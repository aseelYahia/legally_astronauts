import { useState } from "react";
import type { WaterBreakdown } from "../../lib/water";
import { Icon, KindBadge } from "../ui";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const pts = (v: number) => v.toFixed(1);

/** Body of the map information panel for a clicked water-evidence spot: the exact 0-100 index, its class and
 *  colour, every input's score, weight and contribution, a plain-language explanation, sources and warnings. */
export function WaterInfoBody({ b }: { b: WaterBreakdown }) {
  const [details, setDetails] = useState(false);
  const total = b.components.reduce((s, c) => s + (c.points ?? 0), 0);
  return (
    <div className="winfo" data-testid="water-info">
      <div className="winfo-score">
        <span className={`winfo-num ${b.partial ? "partial" : ""} ${b.index === null ? "missing" : ""}`} style={b.cls ? { background: b.cls.color, color: b.index !== null && b.index >= 60 ? "#fff" : "var(--navy)" } : undefined}>
          {b.index ?? "–"}
          <small>/100</small>
        </span>
        <div className="winfo-cat">
          <b>{b.cls ? b.cls.priority : "Insufficient data"}</b>
          <span>{b.cls ? `Evidence index ${b.cls.min}–${b.cls.max} · ${b.cls.color_name} on the map` : "Hatched grey on the map"}</span>
          <span className="winfo-conf">Confidence: {b.confidence}{b.range ? ` · could be ${b.range[0]}–${b.range[1]}` : ""}</span>
        </div>
      </div>
      <p className="winfo-not-prob">
        <Icon name="info" size={13} />
        <span>An exploration index from orbital and map evidence for <b>ancient</b> water. It is <b>not</b> the percentage chance that water exists here.</span>
      </p>

      <p className="winfo-summary" data-testid="water-summary">{b.summary}</p>

      {b.warnings.length > 0 && (
        <ul className="winfo-warn" aria-label="Missing-data warnings">
          {b.warnings.map((w) => <li key={w}><Icon name="warn" size={13} />{w}</li>)}
        </ul>
      )}

      <table className="winfo-table" aria-label="How the evidence index is calculated">
        <thead>
          <tr><th>Input</th><th>Score</th><th>Weight</th><th>Adds</th></tr>
        </thead>
        <tbody>
          {b.components.map((c) => (
            <tr key={c.key} className={c.score === null ? "missing" : ""}>
              <th scope="row">{c.label.replace(/ \(.*\)$/, "")}<em>{c.label.match(/\((.*)\)$/)?.[1]}</em></th>
              <td>{c.score === null ? <span className="winfo-na">no data</span> : c.score}</td>
              <td>
                {pct(c.weight)}
                {c.effectiveWeight !== null && Math.abs(c.effectiveWeight - c.weight) > 0.005 && <em>used {pct(c.effectiveWeight)}</em>}
              </td>
              <td>{c.points === null ? "–" : `+${pts(c.points)}`}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><th scope="row">Evidence index</th><td /><td /><td><b>{b.index ?? "–"}</b>{b.index !== null && Math.abs(total - b.index) >= 0.5 && <em>({total.toFixed(1)})</em>}</td></tr>
        </tfoot>
      </table>
      <p className="winfo-formula">
        Index = Σ score × weight ÷ Σ weight of the inputs with data. Weights 45% / 40% / 15% are PAWPRINT assumptions <KindBadge kind="assumption" />
      </p>

      <button className="water-more" aria-expanded={details} onClick={() => setDetails((v) => !v)}>
        <Icon name={details ? "chevronUp" : "chevronDown"} size={14} /> Why each input scored this way · sources
      </button>
      {details && (
        <div className="winfo-details">
          {b.components.map((c) => (
            <div key={c.key}>
              <b>{c.label}</b>
              <p>{c.text}</p>
              <p className="winfo-src">Source: {c.source}</p>
            </div>
          ))}
          <b>Limitations</b>
          <ul>{b.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
