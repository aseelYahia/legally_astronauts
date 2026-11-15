import { describe, expect, it } from "vitest";
import { hiddenBehind, panelLayout, panelWidth, selectedPoiIds, selectionKey, sheetDragOutcome } from "./mapSelection";

describe("selectionKey", () => {
  it("is stable for the same thing and different for different things", () => {
    expect(selectionKey({ kind: "point", lon: 77.4, lat: 18.4 })).toBe(selectionKey({ kind: "point", lon: 77.4, lat: 18.4 }));
    expect(selectionKey({ kind: "point", lon: 77.4, lat: 18.4 })).not.toBe(selectionKey({ kind: "point", lon: 77.41, lat: 18.4 }));
    expect(selectionKey({ kind: "poi", id: "a" })).not.toBe(selectionKey({ kind: "poi", id: "a", groupIds: ["a", "b"] }));
    expect(selectionKey(null)).toBe("");
  });
});

describe("selectedPoiIds", () => {
  it("returns the sample, or every member of a group", () => {
    expect(selectedPoiIds({ kind: "poi", id: "a" })).toEqual(["a"]);
    expect(selectedPoiIds({ kind: "poi-group", ids: ["a", "b"], lon: 0, lat: 0, identical: true })).toEqual(["a", "b"]);
    expect(selectedPoiIds({ kind: "water", id: "W1" })).toEqual([]);
    expect(selectedPoiIds(null)).toEqual([]);
  });
});

describe("panelLayout / panelWidth", () => {
  it("uses a side panel on desktop and a bottom sheet on phones or narrow maps", () => {
    expect(panelLayout(1440, 1000)).toBe("side");
    expect(panelLayout(1024, 700)).toBe("side");
    expect(panelLayout(390, 390)).toBe("sheet");
    expect(panelLayout(900, 520)).toBe("sheet");
  });
  it("keeps the side panel readable but never wider than ~38% of the map", () => {
    expect(panelWidth(1000)).toBe(372);
    expect(panelWidth(800)).toBe(304);
    expect(panelWidth(600)).toBe(288);
  });
});

describe("sheetDragOutcome", () => {
  it("closes on a long drag down or a quick flick, and expands on a drag up", () => {
    expect(sheetDragOutcome(120, 400, false)).toBe("close");
    expect(sheetDragOutcome(40, 40, false)).toBe("close"); // flick
    expect(sheetDragOutcome(40, 400, false)).toBe("stay"); // slow and short
    expect(sheetDragOutcome(120, 400, true)).toBe("collapse");
    expect(sheetDragOutcome(-80, 300, false)).toBe("expand");
    expect(sheetDragOutcome(-80, 300, true)).toBe("stay");
    expect(sheetDragOutcome(0, 0, false)).toBe("stay");
  });
});

describe("hiddenBehind", () => {
  const r = { left: 600, top: 12, right: 960, bottom: 500 };
  it("detects a point under the panel", () => {
    expect(hiddenBehind({ x: 700, y: 200 }, r)).toBe(true);
    expect(hiddenBehind({ x: 300, y: 200 }, r)).toBe(false);
    expect(hiddenBehind({ x: 597, y: 200 }, r)).toBe(true); // within the margin
    expect(hiddenBehind(null, r)).toBe(false);
  });
});
