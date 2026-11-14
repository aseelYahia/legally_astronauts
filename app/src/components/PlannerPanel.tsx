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
import { SafetyList, SeverityIcon } from "./planner/SafetyList";
import { ScienceMissions } from "./planner/ScienceMissions";
import { TEAM_STEP_SLOTS, TeamErrors, TeamResults, TeamSlots } from "./planner/TeamPlanner";
import { DogTip, Hint, Icon, KindBadge, Mascot, Term } from "./ui";

export type PlanStep = 1 | 2 | 3 | 4 | 5;
/** Which Review section is expanded ("none" = all collapsed). */
export type PlannerTab = "route" | "compare" | "safety" | "eva" | "notes" | "none";

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
  /** Progress derived from the itinerary (5 = saved and unchanged). */
  step: PlanStep;
  sheetOpen: boolean;
  toggleSheet: () => void;
  tab: PlannerTab;
  setTab: (t: PlannerTab) => void;
  alerts: Alert[];
  onLocateAlert: (a: Alert) => void;
  weather: WeatherSol[];
  missionId: string | null;
  setMissionId: (id: string | null) => void;
  onAddScience: (p: Poi, role: StopRole) => void;
  eva: EvaSettings;
  setEva: (s: EvaSettings) => void;
  evaPlan: EvaPlan | null;
  teamEva: TeamEva | null;
  team: TeamProps;
}

