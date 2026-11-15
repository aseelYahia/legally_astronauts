/**
 * Ancient Water Evidence Map: client-side helpers for water_evidence.json
 * (built by analysis/scripts/build_water_evidence.py; the formula lives in analysis/pawprint/water.py).
 *
 * The score is a PROJECT-DEFINED index of orbital/mapping evidence for ANCIENT water-related rocks.
 * It is never a probability of finding water, and says nothing about present-day water, ice or groundwater.
 */

export type ComponentKey = "mineral" | "geology" | "landform";

export interface WaterZone {
  id: string;
  name: string;
  unit: string;
  cells: number;
  area_km2: number;
  score_mean: number;
  score_max: number;
  components_mean: Record<ComponentKey, number | null>;
  target: [number, number];
  target_slope_deg: number | null;
  /** Share of the counted CRISM signal confirmed by a second observation vs seen by only one (audit 2026-11-15). */
  crism_signal?: { replicated_share: number | null; single_share: number | null; contradicted_px_share: number };
  /** Mean score if any missing component were 0 (zones use full-coverage cells, so this equals score_mean). */
  score_low_mean?: number;
  nearest_poi: { id: string; name: string; distance_m: number };
  bbox: [number, number, number, number];
}

export interface RejectedDataset {
  key: string;
  name: string;
  url: string;
  why: string;
}

export interface WaterFile {
  title: string;
  generated_utc: string;
  kind: string;
  not_a_probability: string;
  grid: { lon0: number; lat0: number; dlon: number; dlat: number; rows: number; cols: number; cell_m: number };
  formula: {
    expression: string;
    weights: Record<ComponentKey, number>;
    min_coverage: number;
    mineral: { text: string; thresholds: Record<string, number>; params: Record<string, string> };
    geology: { text: string; unit_prior: Record<string, number>; unit_reason: Record<string, string> };
    landform: { text: string; saturation_m: number };
    bands: { below: number; label: string }[];
    /** One colour per class of the 0-100 evidence index (the PNG uses exactly these). */
    classes?: WaterClass[];
    assumption: string;
  };
  units: { symbol: string; name: string; prior: number | null; reason: string | null }[];
  indicator_keys: string[];
  cells: {
    score: (number | null)[];
    /** 0-100 evidence index = floor(score*100 + 0.5); the map colour is the class of this value. */
    index?: (number | null)[];
    coverage: (number | null)[];
    mineral: (number | null)[];
    geology: (number | null)[];
    landform: (number | null)[];
    relief_m: (number | null)[];
    crism_measured: (number | null)[];
    crism_indicator: (number | null)[];
    crism_weak: (number | null)[];
    /** Share of measured pixels whose signal another observation confirms / only one observation saw / another contradicts (dropped). */
    crism_replicated?: (number | null)[];
    crism_single?: (number | null)[];
    crism_contradicted?: (number | null)[];
    /** Score if every missing component were 0 / 1. */
    score_low?: (number | null)[];
    score_high?: (number | null)[];
    indicator_bits: number[];
    unit: number[];
  };
  zones: WaterZone[];
  zone_threshold: number;
  stats: Record<string, unknown>;
  sources: string[];
  rejected: RejectedDataset[];
}

export interface WaterLayerMeta {
  file: string;
  data: string;
  bounds: [[number, number], [number, number]];
  kind: string;
  cell_m: number;
  zones: number;
}

export interface WaterClass {
  min: number;
  max: number;
  label: string;
  priority: string;
  color: string;
  color_name: string;
}

/** Same values as analysis/pawprint/water.py CLASSES (used if an older water_evidence.json has no classes). */
export const WATER_CLASSES: WaterClass[] = [
  { min: 0, max: 19, label: "Low", priority: "Low priority", color: "#E2F5F1", color_name: "very pale mint" },
  { min: 20, max: 39, label: "Modest", priority: "Modest priority", color: "#A4DED3", color_name: "light turquoise" },
  { min: 40, max: 59, label: "Moderate", priority: "Moderate priority", color: "#86BDE8", color_name: "sky blue" },
  { min: 60, max: 79, label: "High", priority: "High priority", color: "#A388E4", color_name: "violet" },
  { min: 80, max: 100, label: "Very high", priority: "Very high priority", color: "#6A4AC7", color_name: "deep purple" },
];

