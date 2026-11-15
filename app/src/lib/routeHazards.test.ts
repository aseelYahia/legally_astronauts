import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Objective, RouteResult } from "../types";
import { climbs, groupHazards, ICON_OFFSETS, pickIconOffset, routeHazards, slopeStretches } from "./routeHazards";
import { routeAlerts, SAFETY_THRESHOLDS, steepStretches } from "./safety";

/** Synthetic straight route: points 10 m apart in x, given elevations and terrain slopes. */
function mk(elev: number[], slope: number[], over: Partial<RouteResult> = {}): RouteResult {
  const dist = [0];
  const wt = [0];
  for (let i = 1; i < elev.length; i++) {
    dist.push(dist[i - 1] + Math.hypot(10, elev[i] - elev[i - 1]));
    wt.push(wt[i - 1] + 10);
  }
  let gain = 0;
  for (let i = 1; i < elev.length; i++) gain += Math.max(0, elev[i] - elev[i - 1]);
  return {
    distance_m: dist[dist.length - 1],
    horizontal_distance_m: 10 * (elev.length - 1),
    elevation_start_m: elev[0],
    elevation_end_m: elev[elev.length - 1],
    elevation_gain_m: gain,
    elevation_loss_m: 0,
    elevation_min_m: Math.min(...elev),
    elevation_max_m: Math.max(...elev),
    max_slope_deg: Math.max(...slope),
    mean_slope_deg: 0,
    slope_class_fraction: { easy: 1, moderate: 0, hazard: 0, nogo: 0 },
    est_time_s: 0,
    walk_time_s: wt[wt.length - 1],
    objective_costs: { fastest_s: 0, shortest_m: 0, lower_risk_s: 0, balanced_s: 0 },
    difficulty: { score: 10, label: "Easy" },
    profile: { distance_m: dist, elevation_m: elev, slope_deg: slope, walk_time_s: wt },
    path_lonlat: elev.map((_, i) => [77.4 + i * 0.0001, 18.45 + i * 0.00005]),
    stop_indices: [0, elev.length - 1],
    grid: { name: "ctx", resolution_m: 20 },
    max_slope_limit_deg: 25,
    compute_ms: 1,
    model: { kind: "test", note: "" },
    ...over,
  };
}

const fixture = JSON.parse(readFileSync(resolve(__dirname, "routeHazards.fixture.json"), "utf8")) as { routes: Record<Objective, RouteResult> };

describe("slopeStretches / climbs", () => {
  it("finds contiguous runs and the steepest index", () => {
    expect(slopeStretches([1, 16, 18, 15, 2, 20, 3], 15)).toEqual([
      { start: 1, end: 3, peak: 2 },
      { start: 5, end: 5, peak: 5 },
    ]);
  });
  it("agrees with safety.steepStretches (which the Warnings board counts)", () => {
    for (const r of Object.values(fixture.routes)) {
      const a = slopeStretches(r.profile.slope_deg, 15);
      const b = steepStretches(r, 15);
      expect(a.length).toBe(b.length);
      a.forEach((s, i) => expect(r.path_lonlat[s.peak]).toEqual(b[i].at));
    }
  });
  it("treats small dips as noise and splits on real descents", () => {
    expect(climbs([0, 10, 7, 30, 31])).toEqual([{ start: 0, end: 4, gain: 31 }]);
    expect(climbs([0, 20, 10, 40])).toEqual([
      { start: 0, end: 1, gain: 20 },
      { start: 2, end: 3, gain: 30 },
    ]);
    expect(climbs([10, 5, 0])).toEqual([]);
  });
});

