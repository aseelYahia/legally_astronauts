export type LonLat = [number, number];

export type DataKind = "real" | "real-derived" | "estimate" | "simulated" | "unavailable";

export interface LayerInfo {
  file: string;
  bounds?: [[number, number], [number, number]];
  kind: string;
  source: string;
  [k: string]: unknown;
}

export interface Dataset {
  title: string;
  url: string;
  file?: string;
  instrument?: string;
  resolution_m?: number;
  vertical_datum?: string;
  producer: string;
  citation?: string;
  doi?: string;
  license: string;
  kind: string;
  note?: string;
}

export interface Validation {
  n: number;
  median_m: number;
  mad_m: number;
  p05_m: number;
  p95_m: number;
  note?: string;
  usgs_reported_median_offset_m?: number;
}

export interface Manifest {
  generated_utc: string;
  crs: Record<string, string | number>;
  aoi: { lon_min: number; lon_max: number; lat_min: number; lat_max: number };
  layers: Record<string, LayerInfo>;
  datasets: Record<string, Dataset>;
  assumptions: { slope_classes_deg: number[]; default_max_slope_deg: number; note: string };
  validation_ctx_vs_rover: Validation;
  validation_hirise_vs_ctx?: Validation;
  validation_hirise_vs_rover?: Validation;
}

export interface Poi {
  id: string;
  name: string;
  category: "landing" | "sample";
  lon: number;
  lat: number;
  description?: string;
  position_quality: "measured" | "estimated";
  position_method?: string;
  number?: number;
  sol_sealed?: number;
  date_sealed?: string;
  type?: string;
  campaign?: string;
  core_length_cm?: number | null;
  elev_geoid_m?: number | null;
  elev_ctx_m?: number | null;
}

export interface WeatherSol {
  sol: number;
  earth_date: string;
  ls_deg: number;
  season: string;
  min_temp_c: number | null;
  max_temp_c: number | null;
  pressure_pa: number | null;
  sunrise_lmst: string;
  sunset_lmst: string;
}

export interface RouteResult {
  distance_m: number;
  horizontal_distance_m: number;
  elevation_start_m: number;
  elevation_end_m: number;
  elevation_gain_m: number;
  elevation_loss_m: number;
  elevation_min_m: number;
  elevation_max_m: number;
  max_slope_deg: number;
  mean_slope_deg: number;
  slope_class_fraction: { easy: number; moderate: number; hazard: number; nogo: number };
  est_time_s: number;
  difficulty: { score: number; label: string };
  profile: { distance_m: number[]; elevation_m: number[] };
  path_lonlat: LonLat[];
  stop_indices: number[];
  grid: { name: string; resolution_m: number };
  max_slope_limit_deg: number;
  compute_ms: number;
  model: { kind: string; note: string };
}

export type StopRole = "start" | "waypoint" | "destination";

export interface Stop {
  id: string;
  role: StopRole;
  name: string;
  lon: number;
  lat: number;
  poiId?: string;
}

export interface SavedRoute {
  id: string;
  name: string;
  savedAt: string;
  stops: Stop[];
  maxSlopeDeg: number;
  notes: string;
  summary?: { distance_m: number; elevation_gain_m: number; max_slope_deg: number; grid: string };
}
