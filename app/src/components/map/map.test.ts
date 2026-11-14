import { describe, expect, it } from "vitest";
import type { Manifest, Poi } from "../../types";
import { aoiZooms } from "../MapView";
import { GROUP_PX, groupPois, splitZoom } from "./PoiLayer";
import { routeWeight } from "./RouteLayer";
import { mergeTeamLabels, type TeamPin } from "./TeamPins";

const poi = (id: string, lon: number, lat: number, number?: number): Poi => ({ id, name: id, category: "sample", lon, lat, position_quality: "estimated", number });

describe("sample grouping never moves a sample", () => {
  const pois = [poi("a", 77.4, 18.45, 1), poi("b", 77.4, 18.45, 2), poi("c", 77.4003, 18.45, 3), poi("d", 77.44, 18.43, 4)];

  it("groups co-located and nearby samples at low zoom and separates them at high zoom", () => {
    const low = groupPois(pois, 13); // 8192 px/deg: 0.0003 deg = 2.5 px
    expect(low.map((g) => g.members.map((m) => m.id))).toEqual([["a", "b", "c"], ["d"]]);
    const high = groupPois(pois, 17); // 131072 px/deg: 0.0003 deg = 39 px
    expect(high.map((g) => g.members.map((m) => m.id))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(high[0].identical).toBe(true);
  });

  it("keeps every member's own coordinate untouched", () => {
    const before = JSON.stringify(pois);
    const groups = groupPois(pois, 13);
    expect(JSON.stringify(pois)).toBe(before);
    const all = groups.flatMap((g) => g.members);
    for (const p of pois) expect(all.find((m) => m.id === p.id)).toMatchObject({ lon: p.lon, lat: p.lat });
  });

  it("knows the zoom at which a group splits (never for identical positions)", () => {
    const [g] = groupPois(pois.slice(0, 3), 13);
    const z = splitZoom(g);
    expect(groupPois(pois.slice(0, 3), z).length).toBeGreaterThan(1);
    expect(Math.hypot(0.0003) * Math.pow(2, z)).toBeGreaterThanOrEqual(GROUP_PX);
    const [same] = groupPois(pois.slice(0, 2), 17);
    expect(splitZoom(same)).toBe(Infinity);
  });
});

describe("map viewport", () => {
  const m = { aoi: { lon_min: 77.34, lon_max: 77.47, lat_min: 18.42, lat_max: 18.51 } } as Manifest;
  it("computes contain/fill zooms from the visible map size (2^z px per degree)", () => {
    const { contain, fill } = aoiZooms({ x: 662, y: 766 }, m);
    // width-limited: 662 px / 0.13 deg
    expect(Math.pow(2, contain) * 0.13).toBeCloseTo(662, 6);
    // height fills: 766 px / 0.09 deg
    expect(Math.pow(2, fill) * 0.09).toBeCloseTo(766, 6);
    expect(fill).toBeGreaterThan(contain);
  });
  it("is not clamped by the current zoom limits (Leaflet getBoundsZoom is)", () => {
    expect(aoiZooms({ x: 300, y: 300 }, m).contain).toBeLessThan(12);
  });
});

describe("route and team drawing helpers", () => {
  it("widens routes as you zoom in, within limits", () => {
    expect(routeWeight(11)).toBeLessThan(routeWeight(14));
    expect(routeWeight(5)).toBeGreaterThanOrEqual(2.6);
    expect(routeWeight(20)).toBeLessThanOrEqual(7.5);
  });
  it("merges labels of team pins that sit together on screen, keeping all pins", () => {
    const pins: TeamPin[] = [
      { key: "aStart", at: [0, 0], label: "A start", who: "A" },
      { key: "meet", at: [1, 1], label: "Rendezvous", who: "meet" },
      { key: "bStart", at: [500, 0], label: "B start", who: "B" },
    ];
    const labels = mergeTeamLabels(pins, ([x, y]) => ({ x, y }));
    expect(labels).toEqual([
      { owner: "aStart", text: "A start / Rendezvous" },
      { owner: "bStart", text: "B start" },
    ]);
  });
});
