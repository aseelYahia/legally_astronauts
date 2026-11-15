import { useState } from "react";
import { WATER_RAMP, type CellExplain } from "../../lib/water";
import { Icon, KindBadge } from "../ui";

export function rampColor(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < WATER_RAMP.length; i++) {
    const [t1, c1] = WATER_RAMP[i];
    const [t0, c0] = WATER_RAMP[i - 1];
    if (x <= t1) {
      const f = (x - t0) / (t1 - t0);
      const a = [1, 3, 5].map((k) => parseInt(c0.slice(k, k + 2), 16));
      const b = [1, 3, 5].map((k) => parseInt(c1.slice(k, k + 2), 16));
      return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * f)).join(",")})`;
    }
  }
  return WATER_RAMP[WATER_RAMP.length - 1][1];
}

/** Score, contributing datasets, explanations and limitations for one ~90 m cell. */
export function WaterCellCard({ info, compact, onSetDestination }: { info: CellExplain; compact?: boolean; onSetDestination?: () => void }) {
  const [more, setMore] = useState(!compact);
  const s = info.score;
  return (
    <div className="wcell" data-testid="water-cell">
      <div className="wcell-head">
        <span className="wcell-icon"><Icon name="drop" size={16} /></span>
        <b>Ancient water evidence</b>
        <KindBadge kind="estimate" title="Project-defined index from NASA/USGS data. Weights are PAWPRINT assumptions. Not a probability of finding water." />
      </div>
      {s === null ? (
        <p className="wcell-missing"><span className="wsw missing" /> Insufficient data: this cell is not scored (it is <b>not</b> low evidence).</p>
      ) : (
        <div className="wcell-score">
          <span className="wcell-num" style={{ background: rampColor(s) }}>{s.toFixed(2)}</span>
          <span className="wcell-band">
            <b>{info.band}</b> evidence index <em>(0–1, not a probability)</em>
            <span className="wcell-conf">Confidence: {info.confidence} · data coverage {Math.round(info.coverage * 100)}%</span>
          </span>
        </div>
      )}
      <ul className="wcell-comps">
        {info.components.map((c) => (
          <li key={c.key} className={c.value === null ? "missing" : ""}>
            <div className="wcell-comp-head">
              <span>{c.label} <em>weight {Math.round(c.weight * 100)}%</em></span>
              <b>{c.value === null ? "no data" : c.value.toFixed(2)}</b>
            </div>
            <div className="wbar" aria-hidden="true"><i style={{ width: `${(c.value ?? 0) * 100}%` }} /></div>
            {more && <p>{c.text}</p>}
          </li>
        ))}
      </ul>
      {more && (
        <div className="wcell-lim">
          <b>Limitations</b>
          <ul>{info.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      )}
      <div className="wcell-actions">
        {compact && (
          <button className="link-btn" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? "Hide details" : "Why this score?"}
          </button>
        )}
        {onSetDestination && s !== null && (
          <button className="pick-btn" onClick={onSetDestination}><Icon name="pin" size={14} />Set as destination</button>
        )}
      </div>
    </div>
  );
}
