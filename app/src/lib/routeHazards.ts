import type { LonLat, RouteResult } from "../types";
import { SAFETY_THRESHOLDS } from "./safety";

/**
 * Location-specific route hazards for the map (pure, unit-tested).
 *
 * Scientific rules:
 *  - A hazard is created ONLY from the route's own profile arrays (profile.slope_deg / elevation_m /
 *    distance_m / walk_time_s, which are parallel to path_lonlat). Its map anchor is ALWAYS exactly
 *    `route.path_lonlat[index]` for the profile point it was measured at. Nothing is interpolated or invented.
 *  - Route-wide warnings (archived weather, EVA time / oxygen / power budgets, total distance, total climb,
 *    effort score, grid resolution) are not location-specific and never become markers.
 *  - Slope thresholds are the same SAFETY_THRESHOLDS that drive the Warnings board; the climb rule reuses the
 *    board's "significant climb" thresholds for a single continuous ascent. All are PAWPRINT planning
 *    assumptions, not NASA limits.
 *  - Nothing here changes the route, the terrain data or the alert calculations.
 */

export type HazardKind = "steep" | "moderate-slope" | "slope-limit" | "climb";
export type HazardSeverity = "warning" | "caution";

export interface HazardSource {
  /** "CTX" | "HiRISE" */
  grid: string;
  resolution_m: number;
  /** Human-readable dataset and method. */
  dataset: string;
  /** What kind of number this is: measured / derived / estimated. */
  kind: string;
  /** Threshold note (always labelled as a PAWPRINT assumption). */
  thresholds: string;
}

export interface RouteHazard {
  /** Stable id: `${who}-${routeKey}-${kind}-${index}` */
  id: string;
  kind: HazardKind;
  severity: HazardSeverity;
  /** Warnings-board alert this hazard belongs to (ids as produced by routeAlerts; team mode prefixes "A-"/"B-"). */
  alertId: string;
  /** Other board alerts that point at this same spot (e.g. "near-limit"). */
  alsoAlertIds: string[];
  astronaut?: "A" | "B";
  routeKey: string;
  /** Index into path_lonlat / profile.* of the anchor point. */
  index: number;
  /** Exactly route.path_lonlat[index]. */
  at: LonLat;
  startIndex: number;
  endIndex: number;
  /** Along-route distance of the anchor (m). */
  distance_m: number;
  start_m: number;
  end_m: number;
  length_m: number;
  /** Pure walking time from the start to the anchor (s), from profile.walk_time_s. */
  elapsed_s: number;
  /** Slope in degrees (slope kinds) or metres climbed (climb). */
  value: number;
  valueLabel: string;
  /** Category label, same wording as the Warnings board catalog. */
  label: string;
  title: string;
  why: string;
  recommendation: string;
  note?: string;
  source: HazardSource;
  /** The stretch itself (path_lonlat[startIndex..endIndex]) for highlighting. */
  path: LonLat[];
}

/** Hysteresis for climb detection: a dip smaller than this does not end a climb (DTM noise allowance). PAWPRINT assumption. */
export const CLIMB_DIP_TOLERANCE_M = 5;

export interface Stretch {
  start: number;
  end: number;
  peak: number;
}

/** Contiguous index runs where slope >= threshold, with the index of the steepest point.
 *  Same rule as safety.steepStretches (which the board counts), but keeps the indices. */
export function slopeStretches(slope: number[], thresholdDeg: number): Stretch[] {
  const out: Stretch[] = [];
  let i = 0;
  while (i < slope.length) {
    if (slope[i] >= thresholdDeg) {
      let j = i;
      let best = i;
      while (j + 1 < slope.length && slope[j + 1] >= thresholdDeg) {
        j++;
        if (slope[j] > slope[best]) best = j;
      }
      out.push({ start: i, end: j, peak: best });
      i = j + 1;
    } else i++;
  }
  return out;
}

