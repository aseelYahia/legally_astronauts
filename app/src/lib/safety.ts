import type { LonLat, RouteResult, WeatherSol } from "../types";

export type Severity = "warning" | "caution" | "info";

export interface Alert {
  id: string;
  severity: Severity;
  title: string;
  why: string;
  source: string;
  at?: LonLat;
}

/** Thresholds used to raise alerts. All are PAWPRINT planning assumptions, not NASA safety limits. */
export const SAFETY_THRESHOLDS = {
  steepCautionDeg: 10,
  steepWarningDeg: 15,
  nearLimitMarginDeg: 2,
  longDistanceCautionM: 3000,
  longDistanceWarningM: 6000,
  gainCautionM: 50,
  gainWarningM: 150,
};

export const NOT_CERTIFIED =
  "PAWPRINT MARS routes are planning estimates from orbital data. They are not certified safe for astronauts and do not replace mission safety review.";

const SEV_RANK: Record<Severity, number> = { warning: 0, caution: 1, info: 2 };
export const sortAlerts = (a: Alert[]) => [...a].sort((x, y) => SEV_RANK[x.severity] - SEV_RANK[y.severity]);

export interface SteepStretch {
  at: LonLat;
  maxSlope: number;
  length_m: number;
}

/** Contiguous stretches of the route whose terrain slope is >= threshold; marker at the steepest point. */
export function steepStretches(route: RouteResult, thresholdDeg: number): SteepStretch[] {
  const s = route.profile.slope_deg ?? [];
  const d = route.profile.distance_m;
  const out: SteepStretch[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] >= thresholdDeg) {
      let j = i;
      let best = i;
      while (j + 1 < s.length && s[j + 1] >= thresholdDeg) {
        j++;
        if (s[j] > s[best]) best = j;
      }
      out.push({ at: route.path_lonlat[best], maxSlope: s[best], length_m: Math.max(d[j] - d[i], 0) });
      i = j + 1;
    } else i++;
  }
  return out;
}

