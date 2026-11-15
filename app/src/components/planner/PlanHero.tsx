import { useMemo } from "react";
import { formatDistance } from "../../lib/mars";
import { MISSIONS, recommend } from "../../lib/science";
import type { MissionMode, Poi, TeamSlot } from "../../types";
import { Icon, KindBadge } from "../ui";

/** The four science choices map onto the existing MISSIONS in lib/science.ts (no new science). */
export const GOAL_CARDS: { id: string; label: string; sub: string; icon: string }[] = [
  { id: "water", label: "Ancient Water", sub: "Delta and lake-edge rocks", icon: "drop" },
  { id: "sedimentary", label: "Rock Layers", sub: "Rocks built from deposited grains", icon: "layers" },
  { id: "igneous", label: "Mineral Clues", sub: "Volcanic rocks that can be dated", icon: "crystal" },
  { id: "history", label: "Explore Freely", sub: "A tour across rock units, or any spot", icon: "explore" },
];

export function PlanHero({
  missionId,
  setMissionId,
  pois,
  from,
  mode,
  inItinerary,
  onSetDestination,
  onAddWaypoint,
  onTeamSlot,
  onShow,
}: {
  missionId: string | null;
  setMissionId: (id: string | null) => void;
  pois: Poi[];
  from: { lon: number; lat: number } | null;
  mode: MissionMode;
  inItinerary: Set<string>;
  onSetDestination: (p: Poi) => void;
  onAddWaypoint: (p: Poi) => void;
  onTeamSlot: (p: Poi, slot: TeamSlot) => void;
  onShow: (p: Poi) => void;
}) {
  const mission = MISSIONS.find((m) => m.id === missionId) ?? null;
  const recs = useMemo(() => (missionId ? recommend(missionId, pois, from, 4) : []), [missionId, pois, from]);
  return (
    <section className="pp-hero" aria-labelledby="pp-title">
      <div className="pp-hero-text">
        <h1 id="pp-title">Plan Your <em>Mars Mission</em></h1>
        <p>Choose a science goal, pick a destination on the map, and get the best route.</p>
      </div>
      <div className="pp-goals" role="radiogroup" aria-label="Science goal">
        {GOAL_CARDS.map((g) => {
          const on = missionId === g.id;
          return (
            <button key={g.id} role="radio" aria-checked={on} className={`pp-goal ${on ? "on" : ""} goal-${g.id}`} onClick={() => setMissionId(on ? null : g.id)}>
              <Icon name={g.icon} size={24} />
              <span>
                <b>{g.label}</b>
                <em>{g.sub}</em>
              </span>
              {on && <i className="pp-goal-check"><Icon name="check" size={13} /></i>}
            </button>
          );
        })}
      </div>

      {mission && (
        <div className="pp-suggest" aria-label="Suggested destinations">
          <div className="pp-suggest-head">
            <b>Suggested NASA sample sites</b>
            <span>{mission.title}{from ? " · nearest to your start first" : ""}</span>
            <KindBadge kind="real" title="Sites come from NASA's Perseverance sample table. Positions are estimated from rover localization." />
          </div>
          {recs.length === 0 ? (
            <p className="fine muted">No matching NASA sample sites lie inside this prototype area.</p>
          ) : (
            <ul className="pp-recs">
              {recs.map((r) => {
                const added = inItinerary.has(r.poi.id);
                return (
                  <li key={r.poi.id} className="pp-rec" title={r.why}>
                    <button className="pp-rec-name" onClick={() => onShow(r.poi)} title="Show on map">
                      <span className="pp-rec-pin"><Icon name="pin" size={15} /></span>
                      <span>
                        <b>#{r.poi.number} {r.poi.name}</b>
                        <em>{r.poi.campaign}{from ? ` · ${formatDistance(r.distance_m)} away` : ""}</em>
                      </span>
                    </button>
                    <div className="pp-rec-actions">
                      {mode === "team" ? (
                        <>
                          <button className="btn-mini teal" onClick={() => onTeamSlot(r.poi, "aDest")}>A destination</button>
                          <button className="btn-mini lav" onClick={() => onTeamSlot(r.poi, "bDest")}>B destination</button>
                        </>
                      ) : added ? (
                        <span className="added"><Icon name="check" size={13} /> In your route</span>
                      ) : (
                        <>
                          <button className="btn-mini rose" onClick={() => onSetDestination(r.poi)}>Set destination</button>
                          <button className="btn-mini lav" onClick={() => onAddWaypoint(r.poi)}>Add waypoint</button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="pp-fine">Picked only from NASA's sample table (rock type and campaign), sorted by straight-line distance. Not a mineral detection.</p>
        </div>
      )}
    </section>
  );
}
