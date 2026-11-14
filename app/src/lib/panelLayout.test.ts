import { describe, expect, it } from "vitest";
import {
  STORAGE_KEY, anchorRect, autoPlace, clampRect, defaultLayout, fromPos, loadLayout, moveInDock, overlaps, parseLayout, restore, saveLayout,
  separate, setMode, setPos, thinPoints, toPos, type Rect,
} from "./panelLayout";

const area = { w: 800, h: 600 };

describe("panel geometry", () => {
  it("clamps a panel fully inside the map area", () => {
    expect(clampRect({ x: -50, y: 900, w: 200, h: 40 }, area)).toEqual({ x: 10, y: 550, w: 200, h: 40 });
    expect(clampRect({ x: 790, y: -3, w: 200, h: 40 }, area)).toEqual({ x: 590, y: 10, w: 200, h: 40 });
  });

  it("pins an oversized panel to the top-left margin instead of pushing it off-screen", () => {
    const r = clampRect({ x: 300, y: 300, w: 1000, h: 900 }, area);
    expect(r.x).toBe(10);
    expect(r.y).toBe(10);
  });

  it("stores positions relative to the nearest corner and survives a resize", () => {
    const r: Rect = { x: 560, y: 520, w: 230, h: 60 }; // bottom-right
    const p = toPos(r, area);
    expect(p).toEqual({ h: "r", dx: 10, v: "b", dy: 20 });
    // the window shrinks: the panel stays docked to the bottom-right corner and inside the area
    const r2 = fromPos(p, { w: 230, h: 60 }, { w: 500, h: 400 });
    expect(r2).toEqual({ x: 260, y: 320, w: 230, h: 60 });
  });

  it("separates overlapping panels without leaving the area", () => {
    const rs = separate([{ x: 10, y: 10, w: 200, h: 50 }, { x: 20, y: 20, w: 200, h: 50 }, { x: 15, y: 15, w: 200, h: 50 }], area);
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) expect(overlaps(rs[i], rs[j])).toBe(false);
    for (const r of rs) expect(clampRect(r, area)).toEqual(r);
  });

  it("keeps panels off fixed map controls", () => {
    const controls = [{ x: 750, y: 260, w: 40, h: 120 }];
    const [r] = separate([{ x: 700, y: 280, w: 120, h: 40 }], area, controls);
    expect(overlaps(r, controls[0])).toBe(false);
  });
});

describe("smart default placement", () => {
  it("uses each panel's usual corner on an empty map", () => {
    const placed = autoPlace([{ id: "title", size: { w: 200, h: 50 } }, { id: "legend", size: { w: 240, h: 70 } }], area, [], []);
    expect(placed.title).toEqual(anchorRect("tl", { w: 200, h: 50 }, area));
    expect(placed.legend).toEqual(anchorRect("bl", { w: 240, h: 70 }, area));
  });

  it("moves a panel away from the selected route and stops", () => {
    // a route runs along the bottom-left corner where the legend normally sits
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: 10 + i * 6, y: 560, w: 3 }));
    pts.push({ x: 100, y: 545, w: 6 });
    const placed = autoPlace([{ id: "legend", size: { w: 240, h: 70 } }], area, pts, []);
    const covered = pts.filter((p) => p.x >= placed.legend.x - 12 && p.x <= placed.legend.x + 252 && p.y >= placed.legend.y - 12 && p.y <= placed.legend.y + 82);
    expect(covered).toHaveLength(0);
  });

  it("never stacks two panels or covers fixed controls", () => {
    const fixed = [{ x: 750, y: 240, w: 40, h: 120 }, { x: 680, y: 550, w: 110, h: 40 }];
    const placed = autoPlace(
      [
        { id: "hint", size: { w: 420, h: 34 } },
        { id: "title", size: { w: 200, h: 52 } },
        { id: "legend", size: { w: 250, h: 70 } },
        { id: "weather", size: { w: 380, h: 34 } },
      ],
      area,
      [],
      fixed,
    );
    const rs = Object.values(placed);
    for (let i = 0; i < rs.length; i++) {
      for (const f of fixed) expect(overlaps(rs[i], f)).toBe(false);
      for (let j = i + 1; j < rs.length; j++) expect(overlaps(rs[i], rs[j])).toBe(false);
    }
  });

  it("keeps a panel where it is while that spot is still good (no jumping on pan)", () => {
    const cur = { x: 300, y: 10, w: 200, h: 50 };
    const placed = autoPlace([{ id: "title", size: { w: 200, h: 50 }, current: cur }], area, [], [], 6);
    expect(placed.title).toEqual(cur);
  });

  it("thins dense route vertices but keeps heavier points", () => {
    const pts = [{ x: 1, y: 1, w: 3 }, { x: 2, y: 2, w: 3 }, { x: 3, y: 3, w: 6 }, { x: 40, y: 40, w: 3 }, { x: -500, y: 0, w: 3 }];
    expect(thinPoints(pts, area)).toEqual([{ x: 1, y: 1, w: 3 }, { x: 3, y: 3, w: 6 }, { x: 40, y: 40, w: 3 }]);
  });
});

describe("panel state", () => {
  it("minimizes and restores to where the panel was (float or dock)", () => {
    let l = setMode(defaultLayout(), "legend", "dock");
    l = setMode(l, "weather", "dock", 0);
    expect(l.dock).toEqual(["weather", "legend"]);
    l = setMode(l, "legend", "min");
    expect(l.panels.legend).toMatchObject({ mode: "min", restore: "dock" });
    l = restore(l, "legend");
    expect(l.panels.legend.mode).toBe("dock");
    expect(l.dock).toEqual(["weather", "legend"]);
    l = setMode(l, "title", "min");
    expect(restore(l, "title").panels.title.mode).toBe("float");
  });

  it("reorders the dock and undocks when dragged out", () => {
    let l = ["title", "legend", "weather"].reduce((acc, id) => setMode(acc, id as "title", "dock"), defaultLayout());
    l = moveInDock(l, "weather", -2);
    expect(l.dock).toEqual(["weather", "title", "legend"]);
    l = setPos(l, "title", { h: "l", dx: 40, v: "t", dy: 40 });
    expect(l.dock).toEqual(["weather", "legend"]);
    expect(l.panels.title).toEqual({ mode: "float", pos: { h: "l", dx: 40, v: "t", dy: 40 }, restore: undefined });
  });

  it("persists to storage and tolerates broken or blocked storage", () => {
    const mem: Record<string, string> = {};
    const st = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => void (mem[k] = v) };
    const l = setPos(setMode(defaultLayout(), "legend", "dock"), "hint", { h: "r", dx: 12, v: "b", dy: 30 });
    saveLayout(st, l);
    expect(JSON.parse(mem[STORAGE_KEY]).v).toBe(1);
    expect(loadLayout(st)).toEqual(parseLayout(JSON.stringify(l)));
    expect(loadLayout(st).panels.hint.pos).toEqual({ h: "r", dx: 12, v: "b", dy: 30 });
    expect(loadLayout(st).dock).toEqual(["legend"]);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
    expect(loadLayout(throwing)).toEqual(defaultLayout());
    expect(() => saveLayout(throwing, l)).not.toThrow();
    expect(parseLayout("{nope")).toEqual(defaultLayout());
    expect(parseLayout(JSON.stringify({ v: 1, panels: { legend: { mode: "teleport" }, hint: { mode: "float", pos: { h: "x" } } }, dock: ["legend", "zzz"] }))).toEqual(defaultLayout());
  });
});
