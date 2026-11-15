import L from "leaflet";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleMarker, GeoJSON, ImageOverlay, MapContainer, Marker, Pane, Polyline, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { formatLat, formatLon, metersPerDegLon, niceScale } from "../lib/mars";
import { photoSites, photosForPoi, sampleCheck, type GeologyFile, type MineralsLayer, type PhotosFile } from "../lib/nasaExtras";
import type { LonLat, Manifest, Poi, RouteResult, Stop, StopRole, TeamSlot } from "../types";
import { Icon, KindBadge, Term } from "./ui";
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

export type LayerKey = "terrain" | "elevation" | "slope" | "geology" | "rover" | "weather" | "hirise_img" | "geomap" | "minerals" | "photos";
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
  /** Location the user clicked in the planner: shows a popup with Set Destination / Set Start / Add Waypoint. */
  pick?: { lon: number; lat: number; key: number } | null;
  onPickRole?: (role: StopRole, lon: number, lat: number) => void;
  onPickSlot?: (slot: TeamSlot, lon: number, lat: number) => void;
  onPickClose?: () => void;
}

/** Popup for an arbitrary clicked map location (planner only). Stays open until an action or the close button. */
function PickPopup({ pick, team, onRole, onSlot, onClose }: { pick: { lon: number; lat: number; key: number }; team: boolean; onRole?: Props["onPickRole"]; onSlot?: Props["onPickSlot"]; onClose?: () => void }) {
  return (
    <Popup
      key={pick.key}
      position={[pick.lat, pick.lon]}
      closeOnClick={false}
      autoClose={false}
      autoPan
      className="pick-popup"
      eventHandlers={{ remove: () => onClose?.() }}
    >
      <div className="pick">
        <div className="pick-head">
          <span className="pick-icon"><Icon name="pin" size={18} /></span>
          <div>
            <b>Selected location</b>
            <span>{formatLat(pick.lat, 3)}, {formatLon(pick.lon, 3)}</span>
          </div>
        </div>
        {team ? (
          <div className="pick-actions team">
            <button className="pick-btn primary" onClick={() => onSlot?.("aDest", pick.lon, pick.lat)}><Icon name="pin" size={16} />A destination</button>
            <button className="pick-btn" onClick={() => onSlot?.("bDest", pick.lon, pick.lat)}><Icon name="pin" size={16} />B destination</button>
            <button className="pick-btn" onClick={() => onSlot?.("meet", pick.lon, pick.lat)}><Icon name="target" size={16} />Rendezvous</button>
            <button className="pick-btn" onClick={() => onSlot?.("aStart", pick.lon, pick.lat)}><Icon name="flag" size={16} />A start</button>
            <button className="pick-btn" onClick={() => onSlot?.("bStart", pick.lon, pick.lat)}><Icon name="flag" size={16} />B start</button>
          </div>
        ) : (
          <div className="pick-actions">
            <button className="pick-btn primary" onClick={() => onRole?.("destination", pick.lon, pick.lat)}><Icon name="pin" size={18} />Set Destination</button>
            <button className="pick-btn" onClick={() => onRole?.("start", pick.lon, pick.lat)}><Icon name="flag" size={18} />Set Start</button>
            <button className="pick-btn" onClick={() => onRole?.("waypoint", pick.lon, pick.lat)}><Icon name="route" size={18} />Add Waypoint</button>
          </div>
        )}
      </div>
    </Popup>
  );
}

const hiriseLabel = L.divIcon({ className: "", html: `<div class="hirise-label">HiRISE Coverage (4 m routing grid)</div>`, iconSize: [0, 0], iconAnchor: [-8, -8] });

const cameraIcon = L.divIcon({
  className: "",
  html: `<div class="cam-pin" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" fill="none" stroke="#131522" stroke-width="2"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="#131522" stroke-width="2"/></svg></div>`,
  iconSize: [24, 24],
  iconAnchor: [-2, 26],
});

const ROLE_LABEL: Record<StopRole, string> = { start: "start", waypoint: "waypoint", destination: "destination" };

