import { formatLat, formatLon } from "../lib/mars";
import type { Manifest, Poi, Validation, WeatherSol } from "../types";
import { Icon, KindBadge, Mascot } from "./ui";

export function ScienceView({ manifest, pois, weather }: { manifest: Manifest; pois: Poi[]; weather: WeatherSol[] }) {
  const ctx = manifest.layers.elevation.stats as Record<string, number | Record<string, number>>;
  const hi = manifest.layers.hirise_elevation?.stats as Record<string, number | Record<string, number> | number[]> | undefined;
  const a = manifest.aoi;
  const samples = pois.filter((p) => p.category === "sample");
  return (
    <div className="science">
      <div className="science-hero">
        <Mascot pose="floating" size={92} />
        <div>
          <h2>Science Data</h2>
          <p>
            Every number in PAWPRINT MARS traces back to a NASA or USGS product listed here. Badges tell you what kind of number it is:
            <KindBadge kind="real" /> measured by NASA, <KindBadge kind="real-derived" /> computed in Python from NASA data,
            <KindBadge kind="estimate" /> a model estimate, <KindBadge kind="assumption" /> a planning assumption,
            <KindBadge kind="unavailable" /> not part of this prototype.
          </p>
        </div>
      </div>

      <div className="science-grid">
        <section className="card">
          <div className="card-title"><Icon name="map" size={15} /> Prototype area & reference frame</div>
          <dl className="kv">
            <dt>Area</dt><dd>{formatLat(a.lat_min, 2)}–{formatLat(a.lat_max, 2)}, {formatLon(a.lon_min, 2)}–{formatLon(a.lon_max, 2)}</dd>
            <dt>Projection</dt><dd>{String(manifest.crs.projection)}</dd>
            <dt>Body</dt><dd>Mars sphere, R = {Number(manifest.crs.radius_m).toLocaleString("en-US")} m</dd>
            <dt>Coordinates</dt><dd>Planetocentric latitude, east-positive longitude (0–360°)</dd>
            <dt>Elevation datum</dt><dd>{String(manifest.crs.elevation_datum)}</dd>
            <dt>Generated</dt><dd>{manifest.generated_utc}</dd>
          </dl>
        </section>

        <section className="card">
          <div className="card-title"><Icon name="terrain" size={15} /> Terrain statistics <KindBadge kind="real-derived" /></div>
          <dl className="kv">
            <dt>CTX DTM grid</dt><dd>{(ctx.shape as unknown as number[]).join(" × ")} posts @ 20 m</dd>
            <dt>Elevation range</dt><dd>{Math.round(ctx.elevation_min_m as number)} to {Math.round(ctx.elevation_max_m as number)} m</dd>
            <dt>Mean / P95 slope</dt><dd>{(ctx.slope_mean_deg as number).toFixed(1)}° / {(ctx.slope_p95_deg as number).toFixed(1)}° (20 m baseline)</dd>
            <dt>Mean roughness</dt><dd>{(ctx.roughness_mean_m as number).toFixed(2)} m (TRI, Riley 1999)</dd>
            {hi && (
              <>
                <dt>HiRISE window</dt><dd>{(hi.shape_1m as number[]).join(" × ")} posts @ 1 m</dd>
                <dt>HiRISE P95 slope</dt><dd>{(hi.slope_p95_deg_2m as number).toFixed(1)}° (2 m baseline)</dd>
              </>
            )}
          </dl>
          <p className="fine muted">Slope uses Horn's 3×3 method with true ground spacing (east-west spacing × cos latitude).</p>
        </section>

        <section className="card">
          <div className="card-title"><Icon name="target" size={15} /> Validation <KindBadge kind="real-derived" /></div>
          <ValidationRow title="CTX DTM vs rover localization elevation" v={manifest.validation_ctx_vs_rover} />
          {manifest.validation_hirise_vs_rover && (
            <ValidationRow title="HiRISE DTM vs rover localization elevation" v={manifest.validation_hirise_vs_rover} />
          )}
          {manifest.validation_hirise_vs_ctx && (
            <ValidationRow title="HiRISE DTM vs CTX DTM" v={manifest.validation_hirise_vs_ctx} extra={`USGS-reported median offset: ${manifest.validation_hirise_vs_ctx.usgs_reported_median_offset_m} m`} />
          )}
          <p className="fine muted">
            Rover elevations are NASA localization solutions (MMGIS elev_geoid). Their ~1 cm agreement with the HiRISE DTM shows they are
            referenced to that DTM, so these rows confirm our georeferencing and datum. They are not an independent accuracy estimate.
          </p>
        </section>

        <section className="card">
          <div className="card-title"><Icon name="cloud" size={15} /> MEDA atmosphere <KindBadge kind="archived" /></div>
          <p className="fine">
            {weather.filter((w) => w.pressure_pa !== null).length} of {weather.length} sols report pressure; {weather.filter((w) => w.min_temp_c !== null).length} report air
            temperature. Pressure range {Math.min(...weather.flatMap((w) => (w.pressure_pa ? [w.pressure_pa] : [])))}–
            {Math.max(...weather.flatMap((w) => (w.pressure_pa ? [w.pressure_pa] : [])))} Pa, late-autumn season (Ls {weather[0].ls_deg.toFixed(0)}–{weather[weather.length - 1].ls_deg.toFixed(0)}°).
          </p>
          <p className="fine muted">The public feed has no newer sols. Live/forecast weather is <KindBadge kind="unavailable" />.</p>
        </section>
      </div>

      <h3 className="section-h">Datasets</h3>
      <div className="dataset-grid">
        {Object.entries(manifest.datasets).map(([k, d]) => (
          <article className="card dataset" key={k}>
            <div className="card-title">
              <Icon name="db" size={15} /> {d.title} <KindBadge kind={d.kind} />
            </div>
            <dl className="kv">
              {d.instrument && (<><dt>Instrument</dt><dd>{d.instrument}</dd></>)}
              {d.resolution_m && (<><dt>Resolution</dt><dd>{d.resolution_m} m/pixel</dd></>)}
              {d.vertical_datum && (<><dt>Vertical datum</dt><dd>{d.vertical_datum}</dd></>)}
              <dt>Producer</dt><dd>{d.producer}</dd>
              {(d as { dates?: string }).dates && (<><dt>Dates</dt><dd>{(d as { dates?: string }).dates}</dd></>)}
              <dt>License</dt><dd>{d.license}</dd>
              {d.doi && (<><dt>DOI</dt><dd><a href={d.doi} target="_blank" rel="noreferrer">{d.doi.replace("https://doi.org/", "")}</a></dd></>)}
              <dt>Source</dt><dd><a href={d.url} target="_blank" rel="noreferrer" className="url">{d.url}</a></dd>
            </dl>
            {d.citation && <p className="fine muted">{d.citation}</p>}
            {d.note && <p className="fine note">{d.note}</p>}
          </article>
        ))}
        <article className="card dataset">
          <div className="card-title"><Icon name="crystal" size={15} /> CRISM orbital mineralogy <KindBadge kind="unavailable" /></div>
          <p className="fine">Mineral maps (olivine, carbonate, clay) are not ingested in this prototype, so the Minerals layer is disabled rather than illustrated.</p>
        </article>
      </div>

      <h3 className="section-h">Sample sites in the prototype area ({samples.length})</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>#</th><th>Name</th><th>Type</th><th>Campaign</th><th>Sealed</th><th>Core</th><th>Lat</th><th>Lon</th><th>Rover elev.</th><th>Position</th></tr>
          </thead>
          <tbody>
            {samples.map((s) => (
              <tr key={s.id}>
                <td>{s.number}</td>
                <td>{s.name}</td>
                <td>{s.type}</td>
                <td>{s.campaign}</td>
                <td>Sol {s.sol_sealed} · {s.date_sealed}</td>
                <td>{s.core_length_cm ? `${s.core_length_cm} cm` : "—"}</td>
                <td>{s.lat.toFixed(5)}</td>
                <td>{s.lon.toFixed(5)}</td>
                <td>{s.elev_geoid_m ? `${s.elev_geoid_m.toFixed(1)} m` : "—"}</td>
                <td><KindBadge kind="estimated" title={s.position_method} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ValidationRow({ title, v, extra }: { title: string; v: Validation; extra?: string }) {
  return (
    <div className="valrow">
      <b>{title}</b>
      <div className="valnums">
        <span><em>n</em>{v.n.toLocaleString("en-US")}</span>
        <span><em>median Δ</em>{v.median_m.toFixed(2)} m</span>
        <span><em>MAD</em>{v.mad_m.toFixed(2)} m</span>
        <span><em>P5–P95</em>{v.p05_m.toFixed(1)} … {v.p95_m.toFixed(1)} m</span>
      </div>
      {extra && <span className="fine muted">{extra}</span>}
    </div>
  );
}
