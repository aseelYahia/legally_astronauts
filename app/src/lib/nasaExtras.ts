/** Official-challenge NASA/USGS resources added in the data-verification upgrade:
 *  Perseverance raw images (Mars Ground View), USGS SIM 3464 geologic units, CRISM mineral indicators,
 *  Mars Trek HiRISE orthoimagery. Everything here is read from files produced by
 *  analysis/scripts/build_nasa_extras.py; nothing is generated in the browser. */

export interface PhotoLocation {
  geolocated: boolean;
  rmc: string | null;
  lon?: number;
  lat?: number;
  localization_sol?: number;
  localization_note?: string;
  method?: string;
  reason?: string;
}

/** Automatic photo category (PAWPRINT heuristic, not NASA metadata). "other" = rover hardware, sample tubes, blank frames. */
export type PhotoCategory = "landscape" | "geology" | "rocks" | "other";
/** Where the image's NASA localization is relative to the selected sample marker. */
export type PhotoPlace = "at_site" | "nearby" | "regional" | "not_geolocated";

export interface Photo {
  id: string;
  role: "context" | "workspace" | "sample" | "closeup";
  title: string;
  camera: string;
  camera_label: string;
  camera_note: string;
  sol: number;
  date_taken_utc: string;
  date_taken_mars: string;
  credit: string;
  caption: string;
  nasa_page: string;
  json_link: string;
  img_small: string;
  img_medium: string;
  img_large: string;
  img_full: string;
  thumb: string;
  site: number;
  drive: string;
  location: PhotoLocation;
  poi_id: string | null;
  poi_name: string | null;
  context: string;
  category?: PhotoCategory;
  category_label?: string;
  category_reason?: string;
  rank?: number;
  quality?: number;
  place?: PhotoPlace;
  distance_m?: number | null;
  marker_rmc?: string | null;
  mast_az?: number | null;
  mast_el?: number | null;
  dimension?: [number, number];
}

export interface SampleCheck {
  poi_id: string;
  name: string;
  sol: number;
  marker_rmc: string;
  image_rmcs_on_sealing_sol: string[];
  corroborated: boolean;
}

export interface PhotosFile {
  source: string;
  fetched_utc: string;
  note: string;
  photos: Photo[];
  sample_position_check: SampleCheck[];
  selection?: {
    summary: string;
    categories: Record<PhotoCategory, string>;
    places: Record<PhotoPlace, string>;
    thresholds: { nearby_m: number; regional_m: number; [k: string]: number };
  };
}

export interface GeoUnit {
  symbol: string;
  unit: string;
  name: string;
  description: string | null;
  characteristics: string | null;
  interpretation: string | null;
  area_km2_in_aoi: number;
  color: string;
}

export interface GeologyFile extends GeoJSON.FeatureCollection<GeoJSON.MultiPolygon, { symbol: string; objectid: number }> {
  units: GeoUnit[];
  source: string;
  positional_note: string;
}

export interface MineralIndicator {
  key: string;
  parameter: string;
  threshold: number;
  meaning: string;
  color: string;
  km2_in_aoi: number;
}

export interface CrismProduct {
  product_id: string;
  observation_id: string;
  start_time: string;
  url: string;
  label_url: string;
  bytes_read: number;
  pixels_used: number;
  registration: {
    corr_before: number | null;
    corr_after: number;
    shift_px: [number, number];
    accepted: boolean;
    shift_m_north_south: number;
    shift_m_east_west: number;
  };
  footprint?: [number, number][];
}

export interface MineralsLayer {
  file: string;
  bounds: [[number, number], [number, number]];
  kind: string;
  source: string;
  resolution_m: number;
  products: CrismProduct[];
  registration_method: string;
  indicators: MineralIndicator[];
  priority: string[];
  measured_km2: number;
  aoi_km2: number;
  assumptions: string;
}

