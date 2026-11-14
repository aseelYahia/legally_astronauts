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
  /** Time spent waiting at a rendezvous (two-astronaut mode; 0 for solo). */
  waitMin: number;
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

interface Parts {
  outboundMin: number;
  scienceMin: number;
  waitMin: number;
  returnMin: number;
}

/** Shared EVA arithmetic for one astronaut. All budgets and rates come from the user. */
function evaFromParts(parts: Parts, s: EvaSettings, formulas: string[], who = ""): EvaPlan {
  const { outboundMin, scienceMin, waitMin, returnMin } = parts;
  const totalMin = outboundMin + scienceMin + waitMin + returnMin;
  const avail = s.availableMin !== null && s.availableMin > 0 ? s.availableMin : null;
  const reserveMin = avail ? (avail * Math.max(0, s.reservePct)) / 100 : 0;
  const turnBackByMin = avail ? avail - reserveMin - returnMin : null;
  const slackMin = avail ? avail - reserveMin - totalMin : null;
  const hours = totalMin / 60;
  const o2 = budget(s.o2Budget, s.o2RatePerHour, hours);
  const power = budget(s.powerBudgetWh, s.powerDrawW, hours);
  const reservePct = Math.max(0, s.reservePct);
  const pre = who ? `Astronaut ${who}: ` : "";
  const idp = who ? `${who}-` : "";

  const alerts: Alert[] = [];
  const src = "User-entered EVA budget and rates; walking times from Tobler estimates. Hypothetical, not NASA-validated.";
  if (avail !== null && slackMin !== null) {
    if (totalMin > avail) {
      alerts.push({ id: `${idp}eva-time`, severity: "warning", title: `${pre}EVA time exceeded`, why: `Estimated EVA (${Math.round(totalMin)} min, including the walk back) is longer than the ${Math.round(avail)} min limit.`, source: src });
    } else if (slackMin < 0) {
      alerts.push({ id: `${idp}eva-reserve`, severity: "caution", title: `${pre}EVA eats into the time reserve`, why: `The plan fits in ${Math.round(avail)} min but leaves less than the ${reservePct}% reserve.`, source: src });
    }
  }
  for (const [key, b, label] of [["o2", o2, "Oxygen"], ["power", power, "Power"]] as const) {
    if (!b) continue;
    if (b.remaining < 0) alerts.push({ id: `${idp}eva-${key}`, severity: "warning", title: `${pre}${label} budget exceeded`, why: `At the entered rate the EVA would use ${b.used.toFixed(1)} of ${b.budget} (${Math.round(-b.remainingPct)}% over budget).`, source: src });
    else if (b.remainingPct < reservePct) alerts.push({ id: `${idp}eva-${key}-reserve`, severity: "caution", title: `${pre}${label} below the reserve`, why: `Only ${b.remainingPct.toFixed(0)}% would remain, below the ${reservePct}% reserve.`, source: src });
  }
  return { outboundMin, scienceMin, waitMin, returnMin, totalMin, availableMin: avail, reserveMin, turnBackByMin, slackMin, o2, power, alerts, formulas };
}

export function evaPlan(route: RouteResult, scienceStops: number, s: EvaSettings): EvaPlan {
  const pace = s.paceFactor > 0 ? s.paceFactor : 1;
  const outboundMin = (route.walk_time_s / 60) * pace;
  const returnMin = (returnWalkSeconds(route) / 60) * pace;
  const scienceMin = Math.max(0, s.scienceMinPerStop) * scienceStops;
  const totalMin = outboundMin + scienceMin + returnMin;
  return evaFromParts({ outboundMin, scienceMin, waitMin: 0, returnMin }, s, [
    `Outbound walk = Tobler walking time × pace factor (${pace}) = ${outboundMin.toFixed(1)} min`,
    `Return walk = Tobler time along the reversed route × pace factor = ${returnMin.toFixed(1)} min`,
    `Science time = ${s.scienceMinPerStop} min × ${scienceStops} stop${scienceStops === 1 ? "" : "s"} = ${scienceMin.toFixed(0)} min`,
    `Total EVA = outbound + science + return = ${totalMin.toFixed(1)} min`,
    "Turn back by = available time − reserve − return walk",
    "Resource used = your consumption rate per hour × total EVA hours; remaining = budget − used",
  ]);
}

// ------------------------------------------------------------------ //
// Two-astronaut EVA: each astronaut walks start -> own destination ->
// rendezvous, waits for the other, then walks back to their OWN start
// along a separately planned A* route (rendezvous -> start).
// Budgets and rates are entered PER ASTRONAUT (each suit).
// ------------------------------------------------------------------ //

export interface CombinedBudget {
  budget: number;
  used: number;
  remaining: number;
  remainingPct: number;
}

