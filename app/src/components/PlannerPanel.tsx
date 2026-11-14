import { useMemo, useState } from "react";
import { formatDistance, formatDuration, formatLat, formatLon } from "../lib/mars";
import { countSteepSegments, profileSlopes, riskLevel } from "../lib/routeAnalysis";
import type { RouteResult, Stop, StopRole } from "../types";
import { ElevationProfile } from "./ElevationProfile";
import type { PlaceMode } from "./MapView";
import { Icon, KindBadge, Mascot } from "./ui";

interface Props {
  name: string;
  setName: (s: string) => void;
  stops: Stop[];
  removeStop: (id: string) => void;
  placeMode: PlaceMode;
  setPlaceMode: (m: PlaceMode) => void;
  maxSlope: number;
  setMaxSlope: (v: number) => void;
  route: RouteResult | null;
  routeError: string | null;
  busy: boolean;
  apiUp: boolean;
  notes: string;
  setNotes: (s: string) => void;
  onAnalyze: () => void;
  onSave: () => void;
  onHover: (i: number | null) => void;
  savedFlash: boolean;
}

const ROLE_LABEL: Record<StopRole, string> = { start: "Start", waypoint: "Waypoint", destination: "Sample" };

export function PlannerPanel(p: Props) {
  const [tab, setTab] = useState<"itinerary" | "metrics" | "notes">("itinerary");
  const r = p.route;
  const ordered = useMemo(() => {
    const s = p.stops.filter((x) => x.role === "start");
    const w = p.stops.filter((x) => x.role === "waypoint");
    const d = p.stops.filter((x) => x.role === "destination");
    return [...s, ...w, ...d];
  }, [p.stops]);
  const hasDest = p.stops.some((s) => s.role === "destination");
  const hasStart = p.stops.some((s) => s.role === "start");

  return (
    <aside className="panel right-panel">
      <header className="route-head">
        <span className="route-icon"><Icon name="walker" size={22} /></span>
        <div>
          <input className="route-name" value={p.name} onChange={(e) => p.setName(e.target.value)} aria-label="Route name" />
          <div className="route-sub">Route Plan · Jezero Crater</div>
        </div>
      </header>

      <div className="tabs" role="tablist">
        {(["itinerary", "metrics", "notes"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "itinerary" && (
        <>
          <div className="itin-row">
            <ol className="itinerary">
              {ordered.map((s, i) => (
                <li key={s.id} className={`stop-${s.role}`}>
                  <span className="dot" />
                  {i < ordered.length - 1 && <span className="rail" />}
                  <div className="itin-text">
                    <div className="itin-title">
                      <b>{ROLE_LABEL[s.role]}</b> — {s.name}
                    </div>
                    <div className="itin-sub">
                      {formatLat(s.lat, 3)}, {formatLon(s.lon, 3)}
                      {r && r.stop_indices[i] !== undefined && (
                        <> | {i === 0 ? `Elev. ${Math.round(r.profile.elevation_m[r.stop_indices[i]]).toLocaleString("en-US")} m` : `+${(r.profile.distance_m[r.stop_indices[i]] / 1000).toFixed(1)} km`}</>
                      )}
                    </div>
                  </div>
                  <button className="icon-btn x" aria-label={`Remove ${s.name}`} onClick={() => p.removeStop(s.id)}>
                    <Icon name="close" size={13} />
                  </button>
                </li>
              ))}
            </ol>
            {r && (
              <div className="mini-metrics">
                <div><Icon name="route" size={16} /><span>Distance</span><b>{formatDistance(r.distance_m)}</b></div>
                <div><Icon name="terrain" size={16} /><span>Elevation gain</span><b>+{Math.round(r.elevation_gain_m)} m</b></div>
                <div><Icon name="warn" size={16} /><span>Max slope</span><b>{r.max_slope_deg.toFixed(1)}°</b></div>
              </div>
            )}
          </div>

          {!hasDest && (
            <div className="empty">
              <Mascot pose="sitting" size={64} />
              <p>
                {hasStart ? "Pick a scientific destination: click a sample marker and choose " : "Set a start point, then pick a destination. Tip: click a sample marker and choose "}
                <b>Destination</b>, or use the buttons below and click the map.
              </p>
            </div>
          )}

          <div className="place-buttons">
            {(["start", "waypoint", "destination"] as StopRole[]).map((m) => (
              <button key={m} className={`chip chip-${m} ${p.placeMode === m ? "active" : ""}`} onClick={() => p.setPlaceMode(p.placeMode === m ? null : m)}>
                <Icon name="plus" size={13} /> {m === "destination" ? "Destination" : m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <label className="slope-limit">
            <span>Max walkable slope <KindBadge kind="assumption" title="Planning assumption, not a NASA requirement" /></span>
            <b>{p.maxSlope}°</b>
            <input type="range" min={10} max={35} step={1} value={p.maxSlope} onChange={(e) => p.setMaxSlope(parseInt(e.target.value))} />
          </label>

          {r && (
            <div className="profile-card">
              <div className="card-title">
                Elevation Profile (Route) <KindBadge kind="real-derived" />
              </div>
              <ElevationProfile
                distance={r.profile.distance_m}
                elevation={r.profile.elevation_m}
                stopIndices={r.stop_indices}
                stopLabels={ordered.map((s, i) => (i === 0 ? "Start" : s.role === "destination" ? s.name.split(" ")[0] : String.fromCharCode(64 + i)))}
                onHover={p.onHover}
              />
            </div>
          )}
        </>
      )}

      {tab === "metrics" && (r ? <Metrics r={r} /> : <Empty text="Analyze a route to see distance, elevation, slope and difficulty metrics." />)}

      {tab === "notes" && (
        <textarea className="notes" placeholder="EVA notes, science goals, contingencies…" value={p.notes} onChange={(e) => p.setNotes(e.target.value)} />
      )}

      {p.routeError && <div className="error">{p.routeError}</div>}
      {!p.apiUp && <div className="error">Python route engine offline. Start it with <code>python analysis/server.py</code>.</div>}

      <div className="actions">
        <button className="btn btn-outline" disabled={p.busy || !hasStart || !hasDest || !p.apiUp} onClick={p.onAnalyze}>
          <Icon name="bars" /> {p.busy ? "Analyzing…" : "Analyze Route"}
        </button>
        <button className="btn btn-solid" disabled={!hasStart || !hasDest} onClick={p.onSave}>
          <Icon name="save" /> {p.savedFlash ? "Saved!" : "Save Route"}
        </button>
      </div>
    </aside>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="empty tall">
      <Mascot pose="sitting" size={84} />
      <p>{text}</p>
    </div>
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
        <M label="3D distance" value={formatDistance(r.distance_m)} kind="real-derived" />
        <M label="Map distance" value={formatDistance(r.horizontal_distance_m)} kind="real-derived" />
        <M label="Elevation gain" value={`+${Math.round(r.elevation_gain_m)} m`} kind="real-derived" />
        <M label="Elevation loss" value={`−${Math.round(r.elevation_loss_m)} m`} kind="real-derived" />
        <M label="Max terrain slope" value={`${r.max_slope_deg.toFixed(1)}°`} kind="real-derived" />
        <M label="Mean terrain slope" value={`${r.mean_slope_deg.toFixed(1)}°`} kind="real-derived" />
        <M label="Est. EVA walk time" value={formatDuration(r.est_time_s)} kind="estimate" />
        <M label="Difficulty" value={`${r.difficulty.label} · ${r.difficulty.score}`} kind="estimate" />
      </div>
      <div className="card-title">Slope classes along route</div>
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
        Risk <b className={`risk-${risk}`}>{risk}</b> · {steep} stretch{steep === 1 ? "" : "es"} with along-track grade ≥15° · terrain grid{" "}
        <b>{r.grid.name.toUpperCase()} {r.grid.resolution_m} m</b> · A* in {r.compute_ms} ms
      </p>
      <p className="fine muted">{r.model.note}</p>
    </div>
  );
}

function M({ label, value, kind }: { label: string; value: string; kind: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <b>{value}</b>
      <KindBadge kind={kind} />
    </div>
  );
}