export const waterClasses = (w: WaterFile | null | undefined): WaterClass[] => w?.formula.classes ?? WATER_CLASSES;

/** 0-100 evidence index, rounded half up exactly like the Python build. */
export const evidenceIndex = (score: number | null | undefined): number | null =>
  score === null || score === undefined || !Number.isFinite(score) ? null : Math.floor(score * 100 + 0.5);

export function classOf(index: number | null, classes: WaterClass[] = WATER_CLASSES): WaterClass | null {
  if (index === null) return null;
  return classes.find((c) => index >= c.min && index <= c.max) ?? null;
}

/** Colour for a 0-1 score (zone chips etc.): the colour of its class. */
export const scoreColor = (score: number, classes: WaterClass[] = WATER_CLASSES) => classOf(evidenceIndex(score), classes)?.color ?? "#999";

export const COMPONENT_LABEL: Record<ComponentKey, string> = {
  mineral: "Water-related minerals (CRISM)",
  geology: "Geologic unit (USGS map)",
  landform: "Landform relief (CTX elevation)",
};

const INDICATOR_NAME: Record<string, string> = {
  mg_carbonate: "Mg-carbonate",
  fe_ca_carbonate: "Fe/Ca-carbonate",
  fe_mg_phyllosilicate: "Fe/Mg clay",
  al_oh: "Al-OH clay / silica",
  hydration: "hydrated mineral",
};

export async function loadWater(path = "/data/water_evidence.json"): Promise<WaterFile | null> {
  try {
    const r = await fetch(path);
    if (!r.ok) return null;
    return (await r.json()) as WaterFile;
  } catch {
    return null;
  }
}

/** Band of a 0-1 score, decided on the displayed 0-100 index so the label always matches the map colour. */
export function bandLabel(score: number | null | undefined, classes?: WaterClass[]): string {
  return classOf(evidenceIndex(score), classes)?.label ?? "Insufficient data";
}

/** Grid cell index at a point, or null outside the map. */
export function cellIndex(w: WaterFile, lon: number, lat: number): number | null {
  const g = w.grid;
  const c = Math.floor((lon - g.lon0) / g.dlon);
  const r = Math.floor((g.lat0 - lat) / g.dlat);
  if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) return null;
  return r * g.cols + c;
}

export interface ComponentExplain {
  key: ComponentKey;
  label: string;
  value: number | null;
  weight: number;
  /** Share of the final score this component contributed (0-1), null if missing. */
  share: number | null;
  text: string;
}

