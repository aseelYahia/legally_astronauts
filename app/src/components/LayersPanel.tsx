import type { Manifest } from "../types";
import type { LayerKey } from "./MapView";
import { Icon, KindBadge, Mascot, Toggle } from "./ui";

interface Row {
  key: LayerKey | "minerals";
  label: string;
  sub: string;
  icon: string;
  thumb?: string;
  kind: string;
  title: string;
}

export function LayersPanel({
  manifest,
  layers,
  setLayer,
  opacity,
  setOpacity,
  onCollapse,
}: {
  manifest: Manifest;
  layers: Record<LayerKey, boolean>;
  setLayer: (k: LayerKey, v: boolean) => void;
  opacity: number;
  setOpacity: (v: number) => void;
  onCollapse: () => void;
}) {
  const L = manifest.layers;
  const rover = L.rover as unknown as { sol_min: number; sol_max: number };
  const hasHirise = Boolean(L.hirise_elevation);
  const rows: Row[] = [
    { key: "terrain", label: "Terrain base", sub: "CTX orthoimage · 6 m", icon: "terrain", thumb: L.terrain.file, kind: "real", title: "USGS Mars 2020 TRN CTX orthomosaic" },
    { key: "elevation", label: "Elevation", sub: hasHirise ? "contours · CTX 20 m + HiRISE 1 m" : "contours · CTX DTM 20 m", icon: "contour", thumb: L.elevation.file, kind: "real-derived", title: "Colour-shaded relief + 10 m contours from the USGS DTMs" },
    { key: "slope", label: "Slope hazards", sub: `(> ${manifest.assumptions.slope_classes_deg[1]}°) · Horn method`, icon: "warn", thumb: L.slope.file, kind: "real-derived", title: "Slope computed in Python from the DTM; thresholds are planning assumptions" },
    { key: "minerals", label: "Minerals", sub: "(orbital) CRISM not ingested", icon: "crystal", kind: "unavailable", title: "CRISM mineral maps are not part of this prototype" },
    { key: "geology", label: "Geology samples", sub: "NASA sample sites", icon: "crystal", kind: "real", title: "Sample names/types from NASA; positions estimated from rover localizations" },
    { key: "rover", label: "Rover tracks", sub: `(historical) sols ${rover.sol_min}–${rover.sol_max}`, icon: "rover", kind: "real", title: "NASA/JPL MMGIS Perseverance traverse" },
    { key: "weather", label: "Weather", sub: "(MEDA archive) panel", icon: "cloud", kind: "archived", title: "NASA MEDA public feed, last updated sol 1133" },
  ];
  return (
    <aside className="panel layers-panel">
      <header className="panel-head">
        <Icon name="layers" />
        <h3>MISSION LAYERS</h3>
        <button className="icon-btn" onClick={onCollapse} aria-label="Collapse layers panel">
          <Icon name="chevronLeft" size={16} />
        </button>
      </header>
      <ul className="layer-list">
        {rows.map((r) => {
          const disabled = r.key === "minerals";
          const on = !disabled && layers[r.key as LayerKey];
          return (
            <li key={r.key} className={disabled ? "disabled" : ""} title={r.title}>
              <span className={`thumb thumb-${r.key}`} style={r.thumb ? { backgroundImage: `url(/data/${r.thumb})` } : undefined}>
                {!r.thumb && <Icon name={r.icon} size={16} />}
              </span>
              <span className="layer-text">
                <span className="layer-label">{r.label}</span>
                <span className="layer-sub">{r.sub}</span>
                <KindBadge kind={r.kind} />
              </span>
              <Toggle on={on} disabled={disabled} label={r.label} onChange={(v) => setLayer(r.key as LayerKey, v)} />
            </li>
          );
        })}
      </ul>
      <div className="opacity">
        <div className="opacity-head">
          <span>Overlay opacity</span>
          <span>{Math.round(opacity * 100)}%</span>
        </div>
        <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(parseFloat(e.target.value))} aria-label="Overlay opacity" />
      </div>
      {layers.slope && (
        <div className="hazard-legend">
          <span><i className="sw easy" />&lt;10°</span>
          <span><i className="sw mod" />10–15°</span>
          <span><i className="sw haz" />15–25°</span>
          <span><i className="sw nogo" />≥25°</span>
        </div>
      )}
      <div className="tip-card">
        <Mascot pose="crawling" size={54} />
        <p>
          <b>Paw tip:</b> slopes come from a 20 m DTM, which smooths out boulders and small scarps. Inside the dashed HiRISE box the planner
          switches to 4 m terrain.
        </p>
      </div>
    </aside>
  );
}
