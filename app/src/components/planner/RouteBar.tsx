import { OBJECTIVE_META, OBJECTIVE_ORDER } from "../../lib/compare";
import { fmtMin } from "../../lib/eva";
import { formatDistance } from "../../lib/mars";
import type { TeamSummary } from "../../lib/team";
import type { CompareResult, MissionMode, Objective, RouteResult, Stop, TeamSlot } from "../../types";
import { Hint, Icon, KindBadge, Mascot } from "../ui";
import { TEAM_COLORS, TEAM_SLOTS } from "./TeamPlanner";

const OBJ_ICON: Record<Objective, string> = { fastest: "bolt", shortest: "distance", lower_risk: "shield" };
const ROLE_LABEL = { start: "Start", waypoint: "Waypoint", destination: "Destination" } as const;

/**
 * Route options under the map: the itinerary (easy to change or remove), one obvious
 * Generate Route button, the three route cards once planned, and Start Expedition.
 * All numbers come straight from the planner's RouteResult objects.
 */
export function RouteBar(p: {
  mode: MissionMode;
  setMode: (m: MissionMode) => void;
  stops: Stop[];
  removeStop: (id: string) => void;
  onFlyStop: (s: { lon: number; lat: number }) => void;
  compare: CompareResult | null;
  objective: Objective;
  setObjective: (o: Objective) => void;
  pace: number;
  busy: boolean;
  apiUp: boolean;
  onPlan: () => void;
  routeError: string | null;
  team: {
    stops: Partial<Record<TeamSlot, Stop>>;
    clear: (s: TeamSlot) => void;
    routes: { A?: RouteResult; B?: RouteResult };
    summary: TeamSummary | null;
    ready: boolean;
    busy: boolean;
    onPlan: () => void;
  };
  canStart: boolean;
  onStartExpedition: () => void;
}) {
  const solo = p.mode === "solo";
  const ordered = [...p.stops.filter((s) => s.role === "start"), ...p.stops.filter((s) => s.role === "waypoint"), ...p.stops.filter((s) => s.role === "destination")];
  const start = ordered.find((s) => s.role === "start");
  const dest = ordered.find((s) => s.role === "destination");
  const ready = solo ? !!start && !!dest : p.team.ready;
  const busy = solo ? p.busy : p.team.busy;
  const planned = solo ? !!p.compare : !!p.team.summary;
  const why = !p.apiUp
    ? "The route engine is offline. Start analysis/server.py."
    : !ready
      ? solo
        ? !start
          ? "Click the map and choose Set Start."
          : "Click the map or a sample and choose Set Destination."
        : "Place both starts, both destinations and the rendezvous on the map."
      : null;

  return (
    <section className="pp-route panel" aria-labelledby="pp-route-title">
      <div className="pp-route-head">
        <span className="pp-route-icon"><Icon name="route" size={26} /></span>
        <div className="pp-route-title">
          <h2 id="pp-route-title">Route Options</h2>
          <p>{solo ? (start && dest ? <>From <b>{start.name}</b> to <b>{dest.name}</b></> : "Set a start and a destination on the map") : "Two astronauts, one shared rendezvous"}</p>
        </div>
        <div className="pp-mode" role="radiogroup" aria-label="Mission mode">
          <button role="radio" aria-checked={solo} className={solo ? "on" : ""} onClick={() => p.setMode("solo")}><Icon name="walker" size={15} /> Solo</button>
          <button role="radio" aria-checked={!solo} className={!solo ? "on" : ""} onClick={() => p.setMode("team")}><Icon name="user" size={15} /> Two Astronauts</button>
        </div>
      </div>

      {/* Itinerary: every chosen point, removable. */}
      <ul className="pp-stops" aria-label={solo ? "Your stops" : "Team points"}>
        {solo
          ? ordered.map((s, i) => (
              <li key={s.id} className={`pp-stop role-${s.role}`}>
                <button className="pp-stop-main" onClick={() => p.onFlyStop(s)} title="Show on map">
                  <i>{i + 1}</i>
                  <span><em>{ROLE_LABEL[s.role]}</em><b>{s.name}</b></span>
                </button>
                <button className="pp-stop-x" onClick={() => p.removeStop(s.id)} aria-label={`Remove ${s.name}`} title="Remove"><Icon name="close" size={13} /></button>
              </li>
            ))
          : TEAM_SLOTS.map((t) => {
              const st = p.team.stops[t.slot];
              return (
                <li key={t.slot} className={`pp-stop who-${t.who} ${st ? "" : "empty"}`}>
                  <button className="pp-stop-main" onClick={() => st && p.onFlyStop(st)} disabled={!st} title={st ? "Show on map" : "Click the map to place it"}>
                    <i style={{ background: TEAM_COLORS[t.who] }} />
                    <span><em>{t.label}</em><b>{st ? st.name : "Not placed"}</b></span>
                  </button>
                  {st && <button className="pp-stop-x" onClick={() => p.team.clear(t.slot)} aria-label={`Clear ${t.label}`} title="Clear"><Icon name="close" size={13} /></button>}
                </li>
              );
            })}
        {solo && ordered.length === 0 && <li className="pp-stop empty"><span className="pp-stop-main"><span><em>No stops yet</em><b>Click the map to begin</b></span></span></li>}
      </ul>

      <div className="pp-route-body">
        {busy ? (
          <div className="pp-busy" role="status"><Mascot pose="floating" size={48} className="bob" /> Sniffing out the safest-looking paths over real terrain…</div>
        ) : !planned ? (
          <div className="pp-generate">
            <button className="btn btn-primary pp-generate-btn" disabled={!ready || !p.apiUp} onClick={solo ? p.onPlan : p.team.onPlan}>
              <Icon name="play" /> {solo ? "Generate Route" : "Generate Both Routes"}
            </button>
            <p className={`pp-why ${solo && p.routeError ? "err" : ""}`} role="status">
              {solo && p.routeError ? `No route found: ${p.routeError}` : why ?? (solo ? "Compares the fastest, shortest and lower-risk paths over NASA terrain." : "Plans a route for each astronaut to the rendezvous.")}
            </p>
          </div>
        ) : solo && p.compare ? (
          <div className="pp-cards" role="radiogroup" aria-label="Route option">
            {OBJECTIVE_ORDER.map((o) => {
              const r = p.compare!.routes[o];
              const on = o === p.objective;
              const meta = OBJECTIVE_META[o];
              return (
                <button key={o} role="radio" aria-checked={on} className={`pp-card ${on ? "on" : ""}`} style={{ ["--c" as string]: meta.color }} onClick={() => p.setObjective(o)} title={meta.goal}>
                  <span className="pp-card-icon"><Icon name={OBJ_ICON[o]} size={20} /></span>
                  <span className="pp-card-text">
                    <b>{meta.label}</b>
                    <em>~{formatDistance(r.distance_m)} · {fmtMin((r.walk_time_s / 60) * p.pace)}</em>
                    <small>max slope {r.max_slope_deg.toFixed(1)}° · +{Math.round(r.elevation_gain_m)} m</small>
                  </span>
                  {on && <i className="pp-card-check"><Icon name="check" size={13} /></i>}
                </button>
              );
            })}
          </div>
        ) : p.team.summary ? (
          <div className="pp-cards team">
            {(["A", "B"] as const).map((w) => {
              const r = p.team.routes[w];
              const leg = w === "A" ? p.team.summary!.a : p.team.summary!.b;
              return r ? (
                <div key={w} className="pp-card on static" style={{ ["--c" as string]: TEAM_COLORS[w] }}>
                  <span className="pp-card-icon"><Icon name="walker" size={20} /></span>
                  <span className="pp-card-text">
                    <b>Astronaut {w}</b>
                    <em>~{formatDistance(r.distance_m)} · arrives {fmtMin(leg.arriveMeetMin)}</em>
                    <small>max slope {r.max_slope_deg.toFixed(1)}° · +{Math.round(r.elevation_gain_m)} m</small>
                  </span>
                </div>
              ) : null;
            })}
          </div>
        ) : null}

        <div className="pp-start">
          <Hint text={p.canStart ? "Open the Expedition Log to track this Marswalk." : "Generate a route first."}>
            <button className="btn btn-primary pp-start-btn" disabled={!p.canStart} onClick={p.onStartExpedition}>
              <Mascot pose="standing" size={30} /> Start Expedition <Icon name="chevron" size={16} />
            </button>
          </Hint>
          {planned && <span className="pp-start-note">Times: Tobler walking estimate <KindBadge kind="estimate" /></span>}
        </div>
      </div>
    </section>
  );
}
