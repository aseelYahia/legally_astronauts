/**
 * "Understand the Data": preview tables drawn from the REAL data files.
 *
 * Every preview cell is read from a source record by a dotted field path and
 * never typed in by hand. Each row remembers which source record it came from
 * (`ref`), so `dataExplainer.test.ts` can re-open the files and check that every
 * shown value equals `getPath(record, column.path)`.
 */
import type { GeologyFile, PhotosFile } from "./nasaExtras";
import type { Manifest, Poi, WeatherSol } from "../types";

export interface PreviewColumn {
  /** Dotted path into the source record, e.g. "location.rmc". */
  path: string;
  label: string;
  /** Plain-language meaning of the column. */
  meaning: string;
  /** Decimal places to show for numbers (display only; the raw value is kept). */
  digits?: number;
  unit?: string;
}

export interface PreviewRow {
  /** Index of the source record in its file's array (see `Preview.from`). */
  ref: number;
  values: unknown[];
}

export interface Preview {
  /** Which file and array the rows come from, e.g. "pois.json". */
  file: string;
  /** Path of the array inside the file ("" when the file itself is the array). */
  from: string;
  /** What one row is, in plain words. */
  rowMeans: string;
  columns: PreviewColumn[];
  rows: PreviewRow[];
  /** Total records in the source array (the preview shows only a few). */
  total: number;
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function build(
  file: string,
  from: string,
  rowMeans: string,
  records: unknown[],
  columns: PreviewColumn[],
  pickIdx: number[],
): Preview {
  const rows = pickIdx
    .filter((i) => i >= 0 && i < records.length)
    .map((i) => ({ ref: i, values: columns.map((c) => getPath(records[i], c.path)) }));
  return { file, from, rowMeans, columns, rows, total: records.length };
}

/** First `n` indices of `arr` that satisfy `ok`. */
function firstIdx<T>(arr: T[], ok: (x: T) => boolean, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < arr.length && out.length < n; i++) if (ok(arr[i])) out.push(i);
  return out;
}

export function formatCell(v: unknown, c: PreviewColumn): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return c.digits !== undefined ? v.toFixed(c.digits) : String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return v.join(" × ");
  return String(v);
}

// ------------------------------------------------------------------ //
// Tabular datasets
// ------------------------------------------------------------------ //

export function samplesPreview(pois: Poi[]): Preview {
  return build(
    "pois.json",
    "",
    "One sealed Perseverance sample: NASA's name, sol and type, plus the PAWPRINT marker position.",
    pois,
    [
      { path: "number", label: "number", meaning: "NASA sample number, in sealing order." },
      { path: "name", label: "name", meaning: "NASA's name for the sample." },
      { path: "sol_sealed", label: "sol_sealed", meaning: "Mars day (sol) since landing when the tube was sealed." },
      { path: "date_sealed", label: "date_sealed", meaning: "Earth date (UTC) of sealing." },
      { path: "type", label: "type", meaning: "Sample type. NASA's table gives Rock core / Regolith / Atmospheric; the bracketed rock sub-type is a campaign summary." },
      { path: "lat", label: "lat", meaning: "Marker latitude, planetocentric degrees N.", digits: 5 },
      { path: "lon", label: "lon", meaning: "Marker longitude, degrees E (0–360).", digits: 5 },
      { path: "elev_geoid_m", label: "elev_geoid_m", meaning: "Rover localization elevation above the Mars areoid, metres.", digits: 1, unit: "m" },
      { path: "position_offset_sols", label: "position_offset_sols", meaning: "How many sols before sealing the position fix was taken (0 = same sol)." },
    ],
    firstIdx(pois, (p) => p.category === "sample", 4),
  );
}