export interface TeamEva {
  A: EvaPlan | null;
  B: EvaPlan | null;
  /** Wall-clock mission length: both astronauts back at their starts. */
  missionMin: number | null;
  /** Sum of both astronauts' EVA time. */
  personMin: number | null;
  o2: CombinedBudget | null;
  power: CombinedBudget | null;
  alerts: Alert[];
  formulas: string[];
}

export interface TeamEvaLegs {
  /** Arrival at the rendezvous for each astronaut (min, includes science time). */
  arriveMeetMinA: number;
  arriveMeetMinB: number;
  /** Shared meeting time = later of the two arrivals. */
  meetMin: number;
  scienceMin: number;
}

function combine(a: Budget | null, b: Budget | null): CombinedBudget | null {
  if (!a || !b) return null;
  const total = a.budget + b.budget;
  const used = a.used + b.used;
  return { budget: total, used, remaining: total - used, remainingPct: ((total - used) / total) * 100 };
}

export function teamEvaPlan(legs: TeamEvaLegs, returnA: RouteResult | null, returnB: RouteResult | null, s: EvaSettings): TeamEva {
  const pace = s.paceFactor > 0 ? s.paceFactor : 1;
  const sci = Math.max(0, legs.scienceMin);
  const formulasFor = (who: "A" | "B", p: Parts) => [
    `Astronaut ${who}: walk to destination and rendezvous = ${p.outboundMin.toFixed(1)} min (Tobler × pace ${pace})`,
    `Astronaut ${who}: science = ${p.scienceMin.toFixed(0)} min; wait at rendezvous = ${p.waitMin.toFixed(1)} min`,
    `Astronaut ${who}: walk back rendezvous → own start (separate A* route) = ${p.returnMin.toFixed(1)} min`,
    `Astronaut ${who}: total EVA = ${(p.outboundMin + p.scienceMin + p.waitMin + p.returnMin).toFixed(1)} min`,
  ];
  const person = (who: "A" | "B", arrive: number, ret: RouteResult | null): EvaPlan | null => {
    if (!ret) return null;
    const parts: Parts = {
      outboundMin: Math.max(0, arrive - sci),
      scienceMin: sci,
      waitMin: Math.max(0, legs.meetMin - arrive),
      returnMin: (ret.walk_time_s / 60) * pace,
    };
    return evaFromParts(parts, s, formulasFor(who, parts), who);
  };
  const A = person("A", legs.arriveMeetMinA, returnA);
  const B = person("B", legs.arriveMeetMinB, returnB);
  const alerts: Alert[] = [...(A?.alerts ?? []), ...(B?.alerts ?? [])];
  const src = "A* route planned from the rendezvous back to each astronaut's start.";
  if (!returnA) alerts.push({ id: "A-return", severity: "warning", title: "Astronaut A: no return route to start", why: "No path under the slope limit leads from the rendezvous back to Astronaut A's start.", source: src });
  if (!returnB) alerts.push({ id: "B-return", severity: "warning", title: "Astronaut B: no return route to start", why: "No path under the slope limit leads from the rendezvous back to Astronaut B's start.", source: src });
  const o2 = combine(A?.o2 ?? null, B?.o2 ?? null);
  const power = combine(A?.power ?? null, B?.power ?? null);
  const hypo = "Sum of both astronauts' user-entered budgets and rates. Hypothetical.";
  if (o2 && o2.remaining < 0)
    alerts.push({ id: "team-o2", severity: "warning", title: "Combined oxygen requirement exceeds both suits' budgets", why: `The team would need ${o2.used.toFixed(2)} of ${o2.budget.toFixed(2)} in total.`, source: hypo });
  if (power && power.remaining < 0)
    alerts.push({ id: "team-power", severity: "warning", title: "Combined power requirement exceeds both batteries", why: `The team would need ${power.used.toFixed(0)} of ${power.budget.toFixed(0)} Wh in total.`, source: hypo });
  return {
    A,
    B,
    missionMin: A && B ? Math.max(A.totalMin, B.totalMin) : null,
    personMin: A && B ? A.totalMin + B.totalMin : null,
    o2,
    power,
    alerts,
    formulas: [
      ...(A?.formulas ?? []),
      ...(B?.formulas ?? []),
      "Mission length = the later of the two astronauts' return times (they leave the rendezvous together)",
      "Combined requirement = Astronaut A's use + Astronaut B's use; combined budget = both suits' budgets",
      "Leave rendezvous by = available time − reserve − that astronaut's walk back",
    ],
  };
}

export function fmtMin(m: number): string {
  const sign = m < 0 ? "−" : "";
  const a = Math.abs(Math.round(m));
  const h = Math.floor(a / 60);
  return h ? `${sign}${h} h ${(a % 60).toString().padStart(2, "0")} min` : `${sign}${a} min`;
}
