import { jsPDF } from "jspdf";
// Inter (SIL Open Font License 1.1) via @expo-google-fonts/inter: covers Latin Extended, Greek, arrows and math symbols.
import interBoldUrl from "@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf?url";
import interRegularUrl from "@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf?url";
import type { CompareResult, EvaSettings, LonLat, Manifest, MissionMode, Objective, Poi, RouteResult, Stop, TeamSlot, WeatherSol } from "../types";
import { OBJECTIVE_META, OBJECTIVE_ORDER, explainComparison } from "./compare";
import { fmtMin, type EvaPlan, type TeamEva } from "./eva";
import { placeLabels, type Rect } from "./labels";
import { formatDistance, formatDuration, formatLat, formatLon, metersPerDegLon, niceScale } from "./mars";
import { NOT_CERTIFIED, SAFETY_THRESHOLDS, steepStretches, type Alert } from "./safety";
import { MISSIONS, campaignWhy } from "./science";
import { C, Kit, SIZE, lineH, type Art, type Kind, type RGB } from "./reportKit";
import type { TeamSummary } from "./team";

export interface ReportInput {
  name: string;
  notes: string;
  mode: MissionMode;
  objective: Objective;
  compare: CompareResult | null;
  route: RouteResult | null;
  stops: Stop[];
  missionId: string | null;
  alerts: Alert[];
  eva: EvaSettings;
  evaPlan: EvaPlan | null;
  team: {
    stops: Partial<Record<TeamSlot, Stop>>;
    routes: { A?: RouteResult; B?: RouteResult; Aret?: RouteResult; Bret?: RouteResult };
    summary: TeamSummary | null;
    errors: { A?: string; B?: string };
    eva?: TeamEva | null;
  } | null;
  manifest: Manifest;
  weather: WeatherSol[];
  pois: Poi[];
  maxSlope: number;
  generatedAt?: Date;
}


/** Fallback used only with jsPDF's built-in Helvetica (Latin-1): map other characters to safe equivalents. */
export function pdfText(t: string): string {
  const map: Record<string, string> = {
    "−": "-", "–": "-", "—": "-", "≥": ">=", "≤": "<=", "≈": "~", "→": "->", "…": "...", "’": "'", "‘": "'", "“": '"', "”": '"',
    "ł": "l", "Ł": "L", "Δ": "delta ", "Σ": "sum ", "√": "sqrt", "⚠": "!", "✓": "v", "★": "*",
  };
  return t.replace(/[^\u0000-ÿ]/g, (c) => map[c] ?? "?");
}

const ROLE: Record<string, string> = { start: "Start", waypoint: "Waypoint", destination: "Destination" };

/** Base64-encoded TTF data for the embedded Unicode font (Inter, SIL Open Font License). */
export interface ReportFonts {
  regular: string;
  bold: string;
}

/** Characters the font cannot draw are replaced; everything the font covers is kept as-is. */
const FALLBACK: Record<string, string> = { "⚠": "!", "✓": "v", "★": "*" };

function makeSafe(doc: jsPDF, font: string): (t: string) => string {
  if (font === "helvetica") return pdfText;
  const fontObj = (doc.internal as unknown as { getFont: (n: string, s: string) => { metadata?: { cmap?: { unicode?: { codeMap?: Record<number, number> } } } } }).getFont(font, "normal");
  const codeMap = fontObj?.metadata?.cmap?.unicode?.codeMap;
  if (!codeMap) return pdfText;
  return (t: string) =>
    Array.from(t)
      .map((ch) => {
        const cp = ch.codePointAt(0)!;
        if (cp < 32 || codeMap[cp]) return ch;
        return FALLBACK[ch] ?? pdfText(ch);
      })
      .join("");
}

/** Which characters in `t` the embedded font cannot draw (used by tests). */
export function missingGlyphs(doc: jsPDF, font: string, t: string): string[] {
  const fontObj = (doc.internal as unknown as { getFont: (n: string, s: string) => { metadata?: { cmap?: { unicode?: { codeMap?: Record<number, number> } } } } }).getFont(font, "normal");
  const codeMap = fontObj?.metadata?.cmap?.unicode?.codeMap ?? {};
  return Array.from(new Set(Array.from(t))).filter((ch) => (ch.codePointAt(0) ?? 0) >= 32 && !codeMap[ch.codePointAt(0)!]);
}

/** Short, readable names for the NASA/USGS datasets (full citations stay in the References). */
const DATASET_SHORT: Record<string, { name: string; use: string }> = {
  ctx_dtm: { name: "CTX elevation model", use: "Heights, slopes and every route calculation (20 m grid)" },
  ctx_ortho: { name: "CTX orbital photo", use: "The map's ground image (6 m pixels)" },
  hirise_dtm: { name: "HiRISE elevation model", use: "Sharper heights and slopes near the landing site (1 m source, routed at 4 m)" },
  rover_traverse: { name: "Perseverance drive path", use: "The rover's real tracks on the map" },
  rover_waypoints: { name: "Perseverance positions", use: "Sample-site and landing positions; elevation checks" },
  meda_weather: { name: "MEDA weather (archived)", use: "Last published temperatures and pressure (April 2024)" },
  samples: { name: "Perseverance sample list", use: "Sample names, sols, dates and types" },
  m2020_raw_images: { name: "Perseverance raw photos", use: "Mars Ground View photos in the app" },
  usgs_sim3464: { name: "USGS geologic map (SIM 3464)", use: "Geologic units shown in the app" },
  crism_mtrdr: { name: "CRISM mineral indicators", use: "Potential mineral indicators shown in the app (not used for routing)" },
  trek_hirise_ortho: { name: "HiRISE orbital photo (Mars Trek)", use: "Close-up ground image near the landing site in the app" },
};

/** Compact, readable link label: DOIs as "doi:…", other links by site name (the full URL stays clickable). */
const SITE_NAME: Record<string, string> = {
  "mars.nasa.gov": "NASA mars.nasa.gov",
  "science.nasa.gov": "NASA Science",
  "pds-geosciences.wustl.edu": "NASA PDS Geosciences",
  "trek.nasa.gov": "NASA Mars Trek",
  "planetarymaps.usgs.gov": "USGS Planetary Maps",
  "pubs.usgs.gov": "USGS Publications",
};
const shortLink = (url: string) => {
  const u = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (u.startsWith("doi.org/")) return `doi:${u.slice(8)}`;
  const host = u.split("/")[0];
  return SITE_NAME[host] ?? host;
};

