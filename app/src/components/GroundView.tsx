import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from "react";
import { formatLat, formatLon } from "../lib/mars";
import {
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  PHOTO_FILTERS,
  categoryOf,
  filterCounts,
  filterPhotos,
  galleryFor,
  placeLabel,
  placeOf,
  sampleCheck,
  shortCamera,
  stepIndex,
  type Photo,
  type PhotoFilter,
  type PhotosFile,
} from "../lib/nasaExtras";
import type { Poi } from "../types";
import { Icon, KindBadge } from "./ui";

const thumbSrc = (p: Photo) => `/data/${p.thumb}`;

function PlaceBadge({ p, compact }: { p: Photo; compact?: boolean }) {
  const l = placeLabel(p);
  return (
    <span className={`gv-place tone-${l.tone}${compact ? " compact" : ""}`} title={l.long}>
      {l.tone === "ok" && <Icon name="check" size={11} />}
      {l.short}
    </span>
  );
}

function Tile({ p, onOpen, small }: { p: Photo; onOpen: () => void; small?: boolean }) {
  const cat = categoryOf(p);
  return (
    <button className={`gv-tile${small ? " small" : ""}`} onClick={onOpen} title={`${p.camera_label}, sol ${p.sol} — open larger`}>
      <img src={thumbSrc(p)} alt={`${CATEGORY_LABEL[cat]}: ${p.camera_label}, sol ${p.sol}`} loading="lazy" decoding="async" />
      <PlaceBadge p={p} compact />
      <span className="gv-tile-cap">
        <span className={`gv-cat cat-${cat}`}>{CATEGORY_SHORT[cat]}</span>
        <span className="gv-tile-meta">
          {shortCamera(p.camera_label)} · sol {p.sol}
        </span>
      </span>
    </button>
  );
}

