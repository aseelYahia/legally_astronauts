// Sample markers select into the map information panel instead of opening Leaflet popups.
// Regression guard for the moving map: a popup auto-pans the map when it opens or re-renders; a selection
// must never create a popup, and must never move the map, however often the parent re-renders.
import { createElement as h } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import L from "leaflet";
import { MapContainer } from "react-leaflet";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PoiLayer } from "./PoiLayer";
import { MapSelectionContext } from "./MapSelectionContext";
import type { MapSelection } from "../../lib/mapSelection";
import type { Poi } from "../../types";

const mk = (id: string, name: string, lat: number, lon: number) =>
  ({ id, name, number: Number(id.slice(1)), lat, lon, category: "sample", type: "Rock core (sedimentary)", campaign: "Upper Fan", sol_sealed: 749 }) as unknown as Poi;
const melyn = mk("s1", "Melyn", 18.47, 77.43);
// two samples on one rover localization: always drawn as one "2 samples here" group
const twinA = mk("s2", "Twin A", 18.46, 77.42);
const twinB = mk("s3", "Twin B", 18.46, 77.42);
const pois = [melyn, twinA, twinB];
const icon = () => L.divIcon({ className: "poi-marker", html: "<div class='poi-pin'></div>", iconSize: [16, 16] });
const icons = { s1: icon(), s2: icon(), s3: icon() };

// jsdom has no canvas; the label layer only needs text widths
HTMLCanvasElement.prototype.getContext = (() => ({ font: "", measureText: (t: string) => ({ width: t.length * 7 }) })) as never;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

type Api = { openPoi: (q: string) => Promise<string>; map: L.Map };
const api = () => (window as unknown as { __pawprintMap: Api }).__pawprintMap;

function mount(sel: MapSelection | null, select: (s: MapSelection | null) => void) {
  const tree = (s: MapSelection | null) =>
    h(
      MapSelectionContext.Provider,
      { value: { sel: s, select } },
      // jsdom has no createSVGRect, so Leaflet would find no vector renderer for the group dots: hand it one
      h(MapContainer, { center: [18.47, 77.43], zoom: 15, crs: L.CRS.Simple, renderer: new L.SVG(), style: { width: 800, height: 600 } } as never, h(PoiLayer, { pois, icons })),
    );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(tree(sel)));
  return (s: MapSelection | null) => act(() => root!.render(tree(s)));
}

describe("sample markers select into the information panel", () => {
  it("a click selects the sample and opens no Leaflet popup", () => {
    const select = vi.fn();
    mount(null, select);
    const markerEl = [...document.querySelectorAll<HTMLElement>(".leaflet-marker-icon")].find((e) => e.getAttribute("title") === "#1 Melyn")!;
    expect(markerEl).toBeTruthy();
    act(() => markerEl.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(select).toHaveBeenCalledWith({ kind: "poi", id: "s1" });
    expect(document.querySelector(".leaflet-popup")).toBeNull();
  });

  it("a group click selects the whole group", () => {
    const select = vi.fn();
    mount(null, select);
    const g = [...document.querySelectorAll<HTMLElement>(".leaflet-marker-icon")].find((e) => e.getAttribute("title") === "2 samples here")!;
    act(() => g.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ kind: "poi-group", ids: ["s2", "s3"], identical: true }));
  });

  it("highlights the selected marker, and never moves the map while selections change", () => {
    const rerender = mount(null, () => {});
    const map = api().map;
    const moves = vi.fn();
    map.on("move", moves);
    const pan = vi.spyOn(map, "panBy");
    const fly = vi.spyOn(map, "flyTo");
    const set = vi.spyOn(map, "setView");
    // rapid switching, plus many unrelated re-renders (the app re-renders on every mouse move)
    const seq: (MapSelection | null)[] = [{ kind: "poi", id: "s1" }, { kind: "poi-group", ids: ["s2", "s3"], lat: 18.46, lon: 77.42, identical: true }, { kind: "poi", id: "s2", groupIds: ["s2", "s3"] }, null];
    for (let i = 0; i < 20; i++) rerender(seq[i % seq.length]);
    rerender({ kind: "poi", id: "s1" });
    expect(moves).not.toHaveBeenCalled();
    expect(pan).not.toHaveBeenCalled();
    expect(fly).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    const melynEl = [...document.querySelectorAll(".leaflet-marker-icon")].find((e) => e.getAttribute("title") === "#1 Melyn")!;
    const groupEl = [...document.querySelectorAll(".leaflet-marker-icon")].find((e) => e.getAttribute("title") === "2 samples here")!;
    expect(melynEl.classList.contains("is-selected")).toBe(true);
    expect(groupEl.classList.contains("is-selected")).toBe(false);
    // a sample chosen inside a group highlights the group symbol
    rerender({ kind: "poi", id: "s3", groupIds: ["s2", "s3"] });
    expect(groupEl.classList.contains("is-selected")).toBe(true);
    expect(melynEl.classList.contains("is-selected")).toBe(false);
  });

  it("the automation hook selects exactly like a click (group members keep their group)", async () => {
    const select = vi.fn();
    mount(null, select);
    await act(async () => {
      await api().openPoi("Twin B");
    });
    expect(select).toHaveBeenLastCalledWith({ kind: "poi", id: "s3", groupIds: ["s2", "s3"] });
    await act(async () => {
      await api().openPoi("Melyn");
    });
    expect(select).toHaveBeenLastCalledWith({ kind: "poi", id: "s1", groupIds: undefined });
  });
});
