import { formatLat, formatLon } from "../lib/mars";
import type { TerrainProbe } from "../lib/api";
import { INDICATOR_LABEL, unitAt, type GeologyFile, type MineralProbe, type PhotosFile } from "../lib/nasaExtras";
import type { Poi, WeatherSol } from "../types";
import { DogTip, Icon, KindBadge, Mascot, Term } from "./ui";

const HAZ = ["Easy", "Moderate", "Hazard", "No-go"];
const HAZ_TEXT = [
  "Gentle ground: comfortable walking.",
  "Noticeable slope: walk with care.",
  "Steep: a planner would avoid this if possible.",
  "Too steep for the default walking limit.",
];

export function ExplorePanel({
  probe,
  probeBusy,
  weather,
  weatherOn,
  pois,
  onFly,
  onPlan,
  sheetOpen,
  toggleSheet,
  geology,
  mineralProbe,
  photos,
  onOpenGroundView,
}: {
  probe: TerrainProbe | null;
  probeBusy: boolean;
  weather: WeatherSol[];
  weatherOn: boolean;
  pois: Poi[];
  onFly: (p: Poi) => void;
  onPlan: (p: Poi) => void;
  sheetOpen: boolean;
  toggleSheet: () => void;
  geology: GeologyFile | null;
  mineralProbe: MineralProbe | null;
  photos: PhotosFile | null;
  onOpenGroundView: (poiId: string | null) => void;
}) {
  const latest = [...weather].reverse().find((s) => s.min_temp_c !== null && s.max_temp_c !== null);
  const samples = pois.filter((p) => p.category === "sample");
  const unit = probe ? unitAt(geology, probe.lon, probe.lat) : null;
  const mp = mineralProbe && probe && Math.abs(mineralProbe.lon - probe.lon) < 1e-9 && Math.abs(mineralProbe.lat - probe.lat) < 1e-9 ? mineralProbe : null;
  return (
    <aside className={`panel right-panel explore ${sheetOpen ? "sheet-open" : ""}`} aria-label="Explore Jezero Crater">
      <button className="sheet-handle" onClick={toggleSheet} aria-expanded={sheetOpen}>
        <span className="grip" />
        <em>{sheetOpen ? "Hide details" : "Show terrain, weather & samples"}</em>
      </button>
      <header className="route-head">
        <span className="route-icon explore-icon"><Icon name="explore" size={22} /></span>
        <div className="route-head-text">
          <div className="route-name static">Jezero Crater</div>
          <div className="route-sub">Explore · Perseverance landing region</div>
        </div>
      </header>

      <div className="panel-scroll">
        <DogTip pose="standing" title="Where am I?">
          An ancient crater lake on Mars, about 45 km wide. Perseverance landed here in 2021 to search for signs of past life.
          This view covers a 7.7 × 5.3 km slice around the landing site and river delta.
        </DogTip>

        <section className="card">
          <div className="card-title">
            <Icon name="pin" size={15} /> Inspect the ground <KindBadge kind="real-derived" />
          </div>
          {probe && Object.keys(probe.samples).length ? (
            <div className="probe">
              <div className="probe-coord">{formatLat(probe.lat)}, {formatLon(probe.lon)}</div>
              {Object.entries(probe.samples).map(([k, s]) => (
                <div className="probe-row" key={k}>
                  <span className="probe-src">{k === "ctx" ? <Term k="ctx">CTX terrain</Term> : <Term k="hirise">HiRISE terrain</Term>} · {s.resolution_m} m grid</span>
                  <span className="pv"><b>{Math.round(s.elevation_m).toLocaleString("en-US")} m</b><Term k="elevation" /></span>
                  <span className="pv"><b>{s.slope_deg.toFixed(1)}°</b><Term k="slope" /></span>
                  <span className={`haz haz-${s.hazard_class}`}>{HAZ[s.hazard_class] ?? "n/a"}</span>
                  <span className="haz-text">{HAZ_TEXT[s.hazard_class] ?? ""}</span>
                </div>
              ))}
              {geology && (
                <div className="probe-extra">
                  <div className="probe-src">
                    Geologic unit · USGS SIM 3464 <KindBadge kind="real" title="Sun & Stack 2020, 1:75,000; boundaries approximate (±100–200 m)" />
                  </div>
                  {unit ? (
                    <>
                      <div className="unit-name"><i style={{ background: unit.color }} /> <b>{unit.symbol}</b> {unit.name}</div>
                      <details className="disclosure">
                        <summary>USGS description and interpretation</summary>
                        <p className="fine">{unit.description}</p>
                        <p className="fine"><b>USGS interpretation (2020, before the rover landed):</b> {unit.interpretation}</p>
                      </details>
                      <p className="fine muted">A mapped rock formation, not a mineral detection. Boundary approximate (±100–200 m).</p>
                    </>
                  ) : (
                    <p className="fine muted">No mapped unit at this point.</p>
                  )}
                </div>
              )}
              {mp?.available && (
                <div className="probe-extra">
                  <div className="probe-src">
                    Mineral indicators · CRISM <KindBadge kind="real-derived" title="Potential indicators from CRISM summary parameters" />
                  </div>
                  {!mp.measured ? (
                    <p className="fine muted">No CRISM measurement here, so nothing is shown.</p>
                  ) : (
                    <>
                      {mp.indicators && mp.indicators.length ? (
                        <ul className="ind-list">
                          {mp.indicators.map((i) => (
                            <li key={i.key}><b>{INDICATOR_LABEL[i.key] ?? i.key}</b> ({i.parameter}) — {i.meaning}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="fine">No indicator above PAWPRINT's thresholds at this 18 m pixel.</p>
                      )}
                      <p className="fine muted">
                        {mp.product?.observation_id}, observed {mp.product?.start_time.slice(0, 10)} ·{" "}
                        <a href={mp.product?.label_url} target="_blank" rel="noreferrer">PDS label</a>. Potential indicators, not confirmed minerals.
                      </p>
                    </>
                  )}
                </div>
              )}
              <p className="fine muted">Click somewhere else to compare.</p>
            </div>
          ) : (
            <div className="empty compact">
              <Mascot pose={probeBusy ? "floating" : "crawling"} size={50} />
              <p>{probeBusy ? "Sniffing the terrain…" : probe ? "No terrain data at that spot. It's outside the coloured map area." : "Click anywhere on the map to see the height, slope and walking difficulty at that point."}</p>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-title">
            <Icon name="cloud" size={15} /> Weather at the rover <KindBadge kind="archived" title="NASA's public MEDA feed stopped updating at sol 1133" />
          </div>
          {!weatherOn ? (
            <p className="fine muted">The Weather layer is off. Turn it on in Mission Layers to see the archived readings.</p>
          ) : latest ? (
            <>
              <div className="wx-grid">
                <div><Icon name="thermo" size={16} /><span>Air temp (min / max)</span><b>{latest.min_temp_c}° / {latest.max_temp_c}° C</b></div>
                <div><Icon name="gauge" size={16} /><span>Pressure</span><b>{latest.pressure_pa ?? "—"} Pa</b></div>
              </div>
              <p className="fine muted">
                <Term k="meda" /> reading for <Term k="sol">sol</Term> {latest.sol} ({latest.earth_date}). This is old data, not a forecast.
              </p>
              <details className="disclosure">
                <summary>All readings, sunrise and season</summary>
                <div className="wx-grid">
                  <div><Icon name="sun" size={16} /><span>Sunrise / sunset (<Term k="lmst" />)</span><b>{latest.sunrise_lmst.slice(0, 5)} / {latest.sunset_lmst.slice(0, 5)}</b></div>
                  <div><Icon name="explore" size={16} /><span>Season · <Term k="ls">Ls</Term></span><b>{latest.season} · {latest.ls_deg.toFixed(0)}°</b></div>
                </div>
                <div className="table-scroll">
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
                </div>
                <p className="fine muted">
                  Measured by MEDA at the rover's location on sols {weather[0].sol}–{weather[weather.length - 1].sol} (Apr 2024), not at the clicked
                  point. "n/a" = the feed reports no value.
                </p>
              </details>
            </>
          ) : (
            <p className="fine">No MEDA values available.</p>
          )}
        </section>

        {photos && (
          <section className="card">
            <div className="card-title">
              <Icon name="camera" size={15} /> Mars Ground View <KindBadge kind="real" title="NASA Perseverance raw images" />
            </div>
            <p className="fine">
              Preview what science stops look like through Perseverance's own cameras: {photos.photos.length} raw NASA photos from the
              days samples were sealed, {photos.photos.filter((p) => p.location.geolocated).length} placed by NASA localization.
            </p>
            <button className="btn-mini lav" onClick={() => onOpenGroundView(null)}>
              <Icon name="camera" size={13} /> Open Ground View
            </button>
          </section>
        )}

        <section className="card">
          <div className="card-title">
            <Icon name="crystal" size={15} /> Rock samples here · {samples.length}
          </div>
          <p className="fine muted">Click a name to fly there, or <b>Plan walk</b> to start a Marswalk to it.</p>
          <ul className="poi-list">
            {samples.map((s) => (
              <li key={s.id}>
                <button className="poi-item" onClick={() => onFly(s)}>
                  <span className={`poi-dot ${s.type?.includes("igneous") ? "igneous" : s.type?.includes("Regolith") ? "regolith" : s.type === "Atmospheric" ? "atmo" : "sedimentary"}`} />
                  <span className="poi-name">#{s.number} {s.name}</span>
                  <span className="poi-meta">{s.campaign} · sol {s.sol_sealed}</span>
                </button>
                <button className="btn-mini rose" onClick={() => onPlan(s)} aria-label={`Plan a walk to ${s.name}`}>Plan walk</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}