export function localizationsPreview(pois: Poi[]): Preview {
  return build(
    "pois.json",
    "",
    "One NASA end-of-drive localization (the rover's solved position) used to place a marker.",
    pois,
    [
      { path: "name", label: "name", meaning: "Which marker uses this fix." },
      { path: "position_method", label: "position_method", meaning: "Which NASA localization (RMC = site_drive counter) and sol the position comes from." },
      { path: "lat", label: "lat", meaning: "Localized rover latitude, degrees N.", digits: 5 },
      { path: "lon", label: "lon", meaning: "Localized rover longitude, degrees E.", digits: 5 },
      { path: "elev_geoid_m", label: "elev_geoid_m", meaning: "NASA's elevation for the fix (MMGIS elev_geoid), metres.", digits: 2, unit: "m" },
      { path: "elev_ctx_m", label: "elev_ctx_m", meaning: "CTX DTM elevation read at the same point by PAWPRINT, metres (for comparison).", digits: 2, unit: "m" },
    ],
    firstIdx(pois, (p) => p.category === "sample" && typeof p.position_method === "string", 3),
  );
}

export function weatherPreview(weather: WeatherSol[]): Preview {
  return build(
    "weather.json",
    "sols",
    "One Mars day (sol) of MEDA's daily summary from NASA's public feed.",
    weather,
    [
      { path: "sol", label: "sol", meaning: "Mission sol (Mars days since landing)." },
      { path: "earth_date", label: "earth_date", meaning: "Earth date of that sol." },
      { path: "ls_deg", label: "ls_deg", meaning: "Solar longitude Ls: Mars' season angle (0° = northern spring; 240° ≈ late autumn).", digits: 1, unit: "°" },
      { path: "min_temp_c", label: "min_temp_c", meaning: "Daily minimum air temperature, °C. null = the feed reported no value.", unit: "°C" },
      { path: "max_temp_c", label: "max_temp_c", meaning: "Daily maximum air temperature, °C.", unit: "°C" },
      { path: "pressure_pa", label: "pressure_pa", meaning: "Mean surface pressure, pascals (Earth sea level ≈ 101,325 Pa).", unit: "Pa" },
      { path: "sunrise_lmst", label: "sunrise_lmst", meaning: "Sunrise in Local Mean Solar Time at the rover." },
    ],
    // first two sols (the feed has nulls there) and the last two
    [...new Set([0, 1, weather.length - 2, weather.length - 1])].filter((i) => i >= 0),
  );
}

export interface TraverseFile {
  type: string;
  features: { properties: { sol: number; length_m: number }; geometry: { type: string; coordinates: number[][] } }[];
}

export function traversePreview(trav: TraverseFile): Preview {
  const recs = trav.features.map((f) => ({
    sol: f.properties.sol,
    length_m: f.properties.length_m,
    geometry: { type: f.geometry.type, points: f.geometry.coordinates.length, first: f.geometry.coordinates[0] },
  }));
  return build(
    "rover_traverse.geojson",
    "features",
    "One drive: the line the rover drove on that sol, clipped to the map area.",
    recs,
    [
      { path: "sol", label: "properties.sol", meaning: "Sol of the drive." },
      { path: "length_m", label: "properties.length_m", meaning: "Driven length NASA reports for the segment, metres.", digits: 2, unit: "m" },
      { path: "geometry.type", label: "geometry.type", meaning: "GeoJSON shape: a LineString is an ordered list of points." },
      { path: "geometry.points", label: "points", meaning: "How many lon/lat vertices the line has." },
      { path: "geometry.first", label: "first [lon, lat]", meaning: "First vertex: longitude °E, latitude °N." },
    ],
    [0, 1, 2],
  );
}

/** The traverse preview flattens geometry; tests rebuild the same record from the file. */
export function traverseRecord(f: TraverseFile["features"][number]) {
  return { sol: f.properties.sol, length_m: f.properties.length_m, geometry: { type: f.geometry.type, points: f.geometry.coordinates.length, first: f.geometry.coordinates[0] } };
}

export function photosPreview(photos: PhotosFile): Preview {
  const ph = photos.photos;
  const seen = new Set<string>();
  const idx = firstIdx(ph, (p) => {
    if (seen.has(p.camera_label)) return false;
    seen.add(p.camera_label);
    return true;
  }, 4);
  return build(
    "photos.json",
    "photos",
    "One raw rover image from NASA's feed, with where the rover was when it was taken.",
    ph,
    [
      { path: "sol", label: "sol", meaning: "Sol the image was taken." },
      { path: "camera_label", label: "camera", meaning: "Which rover camera took it." },
      { path: "date_taken_utc", label: "date_taken_utc", meaning: "Earth time (UTC) of the exposure." },
      { path: "location.rmc", label: "location.rmc", meaning: "NASA site_drive counter of the image, matched exactly to a localization." },
      { path: "location.geolocated", label: "geolocated", meaning: "true only when that exact site/drive has a NASA localization." },
      { path: "category_label", label: "category", meaning: "PAWPRINT's automatic category (a heuristic, not a NASA label)." },
      { path: "mast_el", label: "mast_el", meaning: "Camera elevation angle in degrees (negative = looking down).", digits: 1, unit: "°" },
    ],
    idx,
  );
}

