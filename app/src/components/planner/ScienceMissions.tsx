import { useMemo } from "react";
import { formatDistance } from "../../lib/mars";
import { MISSIONS, recommend } from "../../lib/science";
import type { Poi, StopRole } from "../../types";
import { Icon, KindBadge } from "../ui";

const MISSION_ICON: Record<string, string> = { water: "cloud", sedimentary: "layers", igneous: "mountain", history: "explore" };

export function ScienceMissions({
  missionId,
  setMissionId,
  pois,
  from,
  onAdd,
  onFly,
  inItinerary,
  defaultOpen,
}: {
  missionId: string | null;
  setMissionId: (id: string | null) => void;
  pois: Poi[];
  from: { lon: number; lat: number } | null;
  onAdd: (p: Poi, role: StopRole) => void;
  onFly: (p: Poi) => void;
  inItinerary: Set<string>;
  defaultOpen: boolean;
}) {
  const mission = MISSIONS.find((m) => m.id === missionId) ?? null;
  const recs = useMemo(() => (missionId ? recommend(missionId, pois, from, 4) : []), [missionId, pois, from]);
  return (
    <details className="card science-missions" open={defaultOpen || undefined}>
      <summary>
        <Icon name="sparkle" size={16} /> Choose Your Science Mission
        {mission && <span className="chosen">· {mission.title}</span>}
      </summary>
      <p className="fine">Pick a goal and I'll suggest NASA sample sites in this area that fit it.</p>
      <div className="mission-grid" role="radiogroup" aria-label="Science objective">
        {MISSIONS.map((m) => (
          <button key={m.id} role="radio" aria-checked={missionId === m.id} className={`mission ${missionId === m.id ? "selected" : ""}`} onClick={() => setMissionId(missionId === m.id ? null : m.id)}>
            <Icon name={MISSION_ICON[m.id]} size={17} />
            <b>{m.title}</b>
            <span>{m.short}</span>
          </button>
        ))}
      </div>

      {mission && (
        <div className="mission-detail">
          <p className="fine"><b>Why here?</b> {mission.intro}</p>
          <p className="fine"><b>What scientists want to learn:</b> {mission.learn}</p>
          {recs.length === 0 ? (
            <p className="fine muted">No matching NASA sample sites lie inside this prototype area.</p>
          ) : (
            <ol className="recs">
              {recs.map((r) => {
                const added = inItinerary.has(r.poi.id);
                return (
                  <li key={r.poi.id} className="rec">
                    <div className="rec-head">
                      <button className="rec-name" onClick={() => onFly(r.poi)} title="Show on map">
                        #{r.poi.number} {r.poi.name}
                      </button>
                      <span className="rec-dist" title="Straight-line distance on the Mars sphere from your start">
                        {from ? `${formatDistance(r.distance_m)} away` : ""}
                      </span>
                    </div>
                    <p className="fine">{r.why}</p>
                    <details className="alert-src">
                      <summary>Data & uncertainty</summary>
                      <p>{r.data} <KindBadge kind="real" /></p>
                      <p>{r.uncertainty} <KindBadge kind="estimated" /></p>
                    </details>
                    <div className="rec-actions">
                      {added ? (
                        <span className="added"><Icon name="check" size={13} /> In your Marswalk</span>
                      ) : (
                        <>
                          <button className="btn-mini rose" onClick={() => onAdd(r.poi, "destination")}>Set destination</button>
                          <button className="btn-mini lav" onClick={() => onAdd(r.poi, "waypoint")}>Add waypoint</button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="fine muted">
            Suggestions use only NASA's sample table (rock type, campaign, sol) and are sorted by straight-line distance. PAWPRINT
            does not detect minerals.
          </p>
        </div>
      )}
    </details>
  );
}