/** Large image with zoom (buttons, wheel, double-click, + / - / 0 keys) and drag-to-pan. */
function ZoomImage({ p }: { p: Photo }) {
  const [src, setSrc] = useState(p.img_large || p.img_medium);
  const [loaded, setLoaded] = useState(false);
  const [z, setZ] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  useEffect(() => {
    setSrc(p.img_large || p.img_medium);
    setLoaded(false);
    setZ(1);
    setOff({ x: 0, y: 0 });
  }, [p]);
  const zoomTo = useCallback((nz: number) => {
    const c = Math.min(6, Math.max(1, nz));
    setZ(c);
    if (c === 1) setOff({ x: 0, y: 0 });
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === "+" || e.key === "=") zoomTo(z * 1.5);
      else if (e.key === "-" || e.key === "_") zoomTo(z / 1.5);
      else if (e.key === "0") zoomTo(1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [z, zoomTo]);
  const onWheel = (e: RWheelEvent) => zoomTo(z * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
  const onDown = (e: RPointerEvent) => {
    if (z === 1) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (d) setOff({ x: d.ox + (e.clientX - d.x) / z, y: d.oy + (e.clientY - d.y) / z });
  };
  const onUp = () => (drag.current = null);
  const fallback = () => {
    if (src === p.img_large && p.img_medium) setSrc(p.img_medium);
    else if (src !== thumbSrc(p)) setSrc(thumbSrc(p));
  };
  return (
    <div className={`gv-stage${z > 1 ? " zoomed" : ""}`} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={() => zoomTo(z > 1 ? 1 : 2.5)}>
      {!loaded && <img className="gv-stage-ph" src={thumbSrc(p)} alt="" aria-hidden />}
      <img
        className="gv-stage-img"
        src={src}
        alt={`${p.camera_label}, sol ${p.sol}: ${p.title}`}
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={fallback}
        style={{ transform: `scale(${z}) translate(${off.x}px, ${off.y}px)`, opacity: loaded ? 1 : 0 }}
      />
      {!loaded && <span className="gv-loading">Loading NASA image…</span>}
      <div className="gv-zoom" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" onClick={() => zoomTo(z / 1.5)} disabled={z <= 1} aria-label="Zoom out (minus key)">
          <Icon name="minus" size={15} />
        </button>
        <span aria-live="polite">{Math.round(z * 100)}%</span>
        <button className="icon-btn" onClick={() => zoomTo(z * 1.5)} disabled={z >= 6} aria-label="Zoom in (plus key)">
          <Icon name="plus" size={15} />
        </button>
        {z > 1 && (
          <button className="link-btn" onClick={() => zoomTo(1)}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

function Viewer({
  list,
  index,
  setIndex,
  onClose,
  onFly,
}: {
  list: Photo[];
  index: number;
  setIndex: (i: number) => void;
  onClose: () => void;
  onFly: (lon: number, lat: number) => void;
}) {
  const p = list[index];
  const l = p.location;
  const pl = placeLabel(p);
  const cat = categoryOf(p);
  const go = useCallback((d: 1 | -1) => setIndex(stepIndex(index, list.length, d)), [index, list.length, setIndex]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [go]);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <div className="gv-viewer" role="dialog" aria-modal="true" aria-label={`Photo ${index + 1} of ${list.length}`}>
      <div className="gv-viewer-top">
        <span className="gv-count">
          {index + 1} / {list.length}
        </span>
        <span className="gv-keys fine">← → next · + − zoom · Esc back</span>
        <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Back to gallery (Esc)">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="gv-viewer-body">
        <div className="gv-viewer-media">
          <ZoomImage p={p} />
          {list.length > 1 && (
            <>
              <button className="gv-nav prev" onClick={() => go(-1)} aria-label="Previous photo (left arrow)">
                <Icon name="chevron" size={22} />
              </button>
              <button className="gv-nav next" onClick={() => go(1)} aria-label="Next photo (right arrow)">
                <Icon name="chevron" size={22} />
              </button>
            </>
          )}
        </div>
        <aside className="gv-details">
          <div className="gv-details-head">
            <span className={`gv-cat cat-${cat}`}>{CATEGORY_LABEL[cat]}</span>
            <PlaceBadge p={p} />
          </div>
          <h4>{p.camera_label}</h4>
          <p className="fine muted">{p.camera_note}</p>
          <dl className="gv-meta">
            <dt>Sol</dt>
            <dd>
              {p.sol} <span className="muted">({p.date_taken_mars.replace(/^Sol-\d+M/, "local solar time ").replace(/\.\d+$/, "")})</span>
            </dd>
            <dt>Earth date</dt>
            <dd>
              {p.date_taken_utc.slice(0, 10)} {p.date_taken_utc.slice(11, 19)} UTC
            </dd>
            <dt>Location</dt>
            <dd>
              {pl.long}
              {l.geolocated && l.lon !== undefined && l.lat !== undefined && (
                <>
                  <br />
                  <KindBadge kind="real" title={l.method} /> Rover at {formatLat(l.lat)}, {formatLon(l.lon)}
                  <br />
                  <button className="link-btn" onClick={() => onFly(l.lon!, l.lat!)}>
                    <Icon name="pin" size={12} /> Show rover position on map
                  </button>
                </>
              )}
            </dd>
            <dt>Category</dt>
            <dd>
              {CATEGORY_LABEL[cat]} <span className="gv-auto">automatic</span>
              {p.category_reason && <span className="dd-note">{p.category_reason} Sorted by PAWPRINT, not a NASA label.</span>}
            </dd>
            <dt>Credit</dt>
            <dd>{p.credit}</dd>
            <dt>Image ID</dt>
            <dd className="gv-id">{p.id}</dd>
          </dl>
          {p.context && <p className="gv-context">{p.context}</p>}
          <div className="gv-links">
            <a className="btn-mini lav" href={p.nasa_page} target="_blank" rel="noreferrer">
              <Icon name="link" size={12} /> NASA image page
            </a>
            <a className="btn-mini" href={p.img_full} target="_blank" rel="noreferrer" title="NASA's full-resolution file (PNG, can be several MB)">
              Full resolution
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function GroundView({
  photos,
  pois,
  initialPoiId,
  onClose,
  onFly,
}: {
  photos: PhotosFile;
  pois: Poi[];
  initialPoiId?: string | null;
  onClose: () => void;
  onFly: (lon: number, lat: number) => void;
}) {
  const sites = useMemo(() => pois.filter((p) => photos.photos.some((x) => x.poi_id === p.id)), [photos, pois]);
  const unlocated = useMemo(() => photos.photos.filter((p) => !p.location.geolocated), [photos]);
  const [sel, setSel] = useState<string>(initialPoiId && sites.some((s) => s.id === initialPoiId) ? initialPoiId : sites[0]?.id ?? "unlocated");
  const [filter, setFilter] = useState<PhotoFilter>("all");
  const [viewer, setViewer] = useState<{ list: Photo[]; index: number } | null>(null);
  const [showOther, setShowOther] = useState(false);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (viewer) setViewer(null);
      else onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, viewer]);
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    setShowOther(false);
  }, [sel]);

  const poi = pois.find((p) => p.id === sel);
  const { terrain, other } = useMemo(
    () => (sel === "unlocated" ? { terrain: unlocated.filter((p) => categoryOf(p) !== "other"), other: unlocated.filter((p) => categoryOf(p) === "other") } : galleryFor(photos, sel)),
    [photos, sel, unlocated],
  );
  const counts = filterCounts(terrain);
  const activeFilter = counts[filter] > 0 ? filter : "all";
  const shown = filterPhotos(terrain, activeFilter);
  const check = poi ? sampleCheck(photos, poi.id) : undefined;
  const places = useMemo(() => {
    const all = [...terrain, ...other];
    const n = (k: string) => all.filter((p) => placeOf(p) === k).length;
    return { at: n("at_site"), near: n("nearby"), reg: n("regional"), none: n("not_geolocated") };
  }, [terrain, other]);
  const sel_ = photos.selection;

  return (
    <div className="gv-backdrop" role="dialog" aria-modal="true" aria-label="Mars Ground View" onClick={onClose}>
      <div className="gv" onClick={(e) => e.stopPropagation()}>
        <header className="gv-head">
          <div>
            <h3>
              <Icon name="camera" size={18} /> Mars Ground View
            </h3>
            <p>Real Perseverance photos from NASA's raw-image archive, picked for landscapes, rocks and terrain.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close Ground View">
            <Icon name="close" size={16} />
          </button>
        </header>
        <details className="gv-howto">
          <summary>
            <Icon name="info" size={13} /> Rover cameras sit 1–2 m above the ground. A photo's location is where the <b>rover</b> stood (NASA localization), not
            where the camera pointed. <span className="link-btn">How photos are sorted</span>
          </summary>
          <div className="gv-howto-body">
            {sel_ ? (
              <>
                <p>{sel_.summary}</p>
                <dl className="gv-meta">
                  {(["landscape", "geology", "rocks", "other"] as const).map((c) => (
                    <div key={c} className="gv-def">
                      <dt>{CATEGORY_LABEL[c]}</dt>
                      <dd>{sel_.categories[c]}</dd>
                    </div>
                  ))}
                  <div className="gv-def">
                    <dt>At this site</dt>
                    <dd>{sel_.places.at_site}</dd>
                  </div>
                  <div className="gv-def">
                    <dt>Nearby / Regional</dt>
                    <dd>
                      {sel_.places.nearby} {sel_.places.regional}
                    </dd>
                  </div>
                  <div className="gv-def">
                    <dt>Not geolocated</dt>
                    <dd>{sel_.places.not_geolocated}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p>A photo is placed on the map only when NASA's own localization for the rover's site/drive exists.</p>
            )}
          </div>
        </details>
        <div className="gv-body">
          <nav className="gv-sites" aria-label="Photo locations">
            {sites.map((s) => {
              const n = photos.photos.filter((x) => x.poi_id === s.id && categoryOf(x) !== "other").length;
              return (
                <button key={s.id} className={sel === s.id ? "active" : ""} onClick={() => setSel(s.id)} aria-current={sel === s.id}>
                  <b>
                    {s.number ? <span className="gv-num">#{s.number}</span> : null}
                    {s.name}
                  </b>
                  <span>
                    {s.campaign ?? "Landing"} · sol {s.sol_sealed ?? 13} · {n} photos
                  </span>
                </button>
              );
            })}
            {unlocated.length > 0 && (
              <button className={sel === "unlocated" ? "active" : ""} onClick={() => setSel("unlocated")}>
                <b>Not geolocated ({unlocated.length})</b>
                <span>No NASA localization for the image's site/drive</span>
              </button>
            )}
          </nav>
          <div className="gv-main" ref={mainRef}>
            {poi && (
              <div className="gv-site-head">
                <h4>
                  {poi.number ? `Sample #${poi.number} · ` : ""}
                  {poi.name}
                </h4>
                <p className="fine muted">
                  {poi.category === "sample" ? `${poi.campaign} · sealed sol ${poi.sol_sealed} (${poi.date_sealed})` : poi.description}
                </p>
                <div className="gv-chips">
                  {check &&
                    (check.corroborated ? (
                      <span className="gv-place tone-ok" title={`NASA images from the sealing sol were taken at rover localization ${check.marker_rmc}, the same one used for this sample marker.`}>
                        <Icon name="check" size={11} /> Marker position confirmed by NASA image metadata
                      </span>
                    ) : (
                      <span className="gv-place tone-far" title={`Sealing-sol images: ${check.image_rmcs_on_sealing_sol.join(", ") || "none"}; marker: ${check.marker_rmc}.`}>
                        Marker position not confirmed by image metadata
                      </span>
                    ))}
                  {places.at > 0 && <span className="gv-place tone-ok">{places.at} photos at this site</span>}
                  {places.near > 0 && <span className="gv-place tone-near">{places.near} nearby</span>}
                  {places.reg > 0 && <span className="gv-place tone-far">{places.reg} regional</span>}
                  {places.none > 0 && <span className="gv-place tone-none">{places.none} not geolocated</span>}
                </div>
              </div>
            )}
            {sel === "unlocated" && (
              <p className="fine muted gv-site-head">These images have no NASA localization for their site/drive, so PAWPRINT does not place them on the map.</p>
            )}
            <div className="gv-filters" role="tablist" aria-label="Photo type">
              {PHOTO_FILTERS.map((f) => (
                <button
                  key={f.key}
                  role="tab"
                  aria-selected={activeFilter === f.key}
                  className={activeFilter === f.key ? "active" : ""}
                  disabled={counts[f.key] === 0}
                  onClick={() => setFilter(f.key)}
                  title={f.hint}
                >
                  {f.label} <span className="gv-n">{counts[f.key]}</span>
                </button>
              ))}
              <span className="gv-auto" title="Categories are sorted automatically by PAWPRINT from NASA metadata and simple image statistics; they are not NASA labels.">
                auto-sorted
              </span>
            </div>
            {shown.length === 0 ? (
              <p className="fine muted gv-empty">No terrain photos were found for this place. The rover and sample frames below are still available.</p>
            ) : (
              <div className="gv-grid">
                {shown.map((p, i) => (
                  <Tile key={p.id} p={p} onOpen={() => setViewer({ list: shown, index: i })} />
                ))}
              </div>
            )}
            {other.length > 0 && (
              <div className="gv-other">
                <button className="gv-other-toggle" onClick={() => setShowOther((v) => !v)} aria-expanded={showOther}>
                  <Icon name="chevron" size={13} /> Rover hardware &amp; sample tube ({other.length})
                  <span className="fine muted"> kept out of the main gallery</span>
                </button>
                {showOther && (
                  <div className="gv-grid small">
                    {other.map((p, i) => (
                      <Tile key={p.id} p={p} small onOpen={() => setViewer({ list: other, index: i })} />
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="fine muted gv-foot">
              Source: {photos.source}. Images: NASA/JPL-Caltech (Mastcam-Z: NASA/JPL-Caltech/ASU). Fetched {photos.fetched_utc.slice(0, 10)}.
            </p>
          </div>
        </div>
        {viewer && (
          <Viewer
            list={viewer.list}
            index={viewer.index}
            setIndex={(i) => setViewer({ ...viewer, index: i })}
            onClose={() => setViewer(null)}
            onFly={(lon, lat) => {
              onFly(lon, lat);
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}
