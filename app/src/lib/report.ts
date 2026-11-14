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

// Soft Cosmic palette
const NAVY: [number, number, number] = [19, 21, 34];
const CHARCOAL: [number, number, number] = [34, 36, 56];
const LAV: [number, number, number] = [169, 155, 221];
const TURQ: [number, number, number] = [118, 201, 194];
const ROSE: [number, number, number] = [217, 142, 186];
const INK: [number, number, number] = [40, 38, 60];
const MUTED: [number, number, number] = [110, 106, 140];

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

class Writer {
  doc: jsPDF;
  y = 0;
  readonly M = 16;
  readonly W: number;
  readonly H: number;
  font: string;
  safe: (t: string) => string;
  constructor(doc: jsPDF, font: string, safe: (t: string) => string) {
    this.doc = doc;
    this.font = font;
    this.safe = safe;
    this.W = doc.internal.pageSize.getWidth();
    this.H = doc.internal.pageSize.getHeight();
  }
  ensure(h: number) {
    if (this.y + h > this.H - 18) {
      this.doc.addPage();
      this.miniHeader();
    }
  }
  miniHeader() {
    const d = this.doc;
    d.setFillColor(...NAVY);
    d.rect(0, 0, this.W, 11, "F");
    d.setFont(this.font, "bold");
    d.setFontSize(9);
    d.setTextColor(241, 237, 245);
    d.text("PAWPRINT", this.M, 7.2);
    d.setTextColor(...ROSE);
    d.text("MARS", this.M + d.getTextWidth("PAWPRINT "), 7.2);
    d.setTextColor(200, 196, 220);
    d.setFont(this.font, "normal");
    d.text("Mission Report", this.W - this.M, 7.2, { align: "right" });
    this.y = 19;
  }
  h2(t: string, color = LAV) {
    this.ensure(14);
    const d = this.doc;
    d.setFillColor(...color);
    d.rect(this.M, this.y - 3.6, 2.2, 5.2, "F");
    d.setFont(this.font, "bold");
    d.setFontSize(13);
    d.setTextColor(...INK);
    d.text(this.safe(t), this.M + 5, this.y + 0.8);
    this.y += 7.5;
  }
  p(t: string, opts: { size?: number; color?: [number, number, number]; bold?: boolean; indent?: number; gap?: number } = {}) {
    const d = this.doc;
    const size = opts.size ?? 9.5;
    d.setFont(this.font, opts.bold ? "bold" : "normal");
    d.setFontSize(size);
    d.setTextColor(...(opts.color ?? INK));
    const lines = d.splitTextToSize(this.safe(t), this.W - 2 * this.M - (opts.indent ?? 0)) as string[];
    const lh = size * 0.43;
    for (const ln of lines) {
      this.ensure(lh + 1);
      d.text(ln, this.M + (opts.indent ?? 0), this.y);
      this.y += lh;
    }
    this.y += opts.gap ?? 1.6;
  }
  kv(rows: [string, string][], colW = 52) {
    const d = this.doc;
    for (const [k, v] of rows) {
      const lines = d.splitTextToSize(this.safe(v), this.W - 2 * this.M - colW) as string[];
      this.ensure(lines.length * 4.1 + 1);
      d.setFont(this.font, "normal");
      d.setFontSize(9);
      d.setTextColor(...MUTED);
      d.text(this.safe(k), this.M, this.y);
      d.setTextColor(...INK);
      lines.forEach((ln, i) => d.text(ln, this.M + colW, this.y + i * 4.1));
      this.y += lines.length * 4.1 + 0.8;
    }
    this.y += 1.5;
  }
  table(head: string[], rows: string[][], widths: number[]) {
    const d = this.doc;
    const x0 = this.M;
    const drawRow = (cells: string[], header: boolean) => {
      d.setFont(this.font, header ? "bold" : "normal");
      d.setFontSize(8.5);
      const wrapped = cells.map((c, i) => d.splitTextToSize(this.safe(c), widths[i] - 2.5) as string[]);
      const h = Math.max(...wrapped.map((w) => w.length)) * 3.7 + 2.4;
      this.ensure(h + 1);
      if (header) {
        d.setFillColor(238, 235, 248);
        d.rect(x0, this.y - 3.6, widths.reduce((a, b) => a + b, 0), h, "F");
      }
      let x = x0;
      wrapped.forEach((w, i) => {
        d.setTextColor(...(header ? INK : INK));
        w.forEach((ln, j) => d.text(ln, x + 1.2, this.y + j * 3.7));
        x += widths[i];
      });
      d.setDrawColor(225, 222, 236);
      d.line(x0, this.y - 3.6 + h, x0 + widths.reduce((a, b) => a + b, 0), this.y - 3.6 + h);
      this.y += h;
    };
    drawRow(head, true);
    rows.forEach((r) => drawRow(r, false));
    this.y += 3;
  }
  callout(title: string, body: string, color: [number, number, number]) {
    const d = this.doc;
    d.setFont(this.font, "normal");
    d.setFontSize(8.8);
    const lines = d.splitTextToSize(this.safe(body), this.W - 2 * this.M - 8) as string[];
    const h = lines.length * 3.9 + 9;
    this.ensure(h + 2);
    d.setFillColor(color[0], color[1], color[2]);
    d.setDrawColor(color[0], color[1], color[2]);
    d.roundedRect(this.M, this.y - 4, this.W - 2 * this.M, h, 2, 2, "S");
    d.setFillColor(color[0], color[1], color[2]);
    d.rect(this.M, this.y - 4, 1.6, h, "F");
    d.setFont(this.font, "bold");
    d.setTextColor(...INK);
    d.text(this.safe(title), this.M + 5, this.y + 0.6);
    d.setFont(this.font, "normal");
    d.setTextColor(...INK);
    lines.forEach((ln, i) => d.text(ln, this.M + 5, this.y + 5 + i * 3.9));
    this.y += h + 2;
  }
}