export function geologyPreview(geology: GeologyFile): Preview {
  return build(
    "geology_units.geojson",
    "units",
    "One mapped rock unit from USGS SIM 3464, summarised for the map area.",
    geology.units,
    [
      { path: "symbol", label: "symbol", meaning: "USGS unit code (e.g. Jf = Jezero floor)." },
      { path: "name", label: "name", meaning: "USGS unit name." },
      { path: "area_km2_in_aoi", label: "area_km2_in_aoi", meaning: "Area of the unit inside the PAWPRINT map, km² (PAWPRINT calculation).", digits: 2, unit: "km²" },
      { path: "color", label: "color", meaning: "Display colour chosen by PAWPRINT." },
    ],
    geology.units.map((_, i) => i).slice(0, 4),
  );
}

export interface MineralIndicator {
  key: string;
  parameter: string;
  threshold: number;
  meaning: string;
  color: string;
  km2_in_aoi: number;
}

export function crismPreview(manifest: Manifest): Preview | null {
  const m = manifest.layers.minerals as unknown as { indicators: MineralIndicator[] } | undefined;
  if (!m) return null;
  return build(
    "manifest.json",
    "layers.minerals.indicators",
    "One mineral indicator: a CRISM summary parameter and the threshold PAWPRINT applies to it.",
    m.indicators,
    [
      { path: "parameter", label: "parameter", meaning: "CRISM summary-parameter band name (Viviano-Beck et al. 2014)." },
      { path: "threshold", label: "threshold", meaning: "PAWPRINT ASSUMPTION: pixels above this value are flagged." },
      { path: "km2_in_aoi", label: "km2_in_aoi", meaning: "Flagged ground area inside the map, km² (true spherical cell areas).", unit: "km²" },
      { path: "key", label: "key", meaning: "Indicator id used by the app." },
    ],
    m.indicators.map((_, i) => i),
  );
}

// ------------------------------------------------------------------ //
// Raster metadata (grids get facts, not fake rows)
// ------------------------------------------------------------------ //

export interface MetaFact {
  label: string;
  value: string;
  /** Where the value was read from, e.g. "manifest.layers.elevation.stats.shape". */
  from: string;
}

type Stats = Record<string, unknown>;

const fmtBounds = (b: number[][] | undefined) =>
  b ? `${b[0][0].toFixed(3)}–${b[1][0].toFixed(3)}° N, ${b[0][1].toFixed(3)}–${b[1][1].toFixed(3)}° E` : "—";

