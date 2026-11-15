import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { unitAt, type GeologyFile } from "../lib/nasaExtras";
import { OBJECTIVE_META } from "../lib/compare";
import { fmtMin, type EvaPlan, type TeamEva } from "../lib/eva";
import { formatDistance, formatDuration, formatLat, formatLon } from "../lib/mars";
import { countSteepSegments, profileSlopes, riskLevel, samplesNearRoute } from "../lib/routeAnalysis";
import type { Alert } from "../lib/safety";
import type { TeamSummary } from "../lib/team";
import type { CompareResult, EvaSettings, MissionMode, Objective, Poi, RouteResult, Stop, StopRole, TeamSlot, WeatherSol } from "../types";
import { ElevationProfile } from "./ElevationProfile";
import type { PlaceMode } from "./MapView";
import { ComparePanel } from "./planner/ComparePanel";
import { EvaPanel } from "./planner/EvaPanel";
import { ScienceMissions } from "./planner/ScienceMissions";
import { TEAM_STEP_SLOTS, TeamErrors, TeamResults, TeamSlots } from "./planner/TeamPlanner";
import { WarningsBoard } from "./planner/WarningsBoard";
import { DogTip, Hint, Icon, KindBadge, Mascot, Term } from "./ui";

/** Progress derived from the itinerary in App (5 = saved and unchanged). */
export type PlanStep = 1 | 2 | 3 | 4 | 5;

/** The planner's persistent tabs, in guided order. */
export type PlannerTabId = "start" | "destination" | "goal" | "compare" | "safety" | "eva" | "notes" | "save";
/** "route" / "none" are legacy values meaning "pick the tab from the planning progress". */
export type PlannerTab = PlannerTabId | "route" | "none";

export interface TeamProps {
  stops: Partial<Record<TeamSlot, Stop>>;
  place: TeamSlot | null;
  setPlace: (s: TeamSlot | null) => void;
  clear: (s: TeamSlot) => void;
  routes: { A?: RouteResult; B?: RouteResult };
  errors: { A?: string; B?: string };
  summary: TeamSummary | null;
  busy: boolean;
  ready: boolean;
  onPlan: () => void;
}

interface Props {
  mode: MissionMode;
  setMode: (m: MissionMode) => void;
  name: string;
  setName: (s: string) => void;
  stops: Stop[];
  pois: Poi[];
  geology?: GeologyFile | null;
  removeStop: (id: string) => void;
  placeMode: PlaceMode;
  setPlaceMode: (m: PlaceMode) => void;
  maxSlope: number;
  setMaxSlope: (v: number) => void;
  compare: CompareResult | null;
  objective: Objective;
  setObjective: (o: Objective) => void;
  route: RouteResult | null;
  routeError: string | null;
  busy: boolean;
  apiUp: boolean;
  notes: string;
  setNotes: (s: string) => void;
  onPlan: () => void;
  onSave: () => void;
  onExport: () => void;
  exporting: boolean;
  onHover: (i: number | null) => void;
  onFly: (lon: number, lat: number) => void;
  savedFlash: boolean;
  step: PlanStep;
  sheetOpen: boolean;
  toggleSheet: () => void;
  tab: PlannerTab;
  setTab: (t: PlannerTab) => void;
  alerts: Alert[];
  onLocateAlert: (a: Alert) => void;
  /** Alert highlighted/opened on the Warnings board (shared with the map hazard layer). */
  selectedAlertId?: string | null;
  /** Reports a click on a warning card (null = closed). */
  onSelectAlert?: (id: string | null) => void;
  weather: WeatherSol[];
  missionId: string | null;
  setMissionId: (id: string | null) => void;
  onAddScience: (p: Poi, role: StopRole) => void;
  eva: EvaSettings;
  setEva: (s: EvaSettings) => void;
  evaPlan: EvaPlan | null;
  teamEva: TeamEva | null;
  team: TeamProps;
  /** Planner page: shown below the map with only the detail tabs (Compare, Warnings, EVA, Notes, Save). */
  docked?: boolean;
}

const ROLE_LABEL: Record<StopRole, string> = { start: "Start", waypoint: "Waypoint", destination: "Destination" };