export function routeAlerts(route: RouteResult, maxSlopeLimit: number, weather: WeatherSol[]): Alert[] {
  const T = SAFETY_THRESHOLDS;
  const alerts: Alert[] = [];
  const grid = `${route.grid.name.toUpperCase()} ${route.grid.resolution_m} m`;
  const slopeSrc = `Horn slope computed in Python from the USGS ${route.grid.name === "hirise" ? "HiRISE" : "CTX"} DTM (${grid} grid)`;

  const steep = steepStretches(route, T.steepWarningDeg);
  if (route.max_slope_deg >= T.steepWarningDeg) {
    alerts.push({
      id: "steep",
      severity: "warning",
      title: `Potentially hazardous steep terrain (up to ${route.max_slope_deg.toFixed(1)}°)`,
      why: `${steep.length} stretch${steep.length === 1 ? "" : "es"} of the route cross ground steeper than ${T.steepWarningDeg}°, which PAWPRINT classes as "hazard". Marked on the map with ⚠.`,
      source: `${slopeSrc}; ${T.steepWarningDeg}° threshold is a PAWPRINT assumption.`,
      at: steep[0]?.at,
    });
  } else if (route.max_slope_deg >= T.steepCautionDeg) {
    alerts.push({
      id: "moderate",
      severity: "caution",
      title: `Moderate slopes (up to ${route.max_slope_deg.toFixed(1)}°)`,
      why: `Part of the route crosses ${T.steepCautionDeg}–${T.steepWarningDeg}° ground: walkable but noticeably sloped.`,
      source: `${slopeSrc}; thresholds are PAWPRINT assumptions.`,
    });
  }

  if (route.max_slope_deg >= maxSlopeLimit - T.nearLimitMarginDeg) {
    alerts.push({
      id: "near-limit",
      severity: route.max_slope_deg > maxSlopeLimit ? "warning" : "caution",
      title: route.max_slope_deg > maxSlopeLimit ? "Route exceeds your slope limit at a stop" : "Route approaches your slope limit",
      why:
        route.max_slope_deg > maxSlopeLimit
          ? `A start, waypoint or destination sits on ${route.max_slope_deg.toFixed(1)}° ground, above your ${maxSlopeLimit}° limit. The planner always lets you step off a stop, so consider moving it.`
          : `The steepest point (${route.max_slope_deg.toFixed(1)}°) is within ${T.nearLimitMarginDeg}° of your ${maxSlopeLimit}° limit.`,
      source: `${slopeSrc}; your max walkable slope setting.`,
    });
  }

  if (route.distance_m >= T.longDistanceCautionM) {
    alerts.push({
      id: "distance",
      severity: route.distance_m >= T.longDistanceWarningM ? "warning" : "caution",
      title: `Long walk (${(route.distance_m / 1000).toFixed(2)} km)`,
      why: `The route is longer than ${(T.longDistanceCautionM / 1000).toFixed(0)} km. Remember the walk back to base. See EVA Resources for the time budget.`,
      source: "3-D route distance from the DTM; distance thresholds are PAWPRINT assumptions.",
    });
  }

  if (route.elevation_gain_m >= T.gainCautionM) {
    alerts.push({
      id: "gain",
      severity: route.elevation_gain_m >= T.gainWarningM ? "warning" : "caution",
      title: `Significant climb (+${Math.round(route.elevation_gain_m)} m)`,
      why: `The route gains more than ${T.gainCautionM} m in total. Climbing costs time and effort, especially in a suit.`,
      source: "Sum of uphill height changes along the route (DTM); thresholds are PAWPRINT assumptions.",
    });
  }

  if (route.difficulty.label === "Strenuous" || route.difficulty.label === "Extreme") {
    alerts.push({
      id: "difficulty",
      severity: route.difficulty.label === "Extreme" ? "warning" : "caution",
      title: `${route.difficulty.label} estimated difficulty (${route.difficulty.score}/100)`,
      why: "The combined distance, climb and slope score is high.",
      source: "PAWPRINT difficulty score (estimate; weights are assumptions).",
    });
  }

  alerts.push({
    id: "resolution",
    severity: route.grid.resolution_m >= 10 ? "caution" : "info",
    title: `Terrain resolution: ${route.grid.resolution_m} m grid`,
    why:
      route.grid.resolution_m >= 10
        ? "Each terrain cell averages 20 × 20 m, so boulders, small scarps and sand traps are invisible and real local slopes can be steeper."
        : "HiRISE 4 m terrain is much sharper, but rocks smaller than about 2 m are still invisible.",
    source: route.grid.resolution_m >= 10 ? "USGS Mars 2020 TRN CTX DTM, 20 m posts." : "USGS Mars 2020 TRN HiRISE DTM (1 m posts, routed at 4 m).",
  });

  const latest = [...weather].reverse().find((w) => w.min_temp_c !== null);
  alerts.push({
    id: "weather",
    severity: "info",
    title: "No current weather data",
    why: latest
      ? `The newest environmental reading is MEDA sol ${latest.sol} (${latest.earth_date}). It is archived, not a forecast or live condition.`
      : "No environmental readings are available.",
    source: "NASA MEDA public feed (archived at sol 1133).",
  });

  return sortAlerts(alerts);
}

export function noRouteAlert(msg: string, maxSlope: number): Alert {
  const blocked = msg.includes("no route under");
  return {
    id: "no-route",
    severity: "warning",
    title: blocked ? `No route found under ${maxSlope}°` : "Route could not be planned",
    why: blocked
      ? "Every possible path crosses ground steeper than your max walkable slope. Raise the limit slightly or move a stop."
      : msg.includes("outside")
        ? "A stop is outside the area with terrain data."
        : msg,
    source: "A* search over the DTM grid with your slope limit.",
  };
}
