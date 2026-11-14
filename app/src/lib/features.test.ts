import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CompareResult, Objective, Poi, RouteResult, WeatherSol } from "../types";
import { explainComparison } from "./compare";
import { DEFAULT_EVA, evaPlan, returnWalkSeconds, toblerSpeed } from "./eva";
import { noRouteAlert, routeAlerts, steepStretches } from "./safety";
import { MISSIONS, recommend } from "./science";
import { legTimes, teamAlerts, teamSummary } from "./team";

/** Build a straight synthetic route from per-point elevations and terrain slopes (cells 10 m apart). */
function mkRoute(elev: number[], slopes?: number[], over: Partial<RouteResult> = {}): RouteResult {
  const dist = [0];
  const walk = [0];
  for (let i = 1; i < elev.length; i++) {
    const dz = elev[i] - elev[i - 1];
    const seg = Math.hypot(10, dz);
    dist.push(dist[i - 1] + seg);
    walk.push(walk[i - 1] + seg / toblerSpeed(dz / 10));
  }
  const s = slopes ?? elev.map(() => 2);
  return {
    distance_m: dist[dist.length - 1],
    horizontal_distance_m: 10 * (elev.length - 1),
    elevation_start_m: elev[0],
    elevation_end_m: elev[elev.length - 1],
    elevation_gain_m: elev.reduce((g, z, i) => (i && z > elev[i - 1] ? g + z - elev[i - 1] : g), 0),
    elevation_loss_m: 0,
    elevation_min_m: Math.min(...elev),
    elevation_max_m: Math.max(...elev),
    max_slope_deg: Math.max(...s),
    mean_slope_deg: 2,
    slope_class_fraction: { easy: 1, moderate: 0, hazard: 0, nogo: 0 },
    est_time_s: walk[walk.length - 1],
    walk_time_s: walk[walk.length - 1],
    objective_costs: { fastest_s: 0, shortest_m: 0, lower_risk_s: 0, balanced_s: 0 },
    difficulty: { score: 10, label: "Easy" },
    profile: { distance_m: dist, elevation_m: elev, slope_deg: s, walk_time_s: walk },
    path_lonlat: elev.map((_, i) => [77.4 + i * 1e-4, 18.44] as [number, number]),
    stop_indices: [0, elev.length - 1],
    grid: { name: "ctx", resolution_m: 20 },
    max_slope_limit_deg: 25,
    compute_ms: 1,
    model: { kind: "estimate", note: "" },
    ...over,
  };
}

const WX: WeatherSol[] = [
  { sol: 1132, earth_date: "2024-04-26", ls_deg: 243, season: "late autumn", min_temp_c: -77.9, max_temp_c: -23.4, pressure_pa: 774.1, sunrise_lmst: "06:17:18", sunset_lmst: "17:13:27" },
  { sol: 1133, earth_date: "2024-04-27", ls_deg: 244, season: "late autumn", min_temp_c: -79.3, max_temp_c: -24.7, pressure_pa: 778.9, sunrise_lmst: "06:18:07", sunset_lmst: "17:13:51" },
];

describe("Tobler parity with Python", () => {
  it("matches analysis/pawprint/routing.py values", () => {
    expect(toblerSpeed(-0.05)).toBeCloseTo(1.6666666667, 9);
    expect(toblerSpeed(0)).toBeCloseTo(1.3990950346, 9);
    expect(toblerSpeed(0.2)).toBeCloseTo(0.6947700328, 9);
  });
});

describe("EVA resources", () => {
  it("return walk equals outbound on flat ground and is faster downhill", () => {
    const flat = mkRoute([0, 0, 0, 0, 0]);
    expect(returnWalkSeconds(flat)).toBeCloseTo(flat.walk_time_s, 9);
    const up = mkRoute([0, 1, 2, 3, 4, 5]); // 10% uphill out, downhill back
    expect(returnWalkSeconds(up)).toBeLessThan(up.walk_time_s);
  });
  it("adds science time, applies pace and reserve, computes turn-back time", () => {
    const r = mkRoute([0, 0, 0, 0, 0]); // 40 m flat
    const p = evaPlan(r, 2, { ...DEFAULT_EVA, availableMin: 60, scienceMinPerStop: 10, reservePct: 20, paceFactor: 2 });
    const walkMin = (40 / toblerSpeed(0) / 60) * 2;
    expect(p.outboundMin).toBeCloseTo(walkMin, 9);
    expect(p.returnMin).toBeCloseTo(walkMin, 9);
    expect(p.scienceMin).toBe(20);
    expect(p.totalMin).toBeCloseTo(2 * walkMin + 20, 9);
    expect(p.reserveMin).toBe(12);
    expect(p.turnBackByMin).toBeCloseTo(60 - 12 - walkMin, 9);
    expect(p.alerts).toEqual([]);
  });
  it("warns only from user-entered budgets and never invents rates", () => {
    const r = mkRoute([0, 0, 0]);
    expect(evaPlan(r, 1, DEFAULT_EVA).o2).toBeNull();
    const p = evaPlan(r, 1, { ...DEFAULT_EVA, availableMin: 1, scienceMinPerStop: 5, o2Budget: 1, o2RatePerHour: 60 });
    expect(p.alerts.map((a) => a.id)).toEqual(expect.arrayContaining(["eva-time", "eva-o2"]));
    expect(p.o2!.used).toBeCloseTo(60 * (p.totalMin / 60), 9);
  });
});

