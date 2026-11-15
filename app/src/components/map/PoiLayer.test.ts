// Regression tests for the "shaking popup" bug: hovering an open sample popup must not re-layout or
// auto-pan it. MapView re-renders on every mouse move (cursor read-out) and passes PoiLayer a fresh
// `body` closure each time; that used to reach the react-leaflet <Popup> as new children, which calls
// popup.update() -> Leaflet re-measures and auto-pans the popup on every pixel of mouse movement.
import { createElement as h, type ReactNode } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import L from "leaflet";
import { MapContainer } from "react-leaflet";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PoiLayer, createBodyStore, measureInsets, popupFit } from "./PoiLayer";
import type { Poi } from "../../types";

const poi = { id: "s1", name: "Melyn", number: 19, lat: 18.47, lon: 77.43, category: "sample", type: "Rock core (sedimentary)", campaign: "Upper Fan", sol_sealed: 749 } as unknown as Poi;
const pois = [poi]; // stable, as in the app
const icons = { s1: L.divIcon({ className: "poi-marker", html: "<div class='poi-pin'></div>", iconSize: [16, 16] }) };

// jsdom has no canvas; the label layer only needs text widths
HTMLCanvasElement.prototype.getContext = (() => ({ font: "", measureText: (t: string) => ({ width: t.length * 7 }) })) as never;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  vi.restoreAllMocks();
});

function mount(body: (p: Poi) => ReactNode) {
  const tree = (b: (p: Poi) => ReactNode) =>
    h(MapContainer, { center: [18.47, 77.43], zoom: 15, crs: L.CRS.Simple, style: { width: 800, height: 600 } } as never, h(PoiLayer, { pois, icons, body: b }));
  if (!host) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => root!.render(tree(body)));
  return (b: (p: Poi) => ReactNode) => act(() => root!.render(tree(b)));
}

describe("sample popup stability", () => {
  it("does not re-layout / auto-pan an open popup when the parent re-renders (mouse moves)", async () => {
    let n = 0;
    const rerender = mount((p) => h("div", { className: "popup-title" }, p.name, " #", n));
    const api = (window as unknown as { __pawprintMap: { openPoi: (q: string) => Promise<string>; map: L.Map } }).__pawprintMap;
    await act(async () => {
      await api.openPoi("Melyn");
    });
    expect(document.querySelector(".leaflet-popup .popup-title")?.textContent).toBe("Melyn #0");

    const update = vi.spyOn(L.Popup.prototype, "update");
    const adjustPan = vi.spyOn(L.Popup.prototype as unknown as { _adjustPan: () => void }, "_adjustPan");
    for (n = 1; n <= 20; n++) rerender((p) => h("div", { className: "popup-title" }, p.name, " #", n)); // fresh closure each time, like MapView
    expect(update).not.toHaveBeenCalled();
    expect(adjustPan).not.toHaveBeenCalled();
    // ...but the open popup still shows the latest content (e.g. planning mode toggled)
    expect(document.querySelector(".leaflet-popup .popup-title")?.textContent).toBe("Melyn #20");
    expect(api.map.hasLayer((api.map as unknown as { _popup: L.Popup })._popup)).toBe(true);
  });
});

describe("createBodyStore", () => {
  it("notifies subscribers only when the renderer actually changes", () => {
    const a = () => "a";
    const b = () => "b";
    const s = createBodyStore(a);
    const f = vi.fn();
    const off = s.subscribe(f);
    s.set(a);
    expect(f).not.toHaveBeenCalled();
    s.set(b);
    expect(f).toHaveBeenCalledTimes(1);
    expect(s.get()).toBe(b);
    off();
    s.set(a);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("popupFit", () => {
  it("keeps the default popup on a wide, tall map", () => {
    expect(popupFit(1000, 800)).toEqual({ maxWidth: 300, maxHeight: undefined, padTL: [30, 90], padBR: [80, 90] });
  });
  it("narrows the popup so it fits beside the zoom column on a narrow map (tablet planner)", () => {
    const f = popupFit(326, 890, { top: 60, bottom: 50, right: 56 });
    expect(f.maxWidth + 50 + f.padTL[0] + f.padBR[0]).toBeLessThanOrEqual(326);
    expect(f.padBR[0]).toBeGreaterThanOrEqual(56);
  });
  it("caps the height on a short map so the popup scrolls instead of spilling under controls (phone)", () => {
    const f = popupFit(372, 471, { top: 57, bottom: 46, right: 56 });
    expect(f.maxHeight).toBeDefined();
    expect(f.maxHeight! + 50 + f.padTL[1] + f.padBR[1]).toBeLessThanOrEqual(471);
    expect(f.padTL[1]).toBeGreaterThanOrEqual(57);
    expect(f.padBR[1]).toBeGreaterThanOrEqual(46);
  });
  it("never lets crowded controls squeeze the popup to nothing", () => {
    const f = popupFit(300, 400, { top: 300, bottom: 300, right: 290 });
    expect(f.maxWidth).toBeGreaterThanOrEqual(180);
    expect(f.maxHeight).toBeGreaterThanOrEqual(160);
  });
});

describe("measureInsets", () => {
  it("treats the zoom column as a right strip and other controls as top/bottom bands", () => {
    const wrap = document.createElement("div");
    wrap.className = "map-wrap";
    const cont = document.createElement("div");
    wrap.appendChild(cont);
    const mk = (cls: string, r: [number, number, number, number]) => {
      const e = document.createElement("div");
      e.className = cls;
      e.getBoundingClientRect = () => ({ left: r[0], top: r[1], width: r[2], height: r[3], right: r[0] + r[2], bottom: r[1] + r[3], x: r[0], y: r[1], toJSON: () => ({}) });
      wrap.appendChild(e);
    };
    cont.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 600, right: 600, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
    mk("map-panel", [10, 10, 300, 120]); // weather / title panels along the top
    mk("map-buttons", [544, 50, 42, 130]); // zoom column, top-right
    mk("map-panel mp-info-btn", [10, 554, 100, 36]); // bottom chip
    mk("map-panel", [0, 0, 0, 0]); // minimised panel: ignored
    expect(measureInsets(cont)).toEqual({ top: 130, bottom: 46, right: 56 });
  });
});
