import { waterClasses, type WaterFile } from "../../lib/water";

/** Classed legend for the Ancient Water Evidence layer: one swatch per class of the 0-100 index, with the
 *  exact index range each colour stands for (the same classes the map image is drawn with). */
export function WaterLegend({ water, compact, highlight }: { water: WaterFile | null; compact?: boolean; highlight?: string | null }) {
  const classes = [...waterClasses(water)].reverse(); // high at the top
  return (
    <div className={`water-legend2 ${compact ? "compact" : ""}`} data-testid="water-legend" aria-label="Water evidence legend: evidence index 0 to 100, not a probability">
      {!compact && <div className="wl-title">Water evidence index <em>0–100 · not a probability</em></div>}
      <ul className="wl-rows">
        {classes.map((c) => (
          <li key={c.label} className={highlight === c.label ? "on" : ""}>
            <i className="wl-sw" style={{ background: c.color }} />
            <b>{c.min}–{c.max}</b>
            <span>{c.priority}</span>
          </li>
        ))}
        <li>
          <i className="wl-sw partial" style={{ background: classes[1].color }} />
          <b>striped</b>
          <span>Some inputs missing; colour is provisional</span>
        </li>
        <li>
          <i className="wl-sw missing" />
          <b>hatched</b>
          <span>Not enough data (unknown, not low)</span>
        </li>
      </ul>
    </div>
  );
}
