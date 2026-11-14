import type { LonLat, Manifest, Poi, RouteResult, WeatherSol } from "../types";

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

export async function planRoute(points: LonLat[], maxSlopeDeg: number): Promise<RouteResult> {
  const r = await fetch("/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points, max_slope_deg: maxSlopeDeg, grid: "auto" }),
  });
  const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body as RouteResult;
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