const ROLE_LABEL: Record<StopRole, string> = { start: "Start", waypoint: "Waypoint", destination: "Destination" };
const STEP_LABELS: Record<PlanStep, string> = { 1: "Start", 2: "Destination", 3: "Plan", 4: "Review", 5: "Save" };
const STEPS: PlanStep[] = [1, 2, 3, 4, 5];

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
  const hasDest = p.stops.some((s) => s.role === "destination");
  const hasStart = p.stops.some((s) => s.role === "start");
  const warnings = p.alerts.filter((a) => a.severity === "warning").length;
  const cautions = p.alerts.filter((a) => a.severity === "caution").length;
  const start = ordered.find((s) => s.role === "start") ?? null;
  const inItinerary = new Set(p.stops.map((s) => s.poiId).filter(Boolean) as string[]);
  const saved = solo && p.step === 5;

  // ---------- Guided steps: the furthest step reachable with what is set so far ----------
  const teamStartsSet = TEAM_STEP_SLOTS.start.every((s) => t.stops[s]);
  const teamDestsSet = TEAM_STEP_SLOTS.destination.every((s) => t.stops[s]);
  const planned = solo ? !!r : !!t.summary;
  const reached: PlanStep = solo
    ? !hasStart ? 1 : !hasDest ? 2 : !r ? 3 : 5
    : !teamStartsSet ? 1 : !teamDestsSet ? 2 : !t.summary ? 3 : 5;
  const [soloStep, setSoloStep] = useState<PlanStep>(() => (p.step === 5 ? 4 : p.step));
  const [teamStep, setTeamStep] = useState<PlanStep>(() => (t.summary ? 4 : !teamStartsSet ? 1 : !teamDestsSet ? 2 : 3));
  const view = solo ? soloStep : teamStep;
  const setView = solo ? setSoloStep : setTeamStep;
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const go = (s: PlanStep) => {
    setView(s);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  // A new route jumps straight to Review; a stale route (itinerary edited) falls back to an earlier step.
  const wasPlanned = useRef(planned);
  useEffect(() => {
    if (planned && !wasPlanned.current && view <= 3) go(4);
    wasPlanned.current = planned;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planned]);
  useEffect(() => {
    if (view > reached) setView(reached);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reached, view, solo]);

  const openSection = (s: PlannerTab) => {
    p.setTab(p.tab === s ? "none" : s);
  };
  const jumpTo = (s: PlannerTab) => {
    if (view !== 4) go(4);
    p.setTab(s);
    requestAnimationFrame(() => document.getElementById(`review-${s}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  // ---------- Footer: one primary action that follows the step ----------
  const busy = solo ? p.busy : t.busy;
  let primary: { label: string; icon: string; onClick: () => void; disabled: boolean; why?: string };
  if (view === 1) {
    const ok = solo ? hasStart : teamStartsSet;
    primary = { label: "Continue", icon: "chevron", onClick: () => go(2), disabled: !ok, why: ok ? undefined : solo ? "Choose a starting point to continue." : "Place both astronauts' starts to continue." };
  } else if (view === 2) {
    const ok = solo ? hasStart && hasDest : teamStartsSet && teamDestsSet;
    const missing = solo
      ? !hasStart ? "Choose a starting point first." : "Choose a destination to continue."
      : !teamStartsSet ? "Place both starts first." : "Place both destinations and the rendezvous to continue.";
    primary = { label: "Continue", icon: "chevron", onClick: () => go(3), disabled: !ok, why: ok ? undefined : missing };
  } else if (view === 3) {
    if (planned) primary = { label: solo ? "Review Route" : "Review Routes", icon: "chevron", onClick: () => go(4), disabled: false };
    else {
      const ready = solo ? hasStart && hasDest : t.ready;
      primary = {
        label: busy ? "Planning…" : solo ? "Plan Route" : "Plan Both",
        icon: "play",
        onClick: solo ? p.onPlan : t.onPlan,
        disabled: busy || !ready || !p.apiUp,
        why: !p.apiUp ? "The route engine is offline." : !ready ? "Set every point on the previous steps first." : busy ? "Comparing routes over real terrain…" : undefined,
      };
    }
  } else if (view === 4) {
    primary = { label: "Continue", icon: "chevron", onClick: () => go(5), disabled: false };
  } else if (solo) {
    primary = saved
      ? { label: "Saved", icon: "check", onClick: p.onSave, disabled: true, why: "No unsaved changes. Edit anything to save again." }
      : { label: "Save Mission", icon: "save", onClick: p.onSave, disabled: !hasStart || !hasDest };
  } else {
    primary = { label: p.exporting ? "Preparing…" : "Export Report", icon: "files", onClick: p.onExport, disabled: p.exporting || !t.summary };
  }
  if (p.savedFlash && solo && view === 5) primary = { ...primary, label: "Saved", icon: "check" };

  const canExport = solo ? !!r : !!t.summary;
  const reportBtn = (
    <Hint text={canExport ? "Export a PDF mission report of the plan currently shown." : "Plan a route first to export a PDF report."}>
      <button className="btn btn-secondary pl-icon-btn" disabled={p.exporting || !canExport} onClick={p.onExport} aria-label="Export mission report as PDF">
        <Icon name="files" /> <span className="btn-text">{p.exporting ? "…" : "Report"}</span>
      </button>
    </Hint>
  );
  const saveBtn = (
    <Hint text={solo ? (hasStart && hasDest ? "Save this itinerary in this browser. Find it later under Files." : "Add a start and a destination first.") : "Saving stores the Solo itinerary."}>
      <button className="btn btn-secondary pl-icon-btn" disabled={!hasStart || !hasDest} onClick={p.onSave} aria-label="Save route">
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
      <span className="fine muted span2">Ground steeper than this is avoided completely{solo ? "" : " by both astronauts"}.</span>
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

  // ---------- Step bodies ----------
  let body: ReactNode;
  if (solo && view === 1) {
    body = (
      <>
        <StepIntro title="Where does the walk begin?" sub="Base Camp at the landing site is a good default." />
        {start ? stopList([start]) : <EmptyHint>No start yet. Pick one on the map, or click a marker and choose <b>Set as start</b>.</EmptyHint>}
        <div className="place-buttons">{placeChip("start", start ? "Move start on map" : "Pick start on map")}</div>
      </>
    );
  } else if (solo && view === 2) {
    const dests = ordered.filter((s) => s.role !== "start");
    body = (
      <>
        <StepIntro title="Where do you want to go?" sub="Click a rock sample on the map and choose Set destination, or pick a suggestion below." />
        {start && (
          <button className="pl-from" onClick={() => go(1)} title="Change the start">
            <span className="dot" /> From <b>{start.name}</b> <em>Change</em>
          </button>
        )}
        {dests.length > 0 ? stopList(dests) : <EmptyHint>No destination yet.</EmptyHint>}
        <div className="place-buttons">
          {placeChip("destination", hasDest ? "Move destination" : "Destination on map")}
          {placeChip("waypoint", "Add waypoint")}
        </div>
        <ScienceMissions
          missionId={p.missionId}
          setMissionId={p.setMissionId}
          pois={p.pois}
          from={start}
          onAdd={p.onAddScience}
          onFly={(poi) => p.onFly(poi.lon, poi.lat)}
          inItinerary={inItinerary}
        />
      </>
    );
  } else if (solo && view === 3) {
    body = (
      <>
        <StepIntro
          title={r ? "Route planned" : "Ready to plan"}
          sub={r ? "Your three route options are on the map. Continue to review them." : <>The <Term k="astar">A* planner</Term> compares three routes over real NASA terrain.</>}
        />
        {stopList(ordered, { coords: false })}
        <button className="link-btn" onClick={() => go(2)}>
          <Icon name="plus" size={13} /> Edit stops
        </button>
        {slopeControl}
        {p.busy && (
          <div className="pl-busy" role="status">
            <Mascot pose="floating" size={40} className="bob" /> Sniffing out three routes…
          </div>
        )}
        {p.routeError && (
          <div className="notice error with-dog">
            <Mascot pose="sitting" size={44} />
            <div>
              <b>{p.alerts[0]?.title ?? "Couldn't plan this route."}</b>
              <p>{p.alerts[0]?.why}</p>
              <p className="fine muted">Planner message: {p.routeError}</p>
            </div>
          </div>
        )}
        {offline}
      </>
    );
  } else if (solo && view === 4 && r && p.compare) {
    const near = samplesNearRoute(p.pois, r.path_lonlat, 400);
    const risk = riskLevel(r);
    body = (
      <>
        <StepIntro title="Review your route" sub="Check the numbers, then open any section below." />
        <button className="selected-option" onClick={() => jumpTo("compare")}>
          <i className="cmp-dot" style={{ background: OBJECTIVE_META[p.objective].color }} />
          <span>
            <b>{OBJECTIVE_META[p.objective].label}</b> route selected
          </span>
          <em>Compare 3 <Icon name="chevron" size={13} /></em>
        </button>
        <div className="metric-cards">
          <div className="mcard">
            <Icon name="distance" size={18} />
            <span>Distance</span>
            <b>{formatDistance(r.distance_m)}</b>
          </div>
          <div className="mcard">
            <Icon name="mountain" size={18} />
            <span>Elevation gain</span>
            <b>+{Math.round(r.elevation_gain_m)} m</b>
          </div>
          <div className="mcard warn">
            <Icon name="warn" size={18} />
            <span>Max slope</span>
            <b>{r.max_slope_deg.toFixed(1)}°</b>
          </div>
        </div>
        <SafetySummary alerts={p.alerts} warnings={warnings} cautions={cautions} onClick={() => jumpTo("safety")} />

        <div className="pl-acc" aria-label="Review sections">
          <Section id="route" title="Route details" sub="Elevation profile, slope risk, nearby samples" open={p.tab === "route"} onToggle={openSection}>
            <div className="review-row">
              <div className="review-item">
                <span className="ri-label">Slope risk</span>
                <span className={`risk-badge risk-${risk}`}>{risk}</span>
                <span className="ri-sub">
                  ≥15° ground: {((r.slope_class_fraction.hazard + r.slope_class_fraction.nogo) * 100).toFixed(0)}% · {r.grid.name.toUpperCase()} {r.grid.resolution_m} m terrain
                </span>
              </div>
              <div className="review-item">
                <span className="ri-label">Samples within 400 m</span>
                <span className="ri-sub">
                  {near.length ? near.slice(0, 4).map((s) => s.name).join(" · ") + (near.length > 4 ? ` +${near.length - 4}` : "") : "None nearby"}
                </span>
              </div>
            </div>
            <div className="card-title">
              Elevation profile <KindBadge kind="real-derived" />
            </div>
            <ElevationProfile
              distance={r.profile.distance_m}
              elevation={r.profile.elevation_m}
              stopIndices={r.stop_indices}
              stopLabels={ordered.map((s, i) => (i === 0 ? "Start" : s.role === "destination" ? s.name.split(" ")[0] : String.fromCharCode(64 + i)))}
              onHover={p.onHover}
            />
            <p className="fine muted">Hover the chart to see that point on the map.</p>
            <details className="disclosure">
              <summary>All metrics & technical details</summary>
              <Metrics r={r} />
            </details>
          </Section>
          <Section id="compare" title="Compare 3 routes" sub={`${OBJECTIVE_META[p.objective].label} selected · Fastest, Shortest, Lower Risk`} open={p.tab === "compare"} onToggle={openSection}>
            <ComparePanel compare={p.compare} objective={p.objective} setObjective={p.setObjective} maxSlope={p.maxSlope} weather={p.weather} />
          </Section>
          <SafetySection p={p} warnings={warnings} cautions={cautions} onToggle={openSection} solo />
          <Section id="eva" title="EVA resources" sub={p.evaPlan ? `Total EVA ${fmtMin(p.evaPlan.totalMin)} incl. walk back` : "Time, oxygen and power budgets"} open={p.tab === "eva"} onToggle={openSection}>
            <EvaPanel plan={p.evaPlan} settings={p.eva} setSettings={p.setEva} scienceStops={Math.max(0, p.stops.length - 1)} />
          </Section>
          <NotesSection p={p} onToggle={openSection} />
        </div>
      </>
    );
  } else if (solo && view === 5) {
    body = (
      <>
        <StepIntro title={saved ? "Mission saved" : "Save your Marswalk"} sub={saved ? "Find it any time under Files. You can also export a PDF report." : "Give it a name, then save it in this browser."} />
        <label className="pl-field">
          <span>Mission name</span>
          <input value={p.name} onChange={(e) => p.setName(e.target.value)} aria-label="Mission name" />
        </label>
        {r && (
          <ul className="pl-recap">
            <li><span>Route</span><b>{OBJECTIVE_META[p.objective].label} · {formatDistance(r.distance_m)}</b></li>
            <li><span>Stops</span><b>{ordered.map((s) => s.name).join(" → ")}</b></li>
            <li><span>Safety</span><b className={warnings ? "warn" : ""}>{warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : cautions ? `${cautions} caution${cautions === 1 ? "" : "s"}` : "No warnings"}</b></li>
            <li><span>Notes</span><b>{p.notes.trim() ? `${p.notes.trim().split(/\s+/).length} words` : <button className="link-btn" onClick={() => jumpTo("notes")}>Add notes</button>}</b></li>
          </ul>
        )}
        {saved && (
          <div className="pl-saved" role="status">
            <Icon name="check" size={16} />
            <span>Saved in this browser. Open it later from <b>Files</b>.</span>
          </div>
        )}
        <button className="btn btn-secondary pl-wide" disabled={p.exporting || !r} onClick={p.onExport}>
          <Icon name="files" /> {p.exporting ? "Preparing PDF…" : "Export PDF mission report"}
        </button>
      </>
    );
  } else if (!solo && view === 1) {
    body = (
      <>
        <StepIntro title="Where do both astronauts begin?" sub="Each astronaut walks start → own destination → shared rendezvous." />
        <TeamSlots slots={TEAM_STEP_SLOTS.start} stops={t.stops} place={t.place} setPlace={t.setPlace} clear={t.clear} />
        <p className="fine muted">Press Place, then click the map, or open a sample marker and pick a slot.</p>
      </>
    );
  } else if (!solo && view === 2) {
    body = (
      <>
        <StepIntro title="Destinations and rendezvous" sub="Pick a science target for each astronaut and a shared meeting point." />
        <TeamSlots slots={TEAM_STEP_SLOTS.destination} stops={t.stops} place={t.place} setPlace={t.setPlace} clear={t.clear} />
        <p className="fine muted">Press Place, then click the map, or open a sample marker and pick a slot.</p>
      </>
    );
  } else if (!solo && view === 3) {
    body = (
      <>
        <StepIntro title={t.summary ? "Routes planned" : "Ready to plan both"} sub="Both routes use the same terrain-aware A* planner and your slope limit." />
        <TeamSlots slots={[...TEAM_STEP_SLOTS.start, ...TEAM_STEP_SLOTS.destination]} stops={t.stops} place={t.place} setPlace={t.setPlace} clear={t.clear} readOnly />
        <button className="link-btn" onClick={() => go(2)}>
          <Icon name="pin" size={13} /> Edit points
        </button>
        {slopeControl}
        {t.busy && (
          <div className="pl-busy" role="status">
            <Mascot pose="floating" size={40} className="bob" /> Planning both routes…
          </div>
        )}
        <TeamErrors errors={t.errors} />
        {offline}
      </>
    );
  } else if (!solo && view === 4 && t.summary) {
    body = (
      <>
        <StepIntro title="Review the team plan" sub="Turquoise = Astronaut A · lavender = Astronaut B · rose = rendezvous." />
        <TeamResults routes={t.routes} summary={t.summary} scienceMin={p.eva.scienceMinPerStop} />
        <TeamErrors errors={t.errors} />
        <SafetySummary alerts={p.alerts} warnings={warnings} cautions={cautions} onClick={() => jumpTo("safety")} />
        <div className="pl-acc" aria-label="Review sections">
          <SafetySection p={p} warnings={warnings} cautions={cautions} onToggle={openSection} />
          <Section id="eva" title="EVA resources" sub={p.teamEva?.missionMin != null ? `Mission length ${fmtMin(p.teamEva.missionMin)}` : "Time, oxygen and power for both suits"} open={p.tab === "eva"} onToggle={openSection}>
            <EvaPanel plan={null} team={p.teamEva} teamMode settings={p.eva} setSettings={p.setEva} scienceStops={1} />
          </Section>
          <Section id="compare" title="Compare 3 routes" sub="Available on a Solo Marswalk" open={p.tab === "compare"} onToggle={openSection}>
            <DogTip pose="sitting" title="Solo feature">Route comparison works on a Solo Marswalk. Both astronauts use the <b>{OBJECTIVE_META[p.objective].label}</b> objective.</DogTip>
          </Section>
          <NotesSection p={p} onToggle={openSection} />
        </div>
      </>
    );
  } else if (!solo && view === 5) {
    body = (
      <>
        <StepIntro title="Keep this team plan" sub="Export a PDF mission report with both routes, the timeline and EVA estimates." />
        <label className="pl-field">
          <span>Mission name</span>
          <input value={p.name} onChange={(e) => p.setName(e.target.value)} aria-label="Mission name" />
        </label>
        <p className="fine muted">Saving in the browser stores the Solo itinerary only; two-astronaut plans are kept through the PDF report.</p>
      </>
    );
  } else {
    body = <EmptyHint>Loading this step…</EmptyHint>;
  }

  const stepNow = view;
  return (
    <aside className={`panel right-panel planner ${p.sheetOpen ? "sheet-open" : ""} ${collapsed ? "collapsed" : ""}`} aria-label="Marswalk planner">
      <button className="sheet-handle" onClick={p.toggleSheet} aria-expanded={p.sheetOpen}>
        <span className="grip" />
        <em>{p.sheetOpen ? "Show map" : `Open planner · ${STEP_LABELS[stepNow]}`}</em>
      </button>
      <button className="pl-collapse" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-label={collapsed ? "Expand planner" : "Collapse planner"} title={collapsed ? "Expand planner" : "Collapse planner"}>
        <Icon name="chevron" size={16} />
        {collapsed && <span className="pl-collapse-step">{stepNow}/5</span>}
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

      <nav className="pl-progress" aria-label="Planning progress">
        <div className="pl-progress-text">
          <b>{STEP_LABELS[stepNow]}</b>
          <span>Step {stepNow} of 5</span>
        </div>
        <ol>
          {STEPS.map((s) => {
            const done = s < stepNow || (s === 5 && saved);
            const can = s <= reached && s !== stepNow;
            return (
              <li key={s} className={`${done ? "done" : ""} ${s === stepNow ? "current" : ""}`}>
                <button disabled={!can} onClick={() => go(s)} aria-current={s === stepNow ? "step" : undefined} aria-label={`Step ${s}: ${STEP_LABELS[s]}${done ? " (done)" : ""}`} title={STEP_LABELS[s]}>
                  <i />
                  <span>{STEP_LABELS[s]}</span>
                  {s === 4 && warnings > 0 && planned && <em className="tab-badge" aria-label={`${warnings} warnings`}>{warnings}</em>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="panel-scroll pl-scroll" ref={scrollRef}>
        {body}
      </div>

      <footer className="pl-footer">
        {primary.why && primary.disabled && <p className="pl-why" role="status">{primary.why}</p>}
        <div className="pl-footer-row">
          {stepNow > 1 && (
            <button className="btn btn-ghost pl-back" onClick={() => go((stepNow - 1) as PlanStep)} aria-label={`Back to ${STEP_LABELS[(stepNow - 1) as PlanStep]}`} title="Back">
              <Icon name="chevron" size={16} />
            </button>
          )}
          <button className="btn btn-primary pl-primary" disabled={primary.disabled} onClick={primary.onClick}>
            {primary.icon !== "chevron" && <Icon name={primary.icon} />} {primary.label} {primary.icon === "chevron" && <Icon name="chevron" size={16} />}
          </button>
          {!(solo && stepNow === 5) && saveBtn}
          {!(stepNow === 5) && reportBtn}
        </div>
      </footer>
    </aside>
  );
}

function StepIntro({ title, sub }: { title: string; sub: ReactNode }) {
  return (
    <div className="pl-intro">
      <h3>{title}</h3>
      <p>{sub}</p>
    </div>
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="pl-empty">{children}</p>;
}

function Section({ id, title, sub, badge, open, onToggle, children }: { id: PlannerTab; title: string; sub: string; badge?: ReactNode; open: boolean; onToggle: (id: PlannerTab) => void; children: ReactNode }) {
  return (
    <section className={`pl-sec ${open ? "open" : ""}`} id={`review-${id}`}>
      <button className="pl-sec-head" aria-expanded={open} aria-controls={`review-${id}-body`} onClick={() => onToggle(id)}>
        <span className="pl-sec-text">
          <b>{title} {badge}</b>
          <span>{sub}</span>
        </span>
        <Icon name="chevron" size={16} />
      </button>
      {open && (
        <div className="pl-sec-body" id={`review-${id}-body`}>
          {children}
        </div>
      )}
    </section>
  );
}

function SafetySummary({ alerts, warnings, cautions, onClick }: { alerts: Alert[]; warnings: number; cautions: number; onClick: () => void }) {
  return (
    <button className={`safety-summary ${warnings ? "has-warn" : cautions ? "has-caution" : ""}`} onClick={onClick}>
      <SeverityIcon s={warnings ? "warning" : cautions ? "caution" : "info"} />
      <span>
        <b>{warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : cautions ? `${cautions} caution${cautions === 1 ? "" : "s"}` : "No warnings"}</b>
        {warnings && cautions ? ` · ${cautions} caution${cautions === 1 ? "" : "s"}` : ""}
        <em>{alerts.find((a) => a.severity !== "info")?.title ?? "Only informational notes"}</em>
      </span>
      <Icon name="chevron" size={14} />
    </button>
  );
}

function SafetySection({ p, warnings, cautions, onToggle, solo }: { p: Props; warnings: number; cautions: number; onToggle: (id: PlannerTab) => void; solo?: boolean }) {
  return (
    <Section
      id="safety"
      title="Safety check"
      badge={warnings > 0 ? <span className="tab-badge" aria-label={`${warnings} warnings`}>{warnings}</span> : null}
      sub={`${warnings} warning${warnings === 1 ? "" : "s"} · ${cautions} caution${cautions === 1 ? "" : "s"} · not certified for astronaut safety`}
      open={p.tab === "safety"}
      onToggle={onToggle}
    >
      <SafetyList
        alerts={p.alerts}
        onLocate={p.onLocateAlert}
        empty={solo ? "Plan a route and I'll list anything that deserves a second look: steep ground, long distances, big climbs and data limits." : "Plan both routes to see safety alerts for the team."}
      />
    </Section>
  );
}

function NotesSection({ p, onToggle }: { p: Props; onToggle: (id: PlannerTab) => void }) {
  const words = p.notes.trim() ? p.notes.trim().split(/\s+/).length : 0;
  return (
    <Section id="notes" title="Notes" sub={words ? `${words} word${words === 1 ? "" : "s"} · included in the report` : "Optional · EVA notes, goals, contingencies"} open={p.tab === "notes"} onToggle={onToggle}>
      <textarea className="notes" placeholder="EVA notes, science goals, contingencies…" value={p.notes} onChange={(e) => p.setNotes(e.target.value)} aria-label="Route notes" />
      <p className="fine muted">Notes are saved with the route and included in the mission report.</p>
    </Section>
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
