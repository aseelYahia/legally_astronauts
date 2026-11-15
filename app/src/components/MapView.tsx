import L from "leaflet";
import { type WaterFile, type WaterZone } from "../lib/water";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleMarker, GeoJSON, ImageOverlay, MapContainer, Marker, Pane, Polyline, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { metersPerDegLon, niceScale } from "../lib/mars";
import { photoSites, type GeologyFile, type MineralsLayer, type PhotosFile } from "../lib/nasaExtras";
import type { LonLat, Manifest, Poi, RouteResult, Stop, StopRole, TeamSlot } from "../types";
import { Icon, Term } from "./ui";
import type { MapSelection } from "../lib/mapSelection";
import { MapSelectionContext, type MapSelectionApi } from "./map/MapSelectionContext";
import { MapInfoPanel, usePanelLayout } from "./map/MapInfoPanel";
import { buildPanelContent } from "./map/selectionContent";
export { nasaType } from "./map/selectionContent";
import { PoiLayer } from "./map/PoiLayer";
import { RouteLayer, type DrawnRoute } from "./map/RouteLayer";
import { TeamPins } from "./map/TeamPins";
import { HazardLayer } from "./map/HazardLayer";
import type { RouteHazard } from "../lib/routeHazards";
import { MapPanels, type PanelDef } from "./map/MapPanels";
import type { WeightedPoint } from "../lib/panelLayout";

/** Mars CRS: map units are planetocentric degrees (y = lat, x = east lon).
 *  The USGS rasters are equidistant-cylindrical, which is exactly linear in
 *  lon/lat, so image overlays line up without reprojection. Distances are
 *  computed on the Mars sphere elsewhere, never with Leaflet's Euclidean metric. */
export const MarsCRS: L.CRS = L.extend({}, L.CRS.Simple, {
  transformation: new L.Transformation(1, 0, -1, 0),
  infinite: false,
});

export type LayerKey = "terrain" | "elevation" | "slope" | "geology" | "rover" | "weather" | "hirise_img" | "geomap" | "minerals" | "photos" | "water";
export type PlaceMode = StopRole | null;

interface Props {
  manifest: Manifest;
  pois: Poi[];
  rover: GeoJSON.FeatureCollection;
  layers: Record<LayerKey, boolean>;
  opacity: number;
  stops: Stop[];
  route: RouteResult | null;
  hoverIndex: number | null;
  placeMode: PlaceMode;
  flyTarget: { lon: number; lat: number; zoom?: number; key: number } | null;
  onMapClick: (lon: number, lat: number) => void;
  onCursor: (ll: LonLat | null) => void;
  onPoiAction: (poi: Poi, role: StopRole) => void;
  onPlanTo: (poi: Poi) => void;
  planning: boolean;
  hint: string;
  /** Selected route colour (Compare Routes) */
  routeColor?: string;
  /** Non-selected compared routes, drawn underneath */
  altRoutes?: { key: string; label: string; route: RouteResult; color: string; dash?: string }[];
  /** Location-specific route hazards (lib/routeHazards), drawn by HazardLayer */
  hazards?: RouteHazard[];
  /** Warning selected on the Warnings board (kept in sync with the hazard markers) */
  selectedAlertId?: string | null;
  onSelectAlert?: (id: string | null) => void;
  /** Bumped by the board's "Show on map" */
  hazardLocateKey?: number;
  /** Two-astronaut mode */
  teamRoutes?: { key: string; label: string; route: RouteResult; color: string; dash?: string }[];
  teamPins?: { key: string; at: LonLat; label: string; who: "A" | "B" | "meet" }[];
  teamMode?: boolean;
  onTeamSlot?: (poi: Poi, slot: TeamSlot) => void;
  /** Overrides the "Click the map to place the …" label */
  placeLabel?: string;
  /** NASA data-verification upgrade */
  geology?: GeologyFile | null;
  photos?: PhotosFile | null;
  mineralOpacity?: number;
  roverMaxSol?: number;
  onOpenGroundView?: (poiId: string | null) => void;
  /** Selected route's objective key and label (for route chips) */
  routeKey?: string;
  routeLabel?: string;
  /** Latest weather reading (rendered in a movable map panel) */
  weather?: ReactNode;
  /** Location the user clicked in the planner: shown in the information panel with Set Destination / Set Start / Add Waypoint. */
  pick?: { lon: number; lat: number } | null;
  onPickRole?: (role: StopRole, lon: number, lat: number) => void;
  onPickSlot?: (slot: TeamSlot, lon: number, lat: number) => void;
  onPickClose?: () => void;
  /** Ancient Water Evidence layer */
  water?: WaterFile | null;
  waterOpacity?: number;
  waterZone?: string | null;
  onWaterDestination?: (z: WaterZone) => void;
  /** Remove a route stop (from the stop's details in the information panel) */
  onRemoveStop?: (id: string) => void;
}

