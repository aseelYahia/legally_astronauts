import { formatLat, formatLon } from "../lib/mars";
import type { TerrainProbe } from "../lib/api";
import type { Poi, WeatherSol } from "../types";
import { Icon, KindBadge, Mascot } from "./ui";

const HAZ = ["Easy", "Moderate", "Hazard", "No-go"];

export function ExplorePanel({
  probe,
  probeBusy,
  weather,
  pois,
  onFly,
  onPlan,
}: {
  probe: TerrainProbe | null;
  probeBusy: boolean;
  weather: WeatherSol[];
  pois: Poi[];
  onFly: (p: Poi) => void;
  onPlan: (p: Poi) => void;
}) {
  const latest = [...weather].reverse().find((s) => s.min_temp_c !== null && s.max_temp_c !== null);
  const samples = pois.filter((p) => p.category === "sample");
  return (
    <aside className="panel right-panel explore">
      <header className="route-head">
        <span className="route-icon"><Icon name="explore" size={22} /></span>
        <div>
          <div className="route-name static">JEZERO CRATER</div>
          <div className="route-sub">Explore · Perseverance landing region</div>
        </div>
      </header>

      <section className="card">
        <div className="card-title">
          <Icon name="pin" size={15} /> Terrain at point <KindBadge kind="real-derived" />
        </div>
        {probe && Object.keys(probe.samples).length ? (
          <div className="probe">
            <div className="probe-coord">{formatLat(probe.lat)}, {formatLon(probe.lon)}</div>
            {Object.entries(probe.samples).map(([k, s]) => (
              <div className="probe-row" key={k}>
                <span className="probe-src">{k === "ctx" ? "CTX DTM" : "HiRISE DTM"} · {s.resolution_m} m</span>
                <span><b>{Math.round(s.elevation_m).toLocaleString("en-US")} m</b> elev.</span>
                <span><b>{s.slope_deg.toFixed(1)}°</b> slope</span>
                <span className={`haz haz-${s.hazard_class}`}>{HAZ[s.hazard_class] ?? "n/a"}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty compact">
            <Mascot pose={probeBusy ? "floating" : "crawling"} size={52} />
            <p>{probeBusy ? "Sniffing the terrain…" : probe ? "No terrain data at that spot (outside the prototype area)." : "Click anywhere on the map to probe elevation, slope and hazard class."}</p>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-title">
          <Icon name="cloud" size={15} /> Environment · MEDA <KindBadge kind="archived" title="NASA's public MEDA feed stopped updating at sol 1133" />
        </div>
        {latest ? (
          <>
            <div className="wx-grid">
              <div><Icon name="thermo" size={16} /><span>Air temp (min / max)</span><b>{latest.min_temp_c}° / {latest.max_temp_c}° C</b></div>
              <div><Icon name="gauge" size={16} /><span>Pressure</span><b>{latest.pressure_pa ?? "—"} Pa</b></div>
              <div><Icon name="sun" size={16} /><span>Sunrise / sunset (LMST)</span><b>{latest.sunrise_lmst.slice(0, 5)} / {latest.sunset_lmst.slice(0, 5)}</b></div>
              <div><Icon name="explore" size={16} /><span>Season · Ls</span><b>{latest.season} · {latest.ls_deg.toFixed(0)}°</b></div>
            </div>
            <table className="wx-table">
              <thead>
                <tr><th>Sol</th><th>Earth date</th><th>Min °C</th><th>Max °C</th><th>Pa</th></tr>
              </thead>
              <tbody>
                {weather.map((s) => (
                  <tr key={s.sol}>
                    <td>{s.sol}</td>
                    <td>{s.earth_date}</td>
                    <td>{s.min_temp_c ?? <i className="na">n/a</i>}</td>
                    <td>{s.max_temp_c ?? <i className="na">n/a</i>}</td>
                    <td>{s.pressure_pa ?? <i className="na">n/a</i>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="fine muted">
              Measured by MEDA at the rover's location on sols {weather[0].sol}–{weather[weather.length - 1].sol} (Apr 2024). It is not a forecast and not specific to the
              clicked point. "n/a" = the feed reports no value.
            </p>
          </>
        ) : (
          <p className="fine">No MEDA values available.</p>
        )}
      </section>

      <section className="card grow">
        <div className="card-title">
          <Icon name="crystal" size={15} /> Science markers · {samples.length} samples
        </div>
        <ul className="poi-list">
          {samples.map((s) => (
            <li key={s.id}>
              <button className="poi-item" onClick={() => onFly(s)}>
                <span className={`poi-dot ${s.type?.includes("igneous") ? "igneous" : s.type?.includes("Regolith") ? "regolith" : s.type === "Atmospheric" ? "atmo" : "sedimentary"}`} />
                <span className="poi-name">#{s.number} {s.name}</span>
                <span className="poi-meta">{s.campaign} · sol {s.sol_sealed}</span>
              </button>
              <button className="btn-mini pink" onClick={() => onPlan(s)} title="Plan an EVA to this sample">Plan</button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
