import { useMemo } from "react";
import { OBJECTIVE_META } from "../lib/compare";
import type { EvaPlan } from "../lib/eva";
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
import { TeamPlanner } from "./planner/TeamPlanner";
import { DogTip, Hint, Icon, KindBadge, Mascot, Term } from "./ui";

export type PlanStep = 1 | 2 | 3 | 4 | 5;
export type PlannerTab = "route" | "compare" | "safety" | "eva" | "notes";

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
  weather: WeatherSol[];
  missionId: string | null;
  setMissionId: (id: string | null) => void;
  onAddScience: (p: Poi, role: StopRole) => void;
  eva: EvaSettings;
  setEva: (s: EvaSettings) => void;
  evaPlan: EvaPlan | null;
  team: TeamProps;
}

const ROLE_LABEL: Record<StopRole, string> = { start: "Start", waypoint: "Waypoint", destination: "Destination" };
const STEPS: { n: PlanStep; label: string }[] = [
  { n: 1, label: "Start" },
  { n: 2, label: "Destination" },
  { n: 3, label: "Plan" },
  { n: 4, label: "Review" },
  { n: 5, label: "Save" },
];
const STEP_CAPTION: Record<PlanStep, string> = {
  1: "Choose where the walk begins",
  2: "Add a science destination (and optional waypoints)",
  3: "Generate the route with the terrain-aware planner",
  4: "Compare options, check safety, then save",
  5: "Saved! You can load it again from Files",
};
const TABS: { id: PlannerTab; label: string }[] = [
  { id: "route", label: "Route" },
  { id: "compare", label: "Compare" },
  { id: "safety", label: "Safety" },
  { id: "eva", label: "EVA" },
  { id: "notes", label: "Notes" },
];