/** Build the PDF document. mapImage / mascot are optional so this is testable without a browser canvas. */
export function buildReportPdf(input: ReportInput, mapImage?: string | null, mascot?: HTMLImageElement | null, fonts?: ReportFonts | null): jsPDF {
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
  (doc as unknown as { textLog: string[] }).textLog = textLog;
  (doc as unknown as { reportFont: string }).reportFont = font;
  const w = new Writer(doc, font, safe);
  const now = input.generatedAt ?? new Date();
  const mission = MISSIONS.find((m) => m.id === input.missionId) ?? null;
  const route = input.mode === "solo" ? input.route : null;
  const pois = new Map(input.pois.map((p) => [p.id, p]));

  // ---------- Cover header ----------
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, w.W, 34, "F");
  doc.setFillColor(...CHARCOAL);
  doc.rect(0, 34, w.W, 1.2, "F");
  if (mascot) {
    try {
      doc.addImage(mascot, "JPEG", w.M, 6, 22, 22);
    } catch {
      /* mascot optional */
    }
  }
  const tx = mascot ? w.M + 27 : w.M;
  doc.setFont(font, "bold");
  doc.setFontSize(20);
  doc.setTextColor(241, 237, 245);
  doc.text("PAWPRINT", tx, 16);
  doc.setTextColor(...ROSE);
  doc.text("MARS", tx + doc.getTextWidth("PAWPRINT "), 16);
  doc.setFont(font, "normal");
  doc.setFontSize(10);
  doc.setTextColor(201, 196, 217);
  doc.text("Marswalk Mission Report · Jezero Crater, Mars", tx, 23.5);
  doc.setFontSize(8.5);
  doc.text(safe(`NASA Space Apps 2026 · Interplanetary Survival Guide: Martian Map`), tx, 28.5);
  w.y = 46;

  doc.setFont(font, "bold");
  doc.setFontSize(17);
  doc.setTextColor(...INK);
  doc.text(safe(input.name || "Untitled Marswalk"), w.M, w.y);
  w.y += 7;
  w.kv([
    ["Scientific objective", mission ? mission.title : "No science mission selected"],
    ["Mission mode", input.mode === "solo" ? "Solo Marswalk" : "Two-astronaut Marswalk"],
    ["Route option", `${OBJECTIVE_META[input.objective].label}: ${OBJECTIVE_META[input.objective].goal}`],
    ["Planning date", `${now.toLocaleString()} (${now.toISOString()})`],
    ["Max walkable slope", `${input.maxSlope}° (planning assumption)`],
    ["Area", "Jezero Crater, Mars · planetocentric latitude, east-positive longitude"],
  ]);
  w.callout("Not certified for astronaut safety", NOT_CERTIFIED, ROSE);

  // ---------- Map ----------
  if (mapImage) {
    const imgW = w.W - 2 * w.M;
    const imgH = imgW * (900 / 1400);
    w.ensure(imgH + 8);
    doc.addImage(mapImage, "JPEG", w.M, w.y - 2, imgW, imgH);
    w.y += imgH + 1;
    w.p("Map: USGS Mars 2020 TRN CTX orthoimage with derived elevation colours and steep-ground shading. Routes and markers are from this plan. North is up.", { size: 7.8, color: MUTED });
  }

  // ---------- Solo route ----------
  if (route) {
    w.h2("Itinerary");
    const ordered = [...input.stops.filter((s) => s.role === "start"), ...input.stops.filter((s) => s.role === "waypoint"), ...input.stops.filter((s) => s.role === "destination")];
    w.table(
      ["#", "Role", "Name", "Latitude", "Longitude", "Elevation", "Along route"],
      ordered.map((s, i) => {
        const idx = route.stop_indices[i];
        return [
          String(i + 1),
          ROLE[s.role],
          s.name,
          formatLat(s.lat, 4),
          formatLon(s.lon, 4),
          idx !== undefined ? `${Math.round(route.profile.elevation_m[idx])} m` : "-",
          idx !== undefined ? formatDistance(route.profile.distance_m[idx]) : "-",
        ];
      }),
      [8, 22, 42, 25, 25, 22, 34],
    );

    w.h2("Route statistics", TURQ);
    const f = route.slope_class_fraction;
    w.kv([
      ["Distance (3-D)", `${formatDistance(route.distance_m)} (map distance ${formatDistance(route.horizontal_distance_m)})  [derived]`],
      ["Elevation gain / loss", `+${Math.round(route.elevation_gain_m)} m / -${Math.round(route.elevation_loss_m)} m  [derived]`],
      ["Elevation range", `${Math.round(route.elevation_min_m)} to ${Math.round(route.elevation_max_m)} m relative to the Mars areoid  [derived]`],
      ["Max / mean terrain slope", `${route.max_slope_deg.toFixed(1)}° / ${route.mean_slope_deg.toFixed(1)}°  [derived]`],
      ["Slope classes along route", `<10° ${(f.easy * 100).toFixed(0)}% · 10–15° ${(f.moderate * 100).toFixed(0)}% · 15–25° ${(f.hazard * 100).toFixed(0)}% · ≥25° ${(f.nogo * 100).toFixed(0)}%`],
      ["Estimated walking time", `${formatDuration(route.walk_time_s)} (Tobler hiking function, Earth-based)  [estimate]`],
      ["Effort-weighted time", `${formatDuration(route.est_time_s)} (walking time with PAWPRINT slope penalty)  [estimate]`],
      ["Terrain difficulty", `${route.difficulty.label} (${route.difficulty.score}/100, PAWPRINT score)  [estimate]`],
      ["Terrain grid", `${route.grid.name.toUpperCase()} ${route.grid.resolution_m} m · A* search, 8-connected`],
      ["Optimisation objective", OBJECTIVE_META[input.objective].formula],
    ]);

    if (input.compare) {
      w.h2("Route options compared");
      const c = input.compare.routes;
      w.table(
        ["Option", "Distance", "Gain", "Max slope", "Walk time", "Difficulty"],
        OBJECTIVE_ORDER.map((o) => [
          `${OBJECTIVE_META[o].label}${o === input.objective ? " (selected)" : ""}`,
          formatDistance(c[o].distance_m),
          `+${Math.round(c[o].elevation_gain_m)} m`,
          `${c[o].max_slope_deg.toFixed(1)}°`,
          formatDuration(c[o].walk_time_s),
          `${c[o].difficulty.label} ${Math.round(c[o].difficulty.score)}`,
        ]),
        [42, 28, 22, 26, 30, 30],
      );
      explainComparison(input.compare).forEach((n) => w.p(`• ${n}`, { size: 8.8 }));
    }

    const sci = ordered.filter((s) => s.poiId && pois.get(s.poiId!)?.category === "sample");
    w.h2("Scientific destinations", ROSE);
    if (mission) w.p(`Mission: ${mission.title}. ${mission.intro} Scientists want to learn: ${mission.learn}`, { size: 9 });
    if (sci.length === 0) w.p("No NASA sample sites are in this itinerary.", { color: MUTED });
    sci.forEach((s) => {
      const p = pois.get(s.poiId!)!;
      w.p(`#${p.number} ${p.name} (${ROLE[s.role]})`, { bold: true, size: 10, gap: 0.6 });
      w.p(`${campaignWhy(p)} NASA sample table: ${p.type}, campaign ${p.campaign}, sealed sol ${p.sol_sealed} (${p.date_sealed})${p.core_length_cm ? `, ${p.core_length_cm} cm core` : ""}.`, { size: 8.8, gap: 0.6 });
      w.p(`Position ${formatLat(p.lat)}, ${formatLon(p.lon)} is ESTIMATED from the rover's NASA localization (${p.position_method}). PAWPRINT does not detect minerals.`, { size: 8.2, color: MUTED });
    });
  }

  // ---------- Two-astronaut ----------
  if (input.mode === "team" && input.team) {
    const t = input.team;
    w.h2("Two-astronaut plan", TURQ);
    const slot = (k: TeamSlot) => t.stops[k];
    w.table(
      ["Point", "Name", "Latitude", "Longitude"],
      (["aStart", "aDest", "bStart", "bDest", "meet"] as TeamSlot[]).map((k) => {
        const st = slot(k);
        const label = { aStart: "A start", aDest: "A destination", bStart: "B start", bDest: "B destination", meet: "Rendezvous" }[k];
        return [label, st?.name ?? "not set", st ? formatLat(st.lat, 4) : "-", st ? formatLon(st.lon, 4) : "-"];
      }),
      [34, 64, 40, 40],
    );
    (["A", "B"] as const).forEach((who) => {
      const r = t.routes[who];
      if (r) {
        const leg = who === "A" ? t.summary?.a : t.summary?.b;
        w.kv([
          [`Astronaut ${who}`, `${formatDistance(r.distance_m)} · +${Math.round(r.elevation_gain_m)} m · max slope ${r.max_slope_deg.toFixed(1)}° · ${r.grid.name.toUpperCase()} ${r.grid.resolution_m} m`],
          ...(leg ? ([[`  Estimated timeline`, `destination T+${fmtMin(leg.arriveDestMin)}, leaves T+${fmtMin(leg.departDestMin)}, rendezvous T+${fmtMin(leg.arriveMeetMin)}`]] as [string, string][]) : []),
        ]);
      } else if (t.errors[who]) {
        w.p(`Astronaut ${who}: cannot reach the rendezvous under the constraints (${t.errors[who]}).`, { color: ROSE });
      }
    });
    if (t.summary) {
      w.kv([
        ["Combined", `${formatDistance(t.summary.totalDistance_m)} walked · +${Math.round(t.summary.totalGain_m)} m · max slope ${t.summary.maxSlope.toFixed(1)}°`],
        ["Rendezvous (estimate)", `T+${fmtMin(t.summary.meetMin)}; ${t.summary.firstToArrive === "together" ? "both arrive at about the same time" : `Astronaut ${t.summary.firstToArrive} waits about ${fmtMin(t.summary.waitMin)}`}`],
      ]);
    }
    w.p(`Times are estimates: Tobler walking time × pace factor ${input.eva.paceFactor} plus ${input.eva.scienceMinPerStop} min of science at each destination.`, { size: 8.2, color: MUTED });

    const te = t.eva;
    if (te) {
      w.h2("Team EVA resources (hypothetical planning estimates)", LAV);
      w.p("Not spacesuit telemetry and not a NASA-validated consumption model. Budgets and rates were entered by the planner and apply to each astronaut's suit.", { size: 8.5, color: MUTED });
      const u = input.eva.o2Unit;
      const person = (who: "A" | "B", e: EvaPlan | null) => {
        if (!e) {
          w.p(`Astronaut ${who}: no return route from the rendezvous to the start, so the EVA cannot be estimated.`, { color: ROSE });
          return;
        }
        w.kv([
          [`Astronaut ${who}`, `total ${fmtMin(e.totalMin)}: out ${fmtMin(e.outboundMin)}, science ${fmtMin(e.scienceMin)}, wait ${fmtMin(e.waitMin)}, back ${fmtMin(e.returnMin)}`],
          ["  Leave rendezvous by", e.turnBackByMin !== null ? `T+${fmtMin(e.turnBackByMin)} (time left ${fmtMin(e.slackMin ?? 0)})` : "not available (enter EVA time)"],
          ["  Oxygen", e.o2 ? `${e.o2.used.toFixed(2)} of ${e.o2.budget} ${u} used, ${e.o2.remaining.toFixed(2)} remaining (${Math.round(e.o2.remainingPct)}%)` : "budget or rate not entered"],
          ["  Power", e.power ? `${e.power.used.toFixed(0)} of ${e.power.budget} Wh used, ${e.power.remaining.toFixed(0)} Wh remaining (${Math.round(e.power.remainingPct)}%)` : "budget or draw not entered"],
        ]);
      };
      person("A", te.A);
      person("B", te.B);
      w.kv([
        ["Mission length", te.missionMin !== null ? fmtMin(te.missionMin) : "—"],
        ["Astronaut-time (A + B)", te.personMin !== null ? fmtMin(te.personMin) : "—"],
        ["Combined oxygen", te.o2 ? `${te.o2.used.toFixed(2)} of ${te.o2.budget.toFixed(2)} ${u} (both suits), ${te.o2.remaining.toFixed(2)} remaining` : "budget or rate not entered"],
        ["Combined power", te.power ? `${te.power.used.toFixed(0)} of ${te.power.budget.toFixed(0)} Wh (both batteries), ${te.power.remaining.toFixed(0)} Wh remaining` : "budget or draw not entered"],
      ]);
      te.formulas.slice(-3).forEach((f) => w.p(`• ${f}`, { size: 8.2, color: MUTED, gap: 0.4 }));
    }
  }

  // ---------- Safety ----------
  w.h2("Safety alerts", ROSE);
  if (input.alerts.length === 0) w.p("No alerts were raised for this plan.", { color: MUTED });
  input.alerts.forEach((a) => {
    w.p(`[${a.severity.toUpperCase()}] ${a.title}`, { bold: true, size: 9.2, gap: 0.5, color: a.severity === "warning" ? [170, 70, 130] : a.severity === "caution" ? [160, 110, 60] : INK });
    w.p(`${a.why} Source: ${a.source}`, { size: 8.3, indent: 3 });
  });

  // ---------- EVA ----------
  if (input.mode === "solo" && input.evaPlan) {
    const e = input.evaPlan;
    w.h2("EVA resources (hypothetical planning estimates)", LAV);
    w.p("Not spacesuit telemetry and not a NASA-validated consumption model. Every budget and rate below was entered by the planner.", { size: 8.5, color: MUTED });
    w.kv([
      ["Walk out / science / walk back", `${fmtMin(e.outboundMin)} / ${fmtMin(e.scienceMin)} / ${fmtMin(e.returnMin)}`],
      ["Total EVA", fmtMin(e.totalMin)],
      ["Available EVA time", e.availableMin !== null ? `${fmtMin(e.availableMin)} (reserve ${input.eva.reservePct}% = ${fmtMin(e.reserveMin)})` : "not entered"],
      ["Turn back by", e.turnBackByMin !== null ? `T+${fmtMin(e.turnBackByMin)}` : "not available (enter EVA time)"],
      ["Oxygen", e.o2 ? `${e.o2.used.toFixed(2)} of ${e.o2.budget} ${input.eva.o2Unit} used, ${e.o2.remaining.toFixed(2)} remaining (${Math.round(e.o2.remainingPct)}%) at ${input.eva.o2RatePerHour} ${input.eva.o2Unit}/h` : "budget or rate not entered"],
      ["Power", e.power ? `${e.power.used.toFixed(0)} of ${e.power.budget} Wh used, ${e.power.remaining.toFixed(0)} Wh remaining at ${input.eva.powerDrawW} W` : "budget or draw not entered"],
    ]);
    e.formulas.forEach((f) => w.p(`• ${f}`, { size: 8.2, color: MUTED, gap: 0.4 }));
    w.y += 2;
  }

  if (input.notes.trim()) {
    w.h2("Planner notes");
    w.p(input.notes);
  }

  // ---------- Sources ----------
  w.h2("NASA data sources", TURQ);
  Object.values(input.manifest.datasets).forEach((d) => {
    w.p(d.title, { bold: true, size: 9.2, gap: 0.4 });
    w.p(
      [
        d.producer,
        d.instrument ? `Instrument: ${d.instrument}` : "",
        d.resolution_m ? `Resolution: ${d.resolution_m} m/pixel` : "",
        (d as { dates?: string }).dates ? `Dates: ${(d as { dates?: string }).dates}` : "",
        d.doi ? `DOI: ${d.doi.replace("https://doi.org/", "")}` : "",
        `Source: ${d.url}`,
        d.citation ?? "",
        `License: ${d.license}`,
      ]
        .filter(Boolean)
        .join(" · "),
      { size: 7.8, color: MUTED },
    );
  });
  const v = input.manifest.validation_ctx_vs_rover;
  w.p(`Validation: CTX DTM vs NASA rover localization elevations, median ${v.median_m.toFixed(2)} m, MAD ${v.mad_m.toFixed(2)} m over ${v.n} points. Rover elevations are tied to the HiRISE TRN DTM, so this is a consistency check, not an independent accuracy estimate.`, { size: 8.2 });

  // ---------- Limitations ----------
  w.h2("Scientific limitations and planning assumptions", ROSE);
  [
    "Routes are computed on orbital terrain models (CTX 20 m; HiRISE window routed at 4 m). Boulders, small scarps, sand and soil strength are not visible.",
    `Slope classes (10/15/25°), the max walkable slope, alert thresholds (e.g. long walk ≥ ${SAFETY_THRESHOLDS.longDistanceCautionM / 1000} km) and route penalty shapes are PAWPRINT planning assumptions, not NASA safety limits.`,
    "Walking time uses Tobler's hiking function, fitted to Earth hikers; it is not validated for suited astronauts in Mars gravity.",
    "Sample positions are estimated from rover localizations near the sealing sol; NASA's table does not publish coordinates.",
    "Weather values come from NASA's archived MEDA feed (last sol 1133, April 2024); there is no live or forecast weather.",
    "EVA resource values are hypothetical and depend entirely on user-entered budgets and rates.",
    "No CRISM mineral data is included; mineral composition is not mapped.",
  ].forEach((l) => w.p(`• ${l}`, { size: 8.6, gap: 0.8 }));

  // ---------- Footer ----------
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont(font, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(safe(`PAWPRINT MARS · generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC · planning estimate, not certified for astronaut safety`), w.M, w.H - 8);
    doc.text(`Page ${i} of ${n}`, w.W - w.M, w.H - 8, { align: "right" });
  }
  return doc;
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

