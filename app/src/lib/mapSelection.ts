/** What is selected on the map, shown in the map information panel (components/map/MapInfoPanel).
 *
 *  The panel replaced every Leaflet popup. A popup lives inside the map's panes, so opening one, or
 *  re-rendering one, asks Leaflet to auto-pan the map until the popup fits; the panel lives outside the
 *  map, so selecting something never moves, zooms or animates the map. See docs/popup-redesign/README.md. */
import type { RouteHazard } from "./routeHazards";

export type MapSelection =
  /** Empty ground clicked in the Mission Planner (Set Destination / Set Start / Add Waypoint). */
  | { kind: "point"; lon: number; lat: number }
  /** A NASA sample or the landing site. `groupIds` is set when it was chosen from an "N samples here" group. */
  | { kind: "poi"; id: string; groupIds?: string[] }
  /** An "N samples here" cluster. */
  | { kind: "poi-group"; ids: string[]; lon: number; lat: number; identical: boolean }
  /** A clicked spot on the Ancient Water Evidence heatmap outside the planner (Explore view). */
  | { kind: "water-cell"; lon: number; lat: number }
  /** A highlighted Ancient Water Evidence region (W1, W2...). */
  | { kind: "water"; id: string }
  /** A rover localization with NASA ground photos (camera marker). */
  | { kind: "photos"; rmc: string }
  /** A point on Perseverance's drive path. */
  | { kind: "rover"; sol: number; length_m: number | null; lon: number; lat: number }
  /** A route stop the user placed. */
  | { kind: "stop"; id: string }
  /** A route warning, or a group of nearby warnings. */
  | { kind: "hazard"; id: string }
  | { kind: "hazard-group"; key: string; members: RouteHazard[] };

/** Stable identity of a selection: two selections with the same key show the same content. */
export function selectionKey(s: MapSelection | null): string {
  if (!s) return "";
  switch (s.kind) {
    case "point":
      return `point:${s.lon.toFixed(7)},${s.lat.toFixed(7)}`;
    case "poi":
      return `poi:${s.id}${s.groupIds ? `@${s.groupIds.join("+")}` : ""}`;
    case "poi-group":
      return `poi-group:${s.ids.join("+")}`;
    case "water":
      return `water:${s.id}`;
    case "water-cell":
      return `water-cell:${s.lon.toFixed(7)},${s.lat.toFixed(7)}`;
    case "photos":
      return `photos:${s.rmc}`;
    case "rover":
      return `rover:${s.sol}:${s.lon.toFixed(7)},${s.lat.toFixed(7)}`;
    case "stop":
      return `stop:${s.id}`;
    case "hazard":
      return `hazard:${s.id}`;
    case "hazard-group":
      return `hazard-group:${s.key}`;
  }
}

/** Ids of the samples a selection highlights on the map (a sample, or every member of a group). */
export function selectedPoiIds(s: MapSelection | null): string[] {
  if (s?.kind === "poi") return [s.id];
  if (s?.kind === "poi-group") return s.ids;
  return [];
}

/** Desktop gets a fixed panel on the right of the map; phones (and maps too narrow for a side panel)
 *  get a bottom sheet. */
export function panelLayout(viewportW: number, mapW: number): "side" | "sheet" {
  return viewportW <= 720 || mapW < 600 ? "sheet" : "side";
}

/** Side-panel width for a map of the given width: roomy, but never more than ~38% of the map. */
export function panelWidth(mapW: number): number {
  return Math.round(Math.max(288, Math.min(372, mapW * 0.38)));
}

/** What a vertical drag on the bottom sheet's handle does when released.
 *  dy > 0 is downwards. A short flick counts as much as a long slow drag. */
export function sheetDragOutcome(dy: number, ms: number, expanded: boolean): "close" | "expand" | "collapse" | "stay" {
  const v = ms > 0 ? dy / ms : 0; // px per ms
  if (dy > 90 || (dy > 24 && v > 0.6)) return expanded ? "collapse" : "close";
  if (dy < -60 || (dy < -24 && v < -0.6)) return expanded ? "stay" : "expand";
  return "stay";
}

/** Is a map point (container pixels) hidden behind the panel (container-relative rectangle)? */
export function hiddenBehind(pt: { x: number; y: number } | null, r: { left: number; top: number; right: number; bottom: number } | null, margin = 6): boolean {
  if (!pt || !r) return false;
  return pt.x >= r.left - margin && pt.x <= r.right + margin && pt.y >= r.top - margin && pt.y <= r.bottom + margin;
}
