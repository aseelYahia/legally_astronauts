import { useEffect, useMemo, useState, type ReactNode } from "react";
import { OBJECTIVE_META } from "../../lib/compare";
import {
  crismPreview,
  formatCell,
  geologyPreview,
  localizationsPreview,
  photosPreview,
  rasterFacts,
  samplesPreview,
  slopeClassShares,
  traversePreview,
  weatherPreview,
  type MetaFact,
  type Preview,
  type TraverseFile,
} from "../../lib/dataExplainer";
import type { GeologyFile, PhotosFile } from "../../lib/nasaExtras";
import type { Manifest, Poi, WeatherSol } from "../../types";
import { Icon, KindBadge } from "../ui";

type Group = "nasa" | "derived" | "estimate";

interface Formula {
  name: string;
  expr: string;
  plain: string;
}

interface Entry {
  id: string;
  group: Group;
  icon: string;
  title: string;
  kinds: { kind: string; title?: string }[];
  /** manifest.datasets key, for the source link and DOI. */
  dataset?: string;
  /** Code that produces or uses it (shown as text, not a link). */
  code?: string;
  summary: string;
  why: string;
  preview?: Preview | null;
  facts?: MetaFact[];
  thumb?: { src: string; alt: string; caption: string };
  formulas?: Formula[];
  fields?: { name: string; meaning: string }[];
  extra?: ReactNode;
}

const GROUPS: { key: Group | "all"; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "nasa", label: "Original NASA / USGS data" },
  { key: "derived", label: "Derived by PAWPRINT" },
  { key: "estimate", label: "Estimates & assumptions" },
];

export function DataExplainer({
  manifest,
  pois,
  weather,
  photos,
  geology,
}: {
  manifest: Manifest;
  pois: Poi[];
  weather: WeatherSol[];
  photos: PhotosFile | null;
  geology: GeologyFile | null;
}) {
  const [group, setGroup] = useState<Group | "all">("all");
  const [traverse, setTraverse] = useState<TraverseFile | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/data/rover_traverse.geojson")
      .then((r) => (r.ok ? (r.json() as Promise<TraverseFile>) : null))
      .then((t) => live && t && setTraverse(t))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const entries = useMemo(
    () => buildEntries(manifest, pois, weather, photos, geology, traverse),
    [manifest, pois, weather, photos, geology, traverse],
  );
  const shown = entries.filter((e) => group === "all" || e.group === group);

  return (
    <section className="dx" aria-labelledby="dx-title">
      <div className="dx-head">
        <div className="dx-head-text">
          <span className="dx-eyebrow"><Icon name="sparkle" size={13} /> Learn</span>
          <h3 id="dx-title">Understand the Data</h3>
          <p>
            What each dataset is, what one row or one pixel means, and how PAWPRINT turns it into slopes, routes and EVA times. Previews are read
            from the app's real data files, not typed in.
          </p>
        </div>
        <Pipeline />
      </div>

      <div className="dx-filter" role="tablist" aria-label="Filter datasets">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            role="tab"
            aria-selected={group === g.key}
            className={`dx-chip${group === g.key ? " on" : ""} g-${g.key}`}
            onClick={() => setGroup(g.key)}
          >
            {g.label}
            <span className="dx-count">{g.key === "all" ? entries.length : entries.filter((e) => e.group === g.key).length}</span>
          </button>
        ))}
      </div>

      <div className="dx-grid">
        {shown.map((e) => (
          <DxCard key={e.id} e={e} manifest={manifest} />
        ))}
      </div>
    </section>
  );
}

function Pipeline() {
  const steps = [
    { icon: "db", label: "NASA / USGS files", sub: "DTMs, images, feeds", kind: "real" },
    { icon: "files", label: "Python build", sub: "analysis/scripts", kind: "real-derived" },
    { icon: "layers", label: "Web data", sub: "public/data/*", kind: "real-derived" },
    { icon: "route", label: "Route API", sub: "A* on the grid", kind: "estimate" },
    { icon: "walker", label: "Your EVA plan", sub: "your budgets", kind: "assumption" },
  ];
  return (
    <ol className="dx-pipe" aria-label="How data flows through PAWPRINT">
      {steps.map((s) => (
        <li key={s.label} className={`k-${s.kind}`}>
          <span className="dx-pipe-ic"><Icon name={s.icon} size={15} /></span>
          <b>{s.label}</b>
          <em>{s.sub}</em>
        </li>
      ))}
    </ol>
  );
}