describe("routeHazards", () => {
  it("anchors every marker exactly on the route point it was measured at", () => {
    for (const [k, r] of Object.entries(fixture.routes)) {
      const hz = routeHazards(r, { routeKey: k, maxSlopeLimit: 25 });
      for (const h of hz) {
        expect(h.at).toBe(r.path_lonlat[h.index]);
        expect(h.distance_m).toBe(r.profile.distance_m[h.index]);
        expect(h.elapsed_s).toBe(r.profile.walk_time_s[h.index]);
        if (h.kind !== "climb") expect(h.value).toBe(r.profile.slope_deg[h.index]);
        expect(h.index).toBeGreaterThanOrEqual(h.startIndex);
        expect(h.index).toBeLessThanOrEqual(h.endIndex);
        expect(h.path[0]).toBe(r.path_lonlat[h.startIndex]);
      }
    }
  });

  it("creates one warning per steep stretch and links every marker to an alert the board really shows", () => {
    for (const [k, r] of Object.entries(fixture.routes)) {
      const hz = routeHazards(r, { routeKey: k, maxSlopeLimit: 20 });
      const ids = new Set(routeAlerts(r, 20, []).map((a) => a.id));
      expect(hz.filter((h) => h.kind === "steep").length).toBe(steepStretches(r, 15).length);
      for (const h of hz) {
        expect(ids.has(h.alertId)).toBe(true);
        h.alsoAlertIds.forEach((a) => expect(ids.has(a)).toBe(true));
      }
    }
  });

  it("never pins route-wide warnings (weather, EVA, distance, resolution, difficulty)", () => {
    const r = fixture.routes.shortest;
    const hz = routeHazards(r, { routeKey: "shortest", maxSlopeLimit: 25 });
    const pinned = new Set(hz.flatMap((h) => [h.alertId, ...h.alsoAlertIds]));
    for (const id of ["weather", "resolution", "distance", "difficulty", "eva-time", "eva-o2", "eva-power"]) expect(pinned.has(id)).toBe(false);
  });

  it("produces no markers on gentle flat ground", () => {
    expect(routeHazards(mk([0, 1, 2, 3, 2, 1], [2, 3, 4, 3, 2, 1]), { routeKey: "x", maxSlopeLimit: 25 })).toEqual([]);
  });

  it("grades by the PAWPRINT thresholds and labels them as assumptions", () => {
    const T = SAFETY_THRESHOLDS;
    const r = mk([0, 0, 0, 0, 0, 0, 0], [1, 12, 13, 1, 16, 1, 1]);
    const hz = routeHazards(r, { routeKey: "x" });
    const steep = hz.find((h) => h.kind === "steep")!;
    expect(steep.severity).toBe("warning");
    expect(steep.index).toBe(4);
    expect(steep.alertId).toBe("steep");
    const mod = hz.find((h) => h.kind === "moderate-slope")!;
    expect(mod.severity).toBe("caution");
    expect(mod.index).toBe(2); // steepest of 12°, 13°
    expect(mod.alertId).toBe("steep"); // route max >= 15 -> board shows the "steep" alert, not "moderate"
    expect(steep.source.thresholds).toMatch(/PAWPRINT planning assumptions, not NASA limits/);
    expect(steep.source.thresholds).toContain(`${T.steepWarningDeg}°`);
    expect(steep.source.dataset).toMatch(/CTX DTM \(20 m grid\)/);
  });

  it("does not duplicate a moderate marker for a stretch that contains a steep point", () => {
    const hz = routeHazards(mk([0, 0, 0, 0, 0], [1, 11, 17, 12, 1]), { routeKey: "x" });
    expect(hz.map((h) => h.kind)).toEqual(["steep"]);
  });

  it("links moderate markers to the 'moderate' alert when the route has no steep ground", () => {
    const r = mk([0, 0, 0, 0], [1, 11, 12, 1]);
    const hz = routeHazards(r, { routeKey: "x" });
    expect(hz[0].alertId).toBe("moderate");
    expect(routeAlerts(r, 25, []).some((a) => a.id === "moderate")).toBe(true);
  });

  it("attaches the near-limit note to the marker at the steepest point", () => {
    const hz = routeHazards(mk([0, 0, 0, 0], [1, 16, 19, 1]), { routeKey: "x", maxSlopeLimit: 20 });
    expect(hz).toHaveLength(1);
    expect(hz[0].alsoAlertIds).toEqual(["near-limit"]);
    expect(hz[0].note).toMatch(/within 2° of your 20° limit/);
  });

  it("marks a significant continuous climb where it starts", () => {
    const elev = [100, 100, 110, 125, 140, 160, 158, 170, 170];
    const hz = routeHazards(mk(elev, elev.map(() => 3)), { routeKey: "x" });
    expect(hz).toHaveLength(1);
    expect(hz[0].kind).toBe("climb");
    expect(hz[0].index).toBe(1); // last 100 m point before the rise
    expect(hz[0].value).toBe(70);
    expect(hz[0].severity).toBe("caution");
    expect(hz[0].alertId).toBe("gain");
  });

  it("prefixes team-mode ids per astronaut and keeps ids unique per route option", () => {
    const r = mk([0, 0, 0], [1, 16, 1]);
    const a = routeHazards(r, { routeKey: "A", astronaut: "A" });
    expect(a[0].alertId).toBe("A-steep");
    expect(a[0].title).toMatch(/^Astronaut A: /);
    expect(routeHazards(r, { routeKey: "fastest" })[0].id).not.toBe(routeHazards(r, { routeKey: "shortest" })[0].id);
  });
});

describe("screen helpers", () => {
  it("groups close hazards and anchors the group on the most severe member (an exact route point)", () => {
    const hz = routeHazards(mk([0, 0, 0, 0, 0], [1, 12, 1, 18, 1]), { routeKey: "x" });
    const zoomedOut = groupHazards(hz, 10);
    expect(zoomedOut).toHaveLength(1);
    expect(zoomedOut[0].severity).toBe("warning");
    expect(zoomedOut[0].at).toBe(hz.find((h) => h.kind === "steep")!.at);
    expect(groupHazards(hz, 20)).toHaveLength(2);
  });
  it("moves the icon (never the anchor) away from a science target", () => {
    expect(pickIconOffset({ x: 100, y: 100 }, [], [])).toEqual(ICON_OFFSETS[0]);
    const off = pickIconOffset({ x: 100, y: 100 }, [{ x: 100, y: 70 }], []);
    expect(off).not.toEqual(ICON_OFFSETS[0]);
    expect(Math.hypot(100 + off[0] - 100, 100 + off[1] - 70)).toBeGreaterThanOrEqual(20);
  });
});