describe("Safety alerts", () => {
  it("flags steep terrain with the steepest point and explains the source", () => {
    const r = mkRoute([0, 0, 0, 0, 0, 0], [2, 16, 19, 3, 17, 2]);
    const st = steepStretches(r, 15);
    expect(st).toHaveLength(2);
    expect(st[0].maxSlope).toBe(19);
    expect(st[0].at).toEqual(r.path_lonlat[2]);
    const a = routeAlerts(r, 25, WX);
    expect(a[0].severity).toBe("warning");
    expect(a[0].title).toMatch(/steep/i);
    expect(a.find((x) => x.id === "steep")!.source).toMatch(/Horn slope.*CTX/);
  });
  it("raises near-limit, distance, climb, resolution and archived-weather alerts", () => {
    const r = mkRoute([0, 30, 60], [2, 14, 2], { distance_m: 3500, elevation_gain_m: 60 });
    const ids = routeAlerts(r, 15, WX).map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(["near-limit", "distance", "gain", "resolution", "weather", "moderate"]));
    const w = routeAlerts(r, 15, WX).find((x) => x.id === "weather")!;
    expect(w.why).toMatch(/sol 1133/);
    expect(w.why).toMatch(/not a forecast/);
  });
  it("orders warnings before cautions before info", () => {
    const sev = routeAlerts(mkRoute([0, 0], [2, 20]), 25, WX).map((a) => a.severity);
    const rank = { warning: 0, caution: 1, info: 2 };
    expect([...sev].sort((a, b) => rank[a] - rank[b])).toEqual(sev);
  });
  it("explains a failed plan", () => {
    expect(noRouteAlert("no route under 10 deg slope limit between stops", 10).title).toMatch(/No route found under 10/);
  });
});

describe("Compare explanations", () => {
  const base = (d: number, t: number, s: number) => mkRoute([0, 0], [s, s], { distance_m: d, walk_time_s: t, max_slope_deg: s });
  const mk = (routes: Record<Objective, RouteResult>, identical: Partial<Record<string, boolean>> = {}): CompareResult => {
    const keys: Objective[] = ["lower_risk", "fastest", "shortest"];
    const id = Object.fromEntries(keys.map((a) => [a, Object.fromEntries(keys.map((b) => [b, a === b || !!identical[[a, b].sort().join("|")]]))]));
    return { routes, identical: id as CompareResult["identical"], similarity: id as unknown as CompareResult["similarity"], grid: { name: "ctx", resolution_m: 20 }, compute_ms: 1 };
  };
  it("says when all three are identical", () => {
    const r = base(1000, 700, 8);
    const n = explainComparison(mk({ lower_risk: r, fastest: r, shortest: r }, { "fastest|shortest": true, "fastest|lower_risk": true, "lower_risk|shortest": true }));
    expect(n[0]).toMatch(/exactly the same route/);
  });
  it("explains equivalent fastest/shortest and quantifies the lower-risk trade-off", () => {
    const n = explainComparison(mk({ fastest: base(2877, 2190, 14.5), shortest: base(2877.4, 2190.2, 14.5), lower_risk: base(2878, 2196, 10.6) }));
    expect(n.join(" ")).toMatch(/practically equivalent/);
    expect(n.join(" ")).toMatch(/10\.6° instead of 14\.5°/);
  });
});

describe("Science missions", () => {
  const pois: Poi[] = JSON.parse(readFileSync(resolve(__dirname, "../../public/data/pois.json"), "utf-8"));
  const landing = pois.find((p) => p.id === "landing")!;
  it("recommends only real NASA samples of the right type, nearest first", () => {
    const ign = recommend("igneous", pois, landing, 10);
    expect(ign.length).toBeGreaterThan(0);
    expect(ign.every((r) => /igneous/i.test(r.poi.type!))).toBe(true);
    expect(ign.map((r) => r.distance_m)).toEqual([...ign.map((r) => r.distance_m)].sort((a, b) => a - b));
    expect(recommend("water", pois, landing, 20).every((r) => /sedimentary/i.test(r.poi.type!))).toBe(true);
  });
  it("cites NASA sample data and states position uncertainty", () => {
    const r = recommend("sedimentary", pois, landing)[0];
    expect(r.data).toMatch(new RegExp(`NASA sample #${r.poi.number}`));
    expect(r.uncertainty).toMatch(/estimated/);
    // NASA's table gives only the coarse type; CRISM indicators exist but are never used to choose targets
    expect(r.uncertainty).toMatch(/campaign summary/);
    expect(r.uncertainty).toMatch(/not used to pick targets/);
  });
  it("history mission picks one sample per campaign", () => {
    const h = recommend("history", pois, landing, 20);
    expect(new Set(h.map((r) => r.poi.campaign)).size).toBe(h.length);
    expect(MISSIONS).toHaveLength(4);
  });
});

describe("Two-astronaut timing", () => {
  it("computes arrival, science stop and rendezvous wait", () => {
    const a = mkRoute(Array(41).fill(0), undefined, { stop_indices: [0, 20, 40] }); // 400 m
    const b = mkRoute([0, 0, 0], undefined, { stop_indices: [0, 1, 2] }); // 20 m
    const leg = legTimes(a, 10);
    const cell = 10 / toblerSpeed(0) / 60;
    expect(leg.arriveDestMin).toBeCloseTo(20 * cell, 9);
    expect(leg.departDestMin).toBeCloseTo(20 * cell + 10, 9);
    expect(leg.arriveMeetMin).toBeCloseTo(40 * cell + 10, 9);
    const s = teamSummary(a, b, 10);
    expect(s.firstToArrive).toBe("B");
    expect(s.waitMin).toBeCloseTo(38 * cell, 9);
    expect(s.meetMin).toBeCloseTo(leg.arriveMeetMin, 9);
    expect(teamAlerts("no route under 20 deg slope limit between stops", null, null, 20)[0].title).toMatch(/Astronaut A cannot reach/);
  });
});