type Tab = "preview" | "fields" | "how";

function DxCard({ e, manifest }: { e: Entry; manifest: Manifest }) {
  const ds = e.dataset ? (manifest.datasets as Record<string, { url: string; doi?: string; title: string }>)[e.dataset] : undefined;
  const tabs: { key: Tab; label: string }[] = [
    ...(e.preview || e.facts?.length || e.thumb || e.extra ? [{ key: "preview" as Tab, label: e.preview ? "Real rows" : "What's inside" }] : []),
    ...(e.preview || e.fields ? [{ key: "fields" as Tab, label: "Fields explained" }] : []),
    ...(e.formulas?.length ? [{ key: "how" as Tab, label: e.group === "nasa" ? "How we use it" : "Formula" }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? "preview");
  return (
    <article className={`dx-card g-${e.group}`} id={`dx-${e.id}`}>
      <header className="dx-card-head">
        <span className="dx-ic"><Icon name={e.icon} size={18} /></span>
        <div className="dx-card-title">
          <h4>{e.title}</h4>
          <div className="dx-badges">
            {e.kinds.map((k) => (
              <KindBadge key={k.kind} kind={k.kind} title={k.title} />
            ))}
          </div>
        </div>
      </header>
      {ds && (
        <div className="dx-src">
          <Icon name="link" size={12} />
          <a href={ds.url} target="_blank" rel="noreferrer" title={ds.title}>{hostOf(ds.url)}</a>
          {ds.doi && (
            <a href={ds.doi} target="_blank" rel="noreferrer" className="dx-doi">DOI {ds.doi.replace("https://doi.org/", "")}</a>
          )}
        </div>
      )}
      {!ds && e.code && (
        <div className="dx-src"><Icon name="files" size={12} /> <code>{e.code}</code></div>
      )}
      <p className="dx-summary">{e.summary}</p>
      <p className="dx-why"><Icon name="target" size={13} /> <span><b>Why it matters:</b> {e.why}</span></p>

      {tabs.length > 0 && (
        <details className="dx-more">
          <summary>Learn more</summary>
          <div className="dx-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="dx-panel" role="tabpanel">
            {tab === "preview" && <PreviewPanel e={e} />}
            {tab === "fields" && <FieldsPanel e={e} />}
            {tab === "how" && <FormulaPanel formulas={e.formulas ?? []} code={ds ? e.code : undefined} />}
          </div>
        </details>
      )}
    </article>
  );
}

function hostOf(url: string) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? "/…" : "");
  } catch {
    return url;
  }
}

