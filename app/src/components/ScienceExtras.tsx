import { INDICATOR_LABEL, type GeologyFile, type MineralsLayer, type PhotosFile } from "../lib/nasaExtras";
import type { Manifest } from "../types";
import { Icon, KindBadge } from "./ui";

/** The five official NASA Space Apps challenge resources and how PAWPRINT uses each. */
export const CHALLENGE_RESOURCES = [
  {
    name: "NASA Mars Trek",
    url: "https://trek.nasa.gov/mars/",
    direct: true,
    use: "HiRISE close-up photo layer (Mars 2020 TRN HiRISE controlled orthomosaic, Trek WMTS tiles, zoom 15). Trek's catalog also confirms our CTX mosaic is the same product (identical name and 36,269,402-byte size).",
    proof: "Layer key hirise_ortho in manifest.json; 90 tiles, aligned with CTX at r = 0.96 with zero shift.",
    limits: "Downsampled to ~1.2 m from the 25 cm source; covers only the HiRISE window. Trek's CTX/HiRISE DTMs duplicate products we already use.",
  },
  {
    name: "USGS-NASA Geological Maps",
    url: "https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars",
    direct: true,
    use: "Geologic units layer: USGS SIM 3464 (Sun & Stack 2020) unit polygons from the USGS ArcGIS feature service, with USGS descriptions and interpretations.",
    proof: "geology_units.geojson (6 units, 22 polygons clipped to the area); unit areas total ≈ the area of interest.",
    limits: "1:75,000 map drawn on a semi-controlled mosaic: 100–200 m offsets per USGS. 2020 interpretations predate rover results.",
  },
  {
    name: "Curiosity's Proposed Route",
    url: "https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/",
    direct: false,
    use: "Design reference only: numbered science stops with names and objectives in the Route itinerary.",
    proof: "Itinerary shows numbered stops, the geologic unit and the sample objective at each stop.",
    limits: "A Gale Crater (Mount Sharp) graphic from 2019; no data from it is used or shown as Jezero data.",
  },
  {
    name: "NASA Worldview",
    url: "https://worldview.earthdata.nasa.gov/",
    direct: false,
    use: "Design reference only: time-based exploration. Mission-timeline sol slider for archived rover drives and photos; dated observation timeline below.",
    proof: "Layers panel → Rover tracks → Mission timeline; Science Data → Observation timeline.",
    limits: "Worldview is an Earth-observation tool; none of its Earth data is used.",
  },
  {
    name: "Perseverance Raw Images",
    url: "https://mars.nasa.gov/mars2020/multimedia/raw-images/",
    direct: true,
    use: "Mars Ground View: real raw photos (Mastcam-Z, Hazcam, CacheCam) from each sample's sealing sol, with NASA links, camera, sol and date.",
    proof: "photos.json from NASA's raw-image API; 62 of 64 photos geolocated by exact site/drive match to NASA localizations; all 23 sample markers corroborated.",
    limits: "Rover cameras at ~1–2 m, not astronaut eye level; the map pin is the rover's position, not the camera target.",
  },
];

