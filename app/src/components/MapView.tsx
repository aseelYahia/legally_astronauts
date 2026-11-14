import L from "leaflet";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, GeoJSON, ImageOverlay, MapContainer, Marker, Pane, Polyline, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { formatLat, formatLon, metersPerDegLon, niceScale } from "../lib/mars";
import type { LonLat, Manifest, Poi, RouteResult, Stop, StopRole, TeamSlot } from "../types";
import { Icon, KindBadge, Term } from "./ui";

/** Mars CRS: map units are planetocentric degrees (y = lat, x = east lon).
 *  The USGS rasters are equidistant-cylindrical, which is exactly linear in
 *  lon/lat, so image overlays line up without reprojection. Distances are
 *  computed on the Mars sphere elsewhere, never with Leaflet's Euclidean metric. */
export const MarsCRS: L.CRS = L.extend({}, L.CRS.Simple, {
  transformation: new L.Transformation(1, 0, -1, 0),
  infinite: false,
});

export type LayerKey = "terrain" | "elevation" | "slope" | "geology" | "rover" | "weather";
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
  /** Safety alert markers (steep stretches) */
  alertMarkers?: { key: string; at: LonLat; title: string; why: string }[];
  /** Two-astronaut mode */
  teamRoutes?: { key: string; label: string; route: RouteResult; color: string; dash?: string }[];
  teamPins?: { key: string; at: LonLat; label: string; who: "A" | "B" | "meet" }[];
  teamMode?: boolean;
  onTeamSlot?: (poi: Poi, slot: TeamSlot) => void;
  /** Overrides the "Click the map to place the …" label */
  placeLabel?: string;
}

const ROLE_LABEL: Record<StopRole, string> = { start: "start", waypoint: "waypoint", destination: "destination" };

function teamIcon(who: "A" | "B" | "meet") {
  return L.divIcon({ className: "", html: `<div class="stop-pin stop-team-${who}"><span></span></div>`, iconSize: [26, 34], iconAnchor: [13, 32] });
}

