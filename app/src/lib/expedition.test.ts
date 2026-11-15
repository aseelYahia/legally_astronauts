import { describe, expect, it } from "vitest";
import {
  EXPEDITION_KEY,
  NEW_TIMER,
  countByCategory,
  downsample,
  exportableLog,
  finishTimer,
  fmtClock,
  loadExpedition,
  newExpedition,
  saveExpedition,
  setActivity,
  supplyEstimate,
  timeBasedProgress,
  timerTotals,
  validCoords,
  type MissionSnapshot,
  type NotebookEntry,
} from "./expedition";
import { DEFAULT_EVA } from "./eva";
import { fitSize } from "./photoStore";

const T0 = 1_700_000_000_000;
const sec = (s: number) => T0 + s * 1000;

describe("expedition timer state machine", () => {
  it("starts idle with zero totals", () => {
    expect(NEW_TIMER.status).toBe("idle");
    expect(timerTotals(NEW_TIMER, sec(100))).toEqual({ totalMs: 0, walkingMs: 0, breakMs: 0, obstacleMs: 0 });
  });

  it("walk → break → obstacle → resume: total runs through breaks and obstacles", () => {
    let t = setActivity(NEW_TIMER, "walking", sec(0));
    t = setActivity(t, "break", sec(600)); // 10 min walking
    t = setActivity(t, "obstacle", sec(780)); // 3 min break
    t = setActivity(t, "walking", sec(900)); // 2 min obstacle
    const tot = timerTotals(t, sec(1200)); // 5 more min walking
    expect(t.status).toBe("walking");
    expect(tot.walkingMs).toBe(900_000);
    expect(tot.breakMs).toBe(180_000);
    expect(tot.obstacleMs).toBe(120_000);
    expect(tot.totalMs).toBe(1_200_000);
    expect(tot.walkingMs + tot.breakMs + tot.obstacleMs).toBe(tot.totalMs);
  });

  it("is timestamp based: totals are recomputed from stored segments (survives reload)", () => {
    let t = setActivity(NEW_TIMER, "walking", sec(0));
    t = setActivity(t, "break", sec(60));
    const reloaded = JSON.parse(JSON.stringify(t));
    expect(timerTotals(reloaded, sec(90))).toEqual({ totalMs: 90_000, walkingMs: 60_000, breakMs: 30_000, obstacleMs: 0 });
  });

  it("ignores pressing the current activity again", () => {
    const t = setActivity(NEW_TIMER, "walking", sec(0));
    expect(setActivity(t, "walking", sec(50))).toBe(t);
  });

  it("finish freezes every timer and further actions are ignored", () => {
    let t = setActivity(NEW_TIMER, "walking", sec(0));
    t = setActivity(t, "break", sec(100));
    t = finishTimer(t, sec(160));
    expect(t.status).toBe("finished");
    const later = timerTotals(t, sec(10_000));
    expect(later).toEqual({ totalMs: 160_000, walkingMs: 100_000, breakMs: 60_000, obstacleMs: 0 });
    expect(setActivity(t, "walking", sec(11_000))).toBe(t);
    expect(finishTimer(t, sec(12_000))).toBe(t);
  });

  it("formats the clock as hh:mm:ss", () => {
    expect(fmtClock(0)).toBe("00:00:00");
    expect(fmtClock(866_000)).toBe("00:14:26");
    expect(fmtClock(3_723_999)).toBe("01:02:03");
    expect(fmtClock(-5)).toBe("00:00:00");
  });
});