const hiriseLabel = L.divIcon({ className: "", html: `<div class="hirise-label">HiRISE Coverage (4 m routing grid)</div>`, iconSize: [0, 0], iconAnchor: [-8, -8] });

const cameraIcon = L.divIcon({
  className: "",
  html: `<div class="cam-pin" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" fill="none" stroke="#131522" stroke-width="2"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="#131522" stroke-width="2"/></svg></div>`,
  iconSize: [24, 24],
  iconAnchor: [-2, 26],
});

const ROLE_LABEL: Record<StopRole, string> = { start: "start", waypoint: "waypoint", destination: "destination" };

const cameraIconSel = L.divIcon({ ...cameraIcon.options, html: (cameraIcon.options.html as string).replace('class="cam-pin"', 'class="cam-pin is-selected"') });

/** Selection highlight drawn under a selected marker, and the pin for a clicked spot. Never interactive. */
const ringIcon = L.divIcon({ className: "sel-ring-icon", html: `<div class="sel-ring"></div>`, iconSize: [0, 0], iconAnchor: [0, 0] });
const pointRingIcon = L.divIcon({ className: "sel-ring-icon", html: `<div class="sel-ring"></div><div class="sel-dot"></div>`, iconSize: [0, 0], iconAnchor: [0, 0] });

function stopIcon(role: StopRole, num?: number, selected = false) {
  return L.divIcon({
    className: "",
    html: `<div class="stop-pin stop-${role}${selected ? " is-selected" : ""}"><span>${num ?? ""}</span></div>`,
    iconSize: [26, 34],
    iconAnchor: [13, 32],
  });
}