export function rasterFacts(manifest: Manifest, which: "ctx_dtm" | "ctx_ortho" | "hirise_dtm" | "hirise_ortho" | "crism"): MetaFact[] {
  const L = manifest.layers as Record<string, { bounds?: number[][]; stats?: Stats } & Record<string, unknown>>;
  const D = manifest.datasets as Record<string, { resolution_m?: number; file?: string }>;
  const crs = `${manifest.crs.projection}; Mars sphere R = ${Number(manifest.crs.radius_m).toLocaleString("en-US")} m`;
  if (which === "ctx_dtm") {
    const s = L.elevation.stats as Stats;
    return [
      { label: "Cell size", value: `${D.ctx_dtm.resolution_m} m`, from: "datasets.ctx_dtm.resolution_m" },
      { label: "Grid (rows × cols)", value: (s.shape as number[]).join(" × "), from: "layers.elevation.stats.shape" },
      { label: "One pixel =", value: "mean height of a 20 × 20 m patch, metres above the areoid", from: "datasets.ctx_dtm.vertical_datum" },
      { label: "Value range", value: `${(s.elevation_min_m as number).toFixed(1)} to ${(s.elevation_max_m as number).toFixed(1)} m`, from: "layers.elevation.stats.elevation_min_m / _max_m" },
      { label: "Coverage", value: fmtBounds(L.elevation.bounds), from: "layers.elevation.bounds" },
      { label: "Projection", value: crs, from: "crs" },
    ];
  }
  if (which === "ctx_ortho") {
    return [
      { label: "Cell size", value: `${D.ctx_ortho.resolution_m} m (source)`, from: "datasets.ctx_ortho.resolution_m" },
      { label: "One pixel =", value: "brightness of sunlit ground (8-bit grey); no height", from: "layers.terrain.note" },
      { label: "Display", value: String(L.terrain.note ?? ""), from: "layers.terrain.note" },
      { label: "Coverage", value: fmtBounds(L.terrain.bounds), from: "layers.terrain.bounds" },
      { label: "Projection", value: crs, from: "crs" },
    ];
  }
  if (which === "hirise_dtm") {
    const s = L.hirise_elevation?.stats as Stats | undefined;
    if (!s) return [];
    return [
      { label: "Source cell size", value: `${D.hirise_dtm.resolution_m} m`, from: "datasets.hirise_dtm.resolution_m" },
      { label: "Window (rows × cols)", value: `${(s.shape_1m as number[]).join(" × ")} at 1 m`, from: "layers.hirise_elevation.stats.shape_1m" },
      { label: "Used as", value: "2 m (2×2 mean) for display, 4 m for routing", from: "PROJECT_EXPLAINED.md §HiRISE resampling" },
      { label: "Value range", value: `${(s.elevation_min_m as number).toFixed(1)} to ${(s.elevation_max_m as number).toFixed(1)} m`, from: "layers.hirise_elevation.stats" },
      { label: "Coverage", value: fmtBounds(L.hirise_elevation.bounds), from: "layers.hirise_elevation.bounds" },
    ];
  }
  if (which === "hirise_ortho") {
    const h = L.hirise_ortho;
    if (!h) return [];
    return [
      { label: "Source cell size", value: `${(manifest.datasets as Record<string, { resolution_m?: number }>).trek_hirise_ortho.resolution_m} m`, from: "datasets.trek_hirise_ortho.resolution_m" },
      { label: "Fetched as", value: `Mars Trek WMTS zoom ${h.zoom}, ${h.tiles} tiles`, from: "layers.hirise_ortho.zoom / tiles" },
      { label: "Pixel size", value: `${(h.pixel_deg as number).toExponential(3)}° (≈1.2–1.3 m)`, from: "layers.hirise_ortho.pixel_deg" },
      { label: "Coverage", value: fmtBounds(h.bounds), from: "layers.hirise_ortho.bounds" },
    ];
  }
  const m = L.minerals as (Record<string, unknown> & { bounds?: number[][] }) | undefined;
  if (!m) return [];
  return [
    { label: "Cell size", value: `${m.resolution_m} m (in degrees on both axes)`, from: "layers.minerals.resolution_m" },
    { label: "One pixel =", value: "the strongest flagged indicator there, or nothing", from: "layers.minerals.priority" },
    { label: "Observations", value: String((m.products as unknown[]).length), from: "layers.minerals.products" },
    { label: "Measured area", value: `${m.measured_km2} of ${m.aoi_km2} km²`, from: "layers.minerals.measured_km2 / aoi_km2" },
    { label: "Coverage", value: fmtBounds(m.bounds), from: "layers.minerals.bounds" },
  ];
}

/** Hazard class shares of the CTX grid, from the manifest. */
export function slopeClassShares(manifest: Manifest): { key: string; label: string; range: string; pct: number }[] {
  const s = manifest.layers.elevation.stats as Stats;
  const f = s.slope_class_fraction as Record<string, number>;
  const [a, b, c] = manifest.assumptions.slope_classes_deg as number[];
  return [
    { key: "easy", label: "Easy", range: `< ${a}°`, pct: f.easy * 100 },
    { key: "moderate", label: "Moderate", range: `${a}–${b}°`, pct: f.moderate * 100 },
    { key: "hazard", label: "Hazard", range: `${b}–${c}°`, pct: f.hazard * 100 },
    { key: "nogo", label: "No-go", range: `≥ ${c}°`, pct: f.nogo * 100 },
  ];
}
