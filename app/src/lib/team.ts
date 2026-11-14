import type { RouteResult } from "../types";
import type { Alert } from "./safety";

/**
 * Two-astronaut timing. Each astronaut walks start -> own destination -> shared
 * rendezvous. Times are Tobler walking-time ESTIMATES plus a user-set science stop.
 */
export interface Leg {
  arriveDestMin: number;
  departDestMin: number;
  arriveMeetMin: number;
}

export function legTimes(route: RouteResult, scienceMin: number, pace = 1): Leg {
  const t = route.profile.walk_time_s;
  const [, iDest, iMeet] = route.stop_indices;
  const arriveDestMin = (t[iDest] / 60) * pace;
  const walkToMeetMin = ((t[iMeet] - t[iDest]) / 60) * pace;
  const departDestMin = arriveDestMin + Math.max(0, scienceMin);
  return { arriveDestMin, departDestMin, arriveMeetMin: departDestMin + walkToMeetMin };
}

export interface TeamSummary {
  a: Leg;
  b: Leg;
  meetMin: number;
  waitMin: number;
  firstToArrive: "A" | "B" | "together";
  totalDistance_m: number;
  totalGain_m: number;
  maxSlope: number;
}

export function teamSummary(ra: RouteResult, rb: RouteResult, scienceMin: number, pace = 1): TeamSummary {
  const a = legTimes(ra, scienceMin, pace);
  const b = legTimes(rb, scienceMin, pace);
  const waitMin = Math.abs(a.arriveMeetMin - b.arriveMeetMin);
  return {
    a,
    b,
    meetMin: Math.max(a.arriveMeetMin, b.arriveMeetMin),
    waitMin,
    firstToArrive: waitMin < 0.5 ? "together" : a.arriveMeetMin < b.arriveMeetMin ? "A" : "B",
    totalDistance_m: ra.distance_m + rb.distance_m,
    totalGain_m: ra.elevation_gain_m + rb.elevation_gain_m,
    maxSlope: Math.max(ra.max_slope_deg, rb.max_slope_deg),
  };
}

export function teamAlerts(errA: string | null, errB: string | null, s: TeamSummary | null, maxSlope: number): Alert[] {
  const out: Alert[] = [];
  for (const [who, err] of [["A", errA], ["B", errB]] as const) {
    if (err)
      out.push({
        id: `team-${who}`,
        severity: "warning",
        title: `Astronaut ${who} cannot reach the rendezvous`,
        why: err.includes("no route under")
          ? `No path under your ${maxSlope}° slope limit connects Astronaut ${who}'s start, destination and the meeting point.`
          : err,
        source: "A* search over the DTM grid with your slope limit.",
      });
  }
  if (s && s.waitMin >= 15)
    out.push({
      id: "team-wait",
      severity: "caution",
      title: `Long wait at the rendezvous (${Math.round(s.waitMin)} min)`,
      why: `Astronaut ${s.firstToArrive} is estimated to arrive about ${Math.round(s.waitMin)} min earlier. Consider moving the meeting point.`,
      source: "Tobler walking-time estimates + science stop time (estimates). 15 min threshold is a PAWPRINT assumption.",
    });
  return out;
}