const SEVERITY_TEXT: Record<string, { tone: "warning" | "caution" | "info"; tag: string; plain: string }> = {
  warning: { tone: "warning", tag: "WARNING", plain: "Likely problem: change the plan before going." },
  caution: { tone: "caution", tag: "CAUTION", plain: "Needs attention: check this before going." },
  info: { tone: "info", tag: "GOOD TO KNOW", plain: "For awareness only." },
};

/** Build the PDF document. mapImage / art are optional so this is testable without a browser canvas. */
export function buildReportPdf(input: ReportInput, mapImage?: string | null, art?: Art | HTMLImageElement | null, fonts?: ReportFonts | null): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let font = "helvetica";
  if (fonts) {
    doc.addFileToVFS("Inter-Regular.ttf", fonts.regular);
    doc.addFont("Inter-Regular.ttf", "Inter", "normal");
    doc.addFileToVFS("Inter-Bold.ttf", fonts.bold);
    doc.addFont("Inter-Bold.ttf", "Inter", "bold");
    font = "Inter";
  }
  const safe = makeSafe(doc, font);
  // Record every string written: the embedded font stores text as glyph IDs, so tests read this log instead.
  const textLog: string[] = [];
  const origText = doc.text.bind(doc) as (...a: unknown[]) => jsPDF;
  (doc as unknown as { text: (...a: unknown[]) => jsPDF }).text = (t: unknown, ...rest: unknown[]) => {
    textLog.push(Array.isArray(t) ? t.join(" ") : String(t));
    return origText(t, ...rest);
  };
  const origLink = doc.textWithLink.bind(doc) as (...a: unknown[]) => number;
  (doc as unknown as { textWithLink: (...a: unknown[]) => number }).textWithLink = (t: unknown, ...rest: unknown[]) => {
    textLog.push(String(t));
    return origLink(t, ...rest);
  };
  (doc as unknown as { textLog: string[] }).textLog = textLog;
  (doc as unknown as { reportFont: string }).reportFont = font;

  const pics: Art = art && "src" in (art as object) ? { cover: art as HTMLImageElement } : ((art as Art) ?? {});
  const k = new Kit(doc, font, safe);
  const now = input.generatedAt ?? new Date();
  const mission = MISSIONS.find((m) => m.id === input.missionId) ?? null;
  const route = input.mode === "solo" ? input.route : null;
  const team = input.mode === "team" ? input.team : null;
  const pois = new Map(input.pois.map((p) => [p.id, p]));
  const ordered = [...input.stops.filter((s) => s.role === "start"), ...input.stops.filter((s) => s.role === "waypoint"), ...input.stops.filter((s) => s.role === "destination")];
  const counts = { warning: 0, caution: 0, info: 0 } as Record<string, number>;
  input.alerts.forEach((a) => (counts[a.severity] = (counts[a.severity] ?? 0) + 1));
  const alertSummary = `${counts.warning} warning${counts.warning === 1 ? "" : "s"}, ${counts.caution} caution${counts.caution === 1 ? "" : "s"}`;
  const alertShort =
    [counts.warning ? `${counts.warning} warning${counts.warning === 1 ? "" : "s"}` : "", counts.caution ? `${counts.caution} caution${counts.caution === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ") || "no alerts";

  // =================================================================== PAGE 1: overview
  doc.setFillColor(...C.navy);
  doc.rect(0, 0, k.W, 36, "F");
  doc.setFillColor(...C.lav);
  doc.rect(0, 36, k.W, 1.2, "F");
  const hasCover = k.image(pics.cover, k.W - k.M - 28, 4, 28, 28);
  k.set(22, true, C.ivory);
  doc.text("PAWPRINT", k.M, 17);
  doc.setTextColor(...C.rose);
  doc.text("MARS", k.M + doc.getTextWidth("PAWPRINT "), 17);
  k.text("Marswalk Mission Briefing · Jezero Crater, Mars", k.M, 21.5, k.CW - (hasCover ? 36 : 0), 11.5, { color: [214, 209, 232] });
  k.text("NASA Space Apps 2026 · Interplanetary Survival Guide: Martian Map", k.M, 28.5, k.CW - (hasCover ? 36 : 0), SIZE.small, { color: [170, 164, 200] });
  k.y = 45;

  k.y += k.text(input.name || "Untitled Marswalk", k.M, k.y, k.CW, SIZE.title, { bold: true, k: 1.2 }) + 2;
  // chips
  let cx = k.M;
  for (const [txt, bg, fg] of [
    [input.mode === "solo" ? "Solo Marswalk" : "Two-astronaut Marswalk", C.lavSoft, [92, 76, 160]],
    ...(route ? [[`Route option: ${OBJECTIVE_META[input.objective].label}`, C.turqSoft, [32, 120, 112]]] : []),
    [`Slope limit ${input.maxSlope}° (planning assumption)`, C.sandSoft, C.sandInk],
    [`Planned ${now.toISOString().slice(0, 10)}`, [238, 238, 244], C.ink2],
  ] as [string, RGB, RGB][]) {
    k.set(8.6, true);
    if (cx + doc.getTextWidth(safe(txt)) + 4.4 > k.M + k.CW) {
      cx = k.M;
      k.y += 6.4;
    }
    cx += k.pill(txt, cx, k.y, bg, fg, 8.6) + 2.2;
  }
  k.y += 8;
  k.facts(
    [
      ["Scientific objective", mission ? mission.title : "No science mission selected"],
      ["Route option", route ? `${OBJECTIVE_META[input.objective].label}: ${OBJECTIVE_META[input.objective].goal}` : "Each astronaut walks a Lower Risk route to the rendezvous"],
    ],
    40,
    10.5,
  );

  // one-minute summary + key metrics
  if (route) {
    const first = ordered[0]?.name ?? "start";
    const last = ordered[ordered.length - 1]?.name ?? "destination";
    const via = ordered.length > 2 ? ` via ${ordered.length - 2} waypoint${ordered.length > 3 ? "s" : ""}` : "";
    k.callout(
      "In one minute",
      `A ${formatDistance(route.distance_m)} walk from ${first} to ${last}${via}, climbing ${Math.round(route.elevation_gain_m)} m. The steepest ground on the route is ${route.max_slope_deg.toFixed(1)}°. Estimated walking time is ${formatDuration(route.walk_time_s)} (an Earth-based model). The plan raised ${alertSummary}.`,
      "note",
    );
    const evaTxt = input.evaPlan ? `Total EVA ${fmtMin(input.evaPlan.totalMin)} incl. science` : "Walking only";
    k.cards([
      { label: "DISTANCE", value: formatDistance(route.distance_m), sub: "Along the ground", kind: "DERIVED", accent: C.turq },
      { label: "ELEVATION GAIN", value: `+${Math.round(route.elevation_gain_m)} m`, sub: `${Math.round(route.elevation_loss_m)} m downhill`, kind: "DERIVED", accent: C.lav },
      { label: "MAX SLOPE", value: `${route.max_slope_deg.toFixed(1)}°`, sub: `Average ${route.mean_slope_deg.toFixed(1)}° · limit ${input.maxSlope}°`, kind: "DERIVED", accent: C.rose },
      { label: "EST. DURATION", value: formatDuration(route.walk_time_s), sub: evaTxt, kind: "ESTIMATE", accent: C.sand },
      { label: "RISK LEVEL", value: route.difficulty.label, sub: `Score ${Math.round(route.difficulty.score)}/100 · ${alertShort}`, kind: "ESTIMATE", accent: counts.warning ? C.rose : C.sand },
    ]);
  } else if (team?.summary) {
    const s = team.summary;
    const te = team.eva;
    const worst = Math.max(team.routes.A?.difficulty.score ?? 0, team.routes.B?.difficulty.score ?? 0);
    const worstLabel = [team.routes.A, team.routes.B].filter(Boolean).sort((a, b) => b!.difficulty.score - a!.difficulty.score)[0]?.difficulty.label ?? "—";
    k.callout(
      "In one minute",
      `Two astronauts walk separate routes to their science stops, then meet at ${team.stops.meet?.name ?? "the rendezvous"} about T+${fmtMin(s.meetMin)} and walk back to their own starts. Together they cover ${formatDistance(s.totalDistance_m)}. The steepest ground is ${s.maxSlope.toFixed(1)}°. The plan raised ${alertSummary}.`,
      "note",
    );
    k.cards([
      { label: "DISTANCE (A + B)", value: formatDistance(s.totalDistance_m), sub: "Outbound legs to the rendezvous", kind: "DERIVED", accent: C.turq },
      { label: "ELEVATION GAIN", value: `+${Math.round(s.totalGain_m)} m`, sub: "Both astronauts combined", kind: "DERIVED", accent: C.lav },
      { label: "MAX SLOPE", value: `${s.maxSlope.toFixed(1)}°`, sub: `Limit ${input.maxSlope}°`, kind: "DERIVED", accent: C.rose },
      { label: "MISSION LENGTH", value: te?.missionMin != null ? fmtMin(te.missionMin) : `T+${fmtMin(s.meetMin)}`, sub: te?.missionMin != null ? "Until both are back" : "Until the rendezvous", kind: "ESTIMATE", accent: C.sand },
      { label: "RISK LEVEL", value: worstLabel, sub: `Worst ${Math.round(worst)}/100 · ${alertShort}`, kind: "ESTIMATE", accent: counts.warning ? C.rose : C.sand },
    ]);
  }

  // map
  if (mapImage) {
    const aspect = MAP_W / MAP_H;
    // keep the map, its legend and the safety note on page 1 when possible
    // legend row + caption + the "not certified" callout below the map, measured exactly
    const below = 5 + k.textH(MAP_CAPTION, k.CW, SIZE.tiny) + 1.6 + 4 + k.textH("Not certified for astronaut safety", k.CW - 37, 11.5, true, 1.3) + 1.4 + k.textH(NOT_CERTIFIED, k.CW - 11, SIZE.body) + 4 + 3 + 2;
    const room = k.bottom - k.y - 2.4 - below;
    let imgH = Math.min(k.CW / aspect, Math.max(room, 62));
    if (room < 62) {
      k.newPage();
      imgH = k.CW / aspect;
    }
    const imgW = imgH * aspect;
    const x0 = k.M + (k.CW - imgW) / 2;
    doc.setFillColor(...C.navy);
    doc.roundedRect(x0 - 0.6, k.y - 0.6, imgW + 1.2, imgH + 1.2, 2.4, 2.4, "F");
    doc.addImage(mapImage, "JPEG", x0, k.y, imgW, imgH);
    k.y += imgH + 2.4;
    // legend
    const items: [string, RGB, boolean][] = route
      ? [[`Selected route (${OBJECTIVE_META[input.objective].label})`, hex(OBJECTIVE_META[input.objective].color), false], ...(input.compare ? ([["Other options", C.muted, true]] as [string, RGB, boolean][]) : []), ["Numbered stops", C.rose, false], ["! Steeper than 15°", C.rose, false]]
      : [["Astronaut A", C.turq, false], ["Astronaut B", C.lav, false], ["Walk back to start", C.muted, true], ["Rendezvous", C.rose, false]];
    k.legend(items);
    k.para(MAP_CAPTION, { size: SIZE.tiny, color: C.muted, gap: 1.6 });
  }
  k.callout("Not certified for astronaut safety", NOT_CERTIFIED, "warning", undefined, "IMPORTANT");

  // =================================================================== PAGE 2: route & science
  k.newPage(route ? "Route, itinerary & science" : "Two-astronaut plan");
  if (route) {
    if (input.compare) {
      k.section("Route options compared", "Which path?", C.turq, pics.sitting);
      k.para("PAWPRINT computed three paths between the same stops. The highlighted row is the one this briefing uses.", { color: C.ink2 });
      const c = input.compare.routes;
      k.table(
        ["Option", "What it optimises", "Distance", "Climb", "Steepest", "Time", "Difficulty"],
        OBJECTIVE_ORDER.map((o) => [
          `${OBJECTIVE_META[o].label}${o === input.objective ? " (selected)" : ""}`,
          OBJECTIVE_META[o].goal,
          formatDistance(c[o].distance_m),
          `+${Math.round(c[o].elevation_gain_m)} m`,
          `${c[o].max_slope_deg.toFixed(1)}°`,
          formatDuration(c[o].walk_time_s),
          `${c[o].difficulty.label} (${Math.round(c[o].difficulty.score)})`,
        ]),
        [26, 47, 21, 17, 18, 17, 28],
        { highlight: OBJECTIVE_ORDER.indexOf(input.objective), align: ["l", "l", "r", "r", "r", "r", "l"], size: 10 },
      );
      k.h2("What this means");
      k.bullets(explainComparison(input.compare), { dot: C.turq });
    }

    k.section("Itinerary", "Step by step", C.lav, null, 40);
    k.table(
      ["#", "Stop", "Role", "Height", "Along route", "Position"],
      ordered.map((s, i) => {
        const idx = route.stop_indices[i];
        return [
          String(i + 1),
          s.name,
          ROLE[s.role],
          idx !== undefined ? `${Math.round(route.profile.elevation_m[idx]).toLocaleString("en-US")} m` : "-",
          idx !== undefined ? formatDistance(route.profile.distance_m[idx]) : "-",
          `${formatLat(s.lat, 4)}, ${formatLon(s.lon, 4)}`,
        ];
      }),
      [8, 44, 24, 22, 24, 48],
      { boldFirst: false, align: ["c", "l", "l", "r", "r", "l"] },
    );
    k.para("Heights are relative to the Mars areoid (Mars's \"sea level\"), so they are negative inside Jezero Crater.", { size: SIZE.small, color: C.muted });

    const sci = ordered.filter((s) => s.poiId && pois.get(s.poiId!)?.category === "sample");
    k.section("Scientific objectives", "Why go there?", C.rose, null, mission ? 52 : 32);
    if (mission) {
      k.callout(mission.title, `${mission.intro} Scientists want to learn: ${mission.learn}`, "info");
    }
    if (sci.length === 0) k.para("No NASA sample sites are in this itinerary.", { color: C.muted });
    sci.forEach((s) => {
      const p = pois.get(s.poiId!)!;
      const facts: [string, string][] = [
        ["Why it matters", campaignWhy(p)],
        ["What NASA collected", `NASA sample table: ${p.type?.startsWith("Rock core") ? "Rock Core" : p.type} (PAWPRINT class: ${p.type}), campaign ${p.campaign}, sealed sol ${p.sol_sealed} (${p.date_sealed})${p.core_length_cm ? `, ${p.core_length_cm} cm core` : ""}.`],
      ];
      // keep the name with its first fact; later rows may continue on the next page
      k.ensure(lineH(12.5) + 1.4 + k.textH(facts[0][1], k.CW - 40, SIZE.body) + 2);
      k.y += k.text(`#${p.number} ${p.name} · ${ROLE[s.role]}`, k.M, k.y, k.CW, 12.5, { bold: true, color: C.roseInk }) + 1.4;
      k.facts(facts, 40);
      k.y -= 1.6;
      k.para(`Position ESTIMATED from the rover's NASA localization (${p.position_method}). PAWPRINT does not identify minerals.`, { size: SIZE.small, color: C.muted, indent: 40, gap: 3 });
    });
    if (input.notes.trim()) {
      k.section("Planner notes", "From the team", C.sand, null, 14);
      k.para(input.notes);
    }
  }

  if (team) {
    k.section("Two-astronaut plan", "Who goes where", C.turq, pics.sitting);
    const slot = (key: TeamSlot) => team.stops[key];
    k.table(
      ["Point", "Place", "Position"],
      (["aStart", "aDest", "bStart", "bDest", "meet"] as TeamSlot[]).map((key) => {
        const st = slot(key);
        const label = { aStart: "A start", aDest: "A destination", bStart: "B start", bDest: "B destination", meet: "Rendezvous" }[key];
        return [label, st?.name ?? "not set", st ? `${formatLat(st.lat, 4)}, ${formatLon(st.lon, 4)}` : "-"];
      }),
      [34, 70, 70],
      { boldFirst: true },
    );
    (["A", "B"] as const).forEach((who) => {
      const r = team.routes[who];
      const leg = who === "A" ? team.summary?.a : team.summary?.b;
      if (r) {
        k.h2(`Astronaut ${who}`);
        k.cards(
          [
            { label: "DISTANCE", value: formatDistance(r.distance_m), kind: "DERIVED", accent: who === "A" ? C.turq : C.lav },
            { label: "CLIMB", value: `+${Math.round(r.elevation_gain_m)} m`, kind: "DERIVED", accent: who === "A" ? C.turq : C.lav },
            { label: "STEEPEST", value: `${r.max_slope_deg.toFixed(1)}°`, kind: "DERIVED", accent: who === "A" ? C.turq : C.lav },
            { label: "TERRAIN GRID", value: `${r.grid.name.toUpperCase()} ${r.grid.resolution_m} m`, kind: "NASA DATA", accent: who === "A" ? C.turq : C.lav },
          ],
          4,
        );
        if (leg) k.para(`Estimated timeline: at the destination by T+${fmtMin(leg.arriveDestMin)}, leaves T+${fmtMin(leg.departDestMin)}, reaches the rendezvous at T+${fmtMin(leg.arriveMeetMin)}.`);
      } else if (team.errors[who]) {
        k.callout(`Astronaut ${who} cannot reach the rendezvous`, `No route fits the constraints (${team.errors[who]}).`, "warning");
      }
    });
    if (team.summary) {
      const s = team.summary;
      k.h2("Together");
      k.facts([
        ["Combined", `${formatDistance(s.totalDistance_m)} walked · +${Math.round(s.totalGain_m)} m · max slope ${s.maxSlope.toFixed(1)}°`],
        ["Rendezvous (estimate)", `T+${fmtMin(s.meetMin)}; ${s.firstToArrive === "together" ? "both arrive at about the same time" : `Astronaut ${s.firstToArrive} waits about ${fmtMin(s.waitMin)}`}`],
      ]);
    }
    k.para(`Times are estimates: Tobler walking time × pace factor ${input.eva.paceFactor} plus ${input.eva.scienceMinPerStop} min of science at each destination.`, { size: SIZE.small, color: C.muted });
    if (input.notes.trim()) {
      k.section("Planner notes", "From the team", C.sand, null, 14);
      k.para(input.notes);
    }
  }

  // =================================================================== PAGE 3: safety & EVA
  k.newPage("Safety & resources");
  k.section("Safety alerts", "Read before you go", C.rose, pics.crawling);
  let sx = k.M;
  for (const sev of ["warning", "caution", "info"] as const) {
    const st = SEVERITY_TEXT[sev];
    const col = sev === "warning" ? C.rose : sev === "caution" ? C.sand : C.lav;
    sx += k.pill(`${counts[sev] ?? 0} ${st.tag.toLowerCase()}`, sx, k.y, col, C.navy, 9) + 2.4;
  }
  k.y += 8;
  k.para("Warnings mean the plan likely breaks a limit; cautions need a check; the rest is for awareness. Thresholds are PAWPRINT planning assumptions, not NASA rules.", { color: C.ink2 });
  if (input.alerts.length === 0) k.callout("No alerts", "No alerts were raised for this plan.", "note");
  input.alerts.forEach((a) => {
    const st = SEVERITY_TEXT[a.severity] ?? SEVERITY_TEXT.info;
    k.callout(a.title, a.why, st.tone, `${st.plain} Source: ${a.source}`, st.tag);
  });

  const u = input.eva.o2Unit;
  if (route && input.evaPlan) {
    const e = input.evaPlan;
    k.section("EVA resources (hypothetical planning estimates)", "Time, oxygen, power", C.lav, null, 50);
    k.para("These are hypothetical planning estimates, not spacesuit telemetry or a NASA-validated model. Every budget and rate was entered by the planner.", { color: C.ink2 });
    const avail = e.availableMin ?? e.totalMin;
    k.bar(
      [
        { label: `Walk out ${fmtMin(e.outboundMin)}`, min: e.outboundMin, color: C.turq },
        { label: `Science ${fmtMin(e.scienceMin)}`, min: e.scienceMin, color: C.sand },
        { label: `Walk back ${fmtMin(e.returnMin)}`, min: e.returnMin, color: C.lav },
        ...(e.availableMin !== null ? [{ label: `Reserve ${fmtMin(e.reserveMin)}`, min: e.reserveMin, color: [200, 196, 222] as RGB }] : []),
      ],
      Math.max(avail, e.totalMin + (e.availableMin !== null ? e.reserveMin : 0)),
      { caption: e.availableMin !== null ? `Bar length = available EVA time (${fmtMin(e.availableMin)}).` : "No available EVA time entered." },
    );
    k.cards(
      [
        { label: "TOTAL EVA", value: fmtMin(e.totalMin), sub: "Walk out + science + walk back", kind: "ESTIMATE", accent: C.lav },
        { label: "TURN BACK BY", value: e.turnBackByMin !== null ? `T+${fmtMin(e.turnBackByMin)}` : "—", sub: e.turnBackByMin !== null ? "Leave the last stop by then" : "Enter EVA time to compute", kind: "ESTIMATE", accent: C.rose },
        { label: "AVAILABLE TIME", value: e.availableMin !== null ? fmtMin(e.availableMin) : "—", sub: e.availableMin !== null ? `Keeps ${input.eva.reservePct}% reserve (${fmtMin(e.reserveMin)})` : "Not entered", kind: "USER INPUT", accent: C.sand },
      ],
      3,
    );
    k.ensure(26);
    const gw = (k.CW - 8) / 2;
    const y0 = k.y;
    const h1 = k.gauge("Oxygen", e.o2?.used ?? null, e.o2?.budget ?? null, e.o2 ? `${e.o2.used.toFixed(2)} of ${e.o2.budget} ${u} used, ${e.o2.remaining.toFixed(2)} remaining (${Math.round(e.o2.remainingPct)}%) at ${input.eva.o2RatePerHour} ${u}/h` : "Budget or rate not entered", k.M, y0, gw);
    const h2 = k.gauge("Power", e.power?.used ?? null, e.power?.budget ?? null, e.power ? `${e.power.used.toFixed(0)} of ${e.power.budget} Wh used, ${e.power.remaining.toFixed(0)} Wh remaining at ${input.eva.powerDrawW} W` : "Budget or draw not entered", k.M + gw + 8, y0, gw);
    k.y = y0 + Math.max(h1, h2) + 4;
    k.para("How these are calculated is in the appendix.", { size: SIZE.small, color: C.muted });
  }

  if (team?.eva) {
    const te = team.eva;
    k.section("Team EVA resources (hypothetical planning estimates)", "Time, oxygen, power", C.lav, null, 50);
    k.para("Not spacesuit telemetry and not a NASA-validated consumption model. Budgets and rates were entered by the planner and apply to each astronaut's suit.", { color: C.ink2 });
    (["A", "B"] as const).forEach((who) => {
      const e = who === "A" ? te.A : te.B;
      if (!e) {
        k.callout(`Astronaut ${who}`, "No return route from the rendezvous to the start, so the EVA cannot be estimated.", "warning");
        return;
      }
      k.ensure(52);
      k.h2(`Astronaut ${who} · total ${fmtMin(e.totalMin)}`, 40);
      k.bar(
        [
          { label: `Out ${fmtMin(e.outboundMin)}`, min: e.outboundMin, color: C.turq },
          { label: `Science ${fmtMin(e.scienceMin)}`, min: e.scienceMin, color: C.sand },
          { label: `Wait ${fmtMin(e.waitMin)}`, min: e.waitMin, color: C.rose },
          { label: `Back ${fmtMin(e.returnMin)}`, min: e.returnMin, color: C.lav },
        ],
        Math.max(e.availableMin ?? e.totalMin, e.totalMin),
        { caption: e.availableMin !== null ? `Bar length = available EVA time (${fmtMin(e.availableMin)}); the grey part is unused time.` : undefined },
      );
      k.para(`Leave rendezvous by ${e.turnBackByMin !== null ? `T+${fmtMin(e.turnBackByMin)} (time left ${fmtMin(e.slackMin ?? 0)})` : "not available (enter EVA time)"}.`, { bold: true });
      const gw = (k.CW - 8) / 2;
      const y0 = k.y;
      const h1 = k.gauge("Oxygen", e.o2?.used ?? null, e.o2?.budget ?? null, e.o2 ? `${e.o2.used.toFixed(2)} of ${e.o2.budget} ${u} used, ${e.o2.remaining.toFixed(2)} remaining (${Math.round(e.o2.remainingPct)}%)` : "Budget or rate not entered", k.M, y0, gw);
      const h2 = k.gauge("Power", e.power?.used ?? null, e.power?.budget ?? null, e.power ? `${e.power.used.toFixed(0)} of ${e.power.budget} Wh used, ${e.power.remaining.toFixed(0)} Wh remaining (${Math.round(e.power.remainingPct)}%)` : "Budget or draw not entered", k.M + gw + 8, y0, gw);
      k.y = y0 + Math.max(h1, h2) + 3;
    });
    k.h2("Combined mission requirements");
    k.facts([
      ["Mission length", te.missionMin !== null ? fmtMin(te.missionMin) : "—"],
      ["Astronaut-time (A + B)", te.personMin !== null ? fmtMin(te.personMin) : "—"],
      ["Combined oxygen", te.o2 ? `${te.o2.used.toFixed(2)} of ${te.o2.budget.toFixed(2)} ${u} (both suits), ${te.o2.remaining.toFixed(2)} remaining` : "budget or rate not entered"],
      ["Combined power", te.power ? `${te.power.used.toFixed(0)} of ${te.power.budget.toFixed(0)} Wh (both batteries), ${te.power.remaining.toFixed(0)} Wh remaining` : "budget or draw not entered"],
    ]);
  }

  // =================================================================== PAGE 4+: sources, assumptions, appendix
  k.breakIfLess(110, "Sources & methods");
  k.section("NASA & USGS data sources", "Where the numbers come from", C.turq, pics.floating);
  k.para("Every map value comes from these public datasets. Click a link to open the source.", { color: C.ink2 });
  const ds = Object.entries(input.manifest.datasets);
  k.table(
    ["Dataset", "Used for", "Provider", "Source"],
    ds.map(([key, d]) => [
      DATASET_SHORT[key]?.name ?? d.title,
      DATASET_SHORT[key]?.use ?? (d.instrument ?? ""),
      d.producer.replace(/ for NASA\/JPL Mars 2020 TRN/, "").replace(/\s*\(.*?\)\s*/g, " ").trim(),
      d.doi ? shortLink(d.doi) : shortLink(d.url),
    ]),
    [34, 49, 39, 52],
    { boldFirst: true, size: 10.5, links: ds.map(([, d]) => [null, null, null, d.doi ?? d.url]) },
  );

  k.section("How to read the labels", "Data honesty", C.lav, null, 30);
  const kinds: [Kind, string][] = [
    ["NASA DATA", "Measured by NASA or USGS instruments."],
    ["DERIVED", "Calculated by PAWPRINT from NASA data (for example slope from elevation)."],
    ["ESTIMATE", "A model result, such as walking time."],
    ["ASSUMPTION", "A planning choice, such as the 25° slope limit."],
    ["USER INPUT", "Entered by the planner, such as oxygen budgets."],
    ["ARCHIVED", "Real but no longer updated, such as the MEDA weather feed."],
  ];
  for (const [kk, txt] of kinds) {
    k.ensure(7);
    k.kind(kk, k.M, k.y);
    k.text(txt, k.M + 30, k.y - 0.2, k.CW - 30, 10.5);
    k.y += 6.6;
  }
  k.y += 2;

  k.section("Scientific limitations and planning assumptions", "Know the limits", C.rose, null, 30);
  k.bullets(
    [
      "Routes come from orbital terrain models (CTX 20 m; the HiRISE window is routed at 4 m). Boulders, small ledges, sand and soil strength are not visible.",
      `Slope classes (10/15/25°), the max walkable slope, alert thresholds (e.g. long walk ≥ ${SAFETY_THRESHOLDS.longDistanceCautionM / 1000} km) and route penalties are PAWPRINT planning assumptions, not NASA safety limits.`,
      "Walking time uses Tobler's hiking function, fitted to Earth hikers. It is not validated for suited astronauts in Mars gravity.",
      "Sample positions are estimated from rover localizations near the sealing sol; NASA's table does not publish coordinates.",
      "Weather values come from NASA's archived MEDA feed (last sol 1133, April 2024); there is no live or forecast weather.",
      "EVA resource values are hypothetical and depend entirely on user-entered budgets and rates.",
      "CRISM mineral layers in the app show potential orbital indicators only (not confirmed minerals) and are not used for routing.",
    ],
    { dot: C.rose },
  );

  k.section("Appendix: methodology & formulas", "For the technically curious", C.sand, null, 40);
  const v = input.manifest.validation_ctx_vs_rover;
  const method: [string, string][] = [
    ["Terrain grid", route ? `${route.grid.name.toUpperCase()} ${route.grid.resolution_m} m · A* search over 8 neighbours` : "CTX 20 m or HiRISE-derived 4 m · A* search over 8 neighbours"],
    ["Slope", "Horn (1981) 3×3 method with true ground spacing (east–west spacing × cos latitude)."],
    ["Walking speed", "Tobler (1993): v = 6·e^(−3.5·|grade + 0.05|) km/h (Earth hiking model)."],
    ...(route
      ? ([
          ["Route objective", OBJECTIVE_META[input.objective].formula],
          ["Effort-weighted time", `${formatDuration(route.est_time_s)} (walking time with PAWPRINT slope penalty)  [estimate]`],
          ["Slope classes on route", `<10° ${(route.slope_class_fraction.easy * 100).toFixed(0)}% · 10–15° ${(route.slope_class_fraction.moderate * 100).toFixed(0)}% · 15–25° ${(route.slope_class_fraction.hazard * 100).toFixed(0)}% · ≥25° ${(route.slope_class_fraction.nogo * 100).toFixed(0)}%`],
          ["Distance detail", `${formatDistance(route.distance_m)} 3-D (map distance ${formatDistance(route.horizontal_distance_m)}); heights ${Math.round(route.elevation_min_m)} to ${Math.round(route.elevation_max_m)} m`],
          ["Difficulty score", `${route.difficulty.label} (${route.difficulty.score}/100): PAWPRINT score from distance, climb and slope classes (weights are assumptions).`],
        ] as [string, string][])
      : []),
    ["Elevation check", `CTX vs NASA rover localization elevations: median ${v.median_m.toFixed(2)} m, MAD ${v.mad_m.toFixed(2)} m over ${v.n} points. A consistency check, not an independent accuracy estimate.`],
  ];
  k.facts(method, 40);
  const formulas = route && input.evaPlan ? input.evaPlan.formulas : team?.eva ? team.eva.formulas : [];
  if (formulas.length) {
    k.h2("EVA formulas");
    k.bullets(formulas, { dot: C.lav, gap: 1 });
  }

  k.section("References", "Full citations", C.turq, null, 20);
  for (const d of Object.values(input.manifest.datasets)) {
    const cite = d.citation ? d.citation : `${d.producer}. ${d.title}.`;
    const lic = `License: ${d.license}.`;
    const h = k.textH(`${cite} ${lic}`, k.CW, 10) + lineH(10) + 1.8;
    k.ensure(h);
    k.y += k.text(`${cite} ${lic}`, k.M, k.y, k.CW, 10, { color: C.ink2 });
    const link = d.doi ?? d.url;
    k.set(10, false, [40, 120, 150]);
    doc.textWithLink(safe(link.length > 88 ? shortLink(link) : link), k.M, k.y + 10 * 0.3528 * 0.78, { url: link });
    k.y += lineH(10) + 1.8;
  }

  k.footer(now.toISOString().slice(0, 16).replace("T", " "));
  return doc;
}