/** Continuous ascents (dips under `tol` metres ignored). Returns [startIndex (low), endIndex (high)] pairs. */
export function climbs(elev: number[], tol = CLIMB_DIP_TOLERANCE_M): { start: number; end: number; gain: number }[] {
  const out: { start: number; end: number; gain: number }[] = [];
  if (elev.length < 2) return out;
  let lo = 0;
  let hi = 0;
  const emit = () => {
    if (hi > lo) out.push({ start: lo, end: hi, gain: elev[hi] - elev[lo] });
  };
  for (let i = 1; i < elev.length; i++) {
    if (elev[i] > elev[hi]) hi = i;
    else if (elev[hi] - elev[i] > tol) {
      emit();
      lo = hi = i;
    } else if (elev[i] <= elev[lo]) lo = hi = i; // still at (or below) the low point: the climb starts later
  }
  emit();
  return out;
}

export const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
export const fmtMin = (s: number) => (s < 60 ? "< 1 min" : `${Math.round(s / 60)} min`);

function sourceFor(route: RouteResult, what: "slope" | "climb"): HazardSource {
  const hirise = route.grid.name.toLowerCase() === "hirise";
  const grid = hirise ? "HiRISE" : "CTX";
  const res = route.grid.resolution_m;
  const dtm = hirise ? `USGS Mars 2020 TRN HiRISE DTM (1 m posts, resampled to a ${res} m routing grid)` : `USGS Mars 2020 TRN CTX DTM (${res} m grid)`;
  const T = SAFETY_THRESHOLDS;
  return what === "slope"
    ? {
        grid,
        resolution_m: res,
        dataset: dtm,
        kind: `Derived: Horn slope computed from the DTM elevations for the ${res} m cell under this route point. Real ground can be steeper locally.`,
        thresholds: `${T.steepCautionDeg}° (caution) and ${T.steepWarningDeg}° (warning) are PAWPRINT planning assumptions, not NASA limits.`,
      }
    : {
        grid,
        resolution_m: res,
        dataset: dtm,
        kind: `Derived: elevation difference between two route points on the DTM (vertical accuracy is a few metres; dips under ${CLIMB_DIP_TOLERANCE_M} m are treated as noise).`,
        thresholds: `${T.gainCautionM} m (caution) and ${T.gainWarningM} m (warning) for one continuous climb are PAWPRINT planning assumptions, not NASA limits.`,
      };
}

export interface HazardOptions {
  /** Objective key ("fastest", "lower_risk", ...) or team key; part of the id so a route switch never reuses markers. */
  routeKey: string;
  astronaut?: "A" | "B";
  /** The user's max walkable slope (deg), for the "near your slope limit" note. */
  maxSlopeLimit?: number;
}