function PreviewPanel({ e }: { e: Entry }) {
  return (
    <>
      {e.thumb && (
        <figure className="dx-thumb">
          <img src={e.thumb.src} alt={e.thumb.alt} loading="lazy" />
          <figcaption>{e.thumb.caption}</figcaption>
        </figure>
      )}
      {e.facts && e.facts.length > 0 && (
        <dl className="dx-facts">
          {e.facts.map((f) => (
            <div key={f.label} title={`Read from ${f.from}`}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {e.preview && <PreviewTable p={e.preview} />}
      {e.preview === undefined && !e.facts && !e.thumb && !e.extra && <p className="fine muted">Loading…</p>}
      {e.extra}
    </>
  );
}

function PreviewTable({ p }: { p: Preview }) {
  return (
    <div className="dx-preview">
      <p className="dx-rowmeans"><b>One row =</b> {p.rowMeans}</p>
      <div className="table-wrap">
        <table className="data-table dx-table">
          <thead>
            <tr>{p.columns.map((c) => <th key={c.path} title={c.meaning}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.ref}>
                {r.values.map((v, i) => (
                  <td key={i} className={v === null || v === undefined ? "dx-null" : typeof v === "number" ? "num" : ""}>
                    {formatCell(v, p.columns[i])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dx-file">
        <Icon name="files" size={12} /> {p.rows.length} of {p.total.toLocaleString("en-US")} records from <code>{p.file}</code>
        {p.from && <> → <code>{p.from}</code></>}
      </p>
    </div>
  );
}

function FieldsPanel({ e }: { e: Entry }) {
  const fields = e.fields ?? e.preview?.columns.map((c) => ({ name: c.label + (c.unit ? ` (${c.unit})` : ""), meaning: c.meaning })) ?? [];
  return (
    <dl className="dx-fields">
      {fields.map((f) => (
        <div key={f.name}>
          <dt><code>{f.name}</code></dt>
          <dd>{f.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

function FormulaPanel({ formulas, code }: { formulas: Formula[]; code?: string }) {
  return (
    <div className="dx-formulas">
      {formulas.map((f) => (
        <div className="dx-formula" key={f.name}>
          <span className="dx-fname">{f.name}</span>
          <code className="dx-expr">{f.expr}</code>
          <p>{f.plain}</p>
        </div>
      ))}
      {code && <p className="dx-file"><Icon name="files" size={12} /> <code>{code}</code></p>}
    </div>
  );
}

// ------------------------------------------------------------------ //
// Live API example (real call to the local route server)
// ------------------------------------------------------------------ //

function LiveRouteExample({ pois }: { pois: Poi[] }) {
  const a = pois.find((p) => p.id === "landing");
  const b = pois.find((p) => p.id === "sample-1");
  const [state, setState] = useState<"idle" | "busy" | "err">("idle");
  const [out, setOut] = useState<Record<string, unknown> | null>(null);
  if (!a || !b) return null;
  const run = async () => {
    setState("busy");
    try {
      const r = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: [[a.lon, a.lat], [b.lon, b.lat]], objective: "fastest" }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as Record<string, unknown> & { profile?: { distance_m: number[] }; grid?: { name: string; resolution_m: number }; difficulty?: { label: string } };
      setOut({
        distance_m: j.distance_m,
        walk_time_s: j.walk_time_s,
        elevation_gain_m: j.elevation_gain_m,
        max_slope_deg: j.max_slope_deg,
        "difficulty.label": j.difficulty?.label,
        "grid.name": j.grid?.name,
        "grid.resolution_m": j.grid?.resolution_m,
        "profile points": j.profile?.distance_m.length,
      });
      setState("idle");
    } catch {
      setState("err");
    }
  };
  return (
    <div className="dx-live">
      <div className="dx-live-head">
        <span><b>Try it:</b> ask the route server for {a.name} → {b.name}</span>
        <button className="btn-mini lav" onClick={run} disabled={state === "busy"}>
          <Icon name="play" size={12} /> {state === "busy" ? "Planning…" : "POST /api/route"}
        </button>
      </div>
      {state === "err" && <p className="fine muted">The route server is not running, so no live result. Start it with <code>python analysis/server.py</code>.</p>}
      {out && (
        <dl className="dx-facts dx-facts-live">
          {Object.entries(out).map(([k, v]) => (
            <div key={k}>
              <dt><code>{k}</code></dt>
              <dd>{typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v ?? "—")}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function SlopeShares({ manifest }: { manifest: Manifest }) {
  const shares = slopeClassShares(manifest);
  return (
    <div className="dx-shares">
      <p className="dx-rowmeans"><b>Share of the CTX map in each class</b> (from <code>manifest.layers.elevation.stats.slope_class_fraction</code>)</p>
      <div className="dx-bar" role="img" aria-label={shares.map((s) => `${s.label} ${s.pct.toFixed(1)}%`).join(", ")}>
        {shares.map((s) => <span key={s.key} className={`c-${s.key}`} style={{ width: `${Math.max(s.pct, 0.6)}%` }} />)}
      </div>
      <ul className="dx-legend">
        {shares.map((s) => (
          <li key={s.key}><i className={`c-${s.key}`} /> {s.label} <em>{s.range}</em> <b>{s.pct.toFixed(1)}%</b></li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ //
// The catalogue. Every statement here is taken from the project's own files
// (PROJECT_EXPLAINED.md, DATA_VERIFICATION.md, analysis/pawprint/*.py,
// lib/compare.ts, lib/eva.ts, manifest.json).
// ------------------------------------------------------------------ //

function buildEntries(
  manifest: Manifest,
  pois: Poi[],
  weather: WeatherSol[],
  photos: PhotosFile | null,
  geology: GeologyFile | null,
  traverse: TraverseFile | null,
): Entry[] {
  const L = manifest.layers as Record<string, Record<string, unknown> | undefined>;
  const vc = manifest.validation_ctx_vs_rover;
  const vh = manifest.validation_hirise_vs_rover;
  const [c1, c2, c3] = manifest.assumptions.slope_classes_deg;
  const firstThumb = photos?.photos.find((p) => p.thumb && p.location.geolocated);
  const minerals = L.minerals as { indicators?: { key: string; km2_in_aoi: number }[]; products?: unknown[] } | undefined;
  const oliv = minerals?.indicators?.find((i) => i.key === "olivine");

  const out: Entry[] = [
    {
      id: "ctx-dtm",
      group: "nasa",
      icon: "terrain",
      title: "CTX elevation model (DTM)",
      kinds: [{ kind: "real" }],
      dataset: "ctx_dtm",
      code: "analysis/scripts/build_layers.py",
      summary: "A grid of ground heights for the whole map, made by USGS from stereo pairs of the Context Camera on Mars Reconnaissance Orbiter.",
      why: "Every slope, hazard colour, elevation profile and route outside the HiRISE window is computed from this grid.",
      facts: rasterFacts(manifest, "ctx_dtm"),
      thumb: { src: "/data/ctx_elevation.png", alt: "CTX elevation colour map of the area", caption: "ctx_elevation.png: the DTM coloured by height (low = violet, high = peach)." },
      formulas: [
        { name: "Datum", expr: "height = metres above the Mars areoid (MOLA geoid)", plain: "Zero is the planet's equipotential surface, not sea level. Jezero's floor is about 2.5 km below it, so values are negative." },
        { name: "Check against the rover", expr: `CTX − rover elev_geoid: median ${vc.median_m.toFixed(2)} m, MAD ${vc.mad_m.toFixed(2)} m (n = ${vc.n})`, plain: "A consistency check of our georeferencing and datum along the traverse, not an independent accuracy estimate." },
      ],
    },
    {
      id: "ctx-ortho",
      group: "nasa",
      icon: "map",
      title: "CTX orthoimage mosaic",
      kinds: [{ kind: "real" }],
      dataset: "ctx_ortho",
      code: "analysis/scripts/build_layers.py",
      summary: "The grey satellite photo under everything: CTX images corrected for terrain so each pixel sits at its true map position.",
      why: "Lets you see the real ground (dunes, crater rims, the delta) under the computed layers, and anchors CRISM co-registration.",
      facts: rasterFacts(manifest, "ctx_ortho"),
      thumb: { src: "/data/ctx_ortho.png", alt: "CTX orthoimage of the area", caption: "ctx_ortho.png: brightness only, no height information." },
    },
    {
      id: "hirise-dtm",
      group: "nasa",
      icon: "mountain",
      title: "HiRISE elevation model (1 m window)",
      kinds: [{ kind: "real" }],
      dataset: "hirise_dtm",
      code: "analysis/scripts/fetch_hirise_window.py",
      summary: "A much sharper height grid from HiRISE stereo, read only for a window around the landing site.",
      why: "Near the landing site, routes use this grid, so metre-scale bumps that the 20 m CTX grid smooths away are seen.",
      facts: rasterFacts(manifest, "hirise_dtm"),
      thumb: { src: "/data/hirise_elevation.png", alt: "HiRISE elevation colour map", caption: "hirise_elevation.png: the 2 m display version of the window." },
      formulas: [
        { name: "Resampling", expr: "1 m → 2 m (mean of 2×2) → 4 m (mean again) for routing", plain: "Each 4 m routing cell keeps the maximum 2 m slope inside it, so steep spots are not averaged away." },
        ...(vh ? [{ name: "Check against the rover", expr: `HiRISE − rover elev_geoid: median ${(vh.median_m * 100).toFixed(1)} cm, MAD ${(vh.mad_m * 100).toFixed(1)} cm (n = ${vh.n})`, plain: "Centimetre agreement shows NASA's rover positions are tied to this DTM: it confirms our windowing, not absolute accuracy." }] : []),
      ],
    },
  ];
  if (L.hirise_ortho) {
    out.push({
      id: "hirise-ortho",
      group: "nasa",
      icon: "camera",
      title: "HiRISE close-up photo (via Mars Trek)",
      kinds: [{ kind: "real" }],
      dataset: "trek_hirise_ortho",
      summary: "The 25 cm HiRISE orthomosaic, fetched as NASA Mars Trek map tiles for the HiRISE window.",
      why: "Shows individual rocks and ripples where astronauts would actually walk.",
      facts: rasterFacts(manifest, "hirise_ortho"),
      thumb: { src: "/data/hirise_ortho.jpg", alt: "HiRISE orthomosaic of the landing area", caption: "hirise_ortho.jpg: downsampled to about 1.2 m from the 25 cm source." },
    });
  }
  out.push(
    {
      id: "traverse",
      group: "nasa",
      icon: "rover",
      title: "Perseverance traverse path",
      kinds: [{ kind: "real" }],
      dataset: "rover_traverse",
      summary: `Where the rover actually drove: ${String(L.rover?.segments ?? "")} drive segments from sol ${String(L.rover?.sol_min ?? "")} to ${String(L.rover?.sol_max ?? "")} inside the map.`,
      why: "Ground truth for 'a vehicle has crossed this ground', and the base of the mission-timeline slider.",
      preview: traverse ? traversePreview(traverse) : undefined,
    },
    {
      id: "localizations",
      group: "nasa",
      icon: "pin",
      title: "Rover localizations",
      kinds: [{ kind: "real" }],
      dataset: "rover_waypoints",
      summary: "NASA's solved rover positions at the end of each drive, each with an elevation and a site/drive (RMC) counter.",
      why: "They place the sample markers and Ground View photos, and serve as the elevation check for both DTMs.",
      preview: localizationsPreview(pois),
    },
    {
      id: "samples",
      group: "nasa",
      icon: "flag",
      title: "Sample table",
      kinds: [{ kind: "real" }, { kind: "estimated", title: "Marker positions are the last NASA localization on or before the sealing sol" }],
      dataset: "samples",
      summary: "Names, sols, dates and types of Perseverance's sealed samples, transcribed from NASA's sample page.",
      why: "These are the science destinations you can plan walks to. Their positions are estimates, so treat a marker as 'about here'.",
      preview: samplesPreview(pois),
    },
    {
      id: "weather",
      group: "nasa",
      icon: "cloud",
      title: "MEDA daily weather",
      kinds: [{ kind: "archived" }],
      dataset: "meda_weather",
      summary: `The last ${weather.length} sols NASA's public MEDA feed provides. Some sols have no temperature or pressure (shown as null).`,
      why: "Gives a sense of the cold and thin air, but it is not live and not a forecast.",
      preview: weatherPreview(weather),
    },
  );
  if (photos) {
    const pp = photosPreview(photos);
    out.push({
      id: "photos",
      group: "nasa",
      icon: "camera",
      title: "Perseverance raw images",
      kinds: [{ kind: "real" }],
      dataset: "m2020_raw_images",
      code: "analysis/pawprint/photos.py",
      summary: `${photos.photos.length} raw rover photos from the sealing sols, each with NASA's camera, sol, time and site/drive.`,
      why: "Shows what the ground looks like from the surface at each sample site.",
      preview: pp,
      thumb: firstThumb ? { src: `/data/${firstThumb.thumb}`, alt: firstThumb.title, caption: `${firstThumb.title} (NASA/JPL-Caltech).` } : undefined,
      formulas: [
        { name: "Geolocation rule", expr: "photo position = NASA localization with the same site/drive (RMC)", plain: "No exact match means the photo is not placed. The pin is the rover, not the camera target." },
        { name: "Category", expr: "heuristic from camera, pointing and 320 px image statistics", plain: "Landscape / geology / rocks / other are PAWPRINT guesses, not NASA labels." },
      ],
    });
  }
  if (geology) {
    out.push({
      id: "geology",
      group: "nasa",
      icon: "layers",
      title: "USGS geologic map (SIM 3464)",
      kinds: [{ kind: "real" }],
      dataset: "usgs_sim3464",
      code: "analysis/pawprint/geology.py",
      summary: `${geology.units.length} rock units mapped from orbit by Sun & Stack (2020), with USGS descriptions and interpretations.`,
      why: "Tells you which formation you are standing on (crater floor, delta, …) when choosing a destination.",
      preview: geologyPreview(geology),
      formulas: [
        { name: "Unit area (approximation)", expr: "km² = Σ shoelace(lon/lat polygon) × 59,274.7² × cos(18.46°) / 10⁶", plain: "One fixed cos(latitude) factor for the whole map; within about ±0.03 % here. Display-only: areas feed no calculation." },
        { name: "Position caveat", expr: "boundary offset ≈ 100–200 m", plain: "USGS drew the map on a semi-controlled mosaic, so unit edges can be off by that much." },
      ],
    });
  }
  const cp = crismPreview(manifest);
  if (cp) {
    out.push({
      id: "crism",
      group: "derived",
      icon: "crystal",
      title: "CRISM mineral indicators",
      kinds: [{ kind: "real-derived" }, { kind: "assumption", title: "Thresholds and the 4-of-8 neighbour filter are PAWPRINT choices" }],
      dataset: "crism_mtrdr",
      code: "analysis/pawprint/crism.py",
      summary: `Spectral summary parameters from ${minerals?.products?.length ?? 0} CRISM observations, turned into "potential mineral" flags. Strongest here: olivine${oliv ? `, ${oliv.km2_in_aoi} km²` : ""}. Carbonates: none above threshold.`,
      why: "Points to where interesting minerals may be. A flag is a hint, not a confirmed identification.",
      preview: cp,
      facts: rasterFacts(manifest, "crism"),
      thumb: { src: "/data/crism_indicators.png", alt: "CRISM indicator overlay", caption: "crism_indicators.png: coloured where a parameter passes its threshold." },
      formulas: [
        { name: "Flag", expr: "flag = parameter > threshold  AND  ≥ 4 of 8 neighbours flagged", plain: "The neighbour rule removes single-pixel noise. Both thresholds and the rule are assumptions." },
        { name: "Co-registration", expr: "shift = argmax corr(CRISM R770, CTX ortho), |shift| ≤ 30 px; apply if r ≥ 0.3", plain: "Each observation is slid onto the CTX photo until their brightness patterns line up best." },
        { name: "True cell area", expr: "A = R² · Δλ · (sin(φ + Δφ/2) − sin(φ − Δφ/2)),  R = 3,396,190 m", plain: "Cells are 18 m in degrees on both axes, so east–west they are only 18·cos(lat) m wide; each row gets its exact spherical area." },
      ],
    });
  }
  out.push(
    {
      id: "slope",
      group: "derived",
      icon: "warn",
      title: "Slope & hazard classes",
      kinds: [{ kind: "real-derived" }, { kind: "assumption", title: "Class limits are PAWPRINT planning choices, not NASA rules" }],
      code: "analysis/pawprint/terrain.py",
      summary: `Steepness of every grid cell, grouped into easy (< ${c1}°), moderate (${c1}–${c2}°), hazard (${c2}–${c3}°) and no-go (≥ ${c3}°).`,
      why: "Routes may not enter no-go cells, and the colours show where walking gets hard.",
      thumb: { src: "/data/ctx_slope_hazard.png", alt: "Slope hazard colour map", caption: "ctx_slope_hazard.png: the hazard classes on the CTX grid." },
      extra: <SlopeShares manifest={manifest} />,
      formulas: [
        { name: "Horn slope", expr: "slope = atan( √( (∂z/∂x)² + (∂z/∂y)² ) ),  ∂z/∂x from a 3×3 weighted window", plain: "Horn (1981): compares the heights of the 8 neighbours on each side of a cell." },
        { name: "True spacing", expr: "Δx = cell × cos(latitude),  Δy = cell", plain: "On this map projection a pixel is narrower east–west than north–south; ignoring that would underestimate slopes." },
        { name: "Classes", expr: `class = 0 if < ${c1}°, 1 if < ${c2}°, 2 if < ${c3}°, else 3`, plain: "The limits are assumptions you can question: they are not NASA EVA requirements." },
        { name: "Roughness", expr: "TRI = √( (1/8) · Σ (zᵢ − z_centre)² )", plain: "Riley et al. (1999) ruggedness: how much the 8 neighbours differ in height from the centre." },
      ],
    },
    {
      id: "routes",
      group: "estimate",
      icon: "route",
      title: "Routes & comparisons",
      kinds: [{ kind: "estimate", title: "Tobler's hiking model was fitted to Earth hikers, not suited astronauts on Mars" }],
      code: "analysis/pawprint/routing.py · POST /api/route, /api/compare",
      summary: "A* search over the elevation grid finds the best path between your stops for one of three objectives.",
      why: "Turns 'go from A to B' into a distance, a time and a steepest-point you can compare.",
      fields: [
        { name: "distance_m", meaning: "3-D walking distance along the path, metres." },
        { name: "walk_time_s", meaning: "Pure Tobler walking time, seconds (no slope penalty)." },
        { name: "est_time_s", meaning: "Time including the mild slope penalty above 10° (the 'balanced' cost)." },
        { name: "elevation_gain_m / _loss_m", meaning: "Total climbing and descending along the path." },
        { name: "max_slope_deg", meaning: "Steepest Horn slope of any cell on the path." },
        { name: "slope_class_fraction", meaning: "Share of the path in each hazard class." },
        { name: "profile", meaning: "Per-step distance, elevation, slope and time (the elevation chart)." },
        { name: "grid", meaning: "Which DTM was routed on: HiRISE 4 m if every stop is in its window, else CTX 20 m." },
        { name: "similarity / identical", meaning: "/api/compare only: how much the three objective routes overlap." },
      ],
      extra: <LiveRouteExample pois={pois} />,
      formulas: [
        { name: "Tobler speed", expr: "v = 6 · e^(−3.5 · |grade + 0.05|) km/h", plain: "Fastest (6 km/h) on a gentle 5 % downhill, slower on climbs and steep descents. An Earth hiking model." },
        { name: OBJECTIVE_META.fastest.label, expr: OBJECTIVE_META.fastest.formula, plain: OBJECTIVE_META.fastest.goal + "." },
        { name: OBJECTIVE_META.shortest.label, expr: OBJECTIVE_META.shortest.formula, plain: OBJECTIVE_META.shortest.goal + "." },
        { name: OBJECTIVE_META.lower_risk.label, expr: OBJECTIVE_META.lower_risk.formula, plain: OBJECTIVE_META.lower_risk.goal + " (10° → ×2, 15° → ×5, 20° → ×10)." },
        { name: "A* search", expr: "f = cost so far + straight-line distance / max Tobler speed", plain: "The estimate never overstates the remaining cost, so A* returns the optimal path for the chosen objective. Cells over the slope limit are impassable." },
      ],
    },
    {
      id: "eva",
      group: "estimate",
      icon: "clock",
      title: "EVA time & resource estimates",
      kinds: [{ kind: "estimate" }, { kind: "assumption", title: "All budgets and consumption rates are entered by you" }],
      code: "app/src/lib/eva.ts",
      summary: "Planning arithmetic on top of a route: walk out, do science, walk back, and compare against the budgets you enter.",
      why: "Shows when to turn back. PAWPRINT has no oxygen, power or physiology model and no NASA limits: the numbers are yours.",
      fields: [
        { name: "outboundMin / returnMin", meaning: "Walking time there and back, minutes." },
        { name: "scienceMin", meaning: "Your minutes per stop × number of stops." },
        { name: "turnBackByMin", meaning: "Latest time to start walking back and still keep the reserve." },
        { name: "slackMin", meaning: "Spare time after the reserve; negative means the plan does not fit." },
        { name: "o2 / power", meaning: "Budget, used and remaining for the rates you entered." },
      ],
      formulas: [
        { name: "Outbound", expr: "outbound = Tobler walking time × pace factor", plain: "The pace factor lets you slow the Earth-hiker model down for a suited astronaut." },
        { name: "Return", expr: "return = Tobler time along the reversed route × pace factor", plain: "Uphill becomes downhill on the way back, so the return time differs." },
        { name: "Total", expr: "total = outbound + science + (wait) + return", plain: "Wait is the rendezvous time in two-astronaut mode." },
        { name: "Turn back by", expr: "turn back by = available − reserve − return", plain: "Reserve = available time × your reserve %." },
        { name: "Resources", expr: "used = rate per hour × total hours;  remaining = budget − used", plain: "Simple linear use at the rate you enter." },
      ],
    },
  );
  return out;
}
