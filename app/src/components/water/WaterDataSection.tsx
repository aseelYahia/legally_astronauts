import type { WaterFile } from "../../lib/water";
import { KindBadge } from "../ui";

/** Science Data page: how the Ancient Water Evidence map was built, and what was rejected. */
export function WaterDataSection({ water }: { water: WaterFile }) {
  const f = water.formula;
  const st = water.stats as { cells: number; scored: number; insufficient: number; mineral_missing: number };
  return (
    <section className="card water-data" aria-labelledby="water-data-title" data-testid="water-data">
      <div className="card-title" id="water-data-title">Ancient Water Evidence map <KindBadge kind="estimate" /></div>
      <p className="water-honest">{water.not_a_probability}</p>
      <dl className="kv">
        <dt>Formula</dt><dd><code>score = Σ wᵢ·sᵢ ÷ Σ wᵢ</code> over components with data; scored only if they carry ≥ {Math.round(f.min_coverage * 100)}% of the weight</dd>
        <dt>Minerals ({Math.round(f.weights.mineral * 100)}%)</dt><dd>{f.mineral.text} (CRISM MTRDR, 18 m)</dd>
        <dt>Geology ({Math.round(f.weights.geology * 100)}%)</dt><dd>{f.geology.text} (USGS SIM 3464, 1:75,000)</dd>
        <dt>Landform ({Math.round(f.weights.landform * 100)}%)</dt><dd>{f.landform.text}</dd>
        <dt>Grid</dt><dd>{water.grid.rows} × {water.grid.cols} cells of ~{water.grid.cell_m} m; {st.scored} scored, {st.insufficient} insufficient data, CRISM missing in {st.mineral_missing}</dd>
      </dl>
      <p className="fine muted">{f.assumption} Geology polygons come from the USGS ArcGIS feature service of SIM 3464 (offsets of 100–200 m to this basemap). CRISM values are summary-parameter thresholds: potential indicators, not confirmed detections.</p>
      <details className="disclosure">
        <summary>Datasets checked but not used ({water.rejected.length})</summary>
        <ul className="water-rejected">
          {water.rejected.map((r) => (
            <li key={r.key}><b>{r.name}</b><p>{r.why}</p><a href={r.url} target="_blank" rel="noreferrer">Official source</a></li>
          ))}
        </ul>
      </details>
    </section>
  );
}
