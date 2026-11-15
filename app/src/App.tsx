import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExplorePanel } from "./components/ExplorePanel";
import { LayersPanel } from "./components/LayersPanel";
import { MapView, type LayerKey, type PlaceMode } from "./components/MapView";
import { Onboarding } from "./components/Onboarding";
import { PlannerPanel, type PlanStep, type PlannerTab } from "./components/PlannerPanel";
import { TEAM_COLORS, TEAM_SLOTS } from "./components/planner/TeamPlanner";
import { QuickGuide, type GuideStep } from "./components/QuickGuide";
import { SavedRoutes } from "./components/SavedRoutes";
import { ScienceView } from "./components/ScienceView";
import { ExpeditionLog, expeditionStatus } from "./components/ExpeditionLog";
import { PlanHero } from "./components/planner/PlanHero";
import { RouteBar } from "./components/planner/RouteBar";
import { loadExpedition, saveExpedition, soloSnapshot, teamSnapshot, type Expedition } from "./lib/expedition";
import { Hint, Icon, KindBadge, Mascot, Term } from "./components/ui";
import { apiHealth, compareRoutes, loadStatic, planRoute, probeTerrain, type TerrainProbe } from "./lib/api";
import { loadExtras, probeMinerals, type GeologyFile, type MineralProbe, type PhotosFile } from "./lib/nasaExtras";
import { GroundView } from "./components/GroundView";
import { loadWater, zoneStopName, zonePoiId, type WaterBreakdown, type WaterFile, type WaterZone } from "./lib/water";
import { OBJECTIVE_META, OBJECTIVE_ORDER } from "./lib/compare";
import { DEFAULT_EVA, evaPlan as computeEva, teamEvaPlan } from "./lib/eva";
import { noRouteAlert, routeAlerts, sortAlerts, type Alert } from "./lib/safety";
import { routeHazards } from "./lib/routeHazards";
import { teamAlerts, teamSummary } from "./lib/team";
import { formatLat, formatLon, parseLatLon } from "./lib/mars";
import { deleteRoute, flag, loadRoutes, saveRoute } from "./lib/storage";
import type { CompareResult, EvaSettings, LonLat, Manifest, MissionMode, Objective, Poi, RouteResult, SavedRoute, Stop, StopRole, TeamSlot, WeatherSol } from "./types";

type View = "explore" | "planner" | "science" | "log";
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
  log: "Execute, track and document your planned Marswalk",
};