describe("supply simulation", () => {
  const eva = { ...DEFAULT_EVA, availableMin: 120, o2Budget: 10, o2RatePerHour: 2, o2Unit: "units", powerBudgetWh: 400, powerDrawW: 100 };

  it("returns no gauges when the user has not entered budgets", () => {
    const s = supplyEstimate(DEFAULT_EVA, 30 * 60_000, null);
    expect(s.o2).toBeNull();
    expect(s.power).toBeNull();
    expect(s.time).toBeNull();
    expect(s.turnBackAtMin).toBeNull();
  });

  it("uses budget − rate × elapsed hours (same arithmetic as lib/eva)", () => {
    const s = supplyEstimate(eva, 60 * 60_000, 90, 70);
    expect(s.o2!.used).toBeCloseTo(2);
    expect(s.o2!.rawPct).toBeCloseTo(80);
    expect(s.power!.used).toBeCloseTo(100);
    expect(s.power!.rawPct).toBeCloseTo(75);
    expect(s.time).toEqual({ basis: "eva-limit", totalMin: 120, remainingMin: 60, pct: 50 });
    expect(s.turnBackAtMin).toBe(70);
  });

  it("clamps the drawn ring but keeps the true (negative) value", () => {
    const s = supplyEstimate(eva, 6 * 60 * 60_000, null);
    expect(s.o2!.rawPct).toBeCloseTo(-20);
    expect(s.o2!.pct).toBe(0);
    expect(s.time!.remainingMin).toBeCloseTo(-240);
    expect(s.time!.pct).toBe(0);
  });

  it("falls back to the planned EVA length when no time limit is entered", () => {
    const s = supplyEstimate({ ...DEFAULT_EVA }, 15 * 60_000, 60, 40);
    expect(s.time).toEqual({ basis: "plan", totalMin: 60, remainingMin: 45, pct: 75 });
    expect(s.turnBackAtMin).toBeNull();
  });

  it("time-based progress is an estimate capped at 100%", () => {
    expect(timeBasedProgress(15 * 60_000, 30)).toBeCloseTo(50);
    expect(timeBasedProgress(90 * 60_000, 30)).toBe(100);
    expect(timeBasedProgress(1, 0)).toBeNull();
  });
});

const snap: MissionSnapshot = {
  routeId: "r1", name: "Marswalk 01", mode: "solo", startName: "Base Camp", destName: "Bearwallow", missionId: "water",
  distance_m: 2870, gain_m: 74, walkMin: 37, plannedTotalMin: 80, turnBackByMin: null, maxSlope_deg: 9.9, grid: "CTX",
  eva: DEFAULT_EVA, stops: [], legs: [], paths: [], pins: [], alerts: [],
};

describe("expedition persistence + records", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m } as unknown as Storage & { m: Map<string, string> };
  };

  it("round-trips through storage and clears", () => {
    const s = mem();
    const x = newExpedition(snap, T0, "x1");
    x.timer = setActivity(x.timer, "walking", sec(0));
    expect(saveExpedition(x, s)).toBe(true);
    expect(loadExpedition(s)).toEqual(x);
    saveExpedition(null, s);
    expect(loadExpedition(s)).toBeNull();
  });

  it("survives corrupt or blocked storage", () => {
    const s = mem();
    s.setItem(EXPEDITION_KEY, "{not json");
    expect(loadExpedition(s)).toBeNull();
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => {} } as unknown as Storage;
    expect(loadExpedition(blocked)).toBeNull();
    expect(saveExpedition(newExpedition(snap, T0), blocked)).toBe(false);
  });

  it("counts entries by category", () => {
    const e = (category: NotebookEntry["category"]): NotebookEntry => ({ id: category, category, title: "", notes: "", confidence: "low", coords: null, photoIds: [], createdAt: 0, updatedAt: 0, missionMs: null });
    expect(countByCategory([e("rock"), e("rock"), e("water"), e("general")])).toEqual({ rock: 2, water: 1, mineral: 0, general: 1 });
  });

  it("validates user-entered coordinates", () => {
    expect(validCoords(18.44, 77.45)).toBe(true);
    expect(validCoords(95, 77)).toBe(false);
    expect(validCoords(NaN, 77)).toBe(false);
  });

  it("export carries the honesty disclaimer and no live position", () => {
    const x = newExpedition(snap, T0);
    const out = exportableLog(x, sec(5));
    expect(out.disclaimer).toMatch(/possible evidence/i);
    expect(out.disclaimer).toMatch(/no live position/i);
    expect(JSON.stringify(out)).not.toMatch(/currentPosition|gps/i);
  });

  it("downsamples long paths keeping endpoints", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => [i, i] as [number, number]);
    const d = downsample(pts, 100);
    expect(d).toHaveLength(100);
    expect(d[0]).toEqual([0, 0]);
    expect(d[99]).toEqual([999, 999]);
  });

  it("photo downscale target keeps aspect and never upscales", () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 1280, height: 960 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(0, 10)).toEqual({ width: 0, height: 0 });
  });
});
