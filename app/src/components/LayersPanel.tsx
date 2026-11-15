import { useState, type ReactNode } from "react";
import { INDICATOR_LABEL, type GeologyFile, type MineralsLayer, type PhotosFile } from "../lib/nasaExtras";
import type { Manifest } from "../types";
import type { LayerKey } from "./MapView";
import { DogTip, Icon, KindBadge, Term, Toggle } from "./ui";
import type { WaterFile, WaterZone } from "../lib/water";
import { WaterExplorer } from "./water/WaterExplorer";

interface Row {
  key: LayerKey;
  label: string;
  what: ReactNode;
  details: ReactNode;
  icon: string;
  thumb?: string;
  kind: string;
}

export function LayersPanel({
  manifest,
  layers,
  setLayer,
  opacity,
  setOpacity,
  onCollapse,
  view,
  geology,
  photos,
  mineralOpacity,
  setMineralOpacity,
  roverMaxSol,
  setRoverMaxSol,
  onOpenGroundView,
  docked,
  collapsed,
  water,
  waterOpacity,
  setWaterOpacity,
  waterZone,
  onShowWaterZone,
  onWaterDestination,
}: {
  manifest: Manifest;
  layers: Record<LayerKey, boolean>;
  setLayer: (k: LayerKey, v: boolean) => void;
  opacity: number;
  setOpacity: (v: number) => void;
  onCollapse: () => void;
  view: "explore" | "planner";
  geology: GeologyFile | null;
  photos: PhotosFile | null;
  mineralOpacity: number;
  setMineralOpacity: (v: number) => void;
  roverMaxSol: number | null;
  setRoverMaxSol: (v: number | null) => void;
  onOpenGroundView: () => void;
  /** Planner page: panel sits beside the map and folds into a slim header instead of closing. */
  docked?: boolean;
  collapsed?: boolean;
  water?: WaterFile | null;
  waterOpacity?: number;
  setWaterOpacity?: (v: number) => void;
  waterZone?: string | null;
  onShowWaterZone?: (z: WaterZone) => void;
  onWaterDestination?: (z: WaterZone) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({ "Terrain & Elevation": true });
  const L = manifest.layers;
  const rover = L.rover as unknown as { sol_min: number; sol_max: number };
  const hasHirise = Boolean(L.hirise_elevation);
  const cls = manifest.assumptions.slope_classes_deg;
  const minerals = L.minerals as unknown as MineralsLayer | undefined;
  const nGeo = photos?.photos.filter((p) => p.location.geolocated).length ?? 0;

  const roverRow: Row = {
    key: "rover", label: "Rover tracks", icon: "rover", kind: "real",
    what: `Perseverance's drives, sols ${rover.sol_min}–${rover.sol_max}`,
    details: <>NASA/JPL MMGIS traverse, clipped to this prototype area. Hover a track to see its <Term k="sol" />.</>,
  };

  const groups: { title: string; icon: string; blurb: string; rows: Row[] }[] = [
    {
      title: "Terrain & Elevation",
      icon: "terrain",
      blurb: "Orbital photos and height of the ground",
      rows: [
        {
          key: "terrain", label: "Terrain photo", icon: "terrain", thumb: L.terrain.file, kind: "real",
          what: "Real orbital image of the ground",
          details: <>USGS Mars 2020 TRN <Term k="ctx" /> orthomosaic, 6 m per pixel. Contrast-stretched for display only.</>,
        },
        {
          key: "elevation", label: "Elevation", icon: "contour", thumb: L.elevation.file, kind: "real-derived",
          what: "Colours and contour lines show height",
          details: (
            <>
              Height above the <Term k="areoid" /> from the <Term k="ctx" /> <Term k="dtm" /> (20 m){hasHirise && <>, plus a 1 m <Term k="hirise" /> window (dashed box)</>}.
              Contours every 10 m, bold every 50 m.
            </>
          ),
        },
        ...(L.hirise_ortho
          ? [{
              key: "hirise_img" as LayerKey, label: "HiRISE close-up photo", icon: "terrain", thumb: L.hirise_ortho.file, kind: "real",
              what: "Sharper orbital image of the landing area (Mars Trek)",
              details: <>USGS Mars 2020 TRN <Term k="hirise" /> controlled orthomosaic (25 cm source), streamed from <b>NASA Mars Trek</b> at about 1.2 m per pixel and cropped to the dashed HiRISE box. Aligns with the CTX photo (r = 0.96, no shift).</>,
            }]
          : []),
      ],
    },
    {
      title: "Safety",
      icon: "warn",
      blurb: "Steep ground and archived weather",
      rows: [
        {
          key: "slope", label: "Steep ground", icon: "warn", thumb: L.slope.file, kind: "real-derived",
          what: `Pink where slope is over ${cls[1]}°`,
          details: (
            <>
              <Term k="slope" /> computed in Python. Light pink {cls[1]}–{cls[2]}°, darker pink ≥ {cls[2]}°. The thresholds are a planning{" "}
              <Term k="hazard">assumption</Term>.
            </>
          ),
        },
        {
          key: "weather", label: "Weather", icon: "cloud", kind: "archived",
          what: "Rover weather readings from 2024",
          details: <><Term k="meda" /> daily summary, sols 1127–1133. Not a forecast, and not used in route calculations.</>,
        },
      ],
    },
    {
      title: "Science & Geology",
      icon: "crystal",
      blurb: "Rock samples, geologic units and minerals",
      rows: [
        {
          key: "geology", label: "Rock samples", icon: "crystal", kind: "real",
          what: "Where Perseverance collected samples",
          details: <>Names, sols and types from NASA's sample table. Positions are <Term k="estimated">estimated</Term> from rover locations.</>,
        },
        ...(geology
          ? [{
              key: "geomap" as LayerKey, label: "Geologic units", icon: "map", kind: "real",
              what: `${geology.units.length} mapped units (USGS SIM 3464)`,
              details: <>Sun &amp; Stack (2020), USGS Scientific Investigations Map 3464, 1:75,000. Hover a region for its unit; click the map in Explore for the USGS description. Boundaries are approximate here (USGS notes 100–200 m offsets to this basemap). Geologic units are mapped rock formations, <b>not</b> mineral detections.</>,
            }]
          : []),
        minerals
          ? {
              key: "minerals" as LayerKey, label: "Mineral indicators", icon: "crystal", kind: "real-derived",
              what: `CRISM orbital spectra · ${minerals.products.length} observations`,
              details: <>MRO CRISM MTRDR summary parameters (18 m), co-registered to the CTX photo. Coloured pixels pass a PAWPRINT <Term k="hazard">assumption</Term> threshold: they are <b>potential</b> indicators, not confirmed minerals. Uncoloured = no indicator above threshold. Dotted outlines = observation footprints.</>,
            }
          : {
              key: "minerals" as LayerKey, label: "Minerals", icon: "crystal", kind: "unavailable",
              what: "Orbital mineral maps: not available yet",
              details: <>CRISM mineral data is not ingested, so the layer stays off rather than showing illustrations.</>,
            },
        ...(water
          ? [{
              key: "water" as LayerKey, label: "Ancient Water Evidence", icon: "drop", kind: "estimate",
              what: `Evidence index · ${water.zones.length} highlighted regions`,
              details: <>A PAWPRINT index (0–1) combining CRISM water-related mineral signals, USGS SIM 3464 geologic units and CTX landform relief on a ~{water.grid.cell_m} m grid. The weights are project <Term k="hazard">assumptions</Term>. It shows where <b>ancient</b> water left evidence in the rocks; it is <b>not</b> a probability of finding water today. Click the map for a cell's breakdown.</>,
            }]
          : []),
        ...(photos
          ? [{
              key: "photos" as LayerKey, label: "Ground View photos", icon: "camera", kind: "real",
              what: `${nGeo} NASA rover photos placed by NASA localization`,
              details: <>Perseverance raw images from NASA's raw-image archive, taken on each sample's sealing sol. A camera pin marks where the <b>rover</b> stood (NASA localization for the image's site/drive). <button className="link-btn" onClick={onOpenGroundView}>Open Ground View</button></>,
            }]
          : []),
      ],
    },
    {
      title: "Rover Exploration",
      icon: "rover",
      blurb: "Where Perseverance drove",
      rows: [roverRow],
    },
  ];

  // Extra keys and sliders live inside the category they explain.
  const extras: Record<string, ReactNode> = {
    "Terrain & Elevation": (
      <div className="opacity">
        <div className="opacity-head">
          <span>Overlay strength</span>
          <span>{Math.round(opacity * 100)}%</span>
        </div>
        <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(parseFloat(e.target.value))} aria-label="Overlay strength" />
        <p className="fine muted">How strongly elevation colours and steep-ground shading cover the photo.</p>
      </div>
    ),
    Safety: layers.slope ? (
      <div className="key-block">
        <div className="key-title"><Term k="hazard">Steepness key</Term></div>
        <div className="hazard-legend">
          <span><i className="sw easy" />&lt;{cls[0]}°</span>
          <span><i className="sw mod" />{cls[0]}–{cls[1]}°</span>
          <span><i className="sw haz" />{cls[1]}–{cls[2]}°</span>
          <span><i className="sw nogo" />≥{cls[2]}°</span>
        </div>
      </div>
    ) : null,
    "Science & Geology": (
      <>
        {layers.geology && (
          <div className="key-block">
            <div className="key-title">Marker key</div>
            <div className="marker-key">
              <span><i className="mk landing" />Landing site</span>
              <span><i className="mk igneous" />Igneous rock</span>
              <span><i className="mk sedimentary" />Sedimentary</span>
              <span><i className="mk regolith" />Regolith / soil</span>
              <span><i className="mk atmo" />Atmosphere</span>
            </div>
          </div>
        )}
        {layers.geomap && geology && (
          <div className="key-block">
            <div className="key-title">Geologic units · USGS SIM 3464</div>
            <div className="unit-key">
              {geology.units.map((u) => (
                <span key={u.symbol} title={u.interpretation ?? ""}>
                  <i style={{ background: u.color }} /> <b>{u.symbol}</b> {u.name}
                </span>
              ))}
            </div>
          </div>
        )}
        {layers.water && water && setWaterOpacity && (
          <WaterExplorer
            water={water}
            opacity={waterOpacity ?? 0.75}
            setOpacity={setWaterOpacity}
            planning={view === "planner"}
            selectedZone={waterZone ?? null}
            onShowZone={(z) => onShowWaterZone?.(z)}
            onSetDestination={(z) => onWaterDestination?.(z)}
          />
        )}
        {layers.minerals && minerals && (
          <div className="key-block">
            <div className="key-title">Potential mineral indicators · CRISM</div>
            <div className="unit-key">
              {minerals.indicators.map((i) => (
                <span key={i.key} className={i.km2_in_aoi === 0 ? "none" : ""} title={i.meaning}>
                  <i style={{ background: i.color }} /> {INDICATOR_LABEL[i.key] ?? i.key} <em>{i.km2_in_aoi ? `${i.km2_in_aoi} km²` : "none above threshold"}</em>
                </span>
              ))}
            </div>
            <div className="opacity-head"><span>Mineral layer strength</span><span>{Math.round(mineralOpacity * 100)}%</span></div>
            <input type="range" min={0.2} max={1} step={0.05} value={mineralOpacity} onChange={(e) => setMineralOpacity(parseFloat(e.target.value))} aria-label="Mineral layer strength" />
            <p className="fine muted">Indicators, not confirmed identifications. Thresholds are PAWPRINT assumptions; see Science Data.</p>
          </div>
        )}
      </>
    ),
    "Rover Exploration": layers.rover ? (
      <div className="key-block timeline-block">
        <div className="key-title"><Icon name="clock" size={13} /> Mission timeline</div>
        <input
          type="range"
          min={rover.sol_min}
          max={rover.sol_max}
          step={1}
          value={roverMaxSol ?? rover.sol_max}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            setRoverMaxSol(v >= rover.sol_max ? null : v);
          }}
          aria-label="Show rover drives and photos up to this sol"
        />
        <div className="timeline-ticks">
          <span>sol {rover.sol_min}</span>
          <b>up to sol {roverMaxSol ?? rover.sol_max}</b>
          <span>sol {rover.sol_max}</span>
        </div>
        <p className="fine muted">Archived NASA drives and Ground View photos up to the chosen <Term k="sol" />. Data are historical, not live.</p>
      </div>
    ) : null,
  };

  const rowsOf = (rows: Row[]) => (
    <ul className="layer-list">
      {rows.map((r) => {
        const disabled = r.key === "minerals" && !minerals;
        const on = !disabled && layers[r.key as LayerKey];
        const expanded = open === r.key;
        return (
          <li key={r.key} className={`${disabled ? "disabled" : ""} ${expanded ? "expanded" : ""}`}>
            <div className="layer-row">
              <button className="layer-main" onClick={() => setOpen(expanded ? null : r.key)} aria-expanded={expanded} title="Show where this data comes from">
                <span className={`thumb thumb-${r.key}`} style={r.thumb ? { backgroundImage: `url(/data/${r.thumb})` } : undefined}>
                  {!r.thumb && <Icon name={r.icon} size={16} />}
                </span>
                <span className="layer-text">
                  <span className="layer-label">
                    {r.label} <Icon name={expanded ? "chevronUp" : "chevronDown"} size={13} />
                  </span>
                  <span className="layer-sub">{r.what}</span>
                </span>
              </button>
              <Toggle on={on} disabled={disabled} label={`${r.label} layer`} onChange={(v) => setLayer(r.key as LayerKey, v)} />
            </div>
            {expanded && (
              <div className="layer-details">
                <KindBadge kind={r.kind} />
                <p>{r.details}</p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <aside className={`panel layers-panel ${docked ? "docked" : ""} ${collapsed ? "is-collapsed" : ""}`} aria-label="Mission layers">
      <header className="panel-head">
        <Icon name="layers" />
        <h3>Mission Layers</h3>
        <button className="icon-btn" onClick={onCollapse} aria-label={docked ? (collapsed ? "Expand layers panel" : "Collapse layers panel") : "Close layers panel"} aria-expanded={docked ? !collapsed : undefined}>
          <Icon name={docked ? (collapsed ? "chevronDown" : "chevronUp") : "chevronLeft"} size={16} />
        </button>
      </header>
      {!collapsed && (
        <>
          <p className="panel-intro">Add data layers to explore terrain, geology and mission context.</p>
          <div className="layer-cats">
            {groups.map((g) => {
              const isOpen = !!openCats[g.title];
              const onCount = g.rows.filter((r) => layers[r.key] && !(r.key === "minerals" && !minerals)).length;
              return (
                <section key={g.title} className={`layer-cat ${isOpen ? "open" : ""}`}>
                  <button className="layer-cat-head" aria-expanded={isOpen} onClick={() => setOpenCats((c) => ({ ...c, [g.title]: !isOpen }))}>
                    <span className="layer-cat-icon"><Icon name={g.icon} size={18} /></span>
                    <span className="layer-cat-text">
                      <b>{g.title}</b>
                      <em>{isOpen ? g.blurb : `${onCount} of ${g.rows.length} on`}</em>
                    </span>
                    <Icon name={isOpen ? "chevronUp" : "chevronDown"} size={16} />
                  </button>
                  {isOpen && (
                    <div className="layer-cat-body">
                      {rowsOf(g.rows)}
                      {extras[g.title]}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          {!docked && (
            <div className="layers-tip">
              {view === "explore" ? (
                <DogTip compact>Click anywhere on the map and I'll sniff out the height, slope and hazard class right there.</DogTip>
              ) : (
                <DogTip compact>
                  Slopes come from a 20 m terrain model, which smooths out small rocks. Inside the dashed HiRISE box the planner uses sharper 4 m terrain.
                </DogTip>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
