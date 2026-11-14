import type { CompareResult, LonLat, Manifest, Objective, Poi, RouteResult, WeatherSol } from "../types";

export async function loadStatic() {
  const [manifest, pois, weather, rover] = await Promise.all([
    fetch("/data/manifest.json").then((r) => r.json() as Promise<Manifest>),
    fetch("/data/pois.json").then((r) => r.json() as Promise<Poi[]>),
    fetch("/data/weather.json").then((r) => r.json() as Promise<{ fetched_utc: string | null; sols: WeatherSol[] }>),
    fetch("/data/rover_traverse.geojson").then((r) => r.json() as Promise<GeoJSON.FeatureCollection>),
  ]);
  return { manifest, pois, weather, rover };
}

export async function apiHealth(): Promise<boolean> {
  try {
    const r = await fetch("/api/health");
    return r.ok;
  } catch {
    return false;
  }
}

async function post<T>(url: string, payload: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body as T;
}

/** One route. objective defaults to the original "balanced" planner on the server. */
export function planRoute(points: LonLat[], maxSlopeDeg: number, objective?: Objective): Promise<RouteResult> {
  return post<RouteResult>("/api/route", { points, max_slope_deg: maxSlopeDeg, grid: "auto", ...(objective ? { objective } : {}) });
}

/** Fastest / Shortest / Lower Risk routes for the same itinerary. */
export function compareRoutes(points: LonLat[], maxSlopeDeg: number): Promise<CompareResult> {
  return post<CompareResult>("/api/compare", { points, max_slope_deg: maxSlopeDeg, grid: "auto" });
}

export interface TerrainProbe {
  lon: number;
  lat: number;
  samples: Record<string, { elevation_m: number; slope_deg: number; hazard_class: number; resolution_m: number }>;
}

export async function probeTerrain(lon: number, lat: number): Promise<TerrainProbe> {
  const r = await fetch(`/api/terrain?lon=${lon}&lat=${lat}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
