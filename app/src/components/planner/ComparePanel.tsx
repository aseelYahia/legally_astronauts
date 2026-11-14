import { OBJECTIVE_META, OBJECTIVE_ORDER, explainComparison } from "../../lib/compare";
import { formatDistance, formatDuration } from "../../lib/mars";
import { routeAlerts } from "../../lib/safety";
import type { CompareResult, Objective, WeatherSol } from "../../types";
import { DogTip, Icon, KindBadge, Term } from "../ui";

export function ComparePanel({
  compare,
  objective,
  setObjective,
  maxSlope,
  weather,
}: {
  compare: CompareResult | null;
  objective: Objective;
  setObjective: (o: Objective) => void;
  maxSlope: number;
  weather: WeatherSol[];
}) {
  if (!compare) {
    return (
      <DogTip pose="sitting" title="Compare three routes">
        Add a start and a destination, then press <b>Plan Route</b>. I'll plan three genuinely different options: Fastest,
        Shortest and Lower Risk.
      </DogTip>
    );
  }
  const r = compare.routes;
  const best = {
    distance: Math.min(...OBJECTIVE_ORDER.map((o) => r[o].distance_m)),
    time: Math.min(...OBJECTIVE_ORDER.map((o) => r[o].walk_time_s)),
    slope: Math.min(...OBJECTIVE_ORDER.map((o) => r[o].max_slope_deg)),
    gain: Math.min(...OBJECTIVE_ORDER.map((o) => r[o].elevation_gain_m)),
  };
  const warnCount = (o: Objective) => routeAlerts(r[o], maxSlope, weather).filter((a) => a.severity === "warning").length;
  const notes = explainComparison(compare);
  const rows: { label: React.ReactNode; get: (o: Objective) => string; best?: (o: Objective) => boolean; kind: string }[] = [
    { label: "Distance", get: (o) => formatDistance(r[o].distance_m), best: (o) => r[o].distance_m <= best.distance + 0.5, kind: "real-derived" },
    { label: "Elevation gain", get: (o) => `+${Math.round(r[o].elevation_gain_m)} m`, best: (o) => r[o].elevation_gain_m <= best.gain + 0.5, kind: "real-derived" },
    { label: <Term k="slope">Max slope</Term>, get: (o) => `${r[o].max_slope_deg.toFixed(1)}°`, best: (o) => r[o].max_slope_deg <= best.slope + 0.05, kind: "real-derived" },
    { label: <Term k="walktime">Walk time</Term>, get: (o) => formatDuration(r[o].walk_time_s), best: (o) => r[o].walk_time_s <= best.time + 1, kind: "estimate" },
    { label: <Term k="difficulty">Difficulty</Term>, get: (o) => `${r[o].difficulty.label} ${Math.round(r[o].difficulty.score)}`, kind: "estimate" },
    { label: "Warnings", get: (o) => { const n = warnCount(o); return n ? `⚠ ${n}` : "None"; }, kind: "real-derived" },
  ];

  return (
    <div className="compare">
      <p className="fine">Pick the option that fits your mission. The selected route is used for review, safety, EVA and the report.</p>
      <div className="cmp-options" role="radiogroup" aria-label="Route options">
        {OBJECTIVE_ORDER.map((o) => (
          <button key={o} role="radio" aria-checked={objective === o} className={`cmp-opt ${objective === o ? "selected" : ""}`} onClick={() => setObjective(o)}>
            <span className="cmp-swatch" style={{ background: OBJECTIVE_META[o].color }} data-dash={OBJECTIVE_META[o].dash ? "1" : undefined} />
            <span className="cmp-opt-text">
              <b>{OBJECTIVE_META[o].label}</b>
              <span>{OBJECTIVE_META[o].goal}</span>
            </span>
            {objective === o && <Icon name="check" size={16} />}
          </button>
        ))}
      </div>

      <div className="table-scroll">
        <table className="cmp-table">
          <thead>
            <tr>
              <th />
              {OBJECTIVE_ORDER.map((o) => (
                <th key={o} className={objective === o ? "sel" : ""}>
                  <i className="cmp-dot" style={{ background: OBJECTIVE_META[o].color }} /> {OBJECTIVE_META[o].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <th scope="row">{row.label}</th>
                {OBJECTIVE_ORDER.map((o) => (
                  <td key={o} className={`${objective === o ? "sel" : ""} ${row.best?.(o) ? "best" : ""}`}>{row.get(o)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine muted">
        <span className="best-key">Bold</span> = best value in the row. Distance, climb and slope are <KindBadge kind="real-derived" />; time and difficulty are <KindBadge kind="estimate" />.
      </p>

      <div className="cmp-notes">
        <div className="mini-title">What's different?</div>
        <ul>
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </div>

      <details className="disclosure">
        <summary>How each option is calculated</summary>
        <ul className="formula-list">
          {OBJECTIVE_ORDER.map((o) => (
            <li key={o}>
              <b style={{ color: OBJECTIVE_META[o].color }}>{OBJECTIVE_META[o].label}:</b> {OBJECTIVE_META[o].formula}.
            </li>
          ))}
          <li>
            All three use the same <Term k="astar">A*</Term> search on the {compare.grid.name.toUpperCase()} {compare.grid.resolution_m} m terrain grid and block ground steeper than your {maxSlope}° limit.
            Penalty shapes are PAWPRINT <KindBadge kind="assumption" />, not NASA rules.
          </li>
        </ul>
      </details>
    </div>
  );
}