function hex(h: string): RGB {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ------------------------------------------------------------------ //
// Map snapshot: composite the real terrain layers + routes on a canvas
// ------------------------------------------------------------------ //

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`could not load ${src}`));
    img.src = src;
  });
}

const MAP_CAPTION = "USGS Mars 2020 CTX orbital photo with derived height colours and steep-ground shading. North is up; true-distance scale bar.";
const MAP_W = 1400;
const MAP_H = 780;

export async function renderMapSnapshot(input: ReportInput, W = MAP_W, H = MAP_H): Promise<string> {
  const lines: { pts: LonLat[]; color: string; width: number; dash?: number[] }[] = [];
  const pins: { at: LonLat; color: string; label: string; num?: string }[] = [];
  if (input.mode === "solo" && input.route) {
    if (input.compare)
      OBJECTIVE_ORDER.filter((o) => o !== input.objective).forEach((o) =>
        lines.push({ pts: input.compare!.routes[o].path_lonlat, color: OBJECTIVE_META[o].color, width: 3, dash: [10, 8] }),
      );
    lines.push({ pts: input.route.path_lonlat, color: OBJECTIVE_META[input.objective].color, width: 7 });
    const roleColor = { start: "#76C9C2", waypoint: "#A99BDD", destination: "#D98EBA" } as const;
    const ordered = [...input.stops.filter((s) => s.role === "start"), ...input.stops.filter((s) => s.role === "waypoint"), ...input.stops.filter((s) => s.role === "destination")];
    ordered.forEach((s, i) => pins.push({ at: [s.lon, s.lat], color: roleColor[s.role], label: `${i + 1} · ${s.name}`, num: String(i + 1) }));
  }
  if (input.mode === "team" && input.team) {
    const col = { A: "#76C9C2", B: "#A99BDD" } as const;
    (["A", "B"] as const).forEach((w) => input.team!.routes[w] && lines.push({ pts: input.team!.routes[w]!.path_lonlat, color: col[w], width: 7 }));
    (["A", "B"] as const).forEach((w) => {
      const r = input.team!.routes[`${w}ret`];
      if (r) lines.push({ pts: r.path_lonlat, color: col[w], width: 3, dash: [8, 8] });
    });
    const lab: Record<TeamSlot, [string, string]> = { aStart: ["A start", col.A], aDest: ["A dest.", col.A], bStart: ["B start", col.B], bDest: ["B dest.", col.B], meet: ["Rendezvous", "#D98EBA"] };
    (Object.keys(lab) as TeamSlot[]).forEach((k) => input.team!.stops[k] && pins.push({ at: [input.team!.stops[k]!.lon, input.team!.stops[k]!.lat], color: lab[k][1], label: lab[k][0] }));
  }
  const all = [...lines.flatMap((l) => l.pts), ...pins.map((p) => p.at)];
  const a = input.manifest.aoi;
  let lon0 = all.length ? Math.min(...all.map((p) => p[0])) : a.lon_min;
  let lon1 = all.length ? Math.max(...all.map((p) => p[0])) : a.lon_max;
  let lat0 = all.length ? Math.min(...all.map((p) => p[1])) : a.lat_min;
  let lat1 = all.length ? Math.max(...all.map((p) => p[1])) : a.lat_max;
  const padX = Math.max((lon1 - lon0) * 0.18, 0.004);
  const padY = Math.max((lat1 - lat0) * 0.18, 0.004);
  lon0 -= padX; lon1 += padX; lat0 -= padY; lat1 += padY;
  // match canvas aspect (degrees are linear in this equidistant-cylindrical projection)
  const k = Math.min(W / (lon1 - lon0), H / (lat1 - lat0));
  const cx = (lon0 + lon1) / 2;
  const cy = (lat0 + lat1) / 2;
  const X = (lon: number) => W / 2 + (lon - cx) * k;
  const Y = (lat: number) => H / 2 - (lat - cy) * k;

  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1a1b2c";
  g.fillRect(0, 0, W, H);
  const L = input.manifest.layers;
  const draw = async (file: string | undefined, bounds: [[number, number], [number, number]] | undefined, alpha: number, filter = "none") => {
    if (!file || !bounds) return;
    const img = await loadImage(`/data/${file}`);
    const [[la0, lo0], [la1, lo1]] = bounds;
    g.globalAlpha = alpha;
    g.filter = filter;
    g.imageSmoothingEnabled = true;
    g.drawImage(img, X(lo0), Y(la1), X(lo1) - X(lo0), Y(la0) - Y(la1));
    g.globalAlpha = 1;
    g.filter = "none";
  };
  await draw(L.terrain.file, L.terrain.bounds, 1);
  await draw(L.elevation.file, L.elevation.bounds, 0.42, "saturate(0.75)");
  if (L.hirise_elevation) await draw(L.hirise_elevation.file, L.hirise_elevation.bounds, 0.42, "saturate(0.75)");
  await draw(L.slope.file, L.slope.bounds, 0.6, "saturate(0.6)");
  if (L.hirise_slope) await draw(L.hirise_slope.file, L.hirise_slope.bounds, 0.6, "saturate(0.6)");
  // gentle darkening so routes and labels read clearly
  g.fillStyle = "rgba(19,21,34,0.18)";
  g.fillRect(0, 0, W, H);

  for (const l of lines) {
    g.setLineDash([]);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "rgba(19,21,34,0.7)";
    g.lineWidth = l.width + 5;
    g.beginPath();
    l.pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    g.stroke();
    g.setLineDash(l.dash ?? []);
    g.strokeStyle = l.color;
    g.lineWidth = l.width;
    g.stroke();
  }
  g.setLineDash([]);
  // steep markers
  const steepRoutes = input.mode === "solo" && input.route ? [input.route] : input.team ? ([input.team.routes.A, input.team.routes.B].filter(Boolean) as RouteResult[]) : [];
  steepRoutes.forEach((r) =>
    steepStretches(r, 15).forEach((s) => {
      const x = X(s.at[0]);
      const y = Y(s.at[1]);
      g.fillStyle = "#D98EBA";
      g.strokeStyle = "#131522";
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const ang = Math.PI / 8 + (i * Math.PI) / 4;
        g.lineTo(x + 11 * Math.cos(ang), y + 11 * Math.sin(ang));
      }
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = "#131522";
      g.font = "bold 14px sans-serif";
      g.textAlign = "center";
      g.fillText("!", x, y + 5);
    }),
  );
  // pins, then labels placed so they never overlap each other, the pins or the map furniture
  g.textAlign = "left";
  const screenPins = pins.map((p) => ({ x: X(p.at[0]), y: Y(p.at[1]), label: p.label, color: p.color }));
  for (const [i, p] of screenPins.entries()) {
    const num = pins[i].num;
    g.fillStyle = p.color;
    g.strokeStyle = "#F1EDF5";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(p.x, p.y, num ? 13 : 10, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (num) {
      g.fillStyle = "#131522";
      g.font = "bold 16px sans-serif";
      g.textAlign = "center";
      g.fillText(num, p.x, p.y + 5.5);
      g.textAlign = "left";
    }
  }
  g.font = "600 22px sans-serif";
  const reserved: Rect[] = [
    { x: 14, y: 14, w: 52, h: 64 }, // north arrow
    { x: W - 280, y: H - 70, w: 280, h: 70 }, // scale bar
    { x: 0, y: H - 30, w: 700, h: 30 }, // credits
  ];
  const { boxes } = placeLabels(screenPins, (t) => g.measureText(t).width, W, H, { h: 32, pinR: 15, reserved });
  for (const b of boxes) {
    if (b.leader) {
      g.strokeStyle = "rgba(241,237,245,0.85)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(b.ax, b.ay);
      g.lineTo(b.x + (b.x > b.ax ? 0 : b.w), b.y + b.h / 2);
      g.stroke();
    }
    g.fillStyle = "rgba(34,36,56,0.92)";
    g.fillRect(b.x, b.y, b.w, b.h);
    g.fillStyle = "#F1EDF5";
    g.fillText(b.text, b.x + 8, b.y + b.h / 2 + 8);
  }
  // scale bar (true ground distance at the centre latitude)
  const mPerPx = metersPerDegLon(cy) / k;
  const m = niceScale(mPerPx * 220);
  const px = m / mPerPx;
  g.fillStyle = "rgba(34,36,56,0.9)";
  g.fillRect(W - px - 60, H - 64, px + 44, 46);
  g.strokeStyle = "#F1EDF5";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(W - px - 38, H - 34);
  g.lineTo(W - px - 38, H - 26);
  g.lineTo(W - 38, H - 26);
  g.lineTo(W - 38, H - 34);
  g.stroke();
  g.fillStyle = "#F1EDF5";
  g.font = "600 18px sans-serif";
  g.textAlign = "right";
  g.fillText(m >= 1000 ? `${m / 1000} km` : `${m} m`, W - 38, H - 42);
  // north arrow
  g.textAlign = "center";
  g.fillStyle = "rgba(34,36,56,0.9)";
  g.fillRect(18, 18, 44, 56);
  g.fillStyle = "#F1EDF5";
  g.beginPath();
  g.moveTo(40, 26);
  g.lineTo(50, 50);
  g.lineTo(40, 44);
  g.lineTo(30, 50);
  g.closePath();
  g.fill();
  g.font = "bold 16px sans-serif";
  g.fillText("N", 40, 68);
  g.textAlign = "left";
  g.font = "13px sans-serif";
  g.fillStyle = "rgba(241,237,245,0.85)";
  g.fillText("CTX: NASA/JPL/MSSS · DTMs: USGS Astrogeology · HiRISE: NASA/JPL/UArizona", 18, H - 14);
  return c.toDataURL("image/jpeg", 0.88);
}

