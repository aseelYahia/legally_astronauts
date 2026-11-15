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
    assumption: string;
  };
  units: { symbol: string; name: string; prior: number | null; reason: string | null }[];
  indicator_keys: string[];
  cells: {
    score: (number | null)[];
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

/** Same stops as analysis/pawprint/water.py RAMP (soft turquoise -> lavender). */
export const WATER_RAMP: [number, string][] = [
  [0, "#CEF2EC"],
  [0.3, "#76C9C2"],
  [0.6, "#9FB8E8"],
  [0.85, "#A99BDD"],
  [1, "#7C68CE"],
];

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

export function bandLabel(score: number | null | undefined, bands?: WaterFile["formula"]["bands"]): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return "Insufficient data";
  const b = bands ?? [
    { below: 0.2, label: "Low" },
    { below: 0.4, label: "Modest" },
    { below: 0.6, label: "Moderate" },
    { below: 0.8, label: "High" },
    { below: 1.01, label: "Very high" },
  ];
  return (b.find((x) => score < x.below) ?? b[b.length - 1]).label;
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

  return { index: idx, score, band: bandLabel(score, w.formula.bands), coverage, confidence, components, unit: unit ? { symbol: unit.symbol, name: unit.name } : null, indicators, limitations };
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