export interface MineralProbe {
  lon: number;
  lat: number;
  available: boolean;
  measured?: boolean;
  product?: { product_id: string; observation_id: string; start_time: string; label_url: string };
  resolution_m?: number;
  params?: Record<string, number | null>;
  indicators?: { key: string; parameter: string; meaning: string }[];
  note?: string;
}

export const INDICATOR_LABEL: Record<string, string> = {
  mg_carbonate: "Mg-carbonate indicator",
  fe_ca_carbonate: "Ca/Fe-carbonate indicator",
  olivine: "Olivine indicator",
  fe_mg_phyllosilicate: "Fe/Mg clay indicator",
  al_oh: "Al-OH mineral indicator",
  low_ca_pyroxene: "Low-Ca pyroxene indicator",
  hydration: "Hydration (1.9 µm) indicator",
};

export async function loadExtras(): Promise<{ photos: PhotosFile | null; geology: GeologyFile | null }> {
  const get = async <T,>(u: string): Promise<T | null> => {
    try {
      const r = await fetch(u);
      return r.ok ? ((await r.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const [photos, geology] = await Promise.all([get<PhotosFile>("/data/photos.json"), get<GeologyFile>("/data/geology_units.geojson")]);
  return { photos, geology };
}

export async function probeMinerals(lon: number, lat: number): Promise<MineralProbe | null> {
  try {
    const r = await fetch(`/api/minerals?lon=${lon}&lat=${lat}`);
    return r.ok ? ((await r.json()) as MineralProbe) : null;
  } catch {
    return null;
  }
}

function inRing(x: number, y: number, ring: GeoJSON.Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The USGS geologic unit under a point (exterior ring in, holes out), or null. */
export function unitAt(geo: GeologyFile | null, lon: number, lat: number): GeoUnit | null {
  if (!geo) return null;
  for (const f of geo.features) {
    for (const poly of f.geometry.coordinates) {
      if (inRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lon, lat, h))) {
        return geo.units.find((u) => u.symbol === f.properties.symbol) ?? null;
      }
    }
  }
  return null;
}

export function photosForPoi(photos: PhotosFile | null, poiId: string): Photo[] {
  return photos?.photos.filter((p) => p.poi_id === poiId) ?? [];
}

/** Geolocated photos grouped by NASA localization (one map marker per rover position). A NASA image listed under
 *  two neighbouring samples is counted once. */
export function photoSites(photos: PhotosFile | null, maxSol = Infinity): { rmc: string; lon: number; lat: number; photos: Photo[] }[] {
  const by = new Map<string, { rmc: string; lon: number; lat: number; photos: Photo[] }>();
  const seen = new Set<string>();
  for (const p of photos?.photos ?? []) {
    const l = p.location;
    if (!l.geolocated || l.lon === undefined || l.lat === undefined || !l.rmc || p.sol > maxSol || seen.has(p.id)) continue;
    seen.add(p.id);
    const g = by.get(l.rmc) ?? { rmc: l.rmc, lon: l.lon, lat: l.lat, photos: [] };
    g.photos.push(p);
    by.set(l.rmc, g);
  }
  return [...by.values()];
}

export function sampleCheck(photos: PhotosFile | null, poiId: string): SampleCheck | undefined {
  return photos?.sample_position_check.find((c) => c.poi_id === poiId);
}

/* ------------------------------------------------------------------ Ground View gallery helpers */

export type PhotoFilter = "landscape" | "rocks" | "geology" | "all";
export const PHOTO_FILTERS: { key: PhotoFilter; label: string; hint: string }[] = [
  { key: "landscape", label: "Landscape", hint: "Horizon and sky in view" },
  { key: "rocks", label: "Rocks", hint: "Ground and rocks close to the rover, and arm close-ups" },
  { key: "geology", label: "Geological features", hint: "Outcrops, layers and ridges away from the rover" },
  { key: "all", label: "All photos", hint: "Every terrain photo for this place" },
];
export const CATEGORY_LABEL: Record<PhotoCategory, string> = {
  landscape: "Landscape",
  geology: "Geological feature",
  rocks: "Rocks",
  other: "Rover & sample",
};
export const CATEGORY_SHORT: Record<PhotoCategory, string> = { landscape: "Landscape", geology: "Geology", rocks: "Rocks", other: "Rover/sample" };

/** Category with a fallback for files written before the automatic categories existed. */
export function categoryOf(p: Photo): PhotoCategory {
  if (p.category) return p.category;
  return p.role === "sample" || p.role === "workspace" ? "other" : "rocks";
}

/** Place with a fallback: older files only know geolocated / not geolocated. */
export function placeOf(p: Photo): PhotoPlace {
  if (p.place) return p.place;
  return p.location.geolocated ? "at_site" : "not_geolocated";
}

const PLACE_ORDER: PhotoPlace[] = ["at_site", "nearby", "regional", "not_geolocated"];
const CAT_ORDER: PhotoCategory[] = ["landscape", "geology", "rocks", "other"];

/** Main gallery (terrain, best first) and the kept-aside rover/sample frames for one place. */
export function galleryFor(photos: PhotosFile | null, poiId: string): { terrain: Photo[]; other: Photo[] } {
  const list = photosForPoi(photos, poiId)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.rank ?? a.i) - (b.p.rank ?? b.i) || PLACE_ORDER.indexOf(placeOf(a.p)) - PLACE_ORDER.indexOf(placeOf(b.p)) || CAT_ORDER.indexOf(categoryOf(a.p)) - CAT_ORDER.indexOf(categoryOf(b.p)))
    .map((x) => x.p);
  return { terrain: list.filter((p) => categoryOf(p) !== "other"), other: list.filter((p) => categoryOf(p) === "other") };
}

/** Terrain photos for a filter tab; "all" keeps every terrain photo (never the kept-aside rover/sample frames). */
export function filterPhotos(terrain: Photo[], f: PhotoFilter): Photo[] {
  return f === "all" ? terrain : terrain.filter((p) => categoryOf(p) === f);
}

export function filterCounts(terrain: Photo[]): Record<PhotoFilter, number> {
  return {
    landscape: filterPhotos(terrain, "landscape").length,
    rocks: filterPhotos(terrain, "rocks").length,
    geology: filterPhotos(terrain, "geology").length,
    all: terrain.length,
  };
}

/** Plain-language location status. Only NASA localizations are used; nothing is estimated. */
export function placeLabel(p: Photo): { short: string; long: string; tone: "ok" | "near" | "far" | "none" } {
  const l = p.location;
  const d = p.distance_m;
  const dist = d === null || d === undefined ? "" : d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
  switch (placeOf(p)) {
    case "at_site":
      return {
        short: "At this site",
        long: `Verified by NASA metadata: taken at rover localization ${l.rmc}${p.marker_rmc ? ", the same one used for this marker" : ""}.`,
        tone: "ok",
      };
    case "nearby":
      return { short: `Nearby${dist ? ` · ${dist}` : ""}`, long: `Taken at a different NASA rover localization (${l.rmc})${dist ? `, ${dist} from this marker's localization` : ""}.`, tone: "near" };
    case "regional":
      return { short: `Regional${dist ? ` · ${dist}` : ""}`, long: `Taken at NASA rover localization ${l.rmc}${dist ? `, ${dist} from this marker's localization` : ""}: same area, not the same spot.`, tone: "far" };
    default:
      return { short: "Not geolocated", long: l.reason ? `Not placed on the map: ${l.reason}` : "Not placed on the map: no NASA localization for this image.", tone: "none" };
  }
}

/** Short camera name for tiles ("Mastcam-Z (left)" -> "Mastcam-Z"). */
export function shortCamera(label: string): string {
  return label.replace(/\s*\((left|right)\)$/i, "");
}

/** Wrap-around index step for the viewer. */
export function stepIndex(i: number, n: number, dir: 1 | -1): number {
  return n <= 0 ? 0 : (i + dir + n) % n;
}
