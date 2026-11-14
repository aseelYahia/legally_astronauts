import { fmtMin } from "../../lib/eva";
import { formatDistance, formatLat, formatLon } from "../../lib/mars";
import type { TeamSummary } from "../../lib/team";
import type { RouteResult, Stop, TeamSlot } from "../../types";
import { DogTip, Icon, KindBadge } from "../ui";

export const TEAM_SLOTS: { slot: TeamSlot; label: string; who: "A" | "B" | "meet" }[] = [
  { slot: "aStart", label: "A · Start", who: "A" },
  { slot: "aDest", label: "A · Destination", who: "A" },
  { slot: "bStart", label: "B · Start", who: "B" },
  { slot: "bDest", label: "B · Destination", who: "B" },
  { slot: "meet", label: "Rendezvous", who: "meet" },
];

export const TEAM_COLORS = { A: "#76C9C2", B: "#A99BDD", meet: "#D98EBA" };

export function TeamPlanner({
  stops,
  place,
  setPlace,
  clear,
  routes,
  errors,
  summary,
  scienceMin,
}: {
  stops: Partial<Record<TeamSlot, Stop>>;
  place: TeamSlot | null;
  setPlace: (s: TeamSlot | null) => void;
  clear: (s: TeamSlot) => void;
  routes: { A?: RouteResult; B?: RouteResult };
  errors: { A?: string; B?: string };
  summary: TeamSummary | null;
  scienceMin: number;
}) {
  const missing = TEAM_SLOTS.filter((s) => !stops[s.slot]);
  return (
    <div className="team">
      <p className="fine">
        Each astronaut walks <b>start → own destination → shared rendezvous</b>. Routes use the same terrain-aware A* planner and
        your slope limit.
      </p>
      <ul className="team-slots">
        {TEAM_SLOTS.map((s) => {
          const st = stops[s.slot];
          return (
            <li key={s.slot} className={`team-slot who-${s.who}`}>
              <span className="dot" />
              <div className="slot-text">
                <b>{s.label}</b>
                <span>{st ? `${st.name} · ${formatLat(st.lat, 3)}, ${formatLon(st.lon, 3)}` : "Not set"}</span>
              </div>
              <button className={`chip chip-team ${place === s.slot ? "active" : ""}`} aria-pressed={place === s.slot} onClick={() => setPlace(place === s.slot ? null : s.slot)}>
                <Icon name="pin" size={13} /> {st ? "Move" : "Place"}
              </button>
              {st && (
                <button className="icon-btn" aria-label={`Clear ${s.label}`} onClick={() => clear(s.slot)}>
                  <Icon name="close" size={13} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="fine muted">Tip: click a slot's Place button, then click the map, or open a sample marker and pick a slot.</p>

      {missing.length > 0 && !summary && (
        <DogTip pose="sitting" compact title="Almost there">
          Still needed: {missing.map((m) => m.label).join(", ")}. Then press <b>Plan Both Routes</b>.
        </DogTip>
      )}

      {(errors.A || errors.B) && (
        <div className="notice error">
          {errors.A && <p><b>Astronaut A:</b> {errors.A}</p>}
          {errors.B && <p><b>Astronaut B:</b> {errors.B}</p>}
          <p className="fine">The rendezvous cannot be reached by both under these constraints. Try raising the slope limit or moving the meeting point.</p>
        </div>
      )}

      {summary && routes.A && routes.B && (
        <section className="team-results">
          <div className="team-stats">
            {(["A", "B"] as const).map((w) => {
              const r = routes[w]!;
              return (
                <div key={w} className={`team-card who-${w}`}>
                  <b>Astronaut {w}</b>
                  <span>{formatDistance(r.distance_m)} · +{Math.round(r.elevation_gain_m)} m · max {r.max_slope_deg.toFixed(1)}°</span>
                  <span>Arrives at rendezvous ≈ T+{fmtMin(summary[w === "A" ? "a" : "b"].arriveMeetMin)}</span>
                </div>
              );
            })}
            <div className="team-card who-meet">
              <b>Combined</b>
              <span>{formatDistance(summary.totalDistance_m)} walked · +{Math.round(summary.totalGain_m)} m · max {summary.maxSlope.toFixed(1)}°</span>
              <span>
                {summary.firstToArrive === "together" ? "Both arrive at about the same time" : `Astronaut ${summary.firstToArrive} waits ≈ ${fmtMin(summary.waitMin)}`}
              </span>
            </div>
          </div>
          <Timeline summary={summary} scienceMin={scienceMin} />
          <p className="fine muted">
            Times are <KindBadge kind="estimate" />: Tobler walking time plus {scienceMin} min of science at each destination (set under EVA).
            They are not validated astronaut timings.
          </p>
        </section>
      )}
    </div>
  );
}

function Timeline({ summary, scienceMin }: { summary: TeamSummary; scienceMin: number }) {
  const end = Math.max(summary.a.arriveMeetMin, summary.b.arriveMeetMin, 1);
  const W = 300;
  const x = (m: number) => 34 + (m / end) * (W - 44);
  const row = (y: number, leg: TeamSummary["a"], color: string, label: string) => (
    <g>
      <text x="0" y={y + 9} className="tl-label">{label}</text>
      <rect x={x(0)} y={y} width={x(leg.arriveDestMin) - x(0)} height="12" rx="3" fill={color} opacity="0.9" />
      {scienceMin > 0 && <rect x={x(leg.arriveDestMin)} y={y} width={x(leg.departDestMin) - x(leg.arriveDestMin)} height="12" rx="3" fill="#E6C79C" />}
      <rect x={x(leg.departDestMin)} y={y} width={x(leg.arriveMeetMin) - x(leg.departDestMin)} height="12" rx="3" fill={color} opacity="0.55" />
    </g>
  );
  return (
    <svg className="timeline" viewBox={`0 0 ${W} 74`} role="img" aria-label="Estimated arrival timeline for both astronauts">
      {row(6, summary.a, TEAM_COLORS.A, "A")}
      {row(28, summary.b, TEAM_COLORS.B, "B")}
      <line x1={x(summary.meetMin)} x2={x(summary.meetMin)} y1="2" y2="46" stroke={TEAM_COLORS.meet} strokeWidth="2" strokeDasharray="3 2" />
      <text x={Math.min(x(summary.meetMin), W - 70)} y="60" className="tl-meet">Meet ≈ T+{fmtMin(summary.meetMin)}</text>
      <text x={x(0)} y="72" className="tl-axis">T+0</text>
      <text x={W - 4} y="72" textAnchor="end" className="tl-axis">walk · science · walk to rendezvous</text>
    </svg>
  );
}