/** All location-specific hazards of one route, sorted by distance along the route. */
export function routeHazards(route: RouteResult, opts: HazardOptions): RouteHazard[] {
  const T = SAFETY_THRESHOLDS;
  const p = route.profile;
  const n = Math.min(route.path_lonlat.length, p.distance_m.length, p.slope_deg?.length ?? 0, p.elevation_m.length);
  if (n < 1) return [];
  const slope = p.slope_deg.slice(0, n);
  const elev = p.elevation_m.slice(0, n);
  const dist = p.distance_m;
  const wt = p.walk_time_s ?? [];
  const who = opts.astronaut;
  const pre = who ? `${who}-` : "";
  const whoName = who ? `Astronaut ${who}: ` : "";
  const out: RouteHazard[] = [];

  const base = (kind: HazardKind, index: number, start: number, end: number): Omit<RouteHazard, "severity" | "alertId" | "value" | "valueLabel" | "label" | "title" | "why" | "recommendation" | "source"> => ({
    id: `${who ?? "solo"}-${opts.routeKey}-${kind}-${index}`,
    kind,
    alsoAlertIds: [],
    astronaut: who,
    routeKey: opts.routeKey,
    index,
    at: route.path_lonlat[index],
    startIndex: start,
    endIndex: end,
    distance_m: dist[index],
    start_m: dist[start],
    end_m: dist[end],
    length_m: Math.max(dist[end] - dist[start], 0),
    elapsed_s: wt[index] ?? 0,
    path: route.path_lonlat.slice(start, end + 1),
  });

  // Mirrors routeAlerts: the board shows "steep" when the route max is >= warning threshold, else "moderate".
  const slopeAlert = pre + (route.max_slope_deg >= T.steepWarningDeg ? "steep" : "moderate");
  const cell = route.grid.resolution_m;
  const extent = (len: number) => (len < cell ? `about one ${cell} m terrain cell` : `about ${fmtDist(Math.max(len, cell))}`);

  // 1. steep stretches (>= warning threshold): marker at the steepest point
  const steep = slopeStretches(slope, T.steepWarningDeg);
  for (const s of steep) {
    const h = base("steep", s.peak, s.start, s.end);
    const v = slope[s.peak];
    out.push({
      ...h,
      severity: "warning",
      alertId: pre + "steep",
      value: v,
      valueLabel: `${v.toFixed(1)}° slope`,
      label: "Steep terrain",
      title: `${whoName}Steep slope ${v.toFixed(1)}°`,
      why: `The ground here is steeper than ${T.steepWarningDeg}° for ${extent(h.length_m)}. On slopes like this a suited astronaut tires quickly, footing on loose material is less sure and a fall is more likely.`,
      recommendation: "Walk it slowly with short steps, or avoid it: compare the Lower Risk option or lower your max walkable slope and re-plan. Check this spot in HiRISE imagery before relying on the route.",
      source: sourceFor(route, "slope"),
    });
  }

  // 2. moderate stretches (caution .. warning) that contain no steep point
  for (const s of slopeStretches(slope, T.steepCautionDeg)) {
    if (slope[s.peak] >= T.steepWarningDeg) continue; // already represented by the steep marker(s) inside it
    const h = base("moderate-slope", s.peak, s.start, s.end);
    const v = slope[s.peak];
    out.push({
      ...h,
      severity: "caution",
      alertId: slopeAlert,
      value: v,
      valueLabel: `${v.toFixed(1)}° slope`,
      label: "Moderate slope",
      title: `${whoName}Moderate slope ${v.toFixed(1)}°`,
      why: `The route crosses ${T.steepCautionDeg}–${T.steepWarningDeg}° ground here for ${extent(h.length_m)}. It is walkable, but noticeably sloped: slower, more tiring, and the ${cell} m terrain grid can hide steeper patches.`,
      recommendation: "Allow extra time here and keep a steady pace. If it is near the end of the walk, consider a gentler route option.",
      source: sourceFor(route, "slope"),
    });
  }

  // 3. near the user's slope limit: attach to the marker at the steepest route point, or add one there
  if (opts.maxSlopeLimit !== undefined && route.max_slope_deg >= opts.maxSlopeLimit - T.nearLimitMarginDeg) {
    let imax = 0;
    for (let i = 1; i < n; i++) if (slope[i] > slope[imax]) imax = i;
    const note =
      slope[imax] > opts.maxSlopeLimit
        ? `This is the steepest point of the route and it is above your ${opts.maxSlopeLimit}° limit (stops can always be stepped off).`
        : `This is the steepest point of the route, within ${T.nearLimitMarginDeg}° of your ${opts.maxSlopeLimit}° limit.`;
    const hit = out.find((h) => h.index === imax);
    if (hit) {
      hit.alsoAlertIds.push(pre + "near-limit");
      hit.note = note;
    } else {
      const v = slope[imax];
      const h = base("slope-limit", imax, imax, imax);
      out.push({
        ...h,
        severity: v > opts.maxSlopeLimit ? "warning" : "caution",
        alertId: pre + "near-limit",
        value: v,
        valueLabel: `${v.toFixed(1)}° slope`,
        label: "Near your slope limit",
        title: `${whoName}Steepest point ${v.toFixed(1)}°`,
        why: note,
        recommendation: "If this feels too close to your limit, lower the max walkable slope a little and re-plan to see an alternative.",
        source: sourceFor(route, "slope"),
      });
    }
  }

  // 4. significant continuous climbs: marker where the climb starts
  for (const c of climbs(elev)) {
    if (c.gain < T.gainCautionM) continue;
    const h = base("climb", c.start, c.start, c.end);
    const grade = h.length_m > 0 ? (100 * c.gain) / h.length_m : 0;
    out.push({
      ...h,
      severity: c.gain >= T.gainWarningM ? "warning" : "caution",
      alertId: pre + "gain",
      value: c.gain,
      valueLabel: `+${Math.round(c.gain)} m climb`,
      label: "Significant climb",
      title: `${whoName}Climb of +${Math.round(c.gain)} m starts here`,
      why: `From here the route climbs about ${Math.round(c.gain)} m over ${fmtDist(h.length_m)} (average grade ≈ ${grade.toFixed(0)}%) without a real break. Uphill walking in a suit costs much more time, oxygen and effort than flat ground.`,
      recommendation: "Pace yourself, plan a short rest at the top, and check that the EVA time and oxygen budget still has margin for this climb.",
      source: sourceFor(route, "climb"),
    });
  }

  return out.sort((a, b) => a.distance_m - b.distance_m || a.index - b.index);
}

