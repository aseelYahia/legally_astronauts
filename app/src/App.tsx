import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExplorePanel } from "./components/ExplorePanel";
import { LayersPanel } from "./components/LayersPanel";
import { MapView, type LayerKey, type PlaceMode } from "./components/MapView";
import { Onboarding } from "./components/Onboarding";
import { PlannerPanel, type PlanStep } from "./components/PlannerPanel";
import { QuickGuide, type GuideStep } from "./components/QuickGuide";
import { SavedRoutes } from "./components/SavedRoutes";
import { ScienceView } from "./components/ScienceView";
import { Hint, Icon, KindBadge, Mascot, Term } from "./components/ui";
import { apiHealth, loadStatic, planRoute, probeTerrain, type TerrainProbe } from "./lib/api";
import { formatLat, formatLon, parseLatLon } from "./lib/mars";
import { deleteRoute, flag, loadRoutes, saveRoute } from "./lib/storage";
import type { LonLat, Manifest, Poi, RouteResult, SavedRoute, Stop, StopRole, WeatherSol } from "./types";

type View = "explore" | "planner" | "science";
type Left = "layers" | "saved" | null;

let uid = 0;
const newId = () => `s${Date.now().toString(36)}${(uid++).toString(36)}`;

function useMedia(query: string) {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

const VIEW_HELP: Record<View, string> = {
  explore: "Look around Jezero Crater and inspect the terrain",
  planner: "Plan a lower-risk walk between science targets",
  science: "See every dataset, source and validation check",
};

export default function App() {
  const [data, setData] = useState<{ manifest: Manifest; pois: Poi[]; weather: WeatherSol[]; rover: GeoJSON.FeatureCollection } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>("planner");
  const isMobile = useMedia("(max-width: 720px)");
  const isNarrow = useMedia("(max-width: 1180px)");
  // On tablets and phones the layers panel is an overlay drawer, so start with it closed.
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
  const [routeName, setRouteName] = useState("Marswalk 01");
  const [routeId, setRouteId] = useState(newId);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState<SavedRoute[]>(() => loadRoutes());
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [probe, setProbe] = useState<TerrainProbe | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [cursor, setCursor] = useState<LonLat | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ lon: number; lat: number; zoom?: number; key: number } | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => !flag("onboarded"));
  const [guideOpen, setGuideOpen] = useState(() => !flag("guideHidden"));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [planRequest, setPlanRequest] = useState(0);

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

  // ---------------- Route planning (explicit: the user presses Plan Route) ----------------
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
  const analyzeRef = useRef(analyze);
  analyzeRef.current = analyze;

  // Any itinerary change makes the old route stale: clear it (and cancel any in-flight request).
  useEffect(() => {
    reqSeq.current++;
    setRoute(null);
    setRouteError(null);
    setBusy(false);
  }, [stops, maxSlope]);

  // Programmatic re-plan (used after loading a saved route).
  useEffect(() => {
    if (planRequest) void analyzeRef.current();
  }, [planRequest]);

  useEffect(() => {
    if (route && isMobile) setSheetOpen(true);
  }, [route, isMobile]);

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
        if (isMobile) setSheetOpen(true);
        probeTerrain(lon, lat)
          .then((p) => {
            setProbe(p);
            setApiUp(true);
          })
          .catch(() => setApiUp(false))
          .finally(() => setProbeBusy(false));
      }
    },
    [placeMode, addStop, view, isMobile],
  );

  const onPoiAction = useCallback(
    (p: Poi, role: StopRole) => {
      addStop(role, p.lon, p.lat, role === "start" && p.category === "landing" ? "Base Camp" : p.name, p.id);
    },
    [addStop],
  );

  const planTo = (p: Poi) => {
    onPoiAction(p, "destination");
    setView("planner");
  };

  const fly = (lon: number, lat: number, zoom?: number) => setFlyTarget({ lon, lat, zoom, key: Date.now() });

  const sig = JSON.stringify({ stops, maxSlope, routeName, notes });
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
    setSavedSig(sig);
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
    if (isNarrow) setLeft(null);
    setSavedSig(JSON.stringify({ stops: r.stops, maxSlope: r.maxSlopeDeg, routeName: r.name, notes: r.notes }));
    setPlanRequest((n) => n + 1);
    const d = r.stops.find((s) => s.role === "destination") ?? r.stops[0];
    if (d) fly(d.lon, d.lat, 13.5);
  };

  const hasStart = stops.some((s) => s.role === "start");
  const hasDest = stops.some((s) => s.role === "destination");
  const step: PlanStep = !hasStart ? 1 : !hasDest ? 2 : !route ? 3 : sig === savedSig ? 5 : 4;
  const guideStep: GuideStep = view === "planner" ? (step >= 3 ? 3 : 2) : 1;

  // ---------------- Search ----------------
  const searchResults = useMemo(() => {
    if (!data || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    return data.pois.filter((p) => p.name.toLowerCase().includes(q) || p.campaign?.toLowerCase().includes(q) || p.type?.toLowerCase().includes(q)).slice(0, 7);
  }, [data, query]);
  const coordHit = parseLatLon(query);
  const options = [...(coordHit ? [{ kind: "coord" as const }] : []), ...searchResults.map((p) => ({ kind: "poi" as const, p }))];

  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === "coord" && coordHit) fly(coordHit[0], coordHit[1], 15);
    if (o.kind === "poi") {
      fly(o.p.lon, o.p.lat, 15.5);
      setQuery(o.p.name);
    }
    setSearchOpen(false);
  };
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSearchOpen(true);
      setActiveIdx((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") choose(activeIdx);
    else if (e.key === "Escape") setSearchOpen(false);
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
  const latestWx = [...weather].reverse().find((s) => s.min_temp_c !== null);
  const coord = cursor ?? [(manifest.aoi.lon_min + manifest.aoi.lon_max) / 2, (manifest.aoi.lat_min + manifest.aoi.lat_max) / 2];

  const hint =
    view === "explore"
      ? "Click anywhere to inspect the ground · hover a marker to see what it is"
      : step === 1
        ? "Press + Start, then click the map, or click a marker and choose Set as start"
        : step === 2
          ? "Click a rock sample marker and choose Set destination"
          : step === 3
            ? busy
              ? "Planning over real terrain…"
              : "Ready: press Plan Route in the planner panel"
            : "Hover the elevation profile to see that point on the route";

  const statusLabel = view === "explore" ? "Exploring" : view === "science" ? "Reviewing data" : route ? "Route ready" : "Planning";
  const showLeft = view !== "science" && left !== null;

  return (
    <div className={`app view-${view} ${showLeft ? "left-open" : "left-closed"} ${guideOpen ? "guide-open" : ""} ${sheetOpen ? "sheet-expanded" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <Mascot pose="standing" size={40} />
          <span className="wordmark">PAWPRINT <em>MARS</em></span>
        </div>
        <span className="vsep" />
        <nav className="nav" aria-label="Main views">
          {(["explore", "planner", "science"] as View[]).map((v) => (
            <Hint key={v} text={VIEW_HELP[v]}>
              <button className={view === v ? "active" : ""} aria-current={view === v ? "page" : undefined} onClick={() => { setView(v); if (v !== "planner") setPlaceMode(null); }}>
                <Icon name={v === "explore" ? "explore" : v === "planner" ? "route" : "bars"} /> {v === "explore" ? "Explore" : v === "planner" ? "Mission Planner" : "Science Data"}
              </button>
            </Hint>
          ))}
        </nav>
        <div className="top-right">
          <Hint text={apiUp ? "The Python route engine is running." : "The Python route engine is not responding. Start analysis/server.py."}>
            <span className="status-pill">
              <i className={apiUp ? "ok" : "bad"} /> <span className="sp-label">Mission Status:</span> <b>{statusLabel}</b>
            </span>
          </Hint>
          <Hint text="Terrain from USGS Astrogeology / NASA Mars 2020 TRN products; rover and sample data from NASA/JPL.">
            <span className="data-pill">NASA · USGS DATA</span>
          </Hint>
          <button
            className="icon-round"
            aria-label="Help and quick guide"
            title="Help"
            onClick={() => {
              if (isMobile) setShowOnboarding(true);
              else {
                setGuideOpen(!guideOpen);
                flag("guideHidden", guideOpen);
              }
            }}
          >
            <Icon name="help" size={19} />
          </button>
          <button className="icon-round avatar" aria-label="Profile (not available in this prototype)" title="Profile (not available in this prototype)" disabled>
            <Icon name="user" size={19} />
          </button>
        </div>
      </header>

      <div className="body">
        <nav className="rail" aria-label="Tools">
          <button className="rail-mobile" aria-current={view === "explore" ? "page" : undefined} onClick={() => { setView("explore"); setLeft(null); setPlaceMode(null); }}>
            <Icon name="explore" size={20} /><span>Explore</span>
          </button>
          <button className={left === "layers" && view !== "science" ? "active" : ""} onClick={() => { if (view === "science") setView("explore"); setLeft(left === "layers" && view !== "science" ? null : "layers"); }}>
            <Icon name="map" size={20} /><span className="rl-desk">Map</span><span className="rl-mob">Layers</span>
          </button>
          <button className={view === "planner" && left !== "layers" && left !== "saved" ? "active" : ""} onClick={() => { setView("planner"); if (isNarrow) setLeft(null); }}>
            <Icon name="route" size={20} /><span>Plan</span>
          </button>
          <button className={view === "science" ? "active" : ""} onClick={() => setView("science")}><Icon name="bars" size={20} /><span>Data</span></button>
          <button className={left === "saved" && view !== "science" ? "active" : ""} onClick={() => { if (view === "science") setView("planner"); setLeft(left === "saved" && view !== "science" ? null : "saved"); }}>
            <Icon name="files" size={20} /><span>Files</span>{saved.length > 0 && <em className="count">{saved.length}</em>}
          </button>
        </nav>

        {view === "science" ? (
          <main className="science-main">
            <ScienceView manifest={manifest} pois={pois} weather={weather} />
          </main>
        ) : (
          <>
            {showLeft && isNarrow && <div className="drawer-backdrop" onClick={() => setLeft(null)} aria-hidden="true" />}
            {left === "layers" && (
              <LayersPanel
                manifest={manifest}
                layers={layers}
                setLayer={(k, v) => setLayers((l) => ({ ...l, [k]: v }))}
                opacity={opacity}
                setOpacity={setOpacity}
                onCollapse={() => setLeft(null)}
                view={view}
              />
            )}
            {left === "saved" && <SavedRoutes routes={saved} onLoad={loadSaved} onDelete={(id) => setSaved(deleteRoute(id))} onClose={() => setLeft(null)} />}

            <main className="center">
              <div className="center-bar">
                <label className="select">
                  <span className="sr-only">Region</span>
                  <select aria-label="Region" defaultValue="jezero">
                    <option value="jezero">Jezero Crater</option>
                    <option disabled>Gale Crater (coming soon)</option>
                  </select>
                </label>
                <div className="search" role="combobox" aria-expanded={searchOpen && !!query} aria-haspopup="listbox">
                  <Icon name="search" size={17} />
                  <input
                    placeholder="Search a sample, campaign, or 18.45, 77.42"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); setActiveIdx(0); }}
                    onFocus={() => setSearchOpen(true)}
                    onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                    onKeyDown={onSearchKey}
                    aria-label="Search samples, campaigns or coordinates"
                    aria-autocomplete="list"
                  />
                  {query && (
                    <button className="icon-btn clear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => { setQuery(""); setActiveIdx(0); }}>
                      <Icon name="close" size={14} />
                    </button>
                  )}
                  {searchOpen && query && (
                    <ul className="search-results" role="listbox">
                      {options.map((o, i) => (
                        <li
                          key={o.kind === "coord" ? "coord" : o.p.id}
                          role="option"
                          aria-selected={i === activeIdx}
                          className={i === activeIdx ? "active" : ""}
                          onMouseEnter={() => setActiveIdx(i)}
                          onMouseDown={() => choose(i)}
                        >
                          {o.kind === "coord" ? (
                            <><Icon name="target" size={15} /> Go to {formatLat(coordHit![1], 3)}, {formatLon(coordHit![0], 3)}</>
                          ) : (
                            <>
                              <Icon name={o.p.category === "landing" ? "flag" : "crystal"} size={15} />
                              <span className="sr-name">{o.p.name}</span>
                              <span className="sr-meta">{o.p.category === "landing" ? "Landing site" : `${o.p.type} · ${o.p.campaign}`}</span>
                            </>
                          )}
                        </li>
                      ))}
                      {options.length === 0 && <li className="none">No match. Try a sample name like "Bearwallow", a campaign like "Delta", or "18.45, 77.42".</li>}
                    </ul>
                  )}
                </div>
                <Hint text="Coordinates under your cursor: planetocentric latitude, east-positive longitude.">
                  <div className="coord">
                    <Icon name="target" size={16} /> {formatLat(coord[1], 3)}, {formatLon(coord[0], 3)}
                  </div>
                </Hint>
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
                  onPlanTo={planTo}
                  planning={view === "planner"}
                  hint={hint}
                />
                {layers.weather && latestWx && (
                  <div className="wx-chip">
                    <Icon name="cloud" size={15} />
                    <span><Term k="sol">Sol</Term> {latestWx.sol} · {latestWx.min_temp_c}° / {latestWx.max_temp_c}° C · {latestWx.pressure_pa} Pa</span>
                    <KindBadge kind="archived" />
                  </div>
                )}
                {view === "planner" && busy && (
                  <div className="computing" role="status">
                    <Mascot pose="floating" size={60} className="bob" />
                    <span>Sniffing out the safest path…</span>
                  </div>
                )}
              </div>
            </main>

            {view === "planner" ? (
              <PlannerPanel
                name={routeName}
                setName={setRouteName}
                stops={stops}
                pois={pois}
                removeStop={(id) => setStops((s) => s.filter((x) => x.id !== id))}
                placeMode={placeMode}
                setPlaceMode={(m) => { setPlaceMode(m); if (m && isMobile) setSheetOpen(false); }}
                maxSlope={maxSlope}
                setMaxSlope={setMaxSlope}
                route={route}
                routeError={routeError}
                busy={busy}
                apiUp={apiUp}
                notes={notes}
                setNotes={setNotes}
                onPlan={() => void analyze()}
                onSave={save}
                onHover={setHoverIndex}
                onFly={(lon, lat) => fly(lon, lat, 15)}
                savedFlash={savedFlash}
                step={step}
                sheetOpen={sheetOpen}
                toggleSheet={() => setSheetOpen(!sheetOpen)}
              />
            ) : (
              <ExplorePanel
                probe={probe}
                probeBusy={probeBusy}
                weather={weather}
                weatherOn={layers.weather}
                pois={pois}
                onFly={(p) => fly(p.lon, p.lat, 15.5)}
                onPlan={planTo}
                sheetOpen={sheetOpen}
                toggleSheet={() => setSheetOpen(!sheetOpen)}
              />
            )}
          </>
        )}
      </div>

      {guideOpen && (
        <QuickGuide
          current={guideStep}
          onStep={(s) => setView(s === 1 ? "explore" : "planner")}
          onClose={() => {
            setGuideOpen(false);
            flag("guideHidden", true);
          }}
        />
      )}

      {showOnboarding && <Onboarding onDone={() => { flag("onboarded", true); setShowOnboarding(false); }} />}
    </div>
  );
}