async function fetchBase64(url: string): Promise<string> {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function loadReportFonts(): Promise<ReportFonts | null> {
  try {
    const [regular, bold] = await Promise.all([fetchBase64(interRegularUrl), fetchBase64(interBoldUrl)]);
    return { regular, bold };
  } catch {
    return null; // falls back to Helvetica with Latin-1 substitutions
  }
}

/** The supplied mascot art, downscaled to small JPEGs so the PDF stays light. */
async function loadArt(): Promise<Art> {
  const one = async (name: string, px: number) => {
    try {
      const img = await loadImage(`/mascot/${name}.jpg`);
      const c = document.createElement("canvas");
      c.width = px;
      c.height = px;
      c.getContext("2d")!.drawImage(img, 0, 0, px, px);
      return c.toDataURL("image/jpeg", 0.86);
    } catch {
      return null;
    }
  };
  const [cover, sitting, floating, crawling] = await Promise.all([
    one("dog-standing-wave", 360),
    one("dog-sitting", 200),
    one("dog-floating", 200),
    one("dog-crawling", 200),
  ]);
  return { cover, sitting, floating, crawling };
}

export async function exportMissionReport(input: ReportInput): Promise<{ pages: number }> {
  const [map, art, fonts] = await Promise.all([renderMapSnapshot(input).catch(() => null), loadArt(), loadReportFonts()]);
  const doc = buildReportPdf(input, map, art, fonts);
  const slug = (input.name || "marswalk").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  doc.save(`${slug || "marswalk"}-mission-report.pdf`);
  const pages = doc.getNumberOfPages();
  (window as unknown as { __pawprintLastReport?: unknown }).__pawprintLastReport = {
    pages,
    mapIncluded: !!map,
    font: (doc as unknown as { reportFont: string }).reportFont,
    bytes: doc.output("arraybuffer").byteLength,
    text: (doc as unknown as { textLog: string[] }).textLog.join("\n"),
  };
  return { pages };
}