const TABS: { id: PlannerTabId; label: string; icon: string }[] = [
  { id: "start", label: "Start", icon: "flag" },
  { id: "destination", label: "Destination", icon: "pin" },
  { id: "goal", label: "Goal", icon: "sparkle" },
  { id: "compare", label: "Compare", icon: "route" },
  { id: "safety", label: "Warnings", icon: "warn" },
  { id: "eva", label: "EVA", icon: "gauge" },
  { id: "notes", label: "Notes", icon: "files" },
  { id: "save", label: "Save", icon: "save" },
];
const TAB_IDS = TABS.map((t) => t.id);
const DOCK_TAB_IDS: PlannerTabId[] = ["compare", "safety", "eva", "notes", "save"];
const tabLabel = (id: PlannerTabId) => TABS.find((t) => t.id === id)!.label;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function PlannerPanel(p: Props) {
  const r = p.route;
  const solo = p.mode === "solo";
  const t = p.team;
  const ordered = useMemo(() => {
    const s = p.stops.filter((x) => x.role === "start");
    const w = p.stops.filter((x) => x.role === "waypoint");
    const d = p.stops.filter((x) => x.role === "destination");
    return [...s, ...w, ...d];
  }, [p.stops]);
  const hasDestSolo = p.stops.some((s) => s.role === "destination");
  const hasStartSolo = p.stops.some((s) => s.role === "start");
  const warnings = p.alerts.filter((a) => a.severity === "warning").length;
  const cautions = p.alerts.filter((a) => a.severity === "caution").length;
  const start = ordered.find((s) => s.role === "start") ?? null;
  const inItinerary = new Set(p.stops.map((s) => s.poiId).filter(Boolean) as string[]);
  const saved = solo && p.step === 5;

  // ---------- Progress (what is set so far) ----------
  const teamStartsSet = TEAM_STEP_SLOTS.start.every((s) => t.stops[s]);
  const teamDestsSet = TEAM_STEP_SLOTS.destination.every((s) => t.stops[s]);
  const startSet = solo ? hasStartSolo : teamStartsSet;
  const destSet = solo ? hasDestSolo : teamDestsSet;
  const ready = solo ? hasStartSolo && hasDestSolo : t.ready;
  const planned = solo ? !!(r && p.compare) : !!t.summary;
  const busy = solo ? p.busy : t.busy;
  const words = p.notes.trim() ? p.notes.trim().split(/\s+/).length : 0;

  // Legacy / unset tab → choose from progress.
  const autoTab: PlannerTabId = !startSet ? "start" : !destSet ? "destination" : "compare";
  const rawTab: PlannerTabId = p.tab === "route" || p.tab === "none" ? autoTab : p.tab;
  // Docked: stops and the science goal live above (map popup, goal cards), so those tabs fold into Compare.
  const tab: PlannerTabId = p.docked && !DOCK_TAB_IDS.includes(rawTab) ? "compare" : rawTab;
  const [collapsed, setCollapsed] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const go = (id: PlannerTabId) => {
    p.setTab(id);
    setDockOpen(true);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  // A freshly planned route opens the Compare tab with the results.
  const wasPlanned = useRef(planned);
  useEffect(() => {
    if (planned && !wasPlanned.current && (tab === "start" || tab === "destination" || tab === "goal" || tab === "compare")) go("compare");
    wasPlanned.current = planned;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planned]);

  // ---------- Selected warning (shared with the map) ----------
  const [localSel, setLocalSel] = useState<string | null>(null);
  const rawSel = p.onSelectAlert ? (p.selectedAlertId ?? null) : localSel;
  const selectedAlert = rawSel && p.alerts.some((a) => a.id === rawSel) ? rawSel : null;
  const selectAlert = (id: string | null) => (p.onSelectAlert ? p.onSelectAlert(id) : setLocalSel(id));
  // A warning picked elsewhere (e.g. a hazard marker on the map) opens the Warnings tab.
  const lastSel = useRef(p.selectedAlertId ?? null);
  useEffect(() => {
    const id = p.selectedAlertId ?? null;
    if (id && id !== lastSel.current && tab !== "safety") go("safety");
    lastSel.current = id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.selectedAlertId]);

  // ---------- Tab status (shown in the tab bar) ----------
  const status: Record<PlannerTabId, { done?: boolean; count?: number; tone?: "warn" | "caution"; hint: string }> = {
    start: { done: startSet, hint: startSet ? "Start chosen" : "Choose where the walk begins" },
    destination: { done: destSet, hint: destSet ? "Destination chosen" : "Choose where to go" },
    goal: { done: !!p.missionId, hint: p.missionId ? "Science goal chosen" : "Optional: pick a science goal" },
    compare: { done: planned, hint: planned ? "Routes planned" : "Plan and compare routes" },
    safety: planned || p.alerts.length
      ? warnings
        ? { count: warnings, tone: "warn", hint: plural(warnings, "warning") }
        : cautions
          ? { count: cautions, tone: "caution", hint: plural(cautions, "caution") }
          : { done: true, hint: "No warnings or cautions" }
      : { hint: "Needs a planned route" },
    eva: { done: planned, hint: planned ? "EVA budget estimated" : "Needs a planned route" },
    notes: { done: words > 0, hint: words ? plural(words, "word") : "Optional" },
    save: { done: saved, hint: saved ? "Saved" : solo ? "Save or export" : "Export the report" },
  };

  // ---------- Footer: the single obvious next action ----------
  const idx = TAB_IDS.indexOf(tab);
  const next = TAB_IDS[idx + 1] as PlannerTabId | undefined;
  const prev = TAB_IDS[idx - 1] as PlannerTabId | undefined;
  const planAction = {
    label: busy ? "Planning…" : solo ? "Plan Route" : "Plan Both Routes",
    icon: "play",
    onClick: () => {
      if (tab !== "compare") go("compare");
      (solo ? p.onPlan : t.onPlan)();
    },
    disabled: busy || !ready || !p.apiUp,
    why: !p.apiUp
      ? "The route engine is offline."
      : !ready
        ? !startSet
          ? solo ? "Choose a starting point first (Start tab)." : "Place both astronauts' starts first (Start tab)."
          : solo ? "Choose a destination first (Destination tab)." : "Place both destinations and the rendezvous first (Destination tab)."
        : busy
          ? "Comparing routes over real terrain…"
          : undefined,
  };
  const cont = (to: PlannerTabId) => ({ label: `Next: ${tabLabel(to)}`, icon: "chevron", onClick: () => go(to), disabled: false, why: undefined as string | undefined });
  let primary: { label: string; icon: string; onClick: () => void; disabled: boolean; why?: string };
  if (tab === "start") {
    primary = startSet ? cont("destination") : { ...cont("destination"), disabled: true, why: solo ? "Choose a starting point to continue." : "Place both astronauts' starts to continue." };
  } else if (tab === "destination") {
    primary = destSet ? cont(planned ? "compare" : "goal") : { ...cont("goal"), disabled: true, why: solo ? "Choose a destination to continue." : "Place both destinations and the rendezvous to continue." };
  } else if (tab === "save") {
    if (solo)
      primary = saved
        ? { label: "Saved", icon: "check", onClick: p.onSave, disabled: true, why: "No unsaved changes. Edit anything to save again." }
        : { label: "Save Mission", icon: "save", onClick: p.onSave, disabled: !ready, why: ready ? undefined : "Add a start and a destination first." };
    else primary = { label: p.exporting ? "Preparing…" : "Export Report", icon: "files", onClick: p.onExport, disabled: p.exporting || !t.summary, why: t.summary ? undefined : "Plan both routes first." };
  } else if (tab === "notes") {
    primary = cont("save");
  } else if (!planned) {
    primary = planAction;
  } else {
    primary = cont(next ?? "save");
  }
  if (p.savedFlash && solo && tab === "save") primary = { ...primary, label: "Saved", icon: "check" };

  const canExport = solo ? !!r : !!t.summary;
  const reportBtn = (
    <Hint text={canExport ? "Export a PDF mission report of the plan currently shown." : "Plan a route first to export a PDF report."}>
      <button className="btn btn-secondary pl-icon-btn" disabled={p.exporting || !canExport} onClick={p.onExport} aria-label="Export mission report as PDF">
        <Icon name="files" /> <span className="btn-text">{p.exporting ? "…" : "Report"}</span>
      </button>
    </Hint>
  );
  const saveBtn = (
    <Hint text={solo ? (ready ? "Save this itinerary in this browser. Find it later under Files." : "Add a start and a destination first.") : "Saving stores the Solo itinerary."}>
      <button className="btn btn-secondary pl-icon-btn" disabled={!hasStartSolo || !hasDestSolo} onClick={p.onSave} aria-label="Save route">
        <Icon name={p.savedFlash ? "check" : "save"} /> <span className="btn-text">{p.savedFlash ? "Saved" : "Save"}</span>
      </button>
    </Hint>
  );

  const slopeControl = (
    <label className="slope-limit">
      <span>
        Max walkable <Term k="slope">slope</Term> <KindBadge kind="assumption" title="Planning assumption, not a NASA requirement" />
      </span>
      <b>{p.maxSlope}°</b>
      <input type="range" min={10} max={35} step={1} value={p.maxSlope} onChange={(e) => p.setMaxSlope(parseInt(e.target.value))} aria-label="Maximum walkable slope in degrees" />
      <span className="fine muted span2">
        Ground steeper than this is avoided completely{solo ? "" : " by both astronauts"}.{planned ? " Changing it clears the current routes." : ""}
      </span>
    </label>
  );

  const offline = !p.apiUp && (
    <div className="notice error">
      <b>Route engine offline.</b> The Python planner isn't responding. Start it with <code>python analysis/server.py</code> and try again.
    </div>
  );

  const placeChip = (role: StopRole, label: string) => (
    <button className={`chip chip-${role} ${p.placeMode === role ? "active" : ""}`} aria-pressed={p.placeMode === role} onClick={() => p.setPlaceMode(p.placeMode === role ? null : role)}>
      <Icon name={p.placeMode === role ? "target" : "plus"} size={13} /> {p.placeMode === role ? "Click the map…" : label}
    </button>
  );

  const stopList = (stops: Stop[], opts?: { coords?: boolean }) => (
    <ol className="itinerary">
      {stops.map((s) => {
        const i = ordered.indexOf(s);
        return (
          <StopRow
            key={s.id}
            s={s}
            index={i}
            last={i === ordered.length - 1 || stops[stops.length - 1] === s}
            poi={s.poiId ? p.pois.find((x) => x.id === s.poiId) : undefined}
            geology={p.geology ?? null}
            route={r}
            coords={opts?.coords !== false}
            onFly={() => p.onFly(s.lon, s.lat)}
            onRemove={() => p.removeStop(s.id)}
          />
        );
      })}
    </ol>
  );

  /** Empty state for tabs that need something set first. */
  const needs = (what: "start" | "destination" | "route", title: string, text: ReactNode) => {
    const target: PlannerTabId = what === "start" ? "start" : what === "destination" ? "destination" : "compare";
    const action = p.docked && !(what === "route" && ready) ? undefined : what === "route" && ready ? (
        <button className="btn btn-secondary pl-empty-btn" onClick={planAction.onClick} disabled={planAction.disabled}>
          <Icon name="play" size={15} /> {planAction.label}
        </button>
      ) : (
        <button className="btn btn-secondary pl-empty-btn" onClick={() => go(!startSet ? "start" : !destSet ? "destination" : target)}>
          Go to {tabLabel(!startSet ? "start" : !destSet ? "destination" : target)} <Icon name="chevron" size={14} />
        </button>
      );
    return <EmptyState icon={what === "route" ? "route" : what === "start" ? "flag" : "pin"} title={title} text={text} action={action} />;
  };

  const routeNeeded = (topic: string) =>
    needs(
      "route",
      `${topic} needs a planned route`,
      p.docked && !ready
        ? <>Click the map (or a sample marker) to set {!startSet ? "a start and a destination" : "a destination"}, then press <b>Generate Route</b>.</>
        : !startSet
        ? <>Start by choosing where the walk begins. Then pick a destination and press <b>{planAction.label}</b>.</>
        : !destSet
          ? <>Next, choose a destination. Then press <b>{planAction.label}</b>.</>
          : <>Your stops are set. Press <b>{planAction.label}</b> and PAWPRINT will compare routes over real NASA terrain.</>,
    );

  // ---------- Tab bodies ----------
  let body: ReactNode;
  if (tab === "start") {
    body = solo ? (
      <>
        <Intro title="Where does the walk begin?" sub="Base Camp at the landing site is a good default." />
        {start ? (
          stopList([start])
        ) : (
          <EmptyState icon="flag" title="No start yet" text={<>Press <b>Pick start on map</b> and click the map, or click a marker and choose <b>Set as start</b>.</>} />
        )}
        <div className="place-buttons">{placeChip("start", start ? "Move start on map" : "Pick start on map")}</div>
      </>
    ) : (
      <>
        <Intro title="Where do both astronauts begin?" sub="Each astronaut walks start → own destination → shared rendezvous." />
        <TeamSlots slots={TEAM_STEP_SLOTS.start} stops={t.stops} place={t.place} setPlace={t.setPlace} clear={t.clear} />
        <p className="pl-tip">Press <b>Place</b>, then click the map, or open a sample marker and pick a slot.</p>
      </>
    );
  } else if (tab === "destination") {
    const dests = ordered.filter((s) => s.role !== "start");
    body = solo ? (
      <>
        <Intro title="Where do you want to go?" sub="Click a rock sample on the map and choose Set destination. Add waypoints to stop along the way." />
        {start && (
          <button className="pl-from" onClick={() => go("start")} title="Change the start">
            <span className="dot" /> From <b>{start.name}</b> <em>Change</em>
          </button>
        )}
        {dests.length > 0 ? (
          stopList(dests)
        ) : (
          <EmptyState
            icon="pin"
            title="No destination yet"
            text="Pick one on the map, or let a science goal suggest NASA sample sites."
            action={
              <button className="btn btn-secondary pl-empty-btn" onClick={() => go("goal")}>
                <Icon name="sparkle" size={14} /> Browse science goals
              </button>
            }
          />
        )}
        <div className="place-buttons">
          {placeChip("destination", hasDestSolo ? "Move destination" : "Destination on map")}
          {placeChip("waypoint", "Add waypoint")}
        </div>
      </>
    ) : (
      <>
        <Intro title="Destinations and rendezvous" sub="Pick a science target for each astronaut and a shared meeting point." />
        <TeamSlots slots={TEAM_STEP_SLOTS.destination} stops={t.stops} place={t.place} setPlace={t.setPlace} clear={t.clear} />
        <p className="pl-tip">Press <b>Place</b>, then click the map, or open a sample marker and pick a slot.</p>
      </>
    );
  } else if (tab === "goal") {
    body = (
      <>
        <Intro
          title="Choose a science goal"
          sub={solo ? "Optional. Pick what you want to learn and PAWPRINT suggests NASA sample sites to visit." : "Optional. Find NASA sample sites for each astronaut, then assign them from the map marker."}
        />
        <ScienceMissions
          missionId={p.missionId}
          setMissionId={p.setMissionId}
          pois={p.pois}
          from={solo ? start : (t.stops.aStart ?? null)}
          onAdd={p.onAddScience}
          onFly={(poi) => p.onFly(poi.lon, poi.lat)}
          inItinerary={inItinerary}
          teamMode={!solo}
        />
      </>
    );
  } else if (tab === "compare") {
    if (solo && planned && r && p.compare) {
      const near = samplesNearRoute(p.pois, r.path_lonlat, 400);
      const risk = riskLevel(r);
      body = (
        <>
          <Intro title="Compare your route options" sub="Three routes over real NASA terrain. Pick the one that fits your walk." />
          <div className="metric-cards">
            <div className="mcard">
              <Icon name="distance" size={18} />
              <span>Distance</span>
              <b>{formatDistance(r.distance_m)}</b>
            </div>
            <div className="mcard">
              <Icon name="mountain" size={18} />
              <span>Climb</span>
              <b>+{Math.round(r.elevation_gain_m)} m</b>
            </div>
            <div className="mcard warn">
              <Icon name="warn" size={18} />
              <span>Max slope</span>
              <b>{r.max_slope_deg.toFixed(1)}°</b>
            </div>
          </div>
          <SafetyLink warnings={warnings} cautions={cautions} alerts={p.alerts} onClick={() => go("safety")} />
          <ComparePanel compare={p.compare} objective={p.objective} setObjective={p.setObjective} maxSlope={p.maxSlope} weather={p.weather} />

          <div className="pl-block">
            <h4 className="pl-h">
              Elevation profile <KindBadge kind="real-derived" />
            </h4>
            <ElevationProfile
              distance={r.profile.distance_m}
              elevation={r.profile.elevation_m}
              stopIndices={r.stop_indices}
              stopLabels={ordered.map((s, i) => (i === 0 ? "Start" : s.role === "destination" ? s.name.split(" ")[0] : String.fromCharCode(64 + i)))}
              onHover={p.onHover}
            />
            <p className="pl-tip">Hover the chart to see that point on the map.</p>
          </div>
          <dl className="pl-facts">
            <div>
              <dt>Slope risk</dt>
              <dd>
                <span className={`risk-badge risk-${risk}`}>{risk}</span> ≥15° ground {((r.slope_class_fraction.hazard + r.slope_class_fraction.nogo) * 100).toFixed(0)}%
              </dd>
            </div>
            <div>
              <dt>Terrain grid</dt>
              <dd>{r.grid.name.toUpperCase()} {r.grid.resolution_m} m</dd>
            </div>
            <div>
              <dt>Samples within 400 m</dt>
              <dd>{near.length ? near.slice(0, 4).map((s) => s.name).join(" · ") + (near.length > 4 ? ` +${near.length - 4}` : "") : "None nearby"}</dd>
            </div>
          </dl>
          <details className="disclosure">
            <summary>All metrics & technical details</summary>
            <Metrics r={r} />
          </details>
          <div className="pl-block">
            <h4 className="pl-h">Planning settings</h4>
            {slopeControl}
          </div>
        </>
      );
    } else if (!solo && planned && t.summary) {
      body = (
        <>
          <Intro title="Team routes" sub="Turquoise = Astronaut A · lavender = Astronaut B · rose = rendezvous." />
          <TeamResults routes={t.routes} summary={t.summary} scienceMin={p.eva.scienceMinPerStop} />
          <TeamErrors errors={t.errors} />
          <SafetyLink warnings={warnings} cautions={cautions} alerts={p.alerts} onClick={() => go("safety")} />
          <p className="pl-tip">
            Comparing three route options works on a Solo Marswalk. Both astronauts use the <b>{OBJECTIVE_META[p.objective].label}</b> objective.
          </p>
          <div className="pl-block">
            <h4 className="pl-h">Planning settings</h4>
            {slopeControl}
          </div>
        </>
      );
    } else {
      body = (
        <>
          <Intro
            title={solo ? "Plan and compare routes" : "Plan both routes"}
            sub={<>The <Term k="astar">A* planner</Term> finds {solo ? "three route options (fastest, shortest, lower risk)" : "a route for each astronaut"} over real NASA terrain.</>}
          />
          {!ready && p.docked ? (
            <EmptyState icon="pin" title={!startSet ? "Choose a start first" : "Choose a destination first"} text={solo ? <>Click anywhere on the map, or a sample marker, and choose <b>{!startSet ? "Set Start" : "Set Destination"}</b>.</> : "Click the map or a sample marker to place both starts, both destinations and the rendezvous."} />
          ) : !ready ? (
            needs(!startSet ? "start" : "destination", !startSet ? "Choose a start first" : "Choose a destination first", solo ? "Routes need a start and a destination." : "Both routes need a start, a destination and the shared rendezvous.")
          ) : solo ? (
            <>
              {stopList(ordered, { coords: false })}
              <button className="link-btn" onClick={() => go("destination")}>
                <Icon name="plus" size={13} /> Edit stops
              </button>
            </>
          ) : (
            <>
              <TeamSlots slots={[...TEAM_STEP_SLOTS.start, ...TEAM_STEP_SLOTS.destination]} stops={t.stops} place={t.place} setPlace={t.setPlace} clear={t.clear} readOnly />
              <button className="link-btn" onClick={() => go("destination")}>
                <Icon name="pin" size={13} /> Edit points
              </button>
            </>
          )}
          {slopeControl}
          {busy && (
            <div className="pl-busy" role="status">
              <Mascot pose="floating" size={40} className="bob" /> {solo ? "Sniffing out three routes…" : "Planning both routes…"}
            </div>
          )}
          {solo && p.routeError && (
            <div className="notice error with-dog">
              <Mascot pose="sitting" size={44} />
              <div>
                <b>{p.alerts[0]?.title ?? "Couldn't plan this route."}</b>
                <p>{p.alerts[0]?.why}</p>
                <p className="fine muted">Planner message: {p.routeError}</p>
              </div>
            </div>
          )}
          {!solo && <TeamErrors errors={t.errors} />}
          {offline}
        </>
      );
    }
  } else if (tab === "safety") {
    body = (
      <>
        <Intro title="Warnings & safety" sub="Everything on the planned route that deserves a second look. Tap a card for the explanation." />
        <WarningsBoard alerts={p.alerts} selectedId={selectedAlert} onSelect={selectAlert} onLocate={p.onLocateAlert} empty={routeNeeded("The safety check")} />
      </>
    );
  } else if (tab === "eva") {
    body = (
      <>
        <Intro
          title="EVA resources"
          sub={
            solo
              ? p.evaPlan
                ? `Estimated total EVA ${fmtMin(p.evaPlan.totalMin)}, including the walk back.`
                : "Time, oxygen and power budgets for the walk."
              : p.teamEva?.missionMin != null
                ? `Estimated mission length ${fmtMin(p.teamEva.missionMin)}.`
                : "Time, oxygen and power for both suits."
          }
        />
        {!planned ? (
          routeNeeded("The EVA budget")
        ) : solo ? (
          <EvaPanel plan={p.evaPlan} settings={p.eva} setSettings={p.setEva} scienceStops={Math.max(0, p.stops.length - 1)} />
        ) : (
          <EvaPanel plan={null} team={p.teamEva} teamMode settings={p.eva} setSettings={p.setEva} scienceStops={1} />
        )}
      </>
    );
  } else if (tab === "notes") {
    body = (
      <>
        <Intro title="Mission notes" sub="Optional. EVA notes, science goals and contingencies. Saved with the route and included in the report." />
        <textarea className="notes pl-notes" placeholder="e.g. Collect a core at Melyn; turn back if the dust picks up…" value={p.notes} onChange={(e) => p.setNotes(e.target.value)} aria-label="Route notes" />
        <p className="pl-tip">{words ? `${plural(words, "word")} · included in the mission report.` : "Nothing written yet."}</p>
      </>
    );
  } else if (solo) {
    body = (
      <>
        <Intro title={saved ? "Mission saved" : "Review & save"} sub={saved ? "Find it any time under Files. You can also export a PDF report." : "Check the summary, give it a name and save it in this browser."} />
        <label className="pl-field">
          <span>Mission name</span>
          <input value={p.name} onChange={(e) => p.setName(e.target.value)} aria-label="Mission name" />
        </label>
        <ul className="pl-recap">
          <li><span>Stops</span><b>{ordered.length ? ordered.map((s) => s.name).join(" → ") : <button className="link-btn" onClick={() => go("start")}>Choose a start</button>}</b></li>
          <li><span>Route</span><b>{r ? `${OBJECTIVE_META[p.objective].label} · ${formatDistance(r.distance_m)}` : <button className="link-btn" onClick={() => go("compare")}>Not planned yet</button>}</b></li>
          <li><span>Safety</span><b className={warnings ? "warn" : ""}>{planned ? (warnings ? plural(warnings, "warning") : cautions ? plural(cautions, "caution") : "No warnings") : "Plan a route to check"}</b></li>
          <li><span>EVA</span><b>{p.evaPlan ? `${fmtMin(p.evaPlan.totalMin)} incl. walk back` : "—"}</b></li>
          <li><span>Notes</span><b>{words ? plural(words, "word") : <button className="link-btn" onClick={() => go("notes")}>Add notes</button>}</b></li>
        </ul>
        {saved && (
          <div className="pl-saved" role="status">
            <Icon name="check" size={16} />
            <span>Saved in this browser. Open it later from <b>Files</b>.</span>
          </div>
        )}
        {p.docked && (
          <button className="btn btn-primary pl-wide" disabled={!ready || saved} onClick={p.onSave}>
            <Icon name={saved || p.savedFlash ? "check" : "save"} /> {saved || p.savedFlash ? "Saved" : "Save Mission"}
          </button>
        )}
        <button className="btn btn-secondary pl-wide" disabled={p.exporting || !r} onClick={p.onExport}>
          <Icon name="files" /> {p.exporting ? "Preparing PDF…" : "Export PDF mission report"}
        </button>
      </>
    );
  } else {
    body = (
      <>
        <Intro title="Keep this team plan" sub="Export a PDF mission report with both routes, the timeline and EVA estimates." />
        <label className="pl-field">
          <span>Mission name</span>
          <input value={p.name} onChange={(e) => p.setName(e.target.value)} aria-label="Mission name" />
        </label>
        {!planned && routeNeeded("The team report")}
        {p.docked && planned && (
          <button className="btn btn-primary pl-wide" disabled={p.exporting} onClick={p.onExport}>
            <Icon name="files" /> {p.exporting ? "Preparing PDF…" : "Export PDF mission report"}
          </button>
        )}
        <p className="pl-tip">Saving in the browser stores the Solo itinerary only; two-astronaut plans are kept through the PDF report.</p>
      </>
    );
  }

  if (p.docked) {
    return (
      <section className={`panel planner planner-dock ${dockOpen ? "open" : ""}`} aria-label="Mission tools">
        <div className="dock-bar">
          <div className="dock-tabs" role="tablist" aria-label="Mission tools">
            {TABS.filter((tb) => DOCK_TAB_IDS.includes(tb.id)).map((tb) => {
              const st = status[tb.id];
              const current = tb.id === tab && dockOpen;
              return (
                <button
                  key={tb.id}
                  role="tab"
                  id={`pl-tab-${tb.id}`}
                  aria-selected={current}
                  aria-controls="pl-tabpanel"
                  className={`dock-tab ${current ? "current" : ""}`}
                  onClick={() => (current ? setDockOpen(false) : go(tb.id))}
                  title={`${tb.label}: ${st.hint}`}
                >
                  <Icon name={tb.icon} size={18} />
                  <span>{tb.label}</span>
                  {st.count ? <em className={`pl-tab-badge ${st.tone ?? ""}`} aria-label={st.hint}>{st.count}</em> : st.done ? <i className="dock-done" aria-label="done"><Icon name="check" size={11} /></i> : null}
                </button>
              );
            })}
          </div>
          <button className="icon-btn dock-toggle" onClick={() => setDockOpen(!dockOpen)} aria-expanded={dockOpen} aria-label={dockOpen ? "Collapse mission tools" : "Expand mission tools"}>
            <Icon name={dockOpen ? "chevronUp" : "chevronDown"} size={18} />
          </button>
        </div>
        {dockOpen && (
          <div className="dock-body" ref={scrollRef} role="tabpanel" id="pl-tabpanel" aria-labelledby={`pl-tab-${tab}`}>
            {body}
          </div>
        )}
      </section>
    );
  }

  return (
    <aside className={`panel right-panel planner ${p.sheetOpen ? "sheet-open" : ""} ${collapsed ? "collapsed" : ""}`} aria-label="Marswalk planner">
      <button className="sheet-handle" onClick={p.toggleSheet} aria-expanded={p.sheetOpen}>
        <span className="grip" />
        <em>{p.sheetOpen ? "Show map" : `Open planner · ${tabLabel(tab)}`}</em>
      </button>
      <button className="pl-collapse" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-label={collapsed ? "Expand planner" : "Collapse planner"} title={collapsed ? "Expand planner" : "Collapse planner"}>
        <Icon name="chevron" size={16} />
        {collapsed && <span className="pl-collapse-step">{tabLabel(tab)}</span>}
      </button>

      <header className="pl-head">
        <span className="route-icon"><Icon name={solo ? "walker" : "user"} size={20} /></span>
        <div className="route-head-text">
          <input className="route-name" value={p.name} onChange={(e) => p.setName(e.target.value)} aria-label="Route name (editable)" title="Click to rename" />
          <div className="route-sub">{solo ? "Solo Marswalk" : "Two-Astronaut Plan"} · Jezero Crater</div>
        </div>
      </header>

      <div className="pl-mode" role="radiogroup" aria-label="Mission mode">
        <button role="radio" aria-checked={solo} className={solo ? "active" : ""} onClick={() => p.setMode("solo")}>
          <Icon name="walker" size={14} /> Solo
        </button>
        <button role="radio" aria-checked={!solo} className={!solo ? "active" : ""} onClick={() => p.setMode("team")}>
          <Icon name="user" size={14} /> Two Astronauts
        </button>
      </div>

      <nav className="pl-tabs" aria-label="Planner sections">
        <div role="tablist" aria-label="Planner sections">
          {TABS.map((tb, i) => {
            const st = status[tb.id];
            const current = tb.id === tab;
            return (
              <button
                key={tb.id}
                role="tab"
                id={`pl-tab-${tb.id}`}
                aria-selected={current}
                aria-controls="pl-tabpanel"
                className={`pl-tab ${current ? "current" : ""} ${st.done ? "done" : ""}`}
                onClick={() => go(tb.id)}
                title={`${tb.label}: ${st.hint}`}
                aria-label={`${tb.label}${st.count ? `, ${st.hint}` : st.done ? " (done)" : ""}`}
              >
                <span className="pl-tab-ico">
                  {st.done && !current ? <Icon name="check" size={13} /> : i < 3 ? <i className="pl-tab-num">{i + 1}</i> : <Icon name={tb.icon} size={14} />}
                </span>
                <span className="pl-tab-label">{tb.label}</span>
                {st.count ? <em className={`pl-tab-badge ${st.tone ?? ""}`} aria-hidden="true">{st.count}</em> : null}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="panel-scroll pl-scroll" ref={scrollRef} role="tabpanel" id="pl-tabpanel" aria-labelledby={`pl-tab-${tab}`}>
        {body}
      </div>

      <footer className="pl-footer">
        {primary.why && primary.disabled && <p className="pl-why" role="status">{primary.why}</p>}
        <div className="pl-footer-row">
          {prev && (
            <button className="btn btn-ghost pl-back" onClick={() => go(prev)} aria-label={`Back to ${tabLabel(prev)}`} title={`Back to ${tabLabel(prev)}`}>
              <Icon name="chevron" size={16} />
            </button>
          )}
          <button className="btn btn-primary pl-primary" disabled={primary.disabled} onClick={primary.onClick}>
            {primary.icon !== "chevron" && <Icon name={primary.icon} />} {primary.label} {primary.icon === "chevron" && <Icon name="chevron" size={16} />}
          </button>
          {!(solo && tab === "save") && saveBtn}
          {tab !== "save" && reportBtn}
        </div>
      </footer>
    </aside>
  );
}

function Intro({ title, sub }: { title: string; sub: ReactNode }) {
  return (
    <div className="pl-intro">
      <h3>{title}</h3>
      <p>{sub}</p>
    </div>
  );
}

function EmptyState({ icon, title, text, action }: { icon: string; title: string; text: ReactNode; action?: ReactNode }) {
  return (
    <div className="pl-emptystate">
      <span className="pl-es-icon"><Icon name={icon} size={20} /></span>
      <b>{title}</b>
      <p>{text}</p>
      {action}
    </div>
  );
}

function SafetyLink({ alerts, warnings, cautions, onClick }: { alerts: Alert[]; warnings: number; cautions: number; onClick: () => void }) {
  return (
    <button className={`safety-summary ${warnings ? "has-warn" : cautions ? "has-caution" : ""}`} onClick={onClick}>
      <Icon name="warn" size={16} />
      <span>
        <b>{warnings ? plural(warnings, "warning") : cautions ? plural(cautions, "caution") : "No warnings"}</b>
        {warnings && cautions ? ` · ${plural(cautions, "caution")}` : ""}
        <em>{alerts.find((a) => a.severity !== "info")?.title ?? "Only data notes"}</em>
      </span>
      <Icon name="chevron" size={14} />
    </button>
  );
}

function StopRow({
  s,
  index,
  last,
  poi,
  geology,
  route,
  coords,
  onFly,
  onRemove,
}: {
  s: Stop;
  index: number;
  last: boolean;
  poi?: Poi;
  geology: GeologyFile | null;
  route: RouteResult | null;
  coords: boolean;
  onFly: () => void;
  onRemove: () => void;
}) {
  const unit = unitAt(geology, s.lon, s.lat);
  const r = route;
  return (
    <li className={`stop-${s.role}`}>
      <span className="dot" />
      {!last && <span className="itin-rail" />}
      <div className="itin-main">
        <button className="itin-text" onClick={onFly} title="Show on map">
          <span className="itin-title">
            <span className="itin-role">{ROLE_LABEL[s.role]}</span>
            <b>{s.name}</b>
          </span>
          {(coords || (r && r.stop_indices[index] !== undefined)) && (
            <span className="itin-sub">
              {coords && <>{formatLat(s.lat, 3)}, {formatLon(s.lon, 3)}</>}
              {r && r.stop_indices[index] !== undefined && (
                <>
                  {coords ? " · " : ""}
                  {index === 0
                    ? `Elev. ${Math.round(r.profile.elevation_m[r.stop_indices[index]]).toLocaleString("en-US")} m`
                    : `+${(r.profile.distance_m[r.stop_indices[index]] / 1000).toFixed(2)} km`}
                </>
              )}
            </span>
          )}
        </button>
        {(poi?.number || unit) && (
          <details className="why">
            <summary>Why this location?</summary>
            <p className="fine">
              {poi?.number ? <>Science objective: revisit NASA sample #{poi.number} ({poi.campaign}). </> : null}
              {unit ? <>Geologic unit: <b>{unit.symbol}</b> {unit.name} (USGS, approx.)</> : null}
            </p>
          </details>
        )}
      </div>
      <button className="icon-btn x" aria-label={`Remove ${s.name}`} title="Remove stop" onClick={onRemove}>
        <Icon name="close" size={13} />
      </button>
    </li>
  );
}

function Metrics({ r }: { r: RouteResult }) {
  const slopes = profileSlopes(r.profile.distance_m, r.profile.elevation_m);
  const steep = countSteepSegments(slopes, 15);
  const f = r.slope_class_fraction;
  const risk = riskLevel(r);
  return (
    <div className="metrics">
      <div className="metric-grid">
        <M label="Distance (3D)" value={formatDistance(r.distance_m)} kind="real-derived" />
        <M label="Elevation gain" value={`+${Math.round(r.elevation_gain_m)} m`} kind="real-derived" />
        <M label="Max terrain slope" value={`${r.max_slope_deg.toFixed(1)}°`} kind="real-derived" />
        <M label={<Term k="walktime">Est. walk time</Term>} value={formatDuration(r.walk_time_s)} kind="estimate" />
        <M label={<Term k="difficulty">Difficulty</Term>} value={`${r.difficulty.label} · ${r.difficulty.score}`} kind="estimate" wide />
      </div>
      <DogTip compact title="What does this mean?">
        Distance, climb and slope come from real NASA/USGS terrain. Walk time and difficulty are estimates for comparing routes, not
        validated astronaut times.
      </DogTip>
      <div className="metric-grid">
        <M label="Map distance" value={formatDistance(r.horizontal_distance_m)} kind="real-derived" />
        <M label="Elevation loss" value={`−${Math.round(r.elevation_loss_m)} m`} kind="real-derived" />
        <M label="Mean terrain slope" value={`${r.mean_slope_deg.toFixed(1)}°`} kind="real-derived" />
        <M label="Start → end elevation" value={`${Math.round(r.elevation_start_m)} → ${Math.round(r.elevation_end_m)} m`} kind="real-derived" />
        <M label="Effort-weighted time" value={formatDuration(r.est_time_s)} kind="estimate" wide />
      </div>
      <p className="fine muted">Effort-weighted time is the walk time with the original PAWPRINT slope penalty added; it ranks routes but is not a clock time.</p>
      <div className="card-title">
        <Term k="hazard">Slope classes</Term> along route
      </div>
      <div className="classbar">
        <i className="easy" style={{ flex: f.easy }} />
        <i className="mod" style={{ flex: f.moderate }} />
        <i className="haz" style={{ flex: f.hazard }} />
        <i className="nogo" style={{ flex: f.nogo }} />
      </div>
      <div className="classlegend">
        <span>&lt;10° {(f.easy * 100).toFixed(0)}%</span>
        <span>10–15° {(f.moderate * 100).toFixed(0)}%</span>
        <span>15–25° {(f.hazard * 100).toFixed(0)}%</span>
        <span>≥25° {(f.nogo * 100).toFixed(0)}%</span>
      </div>
      <p className="fine">
        Risk <b className={`risk-txt risk-${risk}`}>{risk}</b> · {steep} stretch{steep === 1 ? "" : "es"} with along-track grade ≥15° · terrain grid{" "}
        <b>{r.grid.name.toUpperCase()} {r.grid.resolution_m} m</b> · <Term k="astar">A*</Term> in {r.compute_ms} ms · slope limit {r.max_slope_limit_deg}°
      </p>
      <p className="fine muted">{r.model.note}</p>
    </div>
  );
}

function M({ label, value, kind, wide }: { label: React.ReactNode; value: string; kind: string; wide?: boolean }) {
  return (
    <div className={`metric ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
      <KindBadge kind={kind} />
    </div>
  );
}