function typeClass(t?: string) {
  if (!t) return "";
  if (t.includes("igneous")) return "igneous";
  if (t.includes("sedimentary") || t.includes("carbonate")) return "sedimentary";
  if (t.includes("Regolith")) return "regolith";
  return "atmo";
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Marker icon with a built-in hover label. (A Leaflet Tooltip bound to the same
 *  marker as a Popup closes the popup on click in Leaflet 1.9, so the label lives
 *  in the icon itself and is revealed with CSS :hover.) Icons are created once. */
const poiIcon = (p: Poi, planning: boolean) => {
  const label =
    `<div class="poi-label"><b>${p.number ? `#${p.number} ` : ""}${esc(p.name)}</b>` +
    `<span>${esc(p.category === "landing" ? "Perseverance landing site" : p.type ?? "")}</span>` +
    `<em>Click for details${planning ? " and route options" : ""}</em></div>`;
  return p.category === "landing"
    ? L.divIcon({ className: "poi-marker", html: `<div class="poi-pin landing"></div>${label}`, iconSize: [18, 18], iconAnchor: [9, 9] })
    : L.divIcon({ className: "poi-marker", html: `<div class="poi-pin ${typeClass(p.type)}"></div>${label}`, iconSize: [16, 16], iconAnchor: [8, 8] });
};

function aoiBounds(m: Manifest) {
  const a = m.aoi;
  return L.latLngBounds([a.lat_min, a.lon_min], [a.lat_max, a.lon_max]);
}

const snapDown = (z: number) => Math.floor(z * 4) / 4;

/** Zoom at which the study area is fully visible ("contain") or fills the map ("fill").
 *  Computed directly (CRS.Simple: 2^zoom pixels per degree) because Leaflet's getBoundsZoom
 *  clamps to the current minZoom, which would stop the limit from ever coming back down. */
export function aoiZooms(size: { x: number; y: number }, m: Manifest) {
  const a = m.aoi;
  const kx = size.x / (a.lon_max - a.lon_min);
  const ky = size.y / (a.lat_max - a.lat_min);
  return { contain: Math.log2(Math.min(kx, ky)), fill: Math.log2(Math.max(kx, ky)) };
}

/** Zoom limits that depend on the visible map size: never zoom out past the point where the whole study
 *  area is visible, and keep panning inside the data. Bounds are the real AOI; imagery is never stretched. */
export function applyViewLimits(map: L.Map, manifest: Manifest) {
  const b = aoiBounds(manifest);
  const size = map.getSize();
  if (size.x < 50 || size.y < 50) return;
  const contain = snapDown(aoiZooms(size, manifest).contain);
  map.setMinZoom(contain);
  map.setMaxBounds(b);
  if (map.getZoom() < contain) map.setZoom(contain, { animate: false });
}

/** Default framing: fill the map area with terrain (no empty margins), centred between the delta front and
 *  the landing site. */
export function resetView(map: L.Map, manifest: Manifest, animate = true) {
  const a = manifest.aoi;
  const b = aoiBounds(manifest);
  const fill = Math.ceil(aoiZooms(map.getSize(), manifest).fill * 4) / 4;
  const center = L.latLng(a.lat_min + 0.42 * (a.lat_max - a.lat_min), a.lon_min + 0.6 * (a.lon_max - a.lon_min));
  if (animate) map.flyTo(center, fill, { duration: 0.6 });
  else map.setView(center, fill, { animate: false });
  map.once("moveend", () => map.panInsideBounds(b, { animate: false }));
  if (!animate) map.panInsideBounds(b, { animate: false });
}

function Controller({ manifest, flyTarget, onMapClick, onCursor, fit }: Pick<Props, "manifest" | "flyTarget" | "onMapClick" | "onCursor"> & { fit: L.LatLngBounds | null }) {
  const map = useMap();
  const fitted = useRef(false);
  const touched = useRef(false); // has the user moved the map yet?
  const lastSize = useRef<L.Point | null>(null);
  useEffect(() => {
    const mark = () => (touched.current = true);
    const el = map.getContainer();
    const unmark = () => (touched.current = false);
    map.on("dragstart usertouch", mark);
    map.on("userreset", unmark);
    el.addEventListener("wheel", mark, { passive: true });
    el.addEventListener("touchstart", mark, { passive: true });
    el.addEventListener("dblclick", mark);
    return () => {
      map.off("dragstart usertouch", mark);
      map.off("userreset", unmark);
      el.removeEventListener("wheel", mark);
      el.removeEventListener("touchstart", mark);
      el.removeEventListener("dblclick", mark);
    };
  }, [map]);
  useEffect(() => {
    const init = () => {
      if (fitted.current) return;
      const sz = map.getSize();
      if (sz.x < 50 || sz.y < 50) return; // wait for layout
      fitted.current = true;
      applyViewLimits(map, manifest);
      resetView(map, manifest, false);
    };
    init();
    // Keep Leaflet in sync when panels, drawers or the mobile sheet resize the map, and recompute limits.
    const el = map.getContainer();
    const ro = new ResizeObserver(() => {
      // pan: false keeps the top-left corner fixed, so when the dock or a sheet changes the map's height the
      // terrain on screen stays where it is (Leaflet's default keeps the centre, which shifts everything).
      map.invalidateSize({ animate: false, pan: false });
      const sz = map.getSize();
      if (lastSize.current && lastSize.current.equals(sz)) return;
      lastSize.current = sz;
      if (!fitted.current) return init();
      const wasAtMin = map.getZoom() <= map.getMinZoom() + 0.01;
      applyViewLimits(map, manifest);
      if (!touched.current) return resetView(map, manifest, false); // keep the default framing until the user takes over
      if (wasAtMin) map.setZoom(map.getMinZoom(), { animate: false });
      map.panInsideBounds(aoiBounds(manifest), { animate: false });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [map, manifest]);
  useEffect(() => {
    if (flyTarget) touched.current = true;
    if (flyTarget) map.flyTo([flyTarget.lat, flyTarget.lon], flyTarget.zoom ?? Math.max(map.getZoom(), 14.5), { duration: 0.8 });
  }, [map, flyTarget]);
  // New route result: frame it, leaving room for the map furniture.
  const lastFit = useRef<L.LatLngBounds | null>(null);
  useEffect(() => {
    if (!fit || (lastFit.current && lastFit.current.equals(fit, 1e-9))) return;
    lastFit.current = fit;
    touched.current = true;
    if (fitted.current) map.flyToBounds(fit, { paddingTopLeft: [60, 70], paddingBottomRight: [80, 70], maxZoom: 16, duration: 0.7 });
  }, [map, fit]);
  useMapEvents({
    click: (e) => {
      // Once the user has picked something, a later resize must not snap the map back to the default framing.
      touched.current = true;
      onMapClick(e.latlng.lng, e.latlng.lat);
    },
    mousemove: (e) => onCursor([e.latlng.lng, e.latlng.lat]),
    mouseout: () => onCursor(null),
  });
  return null;
}

/** Hands the Leaflet map to the panel layer, which lives outside MapContainer. */
function MapGrab({ onMap }: { onMap: (m: L.Map) => void }) {
  const map = useMap();
  useEffect(() => onMap(map), [map, onMap]);
  return null;
}

/** Tablet and phone widths get a compact info sheet instead of floating, draggable panels. */
function useCompact(query = "(max-width: 1024px)") {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [m, setM] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    on();
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

function MapButtons({ manifest, fit }: { manifest: Manifest; fit: L.LatLngBounds | null }) {
  const map = useMap();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      L.DomEvent.disableClickPropagation(ref.current);
      L.DomEvent.disableScrollPropagation(ref.current);
    }
  }, []);
  return (
    <div className="map-buttons" ref={ref}>
      <button aria-label="Zoom in" title="Zoom in" onClick={() => { map.fire("usertouch"); map.zoomIn(0.5); }}><Icon name="plus" /></button>
      <button aria-label="Zoom out" title="Zoom out" onClick={() => { map.fire("usertouch"); map.zoomOut(0.5); }}><Icon name="minus" /></button>
      <button aria-label="Reset view" title="Reset view: show the study area" className="sep" onClick={() => { resetView(map, manifest); map.fire("userreset"); }}>
        <Icon name="target" />
      </button>
      {fit && (
        <button aria-label="Fit route" title="Zoom to the planned route" onClick={() => map.flyToBounds(fit, { paddingTopLeft: [60, 70], paddingBottomRight: [80, 70], maxZoom: 16, duration: 0.6 })}>
          <Icon name="route" />
        </button>
      )}
    </div>
  );
}

function ScaleBar() {
  const map = useMap();
  const [s, setS] = useState({ px: 80, label: "1 km" });
  useEffect(() => {
    const update = () => {
      const c = map.getCenter();
      const pxPerDeg = Math.pow(2, map.getZoom()); // CRS scale: 2^z px per degree
      const mPerPx = metersPerDegLon(c.lat) / pxPerDeg; // true ground E-W metres per pixel
      const m = niceScale(mPerPx * 110);
      setS({ px: m / mPerPx, label: m >= 1000 ? `${m / 1000} km` : `${m} m` });
    };
    update();
    map.on("zoomend moveend", update);
    return () => {
      map.off("zoomend moveend", update);
    };
  }, [map]);
  return (
    <div className="scalebar" title="Ground distance on the Mars sphere (R = 3,396.19 km) at the map centre latitude">
      <div className="bar" style={{ width: s.px }} />
      <span>{s.label}</span>
    </div>
  );
}

export function MapView(props: Props) {
  const { manifest, pois, rover, layers, opacity, stops, route, hoverIndex, placeMode, flyTarget, onMapClick, onCursor, planning, hint } = props;
  const routeColor = props.routeColor ?? "#76C9C2";
  const a = manifest.aoi;
  const L_ = manifest.layers;
  const hoverPt = hoverIndex !== null && route ? route.path_lonlat[hoverIndex] : null;
  const legend = L_.elevation.legend as { min_m: number; max_m: number };
  const hb = L_.hirise_elevation?.bounds;
  const icons = useMemo(() => Object.fromEntries(pois.map((p) => [p.id, poiIcon(p, planning)])), [pois, planning]);
  // bounds of whatever was just planned, so the map can frame it (new object only when the route changes)
  const fit = useMemo(() => {
    const pts = [...(route?.path_lonlat ?? []), ...(props.teamRoutes ?? []).flatMap((t) => t.route.path_lonlat)];
    return pts.length > 1 ? L.latLngBounds(pts.map(([x, y]) => [y, x] as [number, number])) : null;
  }, [route, props.teamRoutes]);
  const drawn: DrawnRoute[] = useMemo(
    () => [
      ...(props.altRoutes ?? []).map((r) => ({ key: r.key, label: r.label, route: r.route, color: r.color, role: "alternative" as const })),
      ...(route ? [{ key: props.routeKey ?? "selected", label: props.routeLabel ?? "Selected", route, color: routeColor, role: "selected" as const }] : []),
      ...(props.teamRoutes ?? []).map((t) => ({ key: t.key, label: t.label, route: t.route, color: t.color, dash: t.dash, role: (t.dash ? "return" : t.key === "A" ? "teamA" : "teamB") as DrawnRoute["role"] })),
    ],
    [props.altRoutes, props.teamRoutes, route, routeColor, props.routeKey, props.routeLabel],
  );
  const maxSol = props.roverMaxSol ?? Infinity;
  const roverShown = useMemo(
    () => ({ ...rover, features: rover.features.filter((f) => ((f.properties as { sol?: number } | null)?.sol ?? 0) <= maxSol) }),
    [rover, maxSol],
  );
  const sites = useMemo(() => photoSites(props.photos ?? null, maxSol), [props.photos, maxSol]);
  const minerals = L_.minerals as unknown as MineralsLayer | undefined;
  const unitColor = useMemo(() => Object.fromEntries((props.geology?.units ?? []).map((u) => [u.symbol, u])), [props.geology]);

  /* ---- movable information panels (screen space only; never touch map coordinates) ---- */
  const wrapRef = useRef<HTMLDivElement>(null);
  const [leaflet, setLeaflet] = useState<L.Map | null>(null);
  const compact = useCompact();

  /* ---- selection + information panel (replaces every Leaflet popup; never moves the map) ---- */
  // Callbacks from App are new on every render (App re-renders on each mouse move for the cursor read-out);
  // read them through a ref so the panel's buttons always call the latest one without re-creating anything.
  const live = useRef(props);
  live.current = props;
  const [marked, setMarked] = useState<MapSelection | null>(null);
  /** Explore view: the spot last clicked for the terrain read-out (ring only; details are in the Explore panel). */
  const [probePt, setProbePt] = useState<{ lon: number; lat: number } | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  mapRef.current = leaflet;
  const dblTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(dblTimer.current), []);
  const select = useCallback((s: MapSelection | null) => {
    setMarked(s);
    if (!s) return;
    live.current.onPickClose?.(); // a marker replaces a clicked spot
    // Leaflet turns ANY two taps within 200 ms into a double-tap zoom, even taps on two different markers, so
    // quickly switching between markers on a phone zoomed the map. A tap that selects something is not the
    // first half of a zoom gesture: pause double-click zoom for a moment (double-tapping the ground still zooms).
    const m = mapRef.current;
    if (m?.doubleClickZoom && (m.doubleClickZoom.enabled() || dblTimer.current)) {
      m.doubleClickZoom.disable();
      window.clearTimeout(dblTimer.current);
      dblTimer.current = window.setTimeout(() => {
        dblTimer.current = 0;
        m.doubleClickZoom.enable();
      }, 450);
    }
  }, []);
  const closePanel = useCallback(() => {
    setMarked(null);
    live.current.onPickClose?.();
  }, []);
  // The planner's clicked spot comes from App (it also handles placement mode); markers are selected here.
  const sel: MapSelection | null = marked ?? (planning && props.pick ? { kind: "point", lon: props.pick.lon, lat: props.pick.lat } : null);
  const selApi = useMemo<MapSelectionApi>(() => ({ sel, select }), [sel, select]);
  useEffect(() => {
    setMarked(null);
    setProbePt(null);
  }, [planning, props.teamMode]);
  const handleMapClick = useCallback(
    (lon: number, lat: number) => {
      setMarked(null); // empty ground: drop a marker selection (the planner then shows the clicked spot)
      setProbePt(!planning && !placeMode ? { lon, lat } : null);
      onMapClick(lon, lat);
    },
    [planning, placeMode, onMapClick],
  );
  const panelLayoutState = usePanelLayout(wrapRef);
  const panelContent = (() => {
    // a selection whose layer is hidden is not shown (its marker is gone)
    if (sel?.kind === "poi" || sel?.kind === "poi-group") if (!layers.geology) return null;
    if (sel?.kind === "water" && !layers.water) return null;
    if (sel?.kind === "photos" && !layers.photos) return null;
    if (sel?.kind === "rover" && !layers.rover) return null;
    return buildPanelContent(sel, {
      pois,
      planning,
      teamMode: !!props.teamMode,
      stops,
      water: layers.water ? (props.water ?? null) : null,
      photos: props.photos ?? null,
      sites,
      hazards: props.hazards ?? [],
      map: leaflet,
      select,
      close: closePanel,
      onPickRole: (r, lon, lat) => live.current.onPickRole?.(r, lon, lat),
      onPickSlot: (s, lon, lat) => live.current.onPickSlot?.(s, lon, lat),
      onPoiAction: (p, r) => live.current.onPoiAction(p, r),
      onTeamSlot: (p, s) => live.current.onTeamSlot?.(p, s),
      onPlanTo: (p) => live.current.onPlanTo(p),
      onOpenGroundView: props.onOpenGroundView ? (id) => live.current.onOpenGroundView?.(id) : undefined,
      onWaterDestination: props.onWaterDestination ? (z) => live.current.onWaterDestination?.(z) : undefined,
      onRemoveStop: props.onRemoveStop ? (id) => live.current.onRemoveStop?.(id) : undefined,
    });
  })();
  // a marker selection that no longer exists (stop removed, route re-planned, layer hidden) is dropped
  useEffect(() => {
    if (marked && !panelContent) setMarked(null);
  }, [marked, panelContent]);
  const panelSide = !!panelContent && panelLayoutState.layout === "side";
  // where the selection ring goes (samples and route warnings have their own highlight)
  const ring = (() => {
    if (!panelContent?.anchor) return probePt;
    if (sel?.kind === "poi" || sel?.kind === "poi-group" || sel?.kind === "hazard" || sel?.kind === "hazard-group") return null;
    return panelContent.anchor;
  })();
  // what the panels should keep clear of, in map-container pixels: stops and routes matter most
  const avoidPoints = useCallback((): WeightedPoint[] => {
    if (!leaflet) return [];
    const out: WeightedPoint[] = [];
    const at = (lat: number, lon: number, w: number) => {
      const p = leaflet.latLngToContainerPoint([lat, lon]);
      out.push({ x: p.x, y: p.y, w });
    };
    if (layers.geology) for (const p of pois) at(p.lat, p.lon, p.category === "landing" ? 2 : 1.5);
    for (const d of drawn) {
      const w = d.role === "alternative" ? 1.5 : 3;
      for (const [x, y] of d.route.path_lonlat) at(y, x, w);
    }
    for (const s of stops) at(s.lat, s.lon, 6);
    for (const t of props.teamPins ?? []) at(t.at[1], t.at[0], 6);
    for (const h of props.hazards ?? []) at(h.at[1], h.at[0], 5);
    return out;
  }, [leaflet, layers.geology, pois, drawn, stops, props.teamPins, props.hazards]);
  // exact points the hazard icons must not cover (science targets, stops, team pins)
  const hazardAvoid = useMemo<LonLat[]>(
    () => [...(layers.geology ? pois.map((p) => [p.lon, p.lat] as LonLat) : []), ...stops.map((s) => [s.lon, s.lat] as LonLat), ...(props.teamPins ?? []).map((t) => t.at)],
    [layers.geology, pois, stops, props.teamPins],
  );
  const placeKey = `${drawn.map((d) => `${d.key}:${d.route.path_lonlat.length}`).join(",")}|${stops.map((s) => s.id).join(",")}|${(props.teamPins ?? []).map((t) => t.key).join(",")}`;
  const hintText = placeMode ? (props.placeLabel ? `Click the map to place ${props.placeLabel}` : `Click the map to place the ${ROLE_LABEL[placeMode]}`) : hint;
  const panels: PanelDef[] = [
    {
      id: "title",
      label: "Location title",
      short: "Jezero",
      chipIcon: <Icon name="pin" size={13} />,
      content: (
        <div className="map-title">
          <h2>Jezero Crater</h2>
          <span>Mars · 18.4° N, 77.4° E</span>
        </div>
      ),
    },
    ...(props.weather
      ? [{ id: "weather" as const, label: "Mars weather (archived NASA reading)", short: "Weather", chipIcon: <Icon name="cloud" size={13} />, content: <div className="wx-chip">{props.weather}</div> }]
      : []),
    ...(layers.elevation
      ? [
          {
            id: "legend" as const,
            label: "Elevation legend",
            short: "Legend",
            chipIcon: <span className="mp-ramp" aria-hidden="true" />,
            content: (
              <div className="legend">
                <div className="legend-title">
                  <Term k="elevation" /> (m, <Term k="areoid">areoid</Term>)
                </div>
                <div className="legend-ramp" />
                <div className="legend-ticks">
                  {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                    <span key={t}>{Math.round(legend.min_m + t * (legend.max_m - legend.min_m)).toLocaleString("en-US")}</span>
                  ))}
                </div>
              </div>
            ),
          },
        ]
      : []),
    {
      id: "hint",
      label: "Map instructions",
      short: "Tips",
      chipIcon: <Icon name={placeMode ? "pin" : "info"} size={13} />,
      className: placeMode ? `tone-${placeMode}` : "",
      // the placement instruction is shown even if the instructions panel was minimized
      forceOpen: !!placeMode,
      liveText: hintText,
      content: (
        <div className={`map-hint ${placeMode ? `placing-${placeMode}` : ""}`} role="status">
          <Icon name={placeMode ? "pin" : "info"} size={14} />
          {hintText}
        </div>
      ),
    },
  ];

  return (
    <div
      ref={wrapRef}
      className={`map-wrap ${placeMode ? "placing" : planning ? "planning" : "inspecting"} ${compact ? "panels-compact" : ""} ${panelSide ? "mi-open-side" : ""}`}
      style={panelSide ? ({ "--mi-w": `${panelLayoutState.width}px` } as React.CSSProperties) : undefined}
    >
      <MapSelectionContext.Provider value={selApi}>
      <MapContainer
        crs={MarsCRS}
        center={[(a.lat_min + a.lat_max) / 2, (a.lon_min + a.lon_max) / 2]}
        zoom={13}
        minZoom={10}
        maxZoom={17}
        zoomSnap={0.25}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={90}
        maxBoundsViscosity={1}
        zoomControl={false}
        attributionControl={false}
        className="map"
      >
        <MapGrab onMap={setLeaflet} />
        <Controller manifest={manifest} flyTarget={flyTarget} onMapClick={handleMapClick} onCursor={onCursor} fit={fit} />
        <Pane name="terrain" style={{ zIndex: 200 }}>
          {layers.terrain && L_.terrain.bounds && <ImageOverlay url={`/data/${L_.terrain.file}`} bounds={L_.terrain.bounds} />}
          {layers.hirise_img && L_.hirise_ortho?.bounds && <ImageOverlay url={`/data/${L_.hirise_ortho.file}`} bounds={L_.hirise_ortho.bounds} />}
        </Pane>
        <Pane name="elevation" style={{ zIndex: 210 }}>
          {layers.elevation && L_.elevation.bounds && (
            <ImageOverlay url={`/data/${L_.elevation.file}`} bounds={L_.elevation.bounds} opacity={layers.terrain ? opacity : 1} className="smooth" />
          )}
          {layers.elevation && L_.hirise_elevation?.bounds && (
            <ImageOverlay url={`/data/${L_.hirise_elevation.file}`} bounds={L_.hirise_elevation.bounds} opacity={layers.terrain ? opacity : 1} />
          )}
        </Pane>
        <Pane name="contours" style={{ zIndex: 220 }}>
          {layers.elevation && L_.contours.bounds && <ImageOverlay url={`/data/${L_.contours.file}`} bounds={L_.contours.bounds} opacity={0.45} />}
        </Pane>
        <Pane name="hazard" style={{ zIndex: 230 }}>
          {layers.slope && L_.slope.bounds && <ImageOverlay url={`/data/${L_.slope.file}`} bounds={L_.slope.bounds} opacity={Math.min(1, opacity + 0.15)} />}
          {layers.slope && L_.hirise_slope?.bounds && (
            <ImageOverlay url={`/data/${L_.hirise_slope.file}`} bounds={L_.hirise_slope.bounds} opacity={Math.min(1, opacity + 0.15)} />
          )}
        </Pane>
        {layers.geomap && props.geology && (
          <Pane name="geomap" style={{ zIndex: 236 }}>
            <GeoJSON
              key={`geo-${opacity}`}
              data={props.geology}
              style={(f) => {
                const u = unitColor[(f?.properties as { symbol: string }).symbol];
                return { color: u?.color ?? "#F1EDF5", weight: 1.4, opacity: 0.95, fillColor: u?.color ?? "#F1EDF5", fillOpacity: 0.28 * opacity + 0.06 };
              }}
              onEachFeature={(f, layer) => {
                const u = unitColor[(f.properties as { symbol: string }).symbol];
                layer.bindTooltip(`<b>${u?.symbol ?? ""}</b> · ${u?.name ?? ""}<br/><span>USGS SIM 3464 · boundary approximate (±100–200 m)</span>`, { sticky: true, className: "map-tip geo-tip" });
              }}
            />
          </Pane>
        )}
        {layers.water && props.water && L_.water_evidence?.bounds && (
          <Pane name="water-evidence" style={{ zIndex: 237 }}>
            <ImageOverlay url={`/data/${L_.water_evidence.file}`} bounds={L_.water_evidence.bounds} opacity={props.waterOpacity ?? 0.75} className="pixelated" />
            {props.water.zones.map((z) => (
              <CircleMarker
                key={z.id}
                center={[z.target[1], z.target[0]]}
                radius={props.waterZone === z.id || (sel?.kind === "water" && sel.id === z.id) ? 9 : 7}
                pathOptions={{ color: "#F1EDF5", weight: 2, fillColor: "#7C68CE", fillOpacity: 0.9 }}
                bubblingMouseEvents={false}
                eventHandlers={{ click: () => select({ kind: "water", id: z.id }) }}
              >
                <Tooltip permanent direction="right" offset={[8, 0]} className="water-zone-label">{z.id}</Tooltip>
              </CircleMarker>
            ))}
          </Pane>
        )}
        {layers.minerals && minerals?.bounds && (
          <Pane name="minerals" style={{ zIndex: 238 }}>
            <ImageOverlay url={`/data/${minerals.file}`} bounds={minerals.bounds} opacity={props.mineralOpacity ?? 0.85} className="pixelated" />
            {minerals.products.map((p) =>
              p.footprint ? (
                <Polyline key={p.product_id} positions={p.footprint.map(([x, y]) => [y, x] as [number, number])} pathOptions={{ color: "#F1EDF5", weight: 1.2, dashArray: "2 6", opacity: 0.8 }}>
                  <Tooltip sticky className="map-tip">CRISM {p.observation_id} footprint · observed {p.start_time.slice(0, 10)}</Tooltip>
                </Polyline>
              ) : null,
            )}
          </Pane>
        )}
        {hb && (layers.elevation || layers.slope) && (
          <Pane name="hirise-frame" style={{ zIndex: 240 }}>
            <Polyline
              positions={[
                [hb[0][0], hb[0][1]],
                [hb[1][0], hb[0][1]],
                [hb[1][0], hb[1][1]],
                [hb[0][0], hb[1][1]],
                [hb[0][0], hb[0][1]],
              ]}
              pathOptions={{ color: "#F1EDF5", weight: 1.2, dashArray: "5 5", opacity: 0.75 }}
            >
              <Tooltip sticky className="map-tip">HiRISE detail area (1 m DTM) · routes fully inside use a 4 m grid derived from it</Tooltip>
            </Polyline>
            <Marker position={[hb[1][0], hb[0][1]]} icon={hiriseLabel} interactive={false} keyboard={false} />
          </Pane>
        )}
        {layers.rover && (
          <Pane name="rover" style={{ zIndex: 400 }}>
            {/* the visible dotted track */}
            <GeoJSON
              key={`rover-${maxSol}`}
              data={roverShown}
              interactive={false}
              style={() => ({ color: "#F1EDF5", weight: 2.2, opacity: 0.8, dashArray: "1 5", lineCap: "round", interactive: false })}
            />
            {/* the selected sol's drive, drawn solid on top */}
            {sel?.kind === "rover" && (
              <GeoJSON
                key={`rover-sel-${sel.sol}-${maxSol}`}
                data={{ ...roverShown, features: roverShown.features.filter((f) => (f.properties as { sol?: number } | null)?.sol === sel.sol) } as GeoJSON.FeatureCollection}
                interactive={false}
                style={() => ({ color: "#A99BDD", weight: 4.5, opacity: 1, lineCap: "round", interactive: false })}
              />
            )}
            {/* an invisible, wider line on top that is easy to hit with a mouse or a finger (a 2 px dotted line is not) */}
            <GeoJSON
              key={`rover-hit-${maxSol}`}
              data={roverShown}
              style={() => ({ color: "#F1EDF5", weight: 14, opacity: 0, lineCap: "round" })}
              onEachFeature={(f, layer) => {
                const pr = f.properties as { sol: number; length_m?: number };
                layer.bindTooltip(`Perseverance drive · sol ${pr.sol}`, { sticky: true, className: "map-tip" });
                (layer as L.Path).options.bubblingMouseEvents = false; // a click on the track selects the track, not the ground under it
                layer.on("click", (e: L.LeafletMouseEvent) => select({ kind: "rover", sol: pr.sol, length_m: pr.length_m ?? null, lon: e.latlng.lng, lat: e.latlng.lat }));
              }}
            />
          </Pane>
        )}
        <Pane name="route" style={{ zIndex: 450 }}>
          <RouteLayer routes={drawn} />
          {hoverPt && <CircleMarker center={[hoverPt[1], hoverPt[0]]} radius={7} pathOptions={{ color: "#F1EDF5", fillColor: "#D98EBA", fillOpacity: 1, weight: 2 }} />}
        </Pane>
        {layers.geology && (
          <PoiLayer pois={pois} icons={icons} />
        )}
        {layers.photos &&
          sites.map((s) => (
            <Fragment key={s.rmc}>
              <CircleMarker center={[s.lat, s.lon]} radius={2.5} pathOptions={{ color: "#131522", fillColor: "#E6C79C", fillOpacity: 1, weight: 1, interactive: false }} />
              <Marker position={[s.lat, s.lon]} icon={sel?.kind === "photos" && sel.rmc === s.rmc ? cameraIconSel : cameraIcon} zIndexOffset={600} eventHandlers={{ click: () => select({ kind: "photos", rmc: s.rmc }) }}>
                <Tooltip direction="top" offset={[10, -26]} className="map-tip">
                  {s.photos.length} NASA photo{s.photos.length > 1 ? "s" : ""} · rover localization {s.rmc} · sol {s.photos[0].sol}
                </Tooltip>
              </Marker>
            </Fragment>
          ))}
        {props.hazards && (
          <HazardLayer
            hazards={props.hazards}
            avoid={hazardAvoid}
            selectedAlertId={props.selectedAlertId}
            onSelectAlert={props.onSelectAlert}
            locateKey={props.hazardLocateKey}
          />
        )}
        {props.teamPins && props.teamPins.length > 0 && <TeamPins pins={props.teamPins} />}
        {[...stops.filter((s) => s.role === "start"), ...stops.filter((s) => s.role === "waypoint"), ...stops.filter((s) => s.role === "destination")].map((s, i, all) => (
          <Marker
            key={s.id}
            position={[s.lat, s.lon]}
            icon={stopIcon(s.role, all.length > 1 ? i + 1 : undefined, sel?.kind === "stop" && sel.id === s.id)}
            zIndexOffset={1000}
            title={s.name}
            eventHandlers={{ click: () => select({ kind: "stop", id: s.id }) }}
          >
            <Tooltip permanent direction="auto" offset={[0, -18]} className={`stop-label label-${s.role}`}>
              {all.length > 1 ? `${i + 1} · ` : ""}{s.name}
            </Tooltip>
          </Marker>
        ))}
        {ring && (
          <Pane name="selection" style={{ zIndex: 590 }}>
            <Marker position={[ring.lat, ring.lon]} icon={sel?.kind === "point" || (!panelContent && probePt) ? pointRingIcon : ringIcon} interactive={false} keyboard={false} pane="selection" />
          </Pane>
        )}
        <MapButtons manifest={manifest} fit={fit} />
        <ScaleBar />
      </MapContainer>
      </MapSelectionContext.Provider>

      <MapPanels map={leaflet} wrapRef={wrapRef} panels={panels} points={avoidPoints} placeKey={placeKey} compact={compact} />

      <MapInfoPanel content={panelContent} layout={panelLayoutState.layout} width={panelLayoutState.width} map={leaflet} onClose={closePanel} />

      <div className="credit">
        CTX: NASA/JPL/MSSS · HiRISE: NASA/JPL/UArizona · DTMs: USGS Astrogeology · Traverse: NASA/JPL-Caltech
        {layers.hirise_img && " · HiRISE mosaic via NASA Mars Trek"}
        {layers.geomap && " · Geology: USGS SIM 3464 (Sun & Stack 2020)"}
        {(layers.minerals || layers.water) && " · CRISM: NASA/JHU-APL, PDS Geosciences"}
        {layers.water && !layers.geomap && " · Geology: USGS SIM 3464"}
        {layers.photos && " · Photos: NASA/JPL-Caltech"}
      </div>
    </div>
  );
}