export function PlannerPanel(p: Props) {
  const r = p.route;
  const solo = p.mode === "solo";
  const ordered = useMemo(() => {
    const s = p.stops.filter((x) => x.role === "start");
    const w = p.stops.filter((x) => x.role === "waypoint");
    const d = p.stops.filter((x) => x.role === "destination");
    return [...s, ...w, ...d];
  }, [p.stops]);
  const hasDest = p.stops.some((s) => s.role === "destination");
  const hasStart = p.stops.some((s) => s.role === "start");
  const near = r ? samplesNearRoute(p.pois, r.path_lonlat, 400) : [];
  const risk = r ? riskLevel(r) : null;
  const warnings = p.alerts.filter((a) => a.severity === "warning").length;
  const cautions = p.alerts.filter((a) => a.severity === "caution").length;
  const start = ordered.find((s) => s.role === "start") ?? null;
  const inItinerary = new Set(p.stops.map((s) => s.poiId).filter(Boolean) as string[]);

  return (
    <aside className={`panel right-panel planner ${p.sheetOpen ? "sheet-open" : ""}`} aria-label="Marswalk planner">
      <button className="sheet-handle" onClick={p.toggleSheet} aria-expanded={p.sheetOpen}>
        <span className="grip" />
        <em>{p.sheetOpen ? "Hide details" : "Show itinerary & details"}</em>
      </button>
      <header className="route-head">
        <span className="route-icon"><Icon name="walker" size={22} /></span>
        <div className="route-head-text">
          <input className="route-name" value={p.name} onChange={(e) => p.setName(e.target.value)} aria-label="Route name (editable)" title="Click to rename" />
          <div className="route-sub">{solo ? "Route Plan" : "Two-Astronaut Plan"} · Jezero Crater</div>
        </div>
      </header>

      <div className="mode-toggle" role="radiogroup" aria-label="Mission mode">
        <button role="radio" aria-checked={solo} className={solo ? "active" : ""} onClick={() => p.setMode("solo")}>
          <Icon name="walker" size={15} /> Solo Marswalk
        </button>
        <button role="radio" aria-checked={!solo} className={!solo ? "active" : ""} onClick={() => p.setMode("team")}>
          <Icon name="user" size={15} /> Two Astronauts
        </button>
      </div>

      {solo && (
        <div className="stepper-wrap">
          <ol className="stepper" aria-label="Planning progress">
            {STEPS.map((s) => (
              <li key={s.n} className={p.step > s.n || (p.step === 5 && s.n === 5) ? "done" : p.step === s.n ? "current" : ""} aria-current={p.step === s.n ? "step" : undefined}>
                <span className="num">{p.step > s.n || (p.step === 5 && s.n === 5) ? <Icon name="check" size={12} /> : s.n}</span>
                <span className="lbl">{s.label}</span>
              </li>
            ))}
          </ol>
          <p className="step-caption">
            <b>Step {p.step} of 5</b> · {STEP_CAPTION[p.step]}
          </p>
        </div>
      )}

      <div className="tabs tabs-5" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={p.tab === t.id} className={p.tab === t.id ? "active" : ""} onClick={() => p.setTab(t.id)}>
            {t.label}
            {t.id === "safety" && warnings > 0 && <span className="tab-badge" aria-label={`${warnings} warnings`}>{warnings}</span>}
          </button>
        ))}
      </div>

      <div className="panel-scroll">
        {p.tab === "route" && !solo && <TeamPlanner {...p.team} scienceMin={p.eva.scienceMinPerStop} />}

        {p.tab === "route" && solo && (
          <>
            {ordered.length > 0 && (
              <ol className="itinerary">
                {ordered.map((s, i) => (
                  <li key={s.id} className={`stop-${s.role}`}>
                    <span className="dot" />
                    {i < ordered.length - 1 && <span className="itin-rail" />}
                    <button className="itin-text" onClick={() => p.onFly(s.lon, s.lat)} title="Show on map">
                      <span className="itin-title">
                        <b>{ROLE_LABEL[s.role]}</b> — {s.name}
                      </span>
                      <span className="itin-sub">
                        {formatLat(s.lat, 3)}, {formatLon(s.lon, 3)}
                        {r && r.stop_indices[i] !== undefined && (
                          <>
                            {" · "}
                            {i === 0
                              ? `Elev. ${Math.round(r.profile.elevation_m[r.stop_indices[i]]).toLocaleString("en-US")} m`
                              : `+${(r.profile.distance_m[r.stop_indices[i]] / 1000).toFixed(2)} km`}
                          </>
                        )}
                      </span>
                    </button>
                    <button className="icon-btn x" aria-label={`Remove ${s.name}`} title="Remove stop" onClick={() => p.removeStop(s.id)}>
                      <Icon name="close" size={13} />
                    </button>
                  </li>
                ))}
              </ol>
            )}

            {p.step <= 3 && !p.routeError && (
              <div className="empty">
                <Mascot pose="sitting" size={60} />
                <p>
                  {!hasStart && <>Pick a starting point: press <b>+ Start</b> and click the map, or click a marker and choose <b>Set as start</b>.</>}
                  {hasStart && !hasDest && <>Now choose where to go: pick a <b>science mission</b> below for suggestions, or click a rock sample marker and choose <b>Set destination</b>.</>}
                  {hasStart && hasDest && !p.busy && <>Ready! Press <b>Plan Route</b> and the <Term k="astar">A* planner</Term> will compare three routes over real terrain.</>}
                  {hasStart && hasDest && p.busy && <>Sniffing out three routes…</>}
                </p>
              </div>
            )}

            <ScienceMissions
              missionId={p.missionId}
              setMissionId={p.setMissionId}
              pois={p.pois}
              from={start}
              onAdd={p.onAddScience}
              onFly={(poi) => p.onFly(poi.lon, poi.lat)}
              inItinerary={inItinerary}
              defaultOpen={hasStart && !hasDest}
            />

            {p.routeError && (
              <div className="notice error with-dog">
                <Mascot pose="sitting" size={48} />
                <div>
                  <b>{p.alerts[0]?.title ?? "Couldn't plan this route."}</b>
                  <p>{p.alerts[0]?.why}</p>
                  <p className="fine muted">Planner message: {p.routeError}</p>
                </div>
              </div>
            )}
            {!p.apiUp && (
              <div className="notice error">
                <b>Route engine offline.</b> The Python planner isn't responding. Start it with <code>python analysis/server.py</code> and try again.
              </div>
            )}

            {r && p.compare && (
              <section className="review" aria-label="Route review">
                <button className="selected-option" onClick={() => p.setTab("compare")}>
                  <i className="cmp-dot" style={{ background: OBJECTIVE_META[p.objective].color }} />
                  <span>
                    <b>{OBJECTIVE_META[p.objective].label}</b> route selected
                  </span>
                  <em>Compare 3 options <Icon name="chevron" size={13} /></em>
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

                <button className={`safety-summary ${warnings ? "has-warn" : cautions ? "has-caution" : ""}`} onClick={() => p.setTab("safety")}>
                  <SeverityIcon s={warnings ? "warning" : cautions ? "caution" : "info"} />
                  <span>
                    <b>{warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : cautions ? `${cautions} caution${cautions === 1 ? "" : "s"}` : "No warnings"}</b>
                    {warnings && cautions ? ` · ${cautions} caution${cautions === 1 ? "" : "s"}` : ""}
                    <em>{p.alerts.find((a) => a.severity !== "info")?.title ?? "Only informational notes"}</em>
                  </span>
                  <Icon name="chevron" size={14} />
                </button>

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

                <div className="profile-card">
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
                </div>
                <details className="disclosure">
                  <summary>All metrics & technical details</summary>
                  <Metrics r={r} />
                </details>
              </section>
            )}

            <div className="add-stops">
              <div className="mini-title">Add to itinerary <span className="muted">· then click the map</span></div>
              <div className="place-buttons">
                {(["start", "waypoint", "destination"] as StopRole[]).map((m) => (
                  <button key={m} className={`chip chip-${m} ${p.placeMode === m ? "active" : ""}`} aria-pressed={p.placeMode === m} onClick={() => p.setPlaceMode(p.placeMode === m ? null : m)}>
                    <Icon name="plus" size={13} /> {ROLE_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {p.tab === "route" && (
          <label className="slope-limit">
            <span>
              Max walkable <Term k="slope">slope</Term> <KindBadge kind="assumption" title="Planning assumption, not a NASA requirement" />
            </span>
            <b>{p.maxSlope}°</b>
            <input type="range" min={10} max={35} step={1} value={p.maxSlope} onChange={(e) => p.setMaxSlope(parseInt(e.target.value))} aria-label="Maximum walkable slope in degrees" />
            <span className="fine muted span2">Ground steeper than this is avoided completely{solo ? "" : " by both astronauts"}.</span>
          </label>
        )}

        {p.tab === "compare" &&
          (solo ? (
            <ComparePanel compare={p.compare} objective={p.objective} setObjective={p.setObjective} maxSlope={p.maxSlope} weather={p.weather} />
          ) : (
            <DogTip pose="sitting" title="Solo feature">Route comparison works on a Solo Marswalk. Both astronauts use the <b>{OBJECTIVE_META[p.objective].label}</b> objective.</DogTip>
          ))}

        {p.tab === "safety" && (
          <SafetyList
            alerts={p.alerts}
            onLocate={p.onLocateAlert}
            empty={solo ? "Plan a route and I'll list anything that deserves a second look: steep ground, long distances, big climbs and data limits." : "Plan both routes to see safety alerts for the team."}
          />
        )}

        {p.tab === "eva" &&
          (solo ? (
            <EvaPanel plan={p.evaPlan} settings={p.eva} setSettings={p.setEva} scienceStops={Math.max(0, p.stops.length - 1)} />
          ) : (
            <>
              <DogTip pose="sitting" compact title="Team EVA">In Two-Astronaut mode, the science time below is used at each astronaut's destination. Oxygen and power budgets apply to Solo plans in this prototype.</DogTip>
              <EvaPanel plan={null} settings={p.eva} setSettings={p.setEva} scienceStops={2} />
            </>
          ))}

        {p.tab === "notes" && (
          <>
            <textarea className="notes" placeholder="EVA notes, science goals, contingencies…" value={p.notes} onChange={(e) => p.setNotes(e.target.value)} aria-label="Route notes" />
            <p className="fine muted">Notes are saved with the route and included in the mission report.</p>
          </>
        )}
      </div>

      <div className="actions actions-3">
        {solo ? (
          <button className="btn btn-primary" disabled={p.busy || !hasStart || !hasDest || !p.apiUp} onClick={p.onPlan}>
            <Icon name="play" /> {p.busy ? "Planning…" : r ? "Re-plan" : "Plan Route"}
          </button>
        ) : (
          <button className="btn btn-primary" disabled={p.team.busy || !p.team.ready || !p.apiUp} onClick={p.team.onPlan}>
            <Icon name="play" /> {p.team.busy ? "Planning…" : "Plan Both"}
          </button>
        )}
        <Hint text={solo ? (hasStart && hasDest ? "Store this itinerary in this browser. Find it later under Files." : "Add a start and a destination first.") : "Saving stores the Solo itinerary."}>
          <button className="btn btn-secondary" disabled={!hasStart || !hasDest} onClick={p.onSave} aria-label="Save route">
            <Icon name={p.savedFlash ? "check" : "save"} /> <span className="btn-text">{p.savedFlash ? "Saved" : "Save"}</span>
          </button>
        </Hint>
        <Hint text="Export a PDF mission report of the plan currently shown.">
          <button className="btn btn-secondary" disabled={p.exporting || (solo ? !r : !p.team.summary)} onClick={p.onExport} aria-label="Export mission report as PDF">
            <Icon name="files" /> <span className="btn-text">{p.exporting ? "…" : "Report"}</span>
          </button>
        </Hint>
      </div>
    </aside>
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
