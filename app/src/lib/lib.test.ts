import { describe, expect, it } from "vitest";
import { formatLon, greatCircleM, metersPerDegLon, niceScale, parseLatLon, MARS_RADIUS_M } from "./mars";
import { countSteepSegments, distanceToPath, profileSlopes, riskLevel, samplesNearRoute } from "./routeAnalysis";
import { deleteRoute, loadRoutes, saveRoute } from "./storage";
import type { Poi, SavedRoute } from "../types";

describe("mars geodesy", () => {
  it("matches the Python implementation for 0.01 deg of latitude", () => {
    expect(greatCircleM(77.4, 18.4, 77.4, 18.41)).toBeCloseTo(592.747, 2);
  });
  it("quarter meridian = pi R / 2", () => {
    expect(greatCircleM(0, 0, 0, 90)).toBeCloseTo((Math.PI * MARS_RADIUS_M) / 2, 3);
  });
  it("longitude degrees shrink with cos(lat)", () => {
    expect(metersPerDegLon(18.44) / metersPerDegLon(0)).toBeCloseTo(Math.cos((18.44 * Math.PI) / 180), 12);
  });
  it("formats east-positive 0-360 longitude", () => {
    expect(formatLon(-10, 1)).toBe("350.0° E");
    expect(formatLon(77.45, 2)).toBe("77.45° E");
  });
  it("parses lat/lon text", () => {
    expect(parseLatLon("18.45, 77.42")).toEqual([77.42, 18.45]);
    expect(parseLatLon("18.45N 77.42E")).toEqual([77.42, 18.45]);
    expect(parseLatLon("Belva")).toBeNull();
    expect(parseLatLon("95, 10")).toBeNull();
  });
  it("chooses 1/2/5 scale lengths", () => {
    expect(niceScale(730)).toBe(500);
    expect(niceScale(1999)).toBe(1000);
    expect(niceScale(2100)).toBe(2000);
  });
});

describe("route analysis", () => {
  it("counts contiguous steep stretches", () => {
    expect(countSteepSegments([1, 16, 17, 2, 18, 3, 16], 15)).toBe(3);
    expect(countSteepSegments([], 15)).toBe(0);
  });
  it("derives along-track slope from a 3D profile", () => {
    // 10 m horizontal, 10 m rise => 45 deg; 3D along-track distance is 10*sqrt(2)
    const s = profileSlopes([0, 10 * Math.SQRT2], [0, 10]);
    expect(s[0]).toBeCloseTo(45, 9);
  });
  it("grades risk", () => {
    const f = { easy: 1, moderate: 0, hazard: 0, nogo: 0 };
    expect(riskLevel({ max_slope_deg: 5, slope_class_fraction: f })).toBe("LOW");
    expect(riskLevel({ max_slope_deg: 12, slope_class_fraction: f })).toBe("MODERATE");
    expect(riskLevel({ max_slope_deg: 22, slope_class_fraction: f })).toBe("HIGH");
  });
  it("finds samples near a route", () => {
    const pois = [
      { id: "a", name: "A", category: "sample", lon: 77.45, lat: 18.4405, position_quality: "estimated" },
      { id: "b", name: "B", category: "sample", lon: 77.30, lat: 18.40, position_quality: "estimated" },
      { id: "l", name: "L", category: "landing", lon: 77.45, lat: 18.44, position_quality: "measured" },
    ] as Poi[];
    const near = samplesNearRoute(pois, [[77.44, 18.44], [77.46, 18.44]], 100);
    expect(near.map((p) => p.id)).toEqual(["a"]);
    expect(near[0].distance_m).toBeCloseTo(29.6, 0);
    expect(distanceToPath(77.45, 18.44, [[77.45, 18.44]])).toBe(0);
  });
});

class MemStore implements Storage {
  m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe("saved routes", () => {
  const r = (id: string): SavedRoute => ({ id, name: id, savedAt: "2026-11-14", stops: [], maxSlopeDeg: 25, notes: "" });
  it("saves newest first, replaces by id and deletes", () => {
    const s = new MemStore();
    saveRoute(r("a"), s);
    saveRoute(r("b"), s);
    expect(loadRoutes(s).map((x) => x.id)).toEqual(["b", "a"]);
    saveRoute({ ...r("a"), name: "renamed" }, s);
    expect(loadRoutes(s).map((x) => x.name)).toEqual(["renamed", "b"]);
    expect(deleteRoute("b", s).map((x) => x.id)).toEqual(["a"]);
  });
  it("survives corrupt storage", () => {
    const s = new MemStore();
    s.setItem("pawprint.routes.v1", "{not json");
    expect(loadRoutes(s)).toEqual([]);
  });
});
