import type { EvaSettings, RouteResult } from "../types";
import type { Alert } from "./safety";

/**
 * EVA resource budgeting. Hypothetical planning arithmetic only:
 * every budget and consumption rate is entered by the user. PAWPRINT
 * provides NO oxygen, power or physiological models and no NASA limits.
 */

export const DEFAULT_EVA: EvaSettings = {
  availableMin: null,
  scienceMinPerStop: 0,
  reservePct: 0,
  paceFactor: 1,
  o2Budget: null,
  o2RatePerHour: null,
  o2Unit: "units",
  powerBudgetWh: null,
  powerDrawW: null,
};

/** Tobler's hiking function, m/s. Must match analysis/pawprint/routing.py. */
export function toblerSpeed(grade: number): number {
  return (6 * Math.exp(-3.5 * Math.abs(grade + 0.05))) / 3.6;
}

/** Walking time back along the same path, reversed (uphill becomes downhill). */
export function returnWalkSeconds(route: RouteResult): number {
  const d = route.profile.distance_m;
  const z = route.profile.elevation_m;
  let t = 0;
  for (let i = d.length - 1; i > 0; i--) {
    const seg = d[i] - d[i - 1];
    const dz = z[i - 1] - z[i]; // walking backwards
    const horiz = Math.sqrt(Math.max(seg * seg - dz * dz, 0));
    const grade = horiz > 0 ? dz / horiz : 0;
    t += seg / toblerSpeed(grade);
  }
  return t;
}

export interface Budget {
  budget: number;
  used: number;
  remaining: number;
  remainingPct: number;
}

export interface EvaPlan {
  outboundMin: number;
  scienceMin: number;
  returnMin: number;
  totalMin: number;
  availableMin: number | null;
  reserveMin: number;
  turnBackByMin: number | null;
  slackMin: number | null;
  o2: Budget | null;
  power: Budget | null;
  alerts: Alert[];
  formulas: string[];
}

function budget(total: number | null, perHour: number | null, hours: number): Budget | null {
  if (total === null || perHour === null || !(total > 0) || !(perHour >= 0)) return null;
  const used = perHour * hours;
  return { budget: total, used, remaining: total - used, remainingPct: ((total - used) / total) * 100 };
}

export function evaPlan(route: RouteResult, scienceStops: number, s: EvaSettings): EvaPlan {
  const pace = s.paceFactor > 0 ? s.paceFactor : 1;
  const outboundMin = (route.walk_time_s / 60) * pace;
  const returnMin = (returnWalkSeconds(route) / 60) * pace;
  const scienceMin = Math.max(0, s.scienceMinPerStop) * scienceStops;
  const totalMin = outboundMin + scienceMin + returnMin;
  const avail = s.availableMin !== null && s.availableMin > 0 ? s.availableMin : null;
  const reserveMin = avail ? (avail * Math.max(0, s.reservePct)) / 100 : 0;
  const turnBackByMin = avail ? avail - reserveMin - returnMin : null;
  const slackMin = avail ? avail - reserveMin - totalMin : null;
  const hours = totalMin / 60;
  const o2 = budget(s.o2Budget, s.o2RatePerHour, hours);
  const power = budget(s.powerBudgetWh, s.powerDrawW, hours);
  const reservePct = Math.max(0, s.reservePct);

  const alerts: Alert[] = [];
  const src = "User-entered EVA budget and rates; walking times from Tobler estimates. Hypothetical, not NASA-validated.";
  if (avail !== null && slackMin !== null) {
    if (totalMin > avail) {
      alerts.push({ id: "eva-time", severity: "warning", title: "EVA time exceeded", why: `Estimated EVA (${Math.round(totalMin)} min, including the walk back) is longer than your ${Math.round(avail)} min limit.`, source: src });
    } else if (slackMin < 0) {
      alerts.push({ id: "eva-reserve", severity: "caution", title: "EVA eats into your time reserve", why: `The plan fits in ${Math.round(avail)} min but leaves less than your ${reservePct}% reserve.`, source: src });
    }
  }
  for (const [key, b, label] of [["o2", o2, "Oxygen"], ["power", power, "Power"]] as const) {
    if (!b) continue;
    if (b.remaining < 0) alerts.push({ id: `eva-${key}`, severity: "warning", title: `${label} budget exceeded`, why: `At your entered rate the EVA would use ${b.used.toFixed(1)} of ${b.budget} (${Math.round(-b.remainingPct)}% over budget).`, source: src });
    else if (b.remainingPct < reservePct) alerts.push({ id: `eva-${key}-reserve`, severity: "caution", title: `${label} below your reserve`, why: `Only ${b.remainingPct.toFixed(0)}% would remain, below your ${reservePct}% reserve.`, source: src });
  }

  return {
    outboundMin, scienceMin, returnMin, totalMin, availableMin: avail, reserveMin, turnBackByMin, slackMin, o2, power, alerts,
    formulas: [
      `Outbound walk = Tobler walking time × pace factor (${pace}) = ${outboundMin.toFixed(1)} min`,
      `Return walk = Tobler time along the reversed route × pace factor = ${returnMin.toFixed(1)} min`,
      `Science time = ${s.scienceMinPerStop} min × ${scienceStops} stop${scienceStops === 1 ? "" : "s"} = ${scienceMin.toFixed(0)} min`,
      `Total EVA = outbound + science + return = ${totalMin.toFixed(1)} min`,
      "Turn back by = available time − reserve − return walk",
      "Resource used = your consumption rate per hour × total EVA hours; remaining = budget − used",
    ],
  };
}

export function fmtMin(m: number): string {
  const sign = m < 0 ? "−" : "";
  const a = Math.abs(Math.round(m));
  const h = Math.floor(a / 60);
  return h ? `${sign}${h} h ${(a % 60).toString().padStart(2, "0")} min` : `${sign}${a} min`;
}