/* ---------------- screen-space helpers (pure; CRS.Simple: 2^zoom px per degree) ---------------- */

export interface HazardGroup {
  key: string;
  members: RouteHazard[];
  /** Anchor of the most severe member (an exact route point, never a centroid). */
  at: LonLat;
  severity: HazardSeverity;
}

const SEV_RANK: Record<HazardSeverity, number> = { warning: 0, caution: 1 };

/** Greedy grouping of hazards whose anchors are closer than `px` on screen. */
export function groupHazards(hz: RouteHazard[], zoom: number, px = 30): HazardGroup[] {
  const k = Math.pow(2, zoom);
  const sorted = [...hz].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.value - a.value);
  const groups: HazardGroup[] = [];
  for (const h of sorted) {
    const g = groups.find((gg) => gg.members.some((m) => Math.hypot((m.at[0] - h.at[0]) * k, (m.at[1] - h.at[1]) * k) < px));
    if (g) g.members.push(h);
    else groups.push({ key: h.id, members: [h], at: h.at, severity: h.severity });
  }
  for (const g of groups) g.key = g.members.map((m) => m.id).sort().join("+");
  return groups;
}

/** Candidate icon offsets (px, from the exact anchor to the icon centre). Up first; the stem always points at the anchor. */
export const ICON_OFFSETS: [number, number][] = [
  [0, -30],
  [24, -24],
  [-24, -24],
  [32, 0],
  [-32, 0],
  [24, 24],
  [-24, 24],
  [0, 32],
];

/** Pick an icon offset whose icon box keeps clear of `obstacles` (screen points such as science targets and stops)
 *  and of icons already placed. Geography is untouched: only the drawn icon moves, the anchor stays exact. */
export function pickIconOffset(anchor: { x: number; y: number }, obstacles: { x: number; y: number }[], placed: { x: number; y: number }[], clear = 20): [number, number] {
  let best = ICON_OFFSETS[0];
  let bestScore = Infinity;
  ICON_OFFSETS.forEach((o, rank) => {
    const c = { x: anchor.x + o[0], y: anchor.y + o[1] };
    let score = rank * 0.01;
    for (const q of obstacles) {
      const d = Math.hypot(q.x - c.x, q.y - c.y);
      if (d < clear) score += (clear - d) * 2;
    }
    for (const q of placed) {
      const d = Math.hypot(q.x - c.x, q.y - c.y);
      if (d < 26) score += 26 - d;
    }
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  });
  return best;
}