export function ChallengeResources() {
  return (
    <>
      <h3 className="section-h">Official challenge resources</h3>
      <div className="table-wrap">
        <table className="data-table resources-table">
          <thead>
            <tr><th>Resource</th><th>Used directly?</th><th>Dataset or feature</th><th>Proof</th><th>Limitations</th></tr>
          </thead>
          <tbody>
            {CHALLENGE_RESOURCES.map((r) => (
              <tr key={r.name}>
                <td><a href={r.url} target="_blank" rel="noreferrer">{r.name}</a></td>
                <td>{r.direct ? <><KindBadge kind="real" title="Data integrated" /><span className="rt-yn">Yes, data integrated</span></> : <span className="rt-design">No, design reference only</span>}</td>
                <td>{r.use}</td>
                <td>{r.proof}</td>
                <td>{r.limits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function CrismCard({ manifest }: { manifest: Manifest }) {
  const m = manifest.layers.minerals as unknown as MineralsLayer | undefined;
  if (!m) {
    return (
      <article className="card dataset">
        <div className="card-title"><Icon name="crystal" size={15} /> CRISM orbital mineralogy <KindBadge kind="unavailable" /></div>
        <p className="fine">Not ingested, so the Minerals layer is disabled rather than illustrated.</p>
      </article>
    );
  }
  return (
    <details className="card disclosure-card" open>
      <summary><Icon name="crystal" size={15} /> CRISM mineral indicators <KindBadge kind="real-derived" /></summary>
      <p className="fine">
        Summary parameters from {m.products.length} CRISM observations ({m.resolution_m} m) cover {m.measured_km2} of {m.aoi_km2} km² of the map. A
        coloured pixel means a parameter exceeds a PAWPRINT threshold: a <b>potential</b> indicator, not a confirmed mineral.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Indicator</th><th>Parameter &gt; threshold</th><th>Area here</th><th>What it can mean</th></tr></thead>
          <tbody>
            {m.indicators.map((i) => (
              <tr key={i.key}>
                <td><i className="swatch" style={{ background: i.color }} /> {INDICATOR_LABEL[i.key] ?? i.key}</td>
                <td>{i.parameter} &gt; {i.threshold}</td>
                <td>{i.km2_in_aoi ? `${i.km2_in_aoi} km²` : "none"}</td>
                <td className="wrap">{i.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Product</th><th>Observed</th><th>Pixels used</th><th>Co-registration to CTX</th><th>Source</th></tr></thead>
          <tbody>
            {m.products.map((p) => (
              <tr key={p.product_id}>
                <td>{p.product_id}</td>
                <td>{p.start_time.slice(0, 10)}</td>
                <td>{p.pixels_used.toLocaleString("en-US")}</td>
                <td>
                  r {p.registration.corr_before ?? "n/a"} → {p.registration.corr_after}; moved {p.registration.shift_m_north_south} m N, {p.registration.shift_m_east_west} m W
                  {!p.registration.accepted && " (not applied)"}
                </td>
                <td><a href={p.label_url} target="_blank" rel="noreferrer">PDS label</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine muted">{m.registration_method}</p>
      <p className="fine muted">
        No carbonate parameter in this area exceeds noise (maximum MIN2295_2480 ≈ 0.012), so no carbonate indicator is shown here; Jezero's strongest
        orbital carbonate signals lie outside this map. Olivine indicators concentrate on the crater floor. {m.assumptions}
      </p>
    </details>
  );
}

export function GeologyCard({ geology }: { geology: GeologyFile | null }) {
  if (!geology) return null;
  return (
    <details className="card disclosure-card">
      <summary><Icon name="map" size={15} /> Geologic units (USGS SIM 3464) <KindBadge kind="real" /></summary>
      <p className="fine">
        Sun &amp; Stack (2020), 1:75,000. {geology.positional_note} Units are rock formations mapped from orbit, kept separate from CRISM mineral
        indicators.
      </p>
      <ul className="unit-cards">
        {geology.units.map((u) => (
          <li key={u.symbol}>
            <div className="unit-name"><i style={{ background: u.color }} /> <b>{u.symbol}</b> {u.name} <em>{u.area_km2_in_aoi} km² here</em></div>
            <p className="fine"><b>Interpretation (USGS, 2020):</b> {u.interpretation}</p>
          </li>
        ))}
      </ul>
      <p className="fine muted">
        Interpretations were written before Perseverance landed; rover results since 2021 (e.g. igneous crater-floor rocks) refine some of them.
      </p>
    </details>
  );
}

export function GroundViewCard({ photos, onOpen }: { photos: PhotosFile | null; onOpen: () => void }) {
  if (!photos) return null;
  const geo = photos.photos.filter((p) => p.location.geolocated).length;
  const ok = photos.sample_position_check.filter((c) => c.corroborated).length;
  return (
    <details className="card disclosure-card">
      <summary><Icon name="camera" size={15} /> Mars Ground View photos <KindBadge kind="real" /></summary>
      <dl className="kv">
        <dt>Photos</dt><dd>{photos.photos.length} raw NASA images ({geo} geolocated, {photos.photos.length - geo} not)</dd>
        <dt>Cameras</dt><dd>{[...new Set(photos.photos.map((p) => p.camera_label))].join(", ")}</dd>
        <dt>Geolocation rule</dt><dd>Exact match of the image's site/drive to a NASA localization; otherwise not placed</dd>
        <dt>Sample markers</dt><dd>{ok} of {photos.sample_position_check.length} corroborated by sealing-sol image metadata</dd>
      </dl>
      <p className="fine muted">{photos.note}</p>
      <button className="btn-mini lav" onClick={onOpen}><Icon name="camera" size={13} /> Open Ground View</button>
    </details>
  );
}

/** Worldview-inspired: every dated observation behind the map, on one line. */
export function ObservationTimeline({ manifest, photos }: { manifest: Manifest; photos: PhotosFile | null }) {
  const m = manifest.layers.minerals as unknown as MineralsLayer | undefined;
  const items: { date: string; label: string; kind: string }[] = [
    ...(m?.products.map((p) => ({ date: p.start_time.slice(0, 10), label: `CRISM ${p.observation_id}`, kind: "real-derived" })) ?? []),
    { date: "2020-07-24", label: "USGS Mars 2020 TRN DTMs & mosaics released", kind: "real" },
    { date: "2020-01-01", label: "USGS SIM 3464 geologic map published (2020)", kind: "real" },
    { date: "2021-02-18", label: "Perseverance lands (sol 0)", kind: "real" },
    ...(photos?.photos.filter((p) => p.role === "sample").map((p) => ({ date: p.date_taken_utc.slice(0, 10), label: `${p.poi_name} sealed`, kind: "real" })) ?? []),
    { date: "2024-04-21", label: "MEDA weather sols 1127–1133 (last in public feed)", kind: "archived" },
  ].sort((a, b) => a.date.localeCompare(b.date));
  const t0 = Date.parse("2006-06-01");
  const t1 = Date.parse("2025-01-01");
  return (
    <>
      <h3 className="section-h"><Icon name="clock" size={16} /> Observation timeline</h3>
      <p className="fine muted">When each archived observation behind the map was made. Nothing here is live.</p>
      <div className="obs-timeline" role="list">
        <div className="obs-axis" />
        {items.map((i, k) => (
          <span key={k} role="listitem" className={`obs-dot k-${i.kind}`} style={{ left: `${((Date.parse(i.date) - t0) / (t1 - t0)) * 100}%` }} title={`${i.date} · ${i.label}`} />
        ))}
        {[2008, 2012, 2016, 2020, 2024].map((y) => (
          <span key={y} className="obs-year" style={{ left: `${((Date.parse(`${y}-01-01`) - t0) / (t1 - t0)) * 100}%` }}>{y}</span>
        ))}
      </div>
      <ul className="obs-list">
        {items.filter((i, k) => k === 0 || !i.label.endsWith("sealed") || !items[k - 1].label.endsWith("sealed")).map((i, k) => (
          <li key={k}><span>{i.date}</span> {i.label.endsWith("sealed") ? "Sample sealing days and Ground View photos (2021–2023)" : i.label}</li>
        ))}
      </ul>
    </>
  );
}
