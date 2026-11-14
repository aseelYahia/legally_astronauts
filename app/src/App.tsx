import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExplorePanel } from "./components/ExplorePanel";
import { LayersPanel } from "./components/LayersPanel";
import { MapView, type LayerKey, type PlaceMode } from "./components/MapView";
import { Onboarding } from "./components/Onboarding";
import { PlannerPanel } from "./components/PlannerPanel";
import { SavedRoutes } from "./components/SavedRoutes";
import { ScienceView } from "./components/ScienceView";
import { Icon, KindBadge, Mascot } from "./components/ui";
import { apiHealth, loadStatic, planRoute, probeTerrain, type TerrainProbe } from "./lib/api";
import { formatLat, formatLon, parseLatLon } from "./lib/mars";
import { riskLevel, samplesNearRoute } from "./lib/routeAnalysis";
import { deleteRoute, flag, loadRoutes, saveRoute } from "./lib/storage";
import type { LonLat, Manifest, Poi, RouteResult, SavedRoute, Stop, StopRole, WeatherSol } from "./types";

type View = "explore" | "planner" | "science";
type Left = "layers" | "saved" | null;

let uid = 0;
const newId = () => `s${Date.now().toString(36)}${(uid++).toString(36)}`;

export default function App() {
  const [data, setData] = useState<{ manifest: Manifest; pois: Poi[]; weather: WeatherSol[]; rover: GeoJSON.FeatureCollection } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>("planner");
  // On tablets the layers panel is an overlay drawer, so start with it closed.
  const [left, setLeft] = useState<Left>(() => (typeof window !== "undefined" && window.innerWidth <= 1180 ? null : "layers"));
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ terrain: true, elevation: true, slope: true, geology: true, rover: false, weather: true });
  const [opacity, setOpacity] = useState(0.65);
  const [stops, setStops] = useState<Stop[]>([]);
  const [placeMode, setPlaceMode] = useState<PlaceMode>(null);
  const [maxSlope, setMaxSlope] = useState(25);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiUp, setApiUp] = useState(true);
  const [routeName, setRouteName] = useState("MARSWALK 01");
  const [routeId, setRouteId] = useState(newId);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState<SavedRoute[]>(() => loadRoutes());
  const [savedFlash, setSavedFlash] = useState(false);
  const [probe, setProbe] = useState<TerrainProbe | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [cursor, setCursor] = useState<LonLat | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ lon: number; lat: number; zoom?: number; key: number } | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => !flag("onboarded"));
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    loadStatic()
      .then((d) => {
        setData({ manifest: d.manifest, pois: d.pois, weather: d.weather.sols, rover: d.rover });
        const landing = d.pois.find((p) => p.id === "landing");
        if (landing) setStops([{ id: newId(), role: "start", name: "Base Camp", lon: landing.lon, lat: landing.lat, poiId: landing.id }]);
      })
      .catch((e) => setLoadError(String(e)));
    apiHealth().then(setApiUp);
  }, []);

  // Auto-analyze when the itinerary changes and is complete.
  const reqSeq = useRef(0);
  const analyze = useCallback(async () => {
    const s = stops.find((x) => x.role === "start");
    const d = stops.find((x) => x.role === "destination");
    if (!s || !d) return;
    const pts: LonLat[] = [s, ...stops.filter((x) => x.role === "waypoint"), d].map((x) => [x.lon, x.lat]);
    const seq = ++reqSeq.current;
    setBusy(true);
    setRouteError(null);
    try {
      const r = await planRoute(pts, maxSlope);
      if (seq === reqSeq.current) setRoute(r);
      setApiUp(true);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setRoute(null);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Failed to fetch") || msg.includes("HTTP 50")) {
        setApiUp(false);
      } else setRouteError(msg);
    } finally {
      if (seq === reqSeq.current) setBusy(false);
    }
  }, [stops, maxSlope]);

  useEffect(() => {
    setRoute(null);
    const t = setTimeout(() => void analyze(), 250);
    return () => clearTimeout(t);
  }, [analyze]);

  const addStop = useCallback((role: StopRole, lon: number, lat: number, name?: string, poiId?: string) => {
    setStops((prev) => {
      const wpCount = prev.filter((s) => s.role === "waypoint").length;
      const stop: Stop = {
        id: newId(),
        role,
        lon,
        lat,
        poiId,
        name: name ?? (role === "start" ? "Base Camp" : role === "waypoint" ? `Waypoint ${String.fromCharCode(65 + wpCount)}` : "Science Site"),
      };
      if (role === "waypoint") return [...prev, stop];
      return [...prev.filter((s) => s.role !== role), stop];
    });
  }, []);

  const onMapClick = useCallback(
    (lon: number, lat: number) => {
      if (placeMode) {
        addStop(placeMode, lon, lat);
        setPlaceMode(null);
        return;
      }
      if (view === "explore") {
        setProbeBusy(true);
        probeTerrain(lon, lat)
          .then((p) => {
            setProbe(p);
            setApiUp(true);
          })
          .catch(() => setApiUp(false))
          .finally(() => setProbeBusy(false));
      }
    },
    [placeMode, addStop, view],
  );

  const onPoiAction = useCallback(
    (p: Poi, role: StopRole) => {
      addStop(role, p.lon, p.lat, role === "start" && p.category === "landing" ? "Base Camp" : p.name, p.id);
    },
    [addStop],
  );

  const fly = (lon: number, lat: number, zoom?: number) => setFlyTarget({ lon, lat, zoom, key: Date.now() });

  const save = () => {
    const r: SavedRoute = {
      id: routeId,
      name: routeName,
      savedAt: new Date().toISOString(),
      stops,
      maxSlopeDeg: maxSlope,
      notes,
      summary: route ? { distance_m: route.distance_m, elevation_gain_m: route.elevation_gain_m, max_slope_deg: route.max_slope_deg, grid: route.grid.name } : undefined,
    };
    setSaved(saveRoute(r));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1400);
  };

  const loadSaved = (r: SavedRoute) => {
    setRouteId(r.id);
    setRouteName(r.name);
    setStops(r.stops);
    setMaxSlope(r.maxSlopeDeg);
    setNotes(r.notes);
    setView("planner");
    const d = r.stops.find((s) => s.role === "destination") ?? r.stops[0];
    if (d) fly(d.lon, d.lat, 13.5);
  };

  const searchResults = useMemo(() => {
    if (!data || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    return data.pois.filter((p) => p.name.toLowerCase().includes(q) || p.campaign?.toLowerCase().includes(q)).slice(0, 7);
  }, [data, query]);

  const submitSearch = () => {
    const ll = parseLatLon(query);
    if (ll) {
      fly(ll[0], ll[1], 15);
      setSearchOpen(false);
    } else if (searchResults[0]) {
      fly(searchResults[0].lon, searchResults[0].lat, 15.5);
      setSearchOpen(false);
    }
  };

  if (loadError) {
    return (
      <div className="splash">
        <Mascot pose="sitting" size={140} />
        <p>Couldn't load the terrain layers ({loadError}). Run <code>python analysis/scripts/build_layers.py</code>.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="splash">
        <Mascot pose="floating" size={150} className="bob" />
        <p>Loading Jezero Crater terrain…</p>
      </div>
    );
  }

  const { manifest, pois, weather, rover } = data;
  const near = route ? samplesNearRoute(pois, route.path_lonlat, 400) : [];
  const risk = route ? riskLevel(route) : null;
  const latestWx = [...weather].reverse().find((s) => s.min_temp_c !== null);
  const coord = cursor ?? [(manifest.aoi.lon_min + manifest.aoi.lon_max) / 2, (manifest.aoi.lat_min + manifest.aoi.lat_max) / 2];

  return (
    <div className={`app view-${view} ${left ? "" : "left-collapsed"}`}>
      <header className="topbar">
        <div className="brand">
          <Mascot pose="standing" size={42} />
          <span className="wordmark">PAWPRINT <em>MARS</em></span>
        </div>
        <span className="vsep" />
        <nav className="nav">
          <button className={view === "explore" ? "active" : ""} onClick={() => { setView("explore"); setPlaceMode(null); }}><Icon name="explore" /> Explore</button>
          <button className={view === "planner" ? "active" : ""} onClick={() => setView("planner")}><Icon name="route" /> Mission Planner</button>
          <button className={view === "science" ? "active" : ""} onClick={() => setView("science")}><Icon name="bars" /> Science Data</button>
        </nav>
        <div className="top-right">
          <span className="status-pill" title={apiUp ? "Python route engine online" : "Python route engine offline"}>
            <i className={apiUp ? "ok" : "bad"} /> Mission Status: <b>{view === "explore" ? "EXPLORING" : route ? "ROUTE READY" : "PLANNING"}</b>
          </span>
          <span className="data-pill" title="Terrain: USGS Astrogeology / NASA Mars 2020 TRN products">NASA · USGS DATA</span>
          <span className="vsep" />
          <button className="avatar" aria-label="Profile"><Icon name="user" size={20} /></button>
        </div>
      </header>

      <div className="body">
        <nav className="rail">
          <button className={left === "layers" && view !== "science" ? "active" : ""} onClick={() => { setView(view === "science" ? "explore" : view); setLeft(left === "layers" ? null : "layers"); }}>
            <Icon name="map" size={20} /><span>Map</span>
          </button>
          <button className={view === "planner" ? "active" : ""} onClick={() => setView("planner")}><Icon name="route" size={20} /><span>Plan</span></button>
          <button className={view === "science" ? "active" : ""} onClick={() => setView("science")}><Icon name="bars" size={20} /><span>Data</span></button>
          <button className={left === "saved" ? "active" : ""} onClick={() => { if (view === "science") setView("planner"); setLeft(left === "saved" ? null : "saved"); }}>
            <Icon name="files" size={20} /><span>Files</span>{saved.length > 0 && <em className="count">{saved.length}</em>}
          </button>
        </nav>

        {view === "science" ? (
          <main className="science-main">
            <ScienceView manifest={manifest} pois={pois} weather={weather} />
          </main>
        ) : (
          <>
            {left === "layers" && (
              <LayersPanel manifest={manifest} layers={layers} setLayer={(k, v) => setLayers((l) => ({ ...l, [k]: v }))} opacity={opacity} setOpacity={setOpacity} onCollapse={() => setLeft(null)} />
            )}
            {left === "saved" && (
              <SavedRoutes routes={saved} onLoad={loadSaved} onDelete={(id) => setSaved(deleteRoute(id))} onClose={() => setLeft(null)} />
            )}

            <main className="center">
              <div className="center-bar">
                <label className="select">
                  <select aria-label="Region" defaultValue="jezero">
                    <option value="jezero">Jezero Crater</option>
                    <option disabled>Gale Crater (coming soon)</option>
                  </select>
                </label>
                <div className="search">
                  <Icon name="search" size={16} />
                  <input
                    placeholder="Search location, feature, or coordinate…"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
                    onFocus={() => setSearchOpen(true)}
                    onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                    onKeyDown={(e) => e.key === "Enter" && submitSearch()}
                    aria-label="Search"
                  />
                  {searchOpen && query && (
                    <ul className="search-results">
                      {parseLatLon(query) && <li onMouseDown={submitSearch}><Icon name="target" size={14} /> Go to {query}</li>}
                      {searchResults.map((p) => (
                        <li key={p.id} onMouseDown={() => { fly(p.lon, p.lat, 15.5); setQuery(p.name); setSearchOpen(false); }}>
                          <Icon name={p.category === "landing" ? "flag" : "crystal"} size={14} /> {p.name} <span>{p.campaign ?? "Landing site"}</span>
                        </li>
                      ))}
                      {!parseLatLon(query) && searchResults.length === 0 && <li className="none">No match. Try a sample name or "18.45, 77.42"</li>}
                    </ul>
                  )}
                </div>
                <div className="coord">
                  <Icon name="target" size={16} /> {formatLat(coord[1], 3)}, {formatLon(coord[0], 3)}
                </div>
              </div>

              <div className="map-area">
                <MapView
                  manifest={manifest}
                  pois={pois}
                  rover={rover}
                  layers={layers}
                  opacity={opacity}
                  stops={view === "planner" ? stops : []}
                  route={view === "planner" ? route : null}
                  hoverIndex={hoverIndex}
                  placeMode={view === "planner" ? placeMode : null}
                  flyTarget={flyTarget}
                  onMapClick={onMapClick}
                  onCursor={setCursor}
                  onPoiAction={onPoiAction}
                  planning={view === "planner"}
                />
                {layers.weather && latestWx && (
                  <div className="wx-chip" title="NASA MEDA public feed (archived)">
                    <Icon name="cloud" size={15} /> Sol {latestWx.sol} · {latestWx.min_temp_c}° / {latestWx.max_temp_c}° C · {latestWx.pressure_pa} Pa <KindBadge kind="archived" />
                  </div>
                )}
                {view === "planner" && busy && (
                  <div className="computing">
                    <Mascot pose="floating" size={64} className="bob" />
                    <span>Sniffing out the safest path…</span>
                  </div>
                )}
                {view === "planner" && (
                  <div className="map-cards">
                    <div className="map-card">
                      <Icon name="warn" size={22} />
                      <div>
                        <div className="mc-title">Slope Risk (Route) {risk && <span className={`risk-badge risk-${risk}`}>{risk}</span>}</div>
                        <div className="mc-sub">
                          {route
                            ? `Max slope: ${route.max_slope_deg.toFixed(1)}°  |  ≥15° terrain: ${((route.slope_class_fraction.hazard + route.slope_class_fraction.nogo) * 100).toFixed(0)}%  |  ${route.grid.name.toUpperCase()} ${route.grid.resolution_m} m`
                            : "Set a start and destination to analyze"}
                        </div>
                      </div>
                    </div>
                    <div className="map-card">
                      <Icon name="crystal" size={22} />
                      <div>
                        <div className="mc-title">Geology Samples (Nearby)</div>
                        <div className="mc-sub">
                          {route ? (near.length ? near.slice(0, 3).map((s) => s.name).join(" · ") + (near.length > 3 ? ` +${near.length - 3}` : "") : "None within 400 m of route") : "NASA sample sites within 400 m"}
                        </div>
                      </div>
                      <Icon name="chevron" size={16} />
                    </div>
                  </div>
                )}
              </div>
            </main>

            {view === "planner" ? (
              <PlannerPanel
                name={routeName}
                setName={setRouteName}
                stops={stops}
                removeStop={(id) => setStops((s) => s.filter((x) => x.id !== id))}
                placeMode={placeMode}
                setPlaceMode={setPlaceMode}
                maxSlope={maxSlope}
                setMaxSlope={setMaxSlope}
                route={route}
                routeError={routeError}
                busy={busy}
                apiUp={apiUp}
                notes={notes}
                setNotes={setNotes}
                onAnalyze={() => void analyze()}
                onSave={save}
                onHover={setHoverIndex}
                savedFlash={savedFlash}
              />
            ) : (
              <ExplorePanel
                probe={probe}
                probeBusy={probeBusy}
                weather={layers.weather ? weather : []}
                pois={pois}
                onFly={(p) => fly(p.lon, p.lat, 15.5)}
                onPlan={(p) => { onPoiAction(p, "destination"); setView("planner"); }}
              />
            )}
          </>
        )}
      </div>

      {showOnboarding && <Onboarding onDone={() => { flag("onboarded", true); setShowOnboarding(false); }} />}
    </div>
  );
}
