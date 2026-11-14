import { describe, expect, it } from "vitest";
import type { RouteResult } from "../types";
import { DEFAULT_EVA, evaPlan, teamEvaPlan, toblerSpeed } from "./eva";
import { mergePins, placeLabels, type LabelBox, type Pin } from "./labels";

const measure = (t: string) => t.length * 10; // deterministic stand-in for canvas measureText

function overlap(a: LabelBox, b: LabelBox) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe("PDF map label placement", () => {
  it("merges pins that sit on top of each other into one label", () => {
    const g = mergePins([
      { x: 100, y: 100, label: "A start", color: "#fff" },
      { x: 106, y: 104, label: "Rendezvous", color: "#fff" },
      { x: 300, y: 100, label: "B start", color: "#fff" },
    ]);
    expect(g.map((x) => x.label)).toEqual(["A start / Rendezvous", "B start"]);
  });

  it("never overlaps labels, pins or reserved areas in a tight cluster", () => {
    const pins: Pin[] = [
      { x: 700, y: 450, label: "A start", color: "#76C9C2" },
      { x: 728, y: 452, label: "Rendezvous", color: "#D98EBA" },
      { x: 740, y: 480, label: "B start", color: "#A99BDD" },
      { x: 712, y: 500, label: "B dest.", color: "#A99BDD" },
      { x: 690, y: 425, label: "A dest.", color: "#76C9C2" },
    ];
    const reserved = [{ x: 14, y: 14, w: 52, h: 64 }];
    const { boxes } = placeLabels(pins, measure, 1400, 900, { h: 28, pinR: 11, reserved });
    expect(boxes).toHaveLength(5);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j]), `${boxes[i].text} vs ${boxes[j].text}`).toBe(false);
      const b = boxes[i];
      expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1400 && b.y + b.h <= 900).toBe(true);
      for (const p of pins) {
        const nx = Math.max(b.x, Math.min(p.x, b.x + b.w));
        const ny = Math.max(b.y, Math.min(p.y, b.y + b.h));
        expect(Math.hypot(nx - p.x, ny - p.y)).toBeGreaterThanOrEqual(11);
      }
    }
  });

  it("keeps labels inside the canvas near the edges", () => {
    const { boxes } = placeLabels([{ x: 1395, y: 5, label: "Corner site", color: "#fff" }], measure, 1400, 900);
    const b = boxes[0];
    expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1400 && b.y + b.h <= 900).toBe(true);
  });
});

function straight(n: number, stops: number[]): RouteResult {
  const d = Array.from({ length: n }, (_, i) => i * 10);
  const t = d.map((x) => x / toblerSpeed(0));
  return {
    distance_m: d[n - 1], horizontal_distance_m: d[n - 1], elevation_start_m: 0, elevation_end_m: 0, elevation_gain_m: 0, elevation_loss_m: 0,
    elevation_min_m: 0, elevation_max_m: 0, max_slope_deg: 1, mean_slope_deg: 1, slope_class_fraction: { easy: 1, moderate: 0, hazard: 0, nogo: 0 },
    est_time_s: t[n - 1], walk_time_s: t[n - 1], objective_costs: { fastest_s: 0, shortest_m: 0, lower_risk_s: 0, balanced_s: 0 },
    difficulty: { score: 5, label: "Easy" }, profile: { distance_m: d, elevation_m: d.map(() => 0), slope_deg: d.map(() => 1), walk_time_s: t },
    path_lonlat: d.map((_, i) => [77.4 + i * 1e-4, 18.44] as [number, number]), stop_indices: stops, grid: { name: "ctx", resolution_m: 20 },
    max_slope_limit_deg: 25, compute_ms: 1, model: { kind: "estimate", note: "" },
  };
}

describe("Two-astronaut EVA resources", () => {
  const cell = 10 / toblerSpeed(0) / 60; // minutes per 10 m
  const settings = { ...DEFAULT_EVA, availableMin: 120, scienceMinPerStop: 10, reservePct: 10, o2Budget: 1, o2RatePerHour: 0.5, o2Unit: "kg", powerBudgetWh: 400, powerDrawW: 200 };

  it("splits each astronaut's EVA into out, science, wait and back, and adds both for team requirements", () => {
    // A reaches the rendezvous at 30 min, B at 50 min -> A waits 20 min
    const retA = straight(61, [0, 60]); // 600 m back
    const retB = straight(31, [0, 30]); // 300 m back
    const te = teamEvaPlan({ arriveMeetMinA: 30, arriveMeetMinB: 50, meetMin: 50, scienceMin: 10 }, retA, retB, settings);
    expect(te.A!.outboundMin).toBeCloseTo(20, 9);
    expect(te.A!.scienceMin).toBe(10);
    expect(te.A!.waitMin).toBeCloseTo(20, 9);
    expect(te.A!.returnMin).toBeCloseTo(60 * cell, 9);
    expect(te.B!.waitMin).toBe(0);
    expect(te.A!.totalMin).toBeCloseTo(50 + 60 * cell, 9);
    expect(te.B!.totalMin).toBeCloseTo(50 + 30 * cell, 9);
    expect(te.missionMin).toBeCloseTo(Math.max(te.A!.totalMin, te.B!.totalMin), 9);
    expect(te.personMin).toBeCloseTo(te.A!.totalMin + te.B!.totalMin, 9);
    // per-astronaut oxygen = own rate x own hours; combined = sum, budget = both suits
    expect(te.A!.o2!.used).toBeCloseTo(0.5 * (te.A!.totalMin / 60), 9);
    expect(te.o2!.used).toBeCloseTo(te.A!.o2!.used + te.B!.o2!.used, 9);
    expect(te.o2!.budget).toBe(2);
    expect(te.power!.budget).toBe(800);
    // leave rendezvous by = available - reserve - own walk back
    expect(te.A!.turnBackByMin).toBeCloseTo(120 - 12 - 60 * cell, 9);
  });

  it("raises per-astronaut and combined warnings from user budgets only", () => {
    const ret = straight(31, [0, 30]);
    // meet at 140 min + walk back > 120 min available; 200 W for > 2 h > 400 Wh battery
    const te = teamEvaPlan({ arriveMeetMinA: 130, arriveMeetMinB: 140, meetMin: 140, scienceMin: 10 }, ret, ret, settings);
    const ids = te.alerts.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["A-eva-time", "B-eva-time", "A-eva-power", "team-power"]));
    expect(te.alerts.find((a) => a.id === "A-eva-time")!.title).toMatch(/^Astronaut A:/);
    const none = teamEvaPlan({ arriveMeetMinA: 10, arriveMeetMinB: 10, meetMin: 10, scienceMin: 0 }, ret, ret, DEFAULT_EVA);
    expect(none.o2).toBeNull();
    expect(none.alerts).toEqual([]);
  });

  it("flags a missing return route instead of guessing", () => {
    const te = teamEvaPlan({ arriveMeetMinA: 10, arriveMeetMinB: 12, meetMin: 12, scienceMin: 0 }, null, straight(5, [0, 4]), settings);
    expect(te.A).toBeNull();
    expect(te.missionMin).toBeNull();
    expect(te.alerts.map((a) => a.id)).toContain("A-return");
  });

  it("leaves the solo EVA calculation unchanged (no wait time)", () => {
    const r = straight(5, [0, 4]);
    const p = evaPlan(r, 1, { ...DEFAULT_EVA, scienceMinPerStop: 15 });
    expect(p.waitMin).toBe(0);
    expect(p.totalMin).toBeCloseTo(2 * 4 * cell + 15, 9);
  });
});