const alertIcon = L.divIcon({
  className: "",
  html: `<div class="alert-pin" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28"><path d="M8 1.5h8l6.5 6.5v8l-6.5 6.5H8L1.5 16V8z" fill="#D98EBA" stroke="#F1EDF5" stroke-width="1.8"/><path d="M12 6.5v6.5M12 16.6v.4" stroke="#131522" stroke-width="2.6" stroke-linecap="round"/></svg></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function stopIcon(role: StopRole) {
  return L.divIcon({
    className: "",
    html: `<div class="stop-pin stop-${role}"><span></span></div>`,
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

/** Run a popup action, then close the popup it came from. */
const thenClose = (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
  fn();
  (e.currentTarget.closest(".leaflet-popup")?.querySelector(".leaflet-popup-close-button") as HTMLElement | null)?.click();
};

function aoiBounds(m: Manifest) {
  const a = m.aoi;
  return L.latLngBounds([a.lat_min, a.lon_min], [a.lat_max, a.lon_max]);
}

function Controller({ manifest, flyTarget, onMapClick, onCursor }: Pick<Props, "manifest" | "flyTarget" | "onMapClick" | "onCursor">) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    const a = manifest.aoi;
    const b = aoiBounds(manifest);
    // Fill the frame with real terrain, framed between the delta front and the landing site,
    // then nudge the view so no empty space outside the data area shows.
    const z = map.getBoundsZoom(b, true);
    map.setView([a.lat_min + 0.42 * (a.lat_max - a.lat_min), a.lon_min + 0.6 * (a.lon_max - a.lon_min)], z, { animate: false });
    map.panInsideBounds(b, { animate: false });
  }, [map, manifest]);
  useEffect(() => {
    if (flyTarget) map.flyTo([flyTarget.lat, flyTarget.lon], flyTarget.zoom ?? Math.max(map.getZoom(), 14.5), { duration: 0.8 });
  }, [map, flyTarget]);
  // Keep Leaflet in sync when panels, drawers or the mobile sheet resize the map.
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  useMapEvents({
    click: (e) => onMapClick(e.latlng.lng, e.latlng.lat),
    mousemove: (e) => onCursor([e.latlng.lng, e.latlng.lat]),
    mouseout: () => onCursor(null),
  });
  return null;
}

function MapButtons({ manifest }: { manifest: Manifest }) {
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
      <button aria-label="Zoom in" title="Zoom in" onClick={() => map.zoomIn(0.5)}><Icon name="plus" /></button>
      <button aria-label="Zoom out" title="Zoom out" onClick={() => map.zoomOut(0.5)}><Icon name="minus" /></button>
      <button aria-label="Show the whole area" title="Show the whole area" className="sep" onClick={() => map.flyToBounds(aoiBounds(manifest), { duration: 0.6 })}>
        <Icon name="target" />
      </button>
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
  const ll = (r: RouteResult) => r.path_lonlat.map(([x, y]) => [y, x] as [number, number]);
  const a = manifest.aoi;
  const maxBounds = useMemo(() => L.latLngBounds([a.lat_min - 0.02, a.lon_min - 0.03], [a.lat_max + 0.02, a.lon_max + 0.03]), [a]);
  const L_ = manifest.layers;
  const routeLatLngs = useMemo(() => route?.path_lonlat.map(([x, y]) => [y, x] as [number, number]) ?? [], [route]);
  const hoverPt = hoverIndex !== null && route ? route.path_lonlat[hoverIndex] : null;
  const legend = L_.elevation.legend as { min_m: number; max_m: number };
  const hb = L_.hirise_elevation?.bounds;
  const icons = useMemo(() => Object.fromEntries(pois.map((p) => [p.id, poiIcon(p, planning)])), [pois, planning]);

  return (
    <div className={`map-wrap ${placeMode ? "placing" : ""}`}>
      <MapContainer
        crs={MarsCRS}
        center={[(a.lat_min + a.lat_max) / 2, (a.lon_min + a.lon_max) / 2]}
        zoom={13}
        minZoom={11.5}
        maxZoom={17}
        zoomSnap={0.25}
        zoomDelta={0.5}
        maxBounds={maxBounds}
        maxBoundsViscosity={0.8}
        zoomControl={false}
        attributionControl={false}
        className="map"
      >
        <Controller manifest={manifest} flyTarget={flyTarget} onMapClick={onMapClick} onCursor={onCursor} />
        <Pane name="terrain" style={{ zIndex: 200 }}>
          {layers.terrain && L_.terrain.bounds && <ImageOverlay url={`/data/${L_.terrain.file}`} bounds={L_.terrain.bounds} />}
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
              <Tooltip sticky className="map-tip">HiRISE 1 m detail area · routes fully inside use sharper 4 m terrain</Tooltip>
            </Polyline>
          </Pane>
        )}
        {layers.rover && (
          <Pane name="rover" style={{ zIndex: 400 }}>
            <GeoJSON
              data={rover}
              style={() => ({ color: "#F1EDF5", weight: 2.2, opacity: 0.8, dashArray: "1 5", lineCap: "round" })}
              onEachFeature={(f, layer) =>
                layer.bindTooltip(`Perseverance drive · sol ${(f.properties as { sol: number }).sol}`, { sticky: true, className: "map-tip" })
              }
            />
          </Pane>
        )}
        <Pane name="route" style={{ zIndex: 450 }}>
          {props.altRoutes?.map((a) => (
            <Polyline key={a.key} positions={ll(a.route)} pathOptions={{ color: a.color, weight: 3, opacity: 0.85, dashArray: a.dash ?? "6 6", lineCap: "round" }}>
              <Tooltip sticky className="map-tip">{a.label} option · click Compare in the planner to select it</Tooltip>
            </Polyline>
          ))}
          {props.teamRoutes?.map((t) => (
            <Fragment key={t.key}>
              <Polyline positions={ll(t.route)} pathOptions={{ color: "#131522", weight: 7, opacity: 0.35, interactive: false }} />
              <Polyline positions={ll(t.route)} pathOptions={{ color: t.color, weight: t.dash ? 2.5 : 3.5, opacity: t.dash ? 0.9 : 1, dashArray: t.dash }}>
                <Tooltip sticky className="map-tip">{t.label}</Tooltip>
              </Polyline>
            </Fragment>
          ))}
          {routeLatLngs.length > 1 && (
            <>
              <Polyline positions={routeLatLngs} pathOptions={{ color: "#131522", weight: 7, opacity: 0.35, interactive: false }} />
              <Polyline positions={routeLatLngs} pathOptions={{ color: routeColor, weight: 4, opacity: 1, interactive: false }} />
            </>
          )}
          {route && route.path_lonlat.filter((_, i) => i % Math.max(1, Math.floor(route.path_lonlat.length / 8)) === 0 && i > 0).map(([x, y], i) => (
            <CircleMarker key={i} center={[y, x]} radius={3} pathOptions={{ color: "#F1EDF5", fillColor: routeColor, fillOpacity: 1, weight: 1.5, interactive: false }} />
          ))}
          {hoverPt && <CircleMarker center={[hoverPt[1], hoverPt[0]]} radius={7} pathOptions={{ color: "#F1EDF5", fillColor: "#D98EBA", fillOpacity: 1, weight: 2 }} />}
        </Pane>
        {layers.geology &&
          pois.map((p) => (
            <Marker key={p.id} position={[p.lat, p.lon]} icon={icons[p.id]} riseOnHover>
              <Popup className="poi-popup" maxWidth={290} autoPanPaddingTopLeft={[20, 84]} autoPanPaddingBottomRight={[70, 90]}>
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
                      <dt>Type</dt><dd>{p.type}</dd>
                      <dt>Campaign</dt><dd>{p.campaign}</dd>
                      <dt>Sealed</dt><dd><Term k="sol">Sol</Term> {p.sol_sealed} · {p.date_sealed}</dd>
                      {p.core_length_cm ? (<><dt>Core length</dt><dd>{p.core_length_cm} cm</dd></>) : null}
                      <dt>Position</dt><dd>{formatLat(p.lat)} · {formatLon(p.lon)}</dd>
                    </dl>
                  ) : (
                    <p className="popup-desc">{p.description}</p>
                  )}
                  {p.position_method && <p className="popup-note">{p.position_method}</p>}
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
                        <button className="btn-mini teal" onClick={thenClose(() => onPoiAction(p, "start"))}>Set as start</button>
                        <button className="btn-mini lav" onClick={thenClose(() => onPoiAction(p, "waypoint"))}>Add waypoint</button>
                        <button className="btn-mini rose" onClick={thenClose(() => onPoiAction(p, "destination"))}>Set destination</button>
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
              </Popup>
            </Marker>
          ))}
        {props.alertMarkers?.map((a) => (
          <Marker key={a.key} position={[a.at[1], a.at[0]]} icon={alertIcon} zIndexOffset={900}>
            <Tooltip direction="top" offset={[0, -10]} className="map-tip alert-tip">
              <b>⚠ {a.title}</b>
              <span>{a.why}</span>
            </Tooltip>
          </Marker>
        ))}
        {props.teamPins?.map((t) => (
          <Marker key={t.key} position={[t.at[1], t.at[0]]} icon={teamIcon(t.who)} zIndexOffset={1000} interactive={false}>
            <Tooltip permanent direction="auto" offset={[0, -18]} className={`stop-label label-team-${t.who}`}>
              {t.label}
            </Tooltip>
          </Marker>
        ))}
        {stops.map((s) => (
          <Marker key={s.id} position={[s.lat, s.lon]} icon={stopIcon(s.role)} zIndexOffset={1000} interactive={false}>
            <Tooltip permanent direction="auto" offset={[0, -18]} className={`stop-label label-${s.role}`}>
              {s.name}
            </Tooltip>
          </Marker>
        ))}
        <MapButtons manifest={manifest} />
        <ScaleBar />
      </MapContainer>

      <div className="map-title">
        <h2>Jezero Crater</h2>
        <span>Mars · 18.4° N, 77.4° E</span>
      </div>

      {layers.elevation && (
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
      )}

      <div className={`map-hint ${placeMode ? `placing-${placeMode}` : ""}`} role="status">
        <Icon name={placeMode ? "pin" : "info"} size={14} />
        {placeMode ? (props.placeLabel ? `Click the map to place ${props.placeLabel}` : `Click the map to place the ${ROLE_LABEL[placeMode]}`) : hint}
      </div>

      <div className="credit">CTX: NASA/JPL/MSSS · HiRISE: NASA/JPL/UArizona · DTMs: USGS Astrogeology · Traverse: NASA/JPL-Caltech</div>
    </div>
  );
}