export async function renderMapSnapshot(input: ReportInput, W = 1400, H = 900): Promise<string> {
  const lines: { pts: LonLat[]; color: string; width: number; dash?: number[] }[] = [];
  const pins: { at: LonLat; color: string; label: string }[] = [];
  if (input.mode === "solo" && input.route) {
    if (input.compare)
      OBJECTIVE_ORDER.filter((o) => o !== input.objective).forEach((o) =>
        lines.push({ pts: input.compare!.routes[o].path_lonlat, color: OBJECTIVE_META[o].color, width: 3, dash: [10, 8] }),
      );
    lines.push({ pts: input.route.path_lonlat, color: OBJECTIVE_META[input.objective].color, width: 5 });
    const roleColor = { start: "#76C9C2", waypoint: "#A99BDD", destination: "#D98EBA" } as const;
    input.stops.forEach((s) => pins.push({ at: [s.lon, s.lat], color: roleColor[s.role], label: s.name }));
  }
  if (input.mode === "team" && input.team) {
    const col = { A: "#76C9C2", B: "#A99BDD" } as const;
    (["A", "B"] as const).forEach((w) => input.team!.routes[w] && lines.push({ pts: input.team!.routes[w]!.path_lonlat, color: col[w], width: 5 }));
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
  await draw(L.elevation.file, L.elevation.bounds, 0.6, "saturate(0.8)");
  if (L.hirise_elevation) await draw(L.hirise_elevation.file, L.hirise_elevation.bounds, 0.6, "saturate(0.8)");
  await draw(L.slope.file, L.slope.bounds, 0.75, "saturate(0.6)");
  if (L.hirise_slope) await draw(L.hirise_slope.file, L.hirise_slope.bounds, 0.75, "saturate(0.6)");

  for (const l of lines) {
    g.setLineDash([]);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "rgba(19,21,34,0.55)";
    g.lineWidth = l.width + 4;
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
  for (const p of screenPins) {
    g.fillStyle = p.color;
    g.strokeStyle = "#F1EDF5";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(p.x, p.y, 9, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.font = "600 20px sans-serif";
  const reserved: Rect[] = [
    { x: 14, y: 14, w: 52, h: 64 }, // north arrow
    { x: W - 280, y: H - 70, w: 280, h: 70 }, // scale bar
    { x: 0, y: H - 30, w: 700, h: 30 }, // credits
  ];
  const { boxes } = placeLabels(screenPins, (t) => g.measureText(t).width, W, H, { h: 28, pinR: 11, reserved });
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
    g.fillText(b.text, b.x + 8, b.y + b.h / 2 + 7);
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

export async function exportMissionReport(input: ReportInput): Promise<{ pages: number }> {
  const [map, mascot, fonts] = await Promise.all([
    renderMapSnapshot(input).catch(() => null),
    loadImage("/mascot/dog-standing-wave.jpg").catch(() => null),
    loadReportFonts(),
  ]);
  const doc = buildReportPdf(input, map, mascot, fonts);
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