export interface CellExplain {
  index: number;
  score: number | null;
  band: string;
  coverage: number;
  confidence: "Higher" | "Moderate" | "Lower" | "None";
  components: ComponentExplain[];
  unit: { symbol: string; name: string } | null;
  indicators: string[];
  limitations: string[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function explainCell(w: WaterFile, idx: number): CellExplain {
  const C = w.cells;
  const score = C.score[idx];
  const coverage = C.coverage[idx] ?? 0;
  const unitIdx = C.unit[idx];
  const unit = unitIdx >= 0 ? w.units[unitIdx] : null;
  const bits = C.indicator_bits[idx] ?? 0;
  const indicators = w.indicator_keys.filter((_, i) => bits & (1 << i)).map((k) => INDICATOR_NAME[k] ?? k);
  const wts = w.formula.weights;
  const vals: Record<ComponentKey, number | null> = { mineral: C.mineral[idx], geology: C.geology[idx], landform: C.landform[idx] };
  const num = (Object.keys(vals) as ComponentKey[]).reduce((s, k) => s + (vals[k] ?? 0) * wts[k], 0);

  const measured = C.crism_measured[idx] ?? 0;
  const ind = C.crism_indicator[idx] ?? 0;
  const weak = C.crism_weak[idx] ?? 0;
  const repl = C.crism_replicated?.[idx] ?? 0;
  const single = C.crism_single?.[idx] ?? 0;
  const contra = C.crism_contradicted?.[idx] ?? 0;
  const lo = C.score_low?.[idx] ?? null;
  const hi = C.score_high?.[idx] ?? null;
  const relief = C.relief_m[idx];
  const texts: Record<ComponentKey, string> = {
    mineral:
      vals.mineral === null
        ? `CRISM measured only ${pct(measured)} of this cell, so the mineral term is left out (not counted as zero).`
        : ind + weak === 0
          ? `CRISM measured ${pct(measured)} of this cell and found no water-related mineral signal above the app's thresholds.`
          : `${pct(ind)} of measured CRISM pixels pass a water-related indicator threshold and ${pct(weak)} show a weaker signal (≥ 75% of threshold)${indicators.length ? `: ${indicators.join(", ")}` : ""}. ${repl > 0 && single === 0 ? "A second CRISM observation shows a signal at the same spot." : repl > 0 ? "Partly repeated in a second CRISM observation of the same spot." : "Seen by only one CRISM observation, so it cannot be cross-checked."} Potential indicators, not confirmed minerals.`,
    geology:
      vals.geology === null
        ? "No USGS unit is mapped over most of this cell."
        : unit
          ? `Mostly ${unit.symbol} (${unit.name}), prior ${unit.prior ?? "?"}: ${unit.reason ?? ""}`
          : "Mixed units.",
    landform:
      vals.landform === null || relief === null
        ? "No elevation data here."
        : `${Math.round(relief)} m of local relief within ~270 m. Scarps and ridges expose layered rock; relief alone is not water evidence.`,
  };
  const components: ComponentExplain[] = (Object.keys(vals) as ComponentKey[]).map((k) => ({
    key: k,
    label: COMPONENT_LABEL[k],
    value: vals[k],
    weight: wts[k],
    share: vals[k] === null || num <= 0 ? null : ((vals[k] as number) * wts[k]) / num,
    text: texts[k],
  }));

  const limitations = [
    "Weights, unit priors and thresholds are PAWPRINT assumptions, not a calibrated model.",
    "Geologic unit boundaries may be offset 100–200 m from this basemap (USGS read-me).",
    "CRISM pixels are 18 m and co-registered by image correlation; small features may shift by a pixel or two.",
  ];
  if (vals.mineral === null) limitations.unshift("No usable CRISM coverage here: the score relies on mapping and terrain only.");
  else if (ind === 0 && weak > 0) limitations.unshift("Mineral term comes only from weak signals below the indicator thresholds.");
  if (vals.mineral !== null && ind + weak > 0 && repl === 0) limitations.unshift("Mineral signal comes from a single CRISM observation; no second observation covers this spot to confirm it.");
  if (contra > 0) limitations.push(`${pct(contra)} of this cell's CRISM pixels had a signal that a second observation of the same spot did not show; those pixels are not counted.`);
  if (vals.mineral === null && lo !== null && hi !== null) limitations.unshift(`Missing CRISM data: depending on what it would show, the score could be anywhere from ${lo.toFixed(2)} to ${hi.toFixed(2)}. Cells like this are never used for highlighted regions.`);
  if (score === null) limitations.unshift("Too little data in this cell to score it.");

  let confidence: CellExplain["confidence"] = "None";
  // Higher = everything measured AND the mineral term is either zero or confirmed by a second observation.
  if (score !== null) confidence = coverage >= 0.999 && measured >= 0.9 ? (vals.mineral === 0 || (repl > 0 && single === 0) ? "Higher" : "Moderate") : coverage >= 0.85 ? "Moderate" : "Lower";

  return { index: idx, score, band: bandLabel(score, waterClasses(w)), coverage, confidence, components, unit: unit ? { symbol: unit.symbol, name: unit.name } : null, indicators, limitations };
}

export function explainAt(w: WaterFile | null, lon: number, lat: number): CellExplain | null {
  if (!w) return null;
  const i = cellIndex(w, lon, lat);
  return i === null ? null : explainCell(w, i);
}

/** Plain-language "why is this interesting" lines for a highlighted region, strongest driver first. */
export function zoneWhy(w: WaterFile, z: WaterZone): string[] {
  const out: { v: number; t: string }[] = [];
  const m = z.components_mean;
  const unit = w.units.find((u) => u.symbol === z.unit);
  if (m.geology !== null) out.push({ v: m.geology * w.formula.weights.geology, t: `Mapped as ${unit?.name ?? z.unit}. ${unit?.reason ?? ""}` });
  if (m.mineral !== null)
    out.push({
      v: m.mineral * w.formula.weights.mineral,
      t:
        (m.mineral >= 0.5 ? "CRISM shows clustered potential water-related mineral signals (clay- or hydration-type summary parameters) here." : "CRISM shows only scattered or weak water-related mineral signals here.") +
        (z.crism_signal?.replicated_share == null ? "" : z.crism_signal.replicated_share >= 0.5 ? " A second CRISM observation shows signal at the same spots." : " Only one CRISM observation covers these spots, so the signal is unconfirmed."),
    });
  else out.push({ v: -1, t: "No usable CRISM coverage: this region is ranked on mapping and terrain only." });
  if (m.landform !== null)
    out.push({ v: m.landform * w.formula.weights.landform, t: m.landform >= 0.5 ? "Strong local relief (scarps or ridges) where layered rock may be exposed." : "Fairly gentle terrain." });
  return out.sort((a, b) => b.v - a.v).map((x) => x.t);
}

/** A prompt the Expedition Log can show for a water-evidence destination. Ground-truth only: nothing is claimed. */
export function observationPrompt(zoneId: string): string {
  return `Water-evidence target ${zoneId}: look for fine layering, light-toned or cemented rock, veins or nodules, and photograph or describe them. Record what you actually see; the map only says why this spot is worth a look.`;
}

/** Stop name used when a highlighted region becomes the destination ("Water evidence W1 · ..."). */
export const zoneStopName = (z: WaterZone) => `Water evidence ${z.id} · ${z.name}`;
/** Zone id parsed back from a stop/destination name, or null. */
export function zoneIdFromName(name: string | undefined | null): string | null {
  const m = /^Water evidence (W\d+)(?=\s|$)/.exec(name ?? "");
  return m ? m[1] : null;
}

export const WATER_POI_PREFIX = "water:";
export const zonePoiId = (z: WaterZone) => `${WATER_POI_PREFIX}${z.id}`;
export const zoneFromPoiId = (w: WaterFile | null, id: string | undefined) =>
  w && id?.startsWith(WATER_POI_PREFIX) ? w.zones.find((z) => z.id === id.slice(WATER_POI_PREFIX.length)) ?? null : null;


/* ------------------------------------------------------------------------------------------------------------ */
/* Full breakdown for the information panel (visualization upgrade 2026-11-15).                                 */
/* ------------------------------------------------------------------------------------------------------------ */

export interface ComponentBreakdown {
  key: ComponentKey;
  label: string;
  /** 0-100, null when the input is unavailable (NEVER zero for missing data) */
  score: number | null;
  /** Fixed project weight, 0-1 (0.45 / 0.40 / 0.15) */
  weight: number;
  /** Weight actually used in this cell: equal to `weight` when nothing is missing, re-scaled otherwise */
  effectiveWeight: number | null;
  /** Points this component adds to the 0-100 index (sum over components = 100 x score) */
  points: number | null;
  text: string;
  source: string;
}

export interface WaterBreakdown {
  cell: number;
  index: number | null;
  cls: WaterClass | null;
  partial: boolean;
  /** 0-100 range the index could take if missing inputs were 0 or 1; null when nothing is missing */
  range: [number, number] | null;
  confidence: CellExplain["confidence"];
  components: ComponentBreakdown[];
  warnings: string[];
  limitations: string[];
  /** Plain-language "what this colour means and why" */
  summary: string;
  unit: { symbol: string; name: string } | null;
}

export const COMPONENT_SOURCE: Record<ComponentKey, string> = {
  mineral: "NASA MRO CRISM MTRDR summary parameters (PDS Geosciences), 18 m, 3 observations 2007-2011",
  geology: "USGS SIM 3464 geologic map (Sun & Stack 2020), 1:75,000",
  landform: "USGS Mars 2020 TRN CTX DTM, 20 m",
};

const SHORT: Record<ComponentKey, string> = { mineral: "the CRISM mineral signal", geology: "the geologic map", landform: "the terrain" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function waterBreakdown(w: WaterFile, idx: number): WaterBreakdown {
  const e = explainCell(w, idx);
  const classes = waterClasses(w);
  const score = e.score;
  const index = w.cells.index?.[idx] ?? evidenceIndex(score);
  const cls = classOf(index, classes);
  const wts = w.formula.weights;
  const avail = e.components.filter((c) => c.value !== null).reduce((s, c) => s + wts[c.key], 0);
  const partial = score !== null && e.components.some((c) => c.value === null);
  const lo = w.cells.score_low?.[idx];
  const hi = w.cells.score_high?.[idx];
  const range: [number, number] | null = partial && lo != null && hi != null ? [evidenceIndex(lo)!, evidenceIndex(hi)!] : null;
  const components: ComponentBreakdown[] = e.components.map((c) => ({
    key: c.key,
    label: c.label,
    score: c.value === null ? null : Math.round(c.value * 100),
    weight: wts[c.key],
    effectiveWeight: c.value === null || score === null || avail <= 0 ? null : wts[c.key] / avail,
    points: c.value === null || score === null || avail <= 0 ? null : (100 * c.value * wts[c.key]) / avail,
    text: c.text,
    source: COMPONENT_SOURCE[c.key],
  }));
  const warnings: string[] = [];
  for (const c of components)
    if (c.score === null)
      warnings.push(
        c.key === "mineral"
          ? "No usable CRISM observation covers this spot. Missing mineral data is NOT counted as zero: the index uses the other inputs only, re-weighted, and the cell is striped on the map."
          : `${c.label}: no data here. It is left out, not counted as zero.`,
      );
  if (range) warnings.push(`With the missing input measured, the index could be anywhere from ${range[0]} to ${range[1]}. Cells like this are never used for highlighted regions.`);
  if (score === null) warnings.push("Too little data to score this spot (shown hatched grey on the map).");

  let summary: string;
  if (score === null || index === null || !cls) {
    summary = "This spot is hatched grey because too few of the three inputs are available to compute an evidence index. That means unknown, not low.";
  } else {
    const ranked = components.filter((c) => c.points !== null).sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    const parts = ranked.filter((c) => (c.points ?? 0) >= 0.5).map((c) => `${SHORT[c.key]} adds ${Math.round(c.points!)}`);
    const why = parts.length ? `${cap(parts.join(", "))}.` : "None of the inputs adds evidence here.";
    const geo = e.components[1].value;
    const lead =
      geo !== null && e.unit && avail > 0 && (wts.geology * geo) / avail >= 0.3
        ? ` Most of it comes from the USGS map, which maps this spot as ${e.unit.name} (${e.unit.symbol}).`
        : "";
    const mineral = e.components[0].value;
    const mineralNote =
      mineral === null
        ? " There is no CRISM mineral data here, so this colour is provisional (striped)."
        : mineral === 0
          ? " CRISM measured this spot and found no water-related mineral signal above the app's thresholds."
          : "";
    summary = `${cap(cls.color_name)} means an evidence index of ${cls.min}-${cls.max}: ${cls.priority.toLowerCase()} for studying ancient water. This spot scores ${index}. ${why}${lead}${mineralNote}`;
  }
  return { cell: idx, index, cls, partial, range, confidence: e.confidence, components, warnings, limitations: e.limitations, summary, unit: e.unit };
}

export function breakdownAt(w: WaterFile | null, lon: number, lat: number): WaterBreakdown | null {
  if (!w) return null;
  const i = cellIndex(w, lon, lat);
  return i === null ? null : waterBreakdown(w, i);
}