export default function App() {
  const [data, setData] = useState<{ manifest: Manifest; pois: Poi[]; weather: WeatherSol[]; rover: GeoJSON.FeatureCollection } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>("planner");
  const isMobile = useMedia("(max-width: 720px)");
  const isNarrow = useMedia("(max-width: 1180px)");
  // On tablets and phones the layers panel is an overlay drawer, so start with it closed.
  const [left, setLeft] = useState<Left>(() => (typeof window !== "undefined" && window.innerWidth <= 1180 ? null : "layers"));
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    terrain: true, elevation: true, slope: true, geology: true, rover: false, weather: true,
    hirise_img: false, geomap: false, minerals: false, photos: false, water: false,
  });
  const [water, setWater] = useState<WaterFile | null>(null);
  const [waterOpacity, setWaterOpacity] = useState(0.75);
  const [waterZone, setWaterZone] = useState<string | null>(null);
  const [extras, setExtras] = useState<{ photos: PhotosFile | null; geology: GeologyFile | null }>({ photos: null, geology: null });
  const [mineralOpacity, setMineralOpacity] = useState(0.85);
  const [roverMaxSol, setRoverMaxSol] = useState<number | null>(null);
  const [groundView, setGroundView] = useState<{ poiId: string | null } | null>(null);
  const [mineralProbe, setMineralProbe] = useState<MineralProbe | null>(null);
  const [opacity, setOpacity] = useState(0.65);
  const [stops, setStops] = useState<Stop[]>([]);
  const [placeMode, setPlaceMode] = useState<PlaceMode>(null);
  const [maxSlope, setMaxSlope] = useState(25);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [objective, setObjective] = useState<Objective>("lower_risk");
  const route: RouteResult | null = compare ? compare.routes[objective] : null;
  const [mode, setMode] = useState<MissionMode>("solo");
  const [plannerTab, setPlannerTab] = useState<PlannerTab>("route");
  /** Safety alert highlighted on the Warnings board (and, via route-hazards, on the map). */
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [missionId, setMissionId] = useState<string | null>(null);
  const [eva, setEva] = useState<EvaSettings>(DEFAULT_EVA);
  const [exporting, setExporting] = useState(false);
  const [teamStops, setTeamStops] = useState<Partial<Record<TeamSlot, Stop>>>({});
  const [teamPlace, setTeamPlace] = useState<TeamSlot | null>(null);
  const [teamRoutes, setTeamRoutes] = useState<{ A?: RouteResult; B?: RouteResult; Aret?: RouteResult; Bret?: RouteResult }>({});
  const [teamErrors, setTeamErrors] = useState<{ A?: string; B?: string }>({});
  const [teamBusy, setTeamBusy] = useState(false);
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
  /** Planner page: location clicked on the map, shown in the map information panel with Set Destination / Set Start /
   *  Add Waypoint. No re-key (it used to carry key: Date.now(), which re-mounted an auto-panning Leaflet popup on every click). */
  const [pick, setPick] = useState<{ lon: number; lat: number } | null>(null);
  const [layersCollapsed, setLayersCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth <= 720);
  // Expedition Log: persisted on this device (localStorage; photo pixels in IndexedDB).
  const [expedition, setExpedition] = useState<Expedition | null>(() => loadExpedition());
  useEffect(() => {
    saveExpedition(expedition);
  }, [expedition]);

  useEffect(() => {
    void loadExtras().then(setExtras);
    void loadWater().then(setWater);
  }, []);

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
      const c = await compareRoutes(pts, maxSlope);
      if (seq === reqSeq.current) setCompare(c);
      setApiUp(true);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setCompare(null);
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
    setCompare(null);
    setRouteError(null);
    setBusy(false);
  }, [stops, maxSlope]);

  // ---------------- Two-astronaut mode ----------------
  const teamSeq = useRef(0);
  useEffect(() => {
    teamSeq.current++;
    setTeamRoutes({});
    setTeamErrors({});
    setTeamBusy(false);
  }, [teamStops, maxSlope, objective]);
  const teamReady = TEAM_SLOTS.every((t) => teamStops[t.slot]);
  const planTeam = async () => {
    const t = teamStops;
    if (!t.aStart || !t.aDest || !t.bStart || !t.bDest || !t.meet) return;
    const seq = ++teamSeq.current;
    setTeamBusy(true);
    setTeamErrors({});
    const pts = (a: Stop, b: Stop, c: Stop): LonLat[] => [a, b, c].map((x) => [x.lon, x.lat]);
    // Outbound legs (start -> destination -> rendezvous) and each astronaut's walk back to their own start.
    const [ra, rb, raRet, rbRet] = await Promise.allSettled([
      planRoute(pts(t.aStart, t.aDest, t.meet), maxSlope, objective),
      planRoute(pts(t.bStart, t.bDest, t.meet), maxSlope, objective),
      planRoute([t.meet, t.aStart].map((x) => [x.lon, x.lat] as LonLat), maxSlope, objective),
      planRoute([t.meet, t.bStart].map((x) => [x.lon, x.lat] as LonLat), maxSlope, objective),
    ]);
    if (seq !== teamSeq.current) return;
    const msg = (r: PromiseSettledResult<RouteResult>) => (r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : undefined);
    if ([msg(ra), msg(rb)].some((m) => m && (m.includes("Failed to fetch") || m.includes("HTTP 50")))) setApiUp(false);
    else setApiUp(true);
    const ok = (r: PromiseSettledResult<RouteResult>) => (r.status === "fulfilled" ? r.value : undefined);
    setTeamRoutes({ A: ok(ra), B: ok(rb), Aret: ok(raRet), Bret: ok(rbRet) });
    setTeamErrors({ A: msg(ra), B: msg(rb) });
    setTeamBusy(false);
  };
  const setTeamStop = (slot: TeamSlot, lon: number, lat: number, name?: string, poiId?: string) => {
    const label = TEAM_SLOTS.find((t) => t.slot === slot)!.label;
    setTeamStops((prev) => ({ ...prev, [slot]: { id: newId(), role: slot === "aStart" || slot === "bStart" ? "start" : "destination", lon, lat, poiId, name: name ?? label } }));
  };

  useEffect(() => setPick(null), [view, mode]);

  // Programmatic re-plan (used after loading a saved route).
  useEffect(() => {
    if (planRequest) void analyzeRef.current();
  }, [planRequest]);

  useEffect(() => {
    if (compare && isMobile) setSheetOpen(true);
  }, [compare, isMobile]);

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
      if (view === "planner" && mode === "team" && teamPlace) {
        setTeamStop(teamPlace, lon, lat);
        setTeamPlace(null);
        return;
      }
      if (placeMode) {
        addStop(placeMode, lon, lat);
        setPlaceMode(null);
        return;
      }
      if (view === "planner") {
        const a = data?.manifest.aoi;
        if (a && lon >= a.lon_min && lon <= a.lon_max && lat >= a.lat_min && lat <= a.lat_max) setPick({ lon, lat });
        else setPick(null);
        return;
      }
      if (view === "explore") {
        setProbeBusy(true);
        if (isMobile) setSheetOpen(true);
        void probeMinerals(lon, lat).then(setMineralProbe);
        probeTerrain(lon, lat)
          .then((p) => {
            setProbe(p);
            setApiUp(true);
          })
          .catch(() => setApiUp(false))
          .finally(() => setProbeBusy(false));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placeMode, addStop, view, isMobile, mode, teamPlace, data],
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

  /* Ancient Water Evidence: explore a highlighted region, or make it the destination for the A* planner. */
  const showWaterZone = (z: WaterZone) => {
    setWaterZone(z.id);
    setLayers((l) => ({ ...l, water: true }));
    fly(z.target[0], z.target[1], 15);
  };
  /** `flyThere` is for the layers list; from the map itself the region is already on screen, so the map stays put. */
  const setWaterDestination = (z: WaterZone, flyThere = true) => {
    setWaterZone(z.id);
    setLayers((l) => ({ ...l, water: true }));
    if (mode === "team") setTeamStop("aDest", z.target[0], z.target[1], zoneStopName(z), zonePoiId(z));
    else addStop("destination", z.target[0], z.target[1], zoneStopName(z), zonePoiId(z));
    setPick(null);
    if (view !== "planner") setView("planner");
    if (flyThere) fly(z.target[0], z.target[1], 15);
  };

  /** A clicked heatmap spot (not a highlighted region) as destination; the map does not move. */
  const setWaterPointDestination = (lon: number, lat: number, b: WaterBreakdown) => {
    const name = `Water evidence spot (index ${b.index})`;
    if (mode === "team") setTeamStop("aDest", lon, lat, name);
    else addStop("destination", lon, lat, name);
    setPick(null);
    if (view !== "planner") setView("planner");
  };

  /* Other overlays that share the water layer's violet/turquoise family: hide them on request, restore later. */
  const COLOUR_LAYERS: [LayerKey, string][] = [["elevation", "Elevation colours"], ["geomap", "Geologic units"], ["minerals", "Mineral indicators"], ["slope", "Steep ground"]];
  const otherColourLayers = layers.water ? COLOUR_LAYERS.filter(([k]) => layers[k]).map(([, l]) => l) : [];
  const [hiddenForWater, setHiddenForWater] = useState<LayerKey[] | null>(null);
  const waterOnly = () => {
    const on = COLOUR_LAYERS.map(([k]) => k).filter((k) => layers[k]);
    setHiddenForWater(on);
    setLayers((l) => ({ ...l, ...Object.fromEntries(on.map((k) => [k, false])) }));
  };
  const restoreColourLayers = () => {
    const back = hiddenForWater ?? [];
    setHiddenForWater(null);
    setLayers((l) => ({ ...l, ...Object.fromEntries(back.map((k) => [k, true])) }));
  };

  const sig = JSON.stringify({ stops, maxSlope, routeName, notes, objective, missionId, eva });
  const save = () => {
    const r: SavedRoute = {
      id: routeId,
      name: routeName,
      savedAt: new Date().toISOString(),
      stops,
      maxSlopeDeg: maxSlope,
      notes,
      summary: route ? { distance_m: route.distance_m, elevation_gain_m: route.elevation_gain_m, max_slope_deg: route.max_slope_deg, grid: route.grid.name } : undefined,
      objective,
      scienceMission: missionId,
      eva,
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
    const obj = r.objective ?? "lower_risk";
    const ms = r.scienceMission ?? null;
    const ev = r.eva ?? DEFAULT_EVA;
    setObjective(obj);
    setMissionId(ms);
    setEva(ev);
    setMode("solo");
    setView("planner");
    if (isNarrow) setLeft(null);
    setSavedSig(JSON.stringify({ stops: r.stops, maxSlope: r.maxSlopeDeg, routeName: r.name, notes: r.notes, objective: obj, missionId: ms, eva: ev }));
    setPlanRequest((n) => n + 1);
    const d = r.stops.find((s) => s.role === "destination") ?? r.stops[0];
    if (d) fly(d.lon, d.lat, 13.5);
  };

  const hasStart = stops.some((s) => s.role === "start");
  const hasDest = stops.some((s) => s.role === "destination");
  const step: PlanStep = !hasStart ? 1 : !hasDest ? 2 : !route ? 3 : sig === savedSig ? 5 : 4;
  const guideStep: GuideStep = view === "planner" ? (step >= 3 ? 3 : 2) : 1;

  // ---------------- EVA, team summary and safety alerts ----------------
  const evaP = useMemo(() => (route ? computeEva(route, Math.max(0, stops.length - 1), eva) : null), [route, stops.length, eva]);
  const teamSum = useMemo(
    () => (teamRoutes.A && teamRoutes.B ? teamSummary(teamRoutes.A, teamRoutes.B, eva.scienceMinPerStop, eva.paceFactor) : null),
    [teamRoutes, eva.scienceMinPerStop, eva.paceFactor],
  );
  const teamEva = useMemo(
    () =>
      teamSum
        ? teamEvaPlan(
            { arriveMeetMinA: teamSum.a.arriveMeetMin, arriveMeetMinB: teamSum.b.arriveMeetMin, meetMin: teamSum.meetMin, scienceMin: eva.scienceMinPerStop },
            teamRoutes.Aret ?? null,
            teamRoutes.Bret ?? null,
            eva,
          )
        : null,
    [teamSum, teamRoutes, eva],
  );
  const weatherSols = useMemo(() => data?.weather ?? [], [data]);
  const alerts: Alert[] = useMemo(() => {
    if (mode === "solo") {
      if (routeError) return [noRouteAlert(routeError, maxSlope)];
      if (!route) return [];
      return sortAlerts([...routeAlerts(route, maxSlope, weatherSols), ...(evaP?.alerts ?? [])]);
    }
    const out: Alert[] = [];
    (["A", "B"] as const).forEach((w, i) => {
      const r = teamRoutes[w];
      if (!r) return;
      routeAlerts(r, maxSlope, weatherSols).forEach((a) => {
        if ((a.id === "weather" || a.id === "resolution") && i > 0 && teamRoutes.A) return;
        out.push(a.id === "weather" || a.id === "resolution" ? a : { ...a, id: `${w}-${a.id}`, title: `Astronaut ${w}: ${a.title}` });
      });
    });
    return sortAlerts([...teamAlerts(teamErrors.A ?? null, teamErrors.B ?? null, teamSum, maxSlope), ...out, ...(teamEva?.alerts ?? [])]);
  }, [mode, routeError, route, maxSlope, weatherSols, evaP, teamRoutes, teamErrors, teamSum, teamEva]);

  // Location-specific hazards for the map: computed only from each route's own profile (lib/routeHazards).
  const hazards = useMemo(() => {
    if (view !== "planner") return [];
    if (mode === "solo") return route ? routeHazards(route, { routeKey: objective, maxSlopeLimit: maxSlope }) : [];
    return (["A", "B"] as const).flatMap((w) => (teamRoutes[w] ? routeHazards(teamRoutes[w]!, { routeKey: w, astronaut: w, maxSlopeLimit: maxSlope }) : []));
  }, [view, mode, route, objective, teamRoutes, maxSlope]);
  // The board offers "Show on map" for every warning that has a hazard marker (same alerts, plus the marker's exact route point).
  const boardAlerts = useMemo(
    () =>
      alerts.map((a) => {
        if (a.at) return a;
        const h = hazards.find((x) => x.alertId === a.id || x.alsoAlertIds.includes(a.id));
        return h ? { ...a, at: h.at } : a;
      }),
    [alerts, hazards],
  );
  const [hazardLocate, setHazardLocate] = useState(0);

  // The route planned right now, frozen into the shape the Expedition Log stores.
  const logCandidate = useMemo(() => {
    if (mode === "solo") {
      if (!route) return null;
      return soloSnapshot({ routeId, name: routeName, route, stops, missionId, eva, evaPlan: evaP, alerts, color: OBJECTIVE_META[objective].color });
    }
    const t = teamStops;
    if (!teamRoutes.A || !teamRoutes.B || !teamSum || !t.aStart || !t.aDest || !t.bStart || !t.bDest || !t.meet) return null;
    return teamSnapshot({
      routeId,
      name: routeName,
      routes: { A: teamRoutes.A, B: teamRoutes.B, Aret: teamRoutes.Aret, Bret: teamRoutes.Bret },
      stops: { aStart: t.aStart, aDest: t.aDest, bStart: t.bStart, bDest: t.bDest, meet: t.meet },
      summary: teamSum,
      teamEva,
      missionId,
      eva,
      alerts,
      colors: { A: TEAM_COLORS.A, B: TEAM_COLORS.B },
    });
  }, [mode, route, routeId, routeName, stops, missionId, eva, evaP, alerts, objective, teamStops, teamRoutes, teamSum, teamEva]);
  const liveAlertIds = useMemo(() => new Set(alerts.map((a) => a.id)), [alerts]);
  const logAvailable = !!logCandidate || !!expedition;

  const runExport = async () => {
    if (!data) return;
    setExporting(true);
    try {
      // jsPDF is large: load the report module only when a report is requested.
      const { exportMissionReport } = await import("./lib/report");
      await exportMissionReport({
        name: routeName,
        notes,
        mode,
        objective,
        compare,
        route,
        stops,
        missionId,
        alerts,
        eva,
        evaPlan: evaP,
        team: mode === "team" ? { stops: teamStops, routes: teamRoutes, summary: teamSum, errors: teamErrors, eva: teamEva } : null,
        manifest: data.manifest,
        weather: data.weather,
        pois: data.pois,
        maxSlope,
      });
    } catch (e) {
      window.alert(`Could not create the report: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

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

  const teamLabel = teamPlace ? TEAM_SLOTS.find((t) => t.slot === teamPlace)!.label : null;
  const hint =
    view === "explore"
      ? "Click anywhere to inspect the ground · hover a marker to see what it is"
      : mode === "team"
        ? teamLabel
          ? `Click the map to place ${teamLabel}, or open a sample marker`
          : teamReady
            ? teamSum
              ? "Turquoise = Astronaut A · lavender = Astronaut B · rose pin = rendezvous"
              : "All points set: press Generate Both Routes below the map"
            : "Click the map to place both starts, both destinations and the rendezvous"
      : step === 1
        ? "Click anywhere on the map (or a sample marker) and choose Set Start"
        : step === 2
          ? "Click a spot or a rock sample and choose Set Destination"
          : step === 3
            ? busy
              ? "Planning over real terrain…"
              : "Ready: press Generate Route below the map"
            : `${OBJECTIVE_META[objective].label} route shown solid; the other options are dashed · warning markers show where hazards are`;

  const statusLabel =
    view === "log"
      ? expeditionStatus(expedition) ?? (logCandidate ? "Ready to start" : "No route yet")
      : view === "explore"
        ? "Exploring"
        : view === "science"
          ? "Reviewing data"
          : route || (mode === "team" && teamSum)
            ? "Route ready"
            : "Planning";
  const fullPage = view === "science" || view === "log";
  const showLeft = !fullPage && left !== null;

  return (
    <div className={`app view-${view} ${showLeft ? "left-open" : "left-closed"} ${guideOpen ? "guide-open" : ""} ${sheetOpen && view !== "planner" ? "sheet-expanded" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <Mascot pose="standing" size={40} />
          <span className="wordmark">PAWPRINT <em>MARS</em></span>
        </div>
        <span className="vsep" />
        <nav className="nav" aria-label="Main views">
          {(["explore", "planner", "science", "log"] as View[]).map((v) => (
            <Hint key={v} text={v === "log" && !logAvailable ? "Plan a route first: the Expedition Log tracks a planned Marswalk." : VIEW_HELP[v]}>
              <button
                className={view === v ? "active" : ""}
                aria-current={view === v ? "page" : undefined}
                data-locked={v === "log" && !logAvailable ? "" : undefined}
                onClick={() => { setView(v); if (v !== "planner") setPlaceMode(null); }}
              >
                <Icon name={v === "explore" ? "explore" : v === "planner" ? "route" : v === "science" ? "bars" : "log"} /> {v === "explore" ? "Explore" : v === "planner" ? "Mission Planner" : v === "science" ? "Science Data" : "Expedition Log"}
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
          <button
            className={view === "planner" ? (!layersCollapsed ? "active" : "") : left === "layers" && !fullPage ? "active" : ""}
            onClick={() => {
              if (view === "planner") return setLayersCollapsed((c) => !c);
              if (fullPage) setView("explore");
              setLeft(left === "layers" && !fullPage ? null : "layers");
            }}
          >
            <Icon name="map" size={20} /><span className="rl-desk">Map</span><span className="rl-mob">Layers</span>
          </button>
          <button className={view === "planner" && left !== "saved" ? "active" : ""} onClick={() => { setView("planner"); if (isNarrow || view === "planner") setLeft(null); }}>
            <Icon name="route" size={20} /><span>Plan</span>
          </button>
          <button className={view === "science" ? "active" : ""} onClick={() => setView("science")}><Icon name="bars" size={20} /><span>Data</span></button>
          <button className={left === "saved" && !fullPage ? "active" : ""} onClick={() => { if (fullPage) setView("planner"); setLeft(left === "saved" && !fullPage ? null : "saved"); }}>
            <Icon name="files" size={20} /><span>Files</span>{saved.length > 0 && <em className="count">{saved.length}</em>}
          </button>
          <button className={view === "log" ? "active" : ""} aria-current={view === "log" ? "page" : undefined} onClick={() => { setView("log"); setPlaceMode(null); }} title={logAvailable ? "Expedition Log" : "Plan a route first"}>
            <Icon name="log" size={20} /><span>Log</span>{expedition && expedition.timer.status !== "idle" && expedition.timer.status !== "finished" && <em className="count live" aria-label="Expedition in progress" />}
          </button>
        </nav>

        {view === "science" ? (
          <main className="science-main">
            <ScienceView manifest={manifest} pois={pois} weather={weather} photos={extras.photos} geology={extras.geology} water={water} onOpenGroundView={(id) => setGroundView({ poiId: id })} />
          </main>
        ) : view === "log" ? (
          <main className="science-main xlog-main">
            <ExpeditionLog
              expedition={expedition}
              setExpedition={setExpedition}
              candidate={logCandidate}
              manifest={manifest}
              liveAlertIds={liveAlertIds}
              onOpenPlanner={(tab) => {
                setView("planner");
                if (tab) setPlannerTab(tab);
                if (isMobile) setSheetOpen(true);
              }}
              onOpenAlert={(id) => {
                setView("planner");
                setPlannerTab("safety");
                setSelectedAlertId(id);
                if (isMobile) setSheetOpen(true);
              }}
            />
          </main>
        ) : (
          <div className={view === "planner" ? "planner-page" : "view-contents"}>
            {view === "planner" && (
              <PlanHero
                missionId={missionId}
                setMissionId={setMissionId}
                pois={pois}
                from={mode === "solo" ? (stops.find((x) => x.role === "start") ?? null) : (teamStops.aStart ?? null)}
                mode={mode}
                inItinerary={new Set(stops.map((x) => x.poiId).filter(Boolean) as string[])}
                onSetDestination={(p) => { onPoiAction(p, "destination"); fly(p.lon, p.lat, 14.5); }}
                onAddWaypoint={(p) => { onPoiAction(p, "waypoint"); fly(p.lon, p.lat, 14.5); }}
                onTeamSlot={(p, slot) => setTeamStop(slot, p.lon, p.lat, p.name, p.id)}
                onShow={(p) => fly(p.lon, p.lat, 15.5)}
              />
            )}
            {view !== "planner" && showLeft && isNarrow && <div className="drawer-backdrop" onClick={() => setLeft(null)} aria-hidden="true" />}
            {(view === "planner" || left === "layers") && (
              <LayersPanel
                docked={view === "planner"}
                collapsed={view === "planner" && layersCollapsed}
                manifest={manifest}
                layers={layers}
                setLayer={(k, v) => setLayers((l) => ({ ...l, [k]: v }))}
                opacity={opacity}
                setOpacity={setOpacity}
                geology={extras.geology}
                photos={extras.photos}
                mineralOpacity={mineralOpacity}
                setMineralOpacity={setMineralOpacity}
                water={water}
                waterOpacity={waterOpacity}
                setWaterOpacity={setWaterOpacity}
                waterZone={waterZone}
                onShowWaterZone={showWaterZone}
                onWaterDestination={(z) => setWaterDestination(z)}
                roverMaxSol={roverMaxSol}
                setRoverMaxSol={setRoverMaxSol}
                onOpenGroundView={() => setGroundView({ poiId: null })}
                onCollapse={() => (view === "planner" ? setLayersCollapsed((c) => !c) : setLeft(null))}
                view={view === "planner" ? "planner" : "explore"}
              />
            )}
            {left === "saved" &&
              (view === "planner" ? (
                <>
                  <div className="drawer-backdrop pp-backdrop" onClick={() => setLeft(null)} aria-hidden="true" />
                  <div className="pp-drawer">
                    <SavedRoutes routes={saved} onLoad={loadSaved} onDelete={(id) => setSaved(deleteRoute(id))} onClose={() => setLeft(null)} />
                  </div>
                </>
              ) : (
                <SavedRoutes routes={saved} onLoad={loadSaved} onDelete={(id) => setSaved(deleteRoute(id))} onClose={() => setLeft(null)} />
              ))}

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
                  stops={view === "planner" && mode === "solo" ? stops : []}
                  route={view === "planner" && mode === "solo" ? route : null}
                  routeColor={OBJECTIVE_META[objective].color}
                  altRoutes={
                    view === "planner" && mode === "solo" && compare
                      ? OBJECTIVE_ORDER.filter((o) => o !== objective).map((o) => ({ key: o, label: OBJECTIVE_META[o].label, route: compare.routes[o], color: OBJECTIVE_META[o].color, dash: OBJECTIVE_META[o].dash }))
                      : []
                  }
                  routeKey={objective}
                  routeLabel={OBJECTIVE_META[objective].label}
                  hazards={hazards}
                  selectedAlertId={selectedAlertId}
                  onSelectAlert={setSelectedAlertId}
                  hazardLocateKey={hazardLocate}
                  teamMode={mode === "team"}
                  onTeamSlot={(p, slot) => setTeamStop(slot, p.lon, p.lat, p.name, p.id)}
                  teamRoutes={
                    view === "planner" && mode === "team"
                      ? (["A", "B"] as const).flatMap((w) => [
                          ...(teamRoutes[w] ? [{ key: w, label: `Astronaut ${w} route`, route: teamRoutes[w]!, color: TEAM_COLORS[w] }] : []),
                          ...(teamRoutes[`${w}ret`] ? [{ key: `${w}ret`, label: `Astronaut ${w} walk back to start`, route: teamRoutes[`${w}ret`]!, color: TEAM_COLORS[w], dash: "4 7" }] : []),
                        ])
                      : []
                  }
                  teamPins={
                    view === "planner" && mode === "team"
                      ? TEAM_SLOTS.flatMap((t) => {
                          const st = teamStops[t.slot];
                          return st ? [{ key: t.slot, at: [st.lon, st.lat] as LonLat, label: t.who === "meet" ? "Rendezvous" : `${t.label}`, who: t.who }] : [];
                        })
                      : []
                  }
                  hoverIndex={hoverIndex}
                  placeMode={view === "planner" ? (mode === "team" ? (teamPlace ? "waypoint" : null) : placeMode) : null}
                  placeLabel={mode === "team" && teamLabel ? teamLabel : undefined}
                  flyTarget={flyTarget}
                  onMapClick={onMapClick}
                  onCursor={setCursor}
                  onPoiAction={onPoiAction}
                  onPlanTo={planTo}
                  planning={view === "planner"}
                  hint={hint}
                  geology={extras.geology}
                  photos={extras.photos}
                  mineralOpacity={mineralOpacity}
                  water={water}
                  waterOpacity={waterOpacity}
                  waterZone={waterZone}
                  onWaterDestination={(z) => setWaterDestination(z, false)}
                  onWaterPointDestination={setWaterPointDestination}
                  otherColourLayers={otherColourLayers}
                  onWaterOnly={waterOnly}
                  onRestoreColourLayers={hiddenForWater?.length ? restoreColourLayers : undefined}
                  onRemoveStop={(id) => setStops((s) => s.filter((x) => x.id !== id))}
                  roverMaxSol={roverMaxSol ?? undefined}
                  onOpenGroundView={(id) => setGroundView({ poiId: id })}
                  pick={view === "planner" ? pick : null}
                  onPickClose={() => setPick(null)}
                  onPickRole={(role, lon, lat) => {
                    addStop(role, lon, lat, role === "start" ? "Start point" : undefined);
                    setPick(null);
                  }}
                  onPickSlot={(slot, lon, lat) => {
                    setTeamStop(slot, lon, lat);
                    setPick(null);
                  }}
                  weather={
                    layers.weather && latestWx ? (
                      <>
                        <Icon name="cloud" size={15} />
                        <span><Term k="sol">Sol</Term> {latestWx.sol} · {latestWx.min_temp_c}° / {latestWx.max_temp_c}° C · {latestWx.pressure_pa} Pa</span>
                        <KindBadge kind="archived" />
                      </>
                    ) : null
                  }
                />
                {view === "planner" && busy && (
                  <div className="computing" role="status">
                    <Mascot pose="floating" size={60} className="bob" />
                    <span>Sniffing out the safest path…</span>
                  </div>
                )}
              </div>
            </main>

            {view === "planner" && (
              <RouteBar
                mode={mode}
                setMode={(m) => { setMode(m); setPlaceMode(null); setTeamPlace(null); }}
                stops={stops}
                removeStop={(id) => setStops((s) => s.filter((x) => x.id !== id))}
                onFlyStop={(s) => fly(s.lon, s.lat, 15)}
                compare={compare}
                objective={objective}
                setObjective={setObjective}
                pace={eva.paceFactor > 0 ? eva.paceFactor : 1}
                busy={busy}
                apiUp={apiUp}
                onPlan={() => void analyze()}
                routeError={routeError}
                team={{
                  stops: teamStops,
                  clear: (sl) => setTeamStops((prev) => { const n = { ...prev }; delete n[sl]; return n; }),
                  routes: teamRoutes,
                  summary: teamSum,
                  ready: teamReady,
                  busy: teamBusy,
                  onPlan: () => void planTeam(),
                }}
                canStart={!!logCandidate}
                onStartExpedition={() => setView("log")}
              />
            )}
            {view === "planner" ? (
              <PlannerPanel
                docked
                mode={mode}
                setMode={(m) => { setMode(m); setPlaceMode(null); setTeamPlace(null); }}
                compare={compare}
                objective={objective}
                setObjective={setObjective}
                onExport={() => void runExport()}
                exporting={exporting}
                tab={plannerTab}
                setTab={setPlannerTab}
                alerts={boardAlerts}
                onLocateAlert={(a) => {
                  if (hazards.some((h) => h.alertId === a.id || h.alsoAlertIds.includes(a.id))) {
                    setSelectedAlertId(a.id);
                    setHazardLocate((k) => k + 1);
                  } else if (a.at) fly(a.at[0], a.at[1], 16);
                }}
                selectedAlertId={selectedAlertId}
                onSelectAlert={setSelectedAlertId}
                weather={weather}
                missionId={missionId}
                setMissionId={setMissionId}
                onAddScience={(p, role) => { onPoiAction(p, role); fly(p.lon, p.lat); }}
                eva={eva}
                setEva={setEva}
                evaPlan={evaP}
                teamEva={teamEva}
                team={{
                  stops: teamStops,
                  place: teamPlace,
                  setPlace: (sl) => { setTeamPlace(sl); if (sl && isMobile) setSheetOpen(false); },
                  clear: (sl) => setTeamStops((prev) => { const n = { ...prev }; delete n[sl]; return n; }),
                  routes: teamRoutes,
                  errors: teamErrors,
                  summary: teamSum,
                  busy: teamBusy,
                  ready: teamReady,
                  onPlan: () => void planTeam(),
                }}
                name={routeName}
                setName={setRouteName}
                stops={stops}
                pois={pois}
                geology={extras.geology}
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
                geology={extras.geology}
                mineralProbe={mineralProbe}
                water={layers.water ? water : null}
                onWaterDestination={(lon, lat) => { addStop("destination", lon, lat, "Water evidence spot"); setView("planner"); }}
                photos={extras.photos}
                onOpenGroundView={(id) => setGroundView({ poiId: id })}
                sheetOpen={sheetOpen}
                toggleSheet={() => setSheetOpen(!sheetOpen)}
              />
            )}
          </div>
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

      {groundView && extras.photos && data && (
        <GroundView
          photos={extras.photos}
          pois={data.pois}
          initialPoiId={groundView.poiId}
          onClose={() => setGroundView(null)}
          onFly={(lon, lat) => {
            if (view === "science") setView("explore");
            setLayers((l) => ({ ...l, photos: true }));
            fly(lon, lat, 16);
          }}
        />
      )}

      {showOnboarding && <Onboarding onDone={() => { flag("onboarded", true); setShowOnboarding(false); }} />}
    </div>
  );
}