function stopIcon(role: StopRole, num?: number) {
  return L.divIcon({
    className: "",
    html: `<div class="stop-pin stop-${role}"><span>${num ?? ""}</span></div>`,
    iconSize: [26, 34],
    iconAnchor: [13, 32],
  });
}

/** NASA's own sample-table wording; the igneous/sedimentary qualifier is a campaign-geology summary. */
export function nasaType(t?: string) {
  if (!t) return "";
  if (t.startsWith("Rock core")) return "Rock Core";
  return t;
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

/** Run a popup action, then close the popup it came from. */
const thenClose = (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
  fn();
  (e.currentTarget.closest(".leaflet-popup")?.querySelector(".leaflet-popup-close-button") as HTMLElement | null)?.click();
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
      map.invalidateSize({ animate: false });
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
    click: (e) => onMapClick(e.latlng.lng, e.latlng.lat),
    // The pointer over an open popup is not "on the ground": skip the read-out so moving inside a popup
    // does not re-render the whole app on every pixel.
    mousemove: (e) => {
      if ((e.originalEvent?.target as Element | null)?.closest?.(".leaflet-popup")) return;
      onCursor([e.latlng.lng, e.latlng.lat]);
    },
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
  const { manifest, pois, rover, layers, opacity, stops, route, hoverIndex, placeMode, flyTarget, onMapClick, onCursor, onPoiAction, onPlanTo, planning, hint } = props;
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
    <div ref={wrapRef} className={`map-wrap ${placeMode ? "placing" : planning ? "planning" : "inspecting"} ${compact ? "panels-compact" : ""}`}>
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
        <Controller manifest={manifest} flyTarget={flyTarget} onMapClick={onMapClick} onCursor={onCursor} fit={fit} />
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
            <GeoJSON
              key={`rover-${maxSol}`}
              data={roverShown}
              style={() => ({ color: "#F1EDF5", weight: 2.2, opacity: 0.8, dashArray: "1 5", lineCap: "round" })}
              onEachFeature={(f, layer) =>
                layer.bindTooltip(`Perseverance drive · sol ${(f.properties as { sol: number }).sol}`, { sticky: true, className: "map-tip" })
              }
            />
          </Pane>
        )}
        <Pane name="route" style={{ zIndex: 450 }}>
          <RouteLayer routes={drawn} />
          {hoverPt && <CircleMarker center={[hoverPt[1], hoverPt[0]]} radius={7} pathOptions={{ color: "#F1EDF5", fillColor: "#D98EBA", fillOpacity: 1, weight: 2 }} />}
        </Pane>
        {layers.geology && (
          <PoiLayer
            pois={pois}
            icons={icons}
            body={(p) => (
              <div className="popup">
                  <div className="popup-title">
                    {p.number ? <span className="num">#{p.number}</span> : null}
                    {p.name}
                  </div>
                  <div className="popup-badges">
                    <KindBadge kind="real" title="Name, sol and type from NASA" />
                    {p.position_quality === "estimated" && <KindBadge kind="estimated" title={p.position_method} />}
                  </div>
                  {p.category === "sample" ? (
                    <dl>
                      <dt>Type</dt><dd>{p.type}<span className="dd-note">NASA's table: {nasaType(p.type)}</span></dd>
                      <dt>Campaign</dt><dd>{p.campaign}</dd>
                      <dt>Sealed</dt><dd><Term k="sol">Sol</Term> {p.sol_sealed} · {p.date_sealed}</dd>
                      {p.core_length_cm ? (<><dt>Core length</dt><dd>{p.core_length_cm} cm</dd></>) : null}
                      <dt>Position</dt><dd>{formatLat(p.lat)} · {formatLon(p.lon)}</dd>
                    </dl>
                  ) : (
                    <p className="popup-desc">{p.description}</p>
                  )}
                  {p.position_method && (
                    <p className="popup-note">
                      {p.position_method}
                      {sampleCheck(props.photos ?? null, p.id)?.corroborated ? ". NASA images from the sealing sol were taken at this same localization." : ""}
                    </p>
                  )}
                  {photosForPoi(props.photos ?? null, p.id).length > 0 && props.onOpenGroundView && (
                    <button className="btn-mini lav gv-open" onClick={thenClose(() => props.onOpenGroundView?.(p.id))}>
                      <Icon name="camera" size={13} /> Ground View · {photosForPoi(props.photos ?? null, p.id).length} NASA photos
                    </button>
                  )}
                  {planning && props.teamMode ? (
                    <>
                      <div className="popup-q">Use this spot for the team:</div>
                      <div className="popup-actions">
                        <button className="btn-mini teal" onClick={thenClose(() => props.onTeamSlot?.(p, "aDest"))}>A destination</button>
                        <button className="btn-mini lav" onClick={thenClose(() => props.onTeamSlot?.(p, "bDest"))}>B destination</button>
                        <button className="btn-mini rose" onClick={thenClose(() => props.onTeamSlot?.(p, "meet"))}>Rendezvous</button>
                        <button className="btn-mini teal" onClick={thenClose(() => props.onTeamSlot?.(p, "aStart"))}>A start</button>
                        <button className="btn-mini lav" onClick={thenClose(() => props.onTeamSlot?.(p, "bStart"))}>B start</button>
                      </div>
                    </>
                  ) : planning ? (
                    <>
                      <div className="popup-q">Use this spot in your Marswalk:</div>
                      <div className="popup-actions">
                        <button className="btn-mini rose" onClick={thenClose(() => onPoiAction(p, "destination"))}>Set destination</button>
                        <button className="btn-mini teal" onClick={thenClose(() => onPoiAction(p, "start"))}>Set as start</button>
                        <button className="btn-mini lav" onClick={thenClose(() => onPoiAction(p, "waypoint"))}>Add waypoint</button>
                      </div>
                    </>
                  ) : (
                    <div className="popup-actions">
                      <button className="btn-mini rose" onClick={thenClose(() => onPlanTo(p))}>
                        <Icon name="route" size={13} /> Plan a walk here
                      </button>
                    </div>
                  )}
                </div>
            )}
          />
        )}
        {layers.photos &&
          sites.map((s) => (
            <Fragment key={s.rmc}>
              <CircleMarker center={[s.lat, s.lon]} radius={2.5} pathOptions={{ color: "#131522", fillColor: "#E6C79C", fillOpacity: 1, weight: 1, interactive: false }} />
              <Marker position={[s.lat, s.lon]} icon={cameraIcon} zIndexOffset={600} eventHandlers={{ click: () => props.onOpenGroundView?.(s.photos[0].poi_id) }}>
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
          <Marker key={s.id} position={[s.lat, s.lon]} icon={stopIcon(s.role, all.length > 1 ? i + 1 : undefined)} zIndexOffset={1000} interactive={false}>
            <Tooltip permanent direction="auto" offset={[0, -18]} className={`stop-label label-${s.role}`}>
              {all.length > 1 ? `${i + 1} · ` : ""}{s.name}
            </Tooltip>
          </Marker>
        ))}
        {planning && props.pick && (
          <PickPopup pick={props.pick} team={!!props.teamMode} onRole={props.onPickRole} onSlot={props.onPickSlot} onClose={props.onPickClose} />
        )}
        <MapButtons manifest={manifest} fit={fit} />
        <ScaleBar />
      </MapContainer>

      <MapPanels map={leaflet} wrapRef={wrapRef} panels={panels} points={avoidPoints} placeKey={placeKey} compact={compact} />

      <div className="credit">
        CTX: NASA/JPL/MSSS · HiRISE: NASA/JPL/UArizona · DTMs: USGS Astrogeology · Traverse: NASA/JPL-Caltech
        {layers.hirise_img && " · HiRISE mosaic via NASA Mars Trek"}
        {layers.geomap && " · Geology: USGS SIM 3464 (Sun & Stack 2020)"}
        {layers.minerals && " · CRISM: NASA/JHU-APL, PDS Geosciences"}
        {layers.photos && " · Photos: NASA/JPL-Caltech"}
      </div>
    </div>
  );
}
