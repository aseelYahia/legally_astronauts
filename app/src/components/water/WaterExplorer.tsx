import { useState } from "react";
import { COMPONENT_LABEL, evidenceIndex, zoneWhy, type ComponentKey, type WaterFile, type WaterZone } from "../../lib/water";
import { Icon, KindBadge } from "../ui";
import { rampColor } from "./WaterCellCard";
import { WaterLegend } from "./WaterLegend";

/** Legend, opacity, highlighted regions and the documented formula for the Ancient Water Evidence layer. */
export function WaterExplorer({
  water,
  opacity,
  setOpacity,
  planning,
  selectedZone,
  onShowZone,
  onSetDestination,
}: {
  water: WaterFile;
  opacity: number;
  setOpacity: (v: number) => void;
  planning: boolean;
  selectedZone: string | null;
  onShowZone: (z: WaterZone) => void;
  onSetDestination: (z: WaterZone) => void;
}) {
  const [open, setOpen] = useState<string | null>(selectedZone);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [rejOpen, setRejOpen] = useState(false);
  const f = water.formula;
  return (
    <div className="key-block water-x" data-testid="water-explorer">
      <div className="key-title">Ancient Water Evidence <KindBadge kind="estimate" /></div>
      <p className="water-honest">
        A project-defined <b>evidence index</b> for rocks formed or changed by <b>ancient</b> water. It is <b>not</b> a chance of finding water, and not a map of today's ice or groundwater.
      </p>
      <WaterLegend water={water} />
      <div className="opacity-head"><span>Water layer strength</span><span>{Math.round(opacity * 100)}%</span></div>
      <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(parseFloat(e.target.value))} aria-label="Water evidence layer strength" />

      <div className="water-zones-head">
        <b>Highlighted regions</b>
        <em>index ≥ {Math.round(water.zone_threshold * 100)}, all data present, at least 4 cells</em>
      </div>
      {water.zones.length === 0 && <p className="fine muted">No region passes the highlight threshold.</p>}
      <ul className="water-zones">
        {water.zones.map((z) => {
          const isOpen = open === z.id;
          return (
            <li key={z.id} className={`${isOpen ? "open" : ""} ${selectedZone === z.id ? "sel" : ""}`} data-zone={z.id}>
              <button className="wz-head" aria-expanded={isOpen} onClick={() => { setOpen(isOpen ? null : z.id); if (!isOpen) onShowZone(z); }}>
                <span className="wz-id" style={{ background: rampColor(z.score_mean) }}>{z.id}</span>
                <span className="wz-text">
                  <b>{z.name}</b>
                  <em>mean index {evidenceIndex(z.score_mean)} · {z.area_km2} km²</em>
                </span>
                <Icon name={isOpen ? "chevronUp" : "chevronDown"} size={14} />
              </button>
              {isOpen && (
                <div className="wz-body">
                  <b className="wz-why-h">Why it is interesting</b>
                  <ul className="wz-why">{zoneWhy(water, z).map((t) => <li key={t}>{t}</li>)}</ul>
                  <div className="wz-comps">
                    {(Object.keys(z.components_mean) as ComponentKey[]).map((k) => (
                      <span key={k} title={COMPONENT_LABEL[k]}>{COMPONENT_LABEL[k].split(" (")[0]}: <b>{z.components_mean[k] === null ? "no data" : z.components_mean[k]!.toFixed(2)}</b></span>
                    ))}
                  </div>
                  <p className="fine muted">
                    Destination point: the highest-scoring cell with median slope under 15°{z.target_slope_deg !== null ? ` (${z.target_slope_deg}°)` : ""}. Nearest sample site: {z.nearest_poi.name} ({(z.nearest_poi.distance_m / 1000).toFixed(1)} km).
                  </p>
                  <div className="wz-actions">
                    <button className="pick-btn" onClick={() => onShowZone(z)}><Icon name="target" size={14} />Show on map</button>
                    <button className="pick-btn primary" onClick={() => onSetDestination(z)}><Icon name="pin" size={14} />{planning ? "Set as destination" : "Plan a route here"}</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <button className="water-more" aria-expanded={formulaOpen} onClick={() => setFormulaOpen((v) => !v)}>
        <Icon name={formulaOpen ? "chevronUp" : "chevronDown"} size={14} /> How the score is calculated
      </button>
      {formulaOpen && (
        <div className="water-formula" data-testid="water-formula">
          <p><code>score = Σ wᵢ·sᵢ ÷ Σ wᵢ</code>, summed over the parts with data in each ~{water.grid.cell_m} m cell. A cell is scored only if the parts with data carry ≥ {Math.round(f.min_coverage * 100)}% of the weight. <KindBadge kind="assumption" /></p>
          <ul>
            <li><b>Minerals · {Math.round(f.weights.mineral * 100)}%</b>: {f.mineral.text}. Counts carbonate, clay, Al-OH and hydration parameters only; olivine and pyroxene are igneous and not counted.</li>
            <li><b>Geologic unit · {Math.round(f.weights.geology * 100)}%</b>: {f.geology.text}.
              <ul className="water-priors">{water.units.map((u) => <li key={u.symbol}><b>{u.symbol}</b> {u.name}: {u.prior ?? "n/a"}</li>)}</ul>
            </li>
            <li><b>Landform · {Math.round(f.weights.landform * 100)}%</b>: {f.landform.text}.</li>
          </ul>
          <p className="fine muted">{f.assumption} Bands: Low &lt; 0.2 ≤ Modest &lt; 0.4 ≤ Moderate &lt; 0.6 ≤ High &lt; 0.8 ≤ Very high.</p>
        </div>
      )}
      <button className="water-more" aria-expanded={rejOpen} onClick={() => setRejOpen((v) => !v)}>
        <Icon name={rejOpen ? "chevronUp" : "chevronDown"} size={14} /> Data we checked but did not use
      </button>
      {rejOpen && (
        <ul className="water-rejected">
          {water.rejected.map((r) => (
            <li key={r.key}><b>{r.name}</b> <KindBadge kind="unavailable" title="Investigated, not used in this map" /><p>{r.why}</p><a href={r.url} target="_blank" rel="noreferrer">Official source</a></li>
          ))}
        </ul>
      )}
    </div>
  );
}
