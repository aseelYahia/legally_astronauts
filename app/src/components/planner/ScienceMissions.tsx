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
}: {
  missionId: string | null;
  setMissionId: (id: string | null) => void;
  pois: Poi[];
  from: { lon: number; lat: number } | null;
  onAdd: (p: Poi, role: StopRole) => void;
  onFly: (p: Poi) => void;
  inItinerary: Set<string>;
}) {
  const mission = MISSIONS.find((m) => m.id === missionId) ?? null;
  const recs = useMemo(() => (missionId ? recommend(missionId, pois, from, 4) : []), [missionId, pois, from]);
  return (
    <section className="science-missions" aria-labelledby="sci-mission-title">
      <h4 className="pl-section-title" id="sci-mission-title">
        <Icon name="sparkle" size={15} /> Need ideas? Choose a science mission
      </h4>
      <div className="mission-grid" role="radiogroup" aria-label="Science objective">
        {MISSIONS.map((m) => (
          <button key={m.id} role="radio" aria-checked={missionId === m.id} className={`mission ${missionId === m.id ? "selected" : ""}`} onClick={() => setMissionId(missionId === m.id ? null : m.id)}>
            <Icon name={MISSION_ICON[m.id]} size={16} />
            <b>{m.title}</b>
            <span>{m.short}</span>
          </button>
        ))}
      </div>

      {mission && (
        <div className="mission-detail">
          <details className="why">
            <summary>About this mission</summary>
            <p className="fine"><b>Why here?</b> {mission.intro}</p>
            <p className="fine"><b>What scientists want to learn:</b> {mission.learn}</p>
          </details>
          {recs.length === 0 ? (
            <p className="fine muted">No matching NASA sample sites lie inside this prototype area.</p>
          ) : (
            <ol className="recs" aria-label="Suggested destinations">
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
                    <details className="why">
                      <summary>Why this location?</summary>
                      <p className="fine">{r.why}</p>
                      <p className="fine">{r.data} <KindBadge kind="real" /></p>
                      <p className="fine">{r.uncertainty} <KindBadge kind="estimated" /></p>
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
            Suggestions use only NASA's sample table (rock type, campaign, sol), sorted by straight-line distance. PAWPRINT does not
            identify minerals; CRISM indicators are a separate map layer.
          </p>
        </div>
      )}
    </section>
  );
}
