import type { LonLat, Poi, RouteResult } from "../types";
import { greatCircleM } from "./mars";

export type RiskLevel = "LOW" | "MODERATE" | "HIGH";

/** Count contiguous stretches of the route on terrain at or above `thresholdDeg`.
 *  Uses the per-vertex slopes we derive from the elevation profile. */
export function countSteepSegments(slopesDeg: number[], thresholdDeg: number): number {
  let n = 0;
  let inSeg = false;
  for (const s of slopesDeg) {
    if (s >= thresholdDeg && !inSeg) {
      n++;
      inSeg = true;
    } else if (s < thresholdDeg) inSeg = false;
  }
  return n;
}

/** Along-track gradient (deg) between consecutive profile vertices. */
export function profileSlopes(distance: number[], elevation: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < distance.length; i++) {
    const along = distance[i] - distance[i - 1];
    const dz = elevation[i] - elevation[i - 1];
    const horiz = Math.sqrt(Math.max(along * along - dz * dz, 0));
    out.push(horiz > 0 ? (Math.atan(Math.abs(dz) / horiz) * 180) / Math.PI : 0);
  }
  return out;
}

export function riskLevel(r: Pick<RouteResult, "max_slope_deg" | "slope_class_fraction">): RiskLevel {
  const steep = r.slope_class_fraction.hazard + r.slope_class_fraction.nogo;
  if (r.max_slope_deg >= 20 || steep > 0.1) return "HIGH";
  if (r.max_slope_deg >= 10 || steep > 0) return "MODERATE";
  return "LOW";
}

/** Distance from a point to a polyline (metres), sampling vertices and segment midpoints. */
export function distanceToPath(lon: number, lat: number, path: LonLat[]): number {
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    best = Math.min(best, greatCircleM(lon, lat, x, y));
    if (i + 1 < path.length) {
      const [x2, y2] = path[i + 1];
      best = Math.min(best, greatCircleM(lon, lat, (x + x2) / 2, (y + y2) / 2));
    }
  }
  return best;
}

export function samplesNearRoute(pois: Poi[], path: LonLat[], withinM: number): (Poi & { distance_m: number })[] {
  return pois
    .filter((p) => p.category === "sample")
    .map((p) => ({ ...p, distance_m: distanceToPath(p.lon, p.lat, path) }))
    .filter((p) => p.distance_m <= withinM)
    .sort((a, b) => a.distance_m - b.distance_m);
}
