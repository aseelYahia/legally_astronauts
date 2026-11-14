import type { CompareResult, Objective } from "../types";

export const OBJECTIVE_ORDER: Objective[] = ["lower_risk", "fastest", "shortest"];

export const OBJECTIVE_META: Record<Objective, { label: string; color: string; dash?: string; goal: string; formula: string }> = {
  lower_risk: {
    label: "Lower Risk",
    color: "#76C9C2",
    goal: "Favors flatter ground and avoids steeper slopes when it can",
    formula: "Minimises Tobler walking time × (1 + ((slope − 5°) / 5°)²) on cells steeper than 5°",
  },
  fastest: {
    label: "Fastest",
    color: "#A99BDD",
    dash: "10 7",
    goal: "Minimises estimated walking time",
    formula: "Minimises Tobler walking time: v = 6·e^(−3.5·|grade + 0.05|) km/h (Earth hiking model)",
  },
  shortest: {
    label: "Shortest",
    color: "#E6C79C",
    dash: "2 7",
    goal: "Minimises total walking distance",
    formula: "Minimises 3-D distance: Σ √(horizontal² + Δheight²)",
  },
};

const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-9);

/** Plain-language notes explaining how (and whether) the three objectives differ. */
export function explainComparison(c: CompareResult): string[] {
  const r = c.routes;
  const notes: string[] = [];
  const allSame = c.identical.fastest.shortest && c.identical.fastest.lower_risk;
  if (allSame) {
    notes.push("All three objectives produced exactly the same route: there is one clearly best path here, whatever you optimise for.");
    return notes;
  }
  const fs = c.identical.fastest.shortest;
  const fsEquivalent = close(r.fastest.distance_m, r.shortest.distance_m, 0.005) && close(r.fastest.walk_time_s, r.shortest.walk_time_s, 0.005);
  if (fs) {
    notes.push("Fastest and Shortest are the same route. On this gentle ground, the quickest path is also the shortest.");
  } else if (fsEquivalent) {
    notes.push(
      "Fastest and Shortest are practically equivalent (within 0.5% in distance and time). Many equally short grid paths exist on gentle ground, so they can follow different cells.",
    );
    if (Math.abs(r.fastest.max_slope_deg - r.shortest.max_slope_deg) >= 1) {
      notes.push(
        `Even so, they cross different terrain: the steepest point is ${r.fastest.max_slope_deg.toFixed(1)}° on Fastest and ${r.shortest.max_slope_deg.toFixed(1)}° on Shortest.`,
      );
    }
  }
  const others = Math.min(r.fastest.max_slope_deg, r.shortest.max_slope_deg);
  const dDist = r.lower_risk.distance_m - Math.min(r.fastest.distance_m, r.shortest.distance_m);
  const dTime = r.lower_risk.walk_time_s - r.fastest.walk_time_s;
  if (c.identical.lower_risk.fastest || c.identical.lower_risk.shortest) {
    notes.push("Lower Risk matches another option: no flatter alternative exists within your slope limit.");
  } else if (r.lower_risk.max_slope_deg <= others - 0.5) {
    notes.push(
      `Lower Risk keeps the steepest point at ${r.lower_risk.max_slope_deg.toFixed(1)}° instead of ${others.toFixed(1)}°, for ${dDist >= 1 ? `+${Math.round(dDist)} m` : "no extra distance"} and ${dTime >= 30 ? `+${Math.round(dTime / 60)} min` : "under a minute more"}.`,
    );
  } else {
    notes.push("Lower Risk follows different, flatter cells but cannot reduce the single steepest point on this itinerary.");
  }
  return notes;
}
