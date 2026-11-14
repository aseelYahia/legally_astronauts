import { useState, type ReactNode } from "react";
import type { Manifest } from "../types";
import type { LayerKey } from "./MapView";
import { DogTip, Icon, KindBadge, Term, Toggle } from "./ui";

interface Row {
  key: LayerKey | "minerals";
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
}: {
  manifest: Manifest;
  layers: Record<LayerKey, boolean>;
  setLayer: (k: LayerKey, v: boolean) => void;
  opacity: number;
  setOpacity: (v: number) => void;
  onCollapse: () => void;
  view: "explore" | "planner";
}) {
  const [open, setOpen] = useState<string | null>(null);
  const L = manifest.layers;
  const rover = L.rover as unknown as { sol_min: number; sol_max: number };
  const hasHirise = Boolean(L.hirise_elevation);
  const cls = manifest.assumptions.slope_classes_deg;

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Base map",
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
      ],
    },
    {
      title: "Terrain safety",
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
      ],
    },
    {
      title: "Science",
      rows: [
        {
          key: "geology", label: "Rock samples", icon: "crystal", kind: "real",
          what: "Where Perseverance collected samples",
          details: <>Names, sols and types from NASA's sample table. Positions are <Term k="estimated">estimated</Term> from rover locations.</>,
        },
        {
          key: "rover", label: "Rover tracks", icon: "rover", kind: "real",
          what: `Perseverance's drives, sols ${rover.sol_min}–${rover.sol_max}`,
          details: <>NASA/JPL MMGIS traverse, clipped to this prototype area. Hover a track to see its <Term k="sol" />.</>,
        },
        {
          key: "minerals", label: "Minerals", icon: "crystal", kind: "unavailable",
          what: "Orbital mineral maps: not available yet",
          details: <>CRISM mineral data is not ingested in this prototype, so the layer stays off rather than showing illustrations.</>,
        },
      ],
    },
    {
      title: "Environment",
      rows: [
        {
          key: "weather", label: "Weather", icon: "cloud", kind: "archived",
          what: "Rover weather readings from 2024",
          details: <><Term k="meda" /> daily summary, sols 1127–1133. Not a forecast, and not used in route calculations.</>,
        },
      ],
    },
  ];

  return (
    <aside className="panel layers-panel" aria-label="Mission layers">
      <header className="panel-head">
        <Icon name="layers" />
        <h3>Mission Layers</h3>
        <button className="icon-btn" onClick={onCollapse} aria-label="Close layers panel">
          <Icon name="chevronLeft" size={16} />
        </button>
      </header>
      <p className="panel-intro">Turn layers on or off. Open a layer to see where its data comes from.</p>

      <div className="layer-groups">
        {groups.map((g) => (
          <section key={g.title} className="layer-group">
            <h4>{g.title}</h4>
            <ul className="layer-list">
              {g.rows.map((r) => {
                const disabled = r.key === "minerals";
                const on = !disabled && layers[r.key as LayerKey];
                const expanded = open === r.key;
                return (
                  <li key={r.key} className={`${disabled ? "disabled" : ""} ${expanded ? "expanded" : ""}`}>
                    <div className="layer-row">
                      <button className="layer-main" onClick={() => setOpen(expanded ? null : r.key)} aria-expanded={expanded}>
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
          </section>
        ))}
      </div>

      <div className="opacity">
        <div className="opacity-head">
          <span>Overlay strength</span>
          <span>{Math.round(opacity * 100)}%</span>
        </div>
        <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(parseFloat(e.target.value))} aria-label="Overlay strength" />
        <p className="fine muted">How strongly elevation colours and steep-ground shading cover the photo.</p>
      </div>

      {layers.slope && (
        <div className="key-block">
          <div className="key-title"><Term k="hazard">Steepness key</Term></div>
          <div className="hazard-legend">
            <span><i className="sw easy" />&lt;{cls[0]}°</span>
            <span><i className="sw mod" />{cls[0]}–{cls[1]}°</span>
            <span><i className="sw haz" />{cls[1]}–{cls[2]}°</span>
            <span><i className="sw nogo" />≥{cls[2]}°</span>
          </div>
        </div>
      )}
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

      <div className="layers-tip">
        {view === "explore" ? (
          <DogTip compact>Click anywhere on the map and I'll sniff out the height, slope and hazard class right there.</DogTip>
        ) : (
          <DogTip compact>
            Slopes come from a 20 m terrain model, which smooths out small rocks. Inside the dashed HiRISE box the planner uses sharper 4 m terrain.
          </DogTip>
        )}
      </div>
    </aside>
  );
}
