import L from "leaflet";
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, Marker, Pane, Polyline, useMap, useMapEvents } from "react-leaflet";
import { useMapSelection } from "./MapSelectionContext";
import { formatLat, formatLon } from "../../lib/mars";
import { fmtDist, fmtMin, groupHazards, pickIconOffset, type HazardGroup, type RouteHazard } from "../../lib/routeHazards";
import { WARNING_ICONS, type WarningIconKey } from "../../lib/warningCatalog";
import type { LonLat } from "../../types";
import { Icon, KindBadge } from "../ui";
import "./hazards.css";

/** Route hazard markers.
 *
 *  Geography is never altered: each marker's Leaflet position is exactly the route point the hazard was
 *  measured at (RouteHazard.at === route.path_lonlat[index]). Only the drawn icon is offset in screen space
 *  (with a stem back to the anchor dot) so it never covers a science target, a stop or another icon.
 *  Close markers are grouped per zoom level; a group sits on its most severe member's exact anchor. */

const SEV_COLOR = { warning: "#D98EBA", caution: "#E9BF9F" } as const;
const WHO_COLOR = { A: "#76C9C2", B: "#A99BDD" } as const;
const ICON_FOR: Record<RouteHazard["kind"], WarningIconKey> = { steep: "steep", "moderate-slope": "steep", "slope-limit": "limit", climb: "climb" };
const SHOW_KEY = "pawprint.routeHazards.show";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const svgIcon = (k: WarningIconKey, size: number) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${WARNING_ICONS[k].map((d) => `<path d="${d}"/>`).join("")}</svg>`;

function markerIcon(g: HazardGroup, off: [number, number], state: "" | "sel" | "rel") {
  const h = g.members[0];
  const multi = g.members.length > 1;
  const whos = [...new Set(g.members.map((m) => m.astronaut).filter(Boolean))] as ("A" | "B")[];
  const ring = whos.length === 1 ? WHO_COLOR[whos[0]] : "#F1EDF5";
  const tip = multi
    ? `${g.members.length} route warnings here. Click to choose one.`
    : `${h.severity === "warning" ? "Warning" : "Caution"} · ${h.title} · ${fmtDist(h.distance_m)} along the route`;
  const len = Math.hypot(off[0], off[1]);
  const ux = off[0] / len;
  const uy = off[1] / len;
  // stem from the anchor dot to the edge of the icon disc
  const stem = `<svg class="hz-stem" width="1" height="1"><line x1="${ux * 3}" y1="${uy * 3}" x2="${off[0] - ux * 13}" y2="${off[1] - uy * 13}" /></svg>`;
  const body = multi ? `<b>${g.members.length}</b>` : svgIcon(ICON_FOR[h.kind], 16);
  const who = whos.length ? `<i class="hz-who">${whos.join("·")}</i>` : "";
  return L.divIcon({
    className: `hz-marker ${state ? `hz-${state}` : ""}`,
    html:
      `<div class="hz sev-${g.severity}${multi ? " hz-group" : ""}" style="--sev:${SEV_COLOR[g.severity]};--ring:${ring}">` +
      `${stem}<span class="hz-dot"></span>` +
      `<span class="hz-ico" role="button" aria-label="${esc(tip)}" title="${esc(tip)}" style="left:${off[0]}px;top:${off[1]}px">${body}${who}</span>` +
      `</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    popupAnchor: [off[0], off[1] - 14],
  });
}

/** The explanation shown in the popup (also used by group popups). */
export const HazardDetails = memo(function HazardDetails({ h, inPanel }: { h: RouteHazard; inPanel?: boolean }) {
  const T = h.kind === "climb";
  return (
    <div className="popup hz-pop" data-hazard-id={h.id}>
      <div className="hz-pop-head">
        <span className="hz-pop-ico" style={{ color: SEV_COLOR[h.severity] }} dangerouslySetInnerHTML={{ __html: svgIcon(ICON_FOR[h.kind], 18) }} />
        <span className={`hz-sev sev-${h.severity}`}>{h.severity === "warning" ? "Warning" : "Caution"}</span>
        <span className="hz-type">{h.label}</span>
        {h.astronaut && <span className={`hz-astro who-${h.astronaut}`}>Astronaut {h.astronaut}</span>}
      </div>
      {!inPanel && <div className="popup-title">{h.title.replace(/^Astronaut [AB]: /, "")}</div>}
      <dl className="hz-facts">
        <dt>{T ? "Measured climb" : "Measured slope"}</dt>
        <dd>
          <b>{h.valueLabel}</b>
          {T ? ` over ${fmtDist(h.length_m)}` : h.length_m > 0 ? ` (steepest point of a ${fmtDist(h.length_m)} stretch)` : " (one terrain cell)"}
        </dd>
        <dt>Location</dt>
        <dd>
          {formatLat(h.at[1], 5)}, {formatLon(h.at[0], 5)}
        </dd>
        <dt>Along route</dt>
        <dd>
          {fmtDist(h.distance_m)} from the start · ≈ {fmtMin(h.elapsed_s)} of walking
          {h.length_m > 0 && <span className="dd-note">{T ? "Climb" : "Stretch"} from {fmtDist(h.start_m)} to {fmtDist(h.end_m)}</span>}
        </dd>
      </dl>
      <div className="hz-sec">
        <span>Why it matters</span>
        <p>{h.why}</p>
        {h.note && <p className="hz-note">{h.note}</p>}
      </div>
      <div className="hz-sec hz-rec">
        <span>What to do</span>
        <p>{h.recommendation}</p>
      </div>
      <details className="hz-src">
        <summary>
          <span className="hz-grid">
            Source: {h.source.grid} DTM · {h.source.resolution_m} m grid
          </span>
          <KindBadge kind="real-derived" title={h.source.kind} />
          <KindBadge kind="assumption" title={h.source.thresholds} />
        </summary>
        <p>
          {h.source.dataset}. {h.source.kind}
        </p>
        <p>{h.source.thresholds}</p>
      </details>
    </div>
  );
});

export function GroupList({ g, onPick }: { g: HazardGroup; onPick: (h: RouteHazard) => void }) {
  return (
    <div className="popup hz-pop group-popup">
      <div className="popup-title">{g.members.length} route warnings here</div>
      <p className="popup-note">These hazards are close together at this zoom. Each one is still pinned to its own route point. Pick one, or zoom in to separate them.</p>
      <ul className="group-list">
        {g.members.map((m) => (
          <li key={m.id}>
            <button className="group-item hz-item" onClick={() => onPick(m)}>
              <i className="hz-item-dot" style={{ background: SEV_COLOR[m.severity] }} />
              <span className="gi-name">{m.title}</span>
              <span className="gi-meta">
                {m.severity === "warning" ? "Warning" : "Caution"} · {fmtDist(m.distance_m)} along the route
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Props {
  hazards: RouteHazard[];
  /** Exact positions to keep icons clear of (science targets, stops, team pins). */
  avoid: LonLat[];
  selectedAlertId?: string | null;
  onSelectAlert?: (id: string | null) => void;
  /** Bumped by the board's "Show on map" to re-fly to the selected warning. */
  locateKey?: number;
}

type Sel = { kind: "hazard"; id: string } | { kind: "group"; key: string } | null;

export function HazardLayer({ hazards, avoid, selectedAlertId = null, onSelectAlert, locateKey }: Props) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(SHOW_KEY) !== "0";
    } catch {
      return true;
    }
  });
  // The selection lives in the shared map selection (the details show in the map information panel).
  const ctx = useMapSelection();
  const sel: Sel = ctx.sel?.kind === "hazard" ? { kind: "hazard", id: ctx.sel.id } : ctx.sel?.kind === "hazard-group" ? { kind: "group", key: ctx.sel.key } : null;
  const selRef = useRef<Sel>(sel);
  selRef.current = sel;
  const groupsRef = useRef<HazardGroup[]>([]);
  const quiet = useRef(false);
  const setSel = (s: Sel) => {
    selRef.current = s;
    if (s?.kind === "hazard") ctx.select({ kind: "hazard", id: s.id });
    else if (s?.kind === "group") {
      const g = groupsRef.current.find((x) => x.key === s.key);
      if (g) ctx.select({ kind: "hazard-group", key: g.key, members: g.members });
    } else if (ctx.sel?.kind === "hazard" || ctx.sel?.kind === "hazard-group") {
      quiet.current = true;
      ctx.select(null); // never clear someone else's selection
    }
  };
  const emitted = useRef<string | null | undefined>(undefined);
  const emit = (id: string | null) => {
    if (id === selectedAlertId) return;
    emitted.current = id;
    onSelectAlert?.(id);
  };
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const toggle = (v: boolean) => {
    setShow(v);
    if (!v) setSel(null);
    try {
      localStorage.setItem(SHOW_KEY, v ? "1" : "0");
    } catch {
      /* private mode */
    }
  };

  // a new route (option switch, re-plan, team re-plan) invalidates a selection that no longer exists
  useEffect(() => {
    const s = selRef.current;
    if (s?.kind === "hazard" && !hazards.some((h) => h.id === s.id)) setSel(null);
    if (s?.kind === "group") setSel(null);
  }, [hazards]);

  const groups = useMemo(() => (show ? groupHazards(hazards, zoom) : []), [hazards, zoom, show]);
  groupsRef.current = groups;

  // Icon offsets: CRS pixel coordinates at this zoom (pan-independent), so this only changes on zoom.
  const offsets = useMemo(() => {
    const pt = (ll: LonLat) => map.project([ll[1], ll[0]], zoom);
    const obstacles = [...avoid.map(pt), ...groups.map((g) => pt(g.at))];
    const placed: { x: number; y: number }[] = [];
    const out: Record<string, [number, number]> = {};
    for (const g of groups) {
      const a = pt(g.at);
      const others = obstacles.filter((o) => Math.hypot(o.x - a.x, o.y - a.y) > 0.5);
      const off = pickIconOffset(a, others, placed);
      placed.push({ x: a.x + off[0], y: a.y + off[1] });
      out[g.key] = off;
    }
    return out;
  }, [groups, avoid, zoom, map]);

  const selHazard = sel?.kind === "hazard" ? hazards.find((h) => h.id === sel.id) ?? null : null;
  const matchesAlert = (h: RouteHazard, id: string | null) => !!id && (h.alertId === id || h.alsoAlertIds.includes(id));

  // Selecting a warning (marker, group list in the panel, test hook) tells the board; see the effect below.
  const select = (h: RouteHazard) => setSel({ kind: "hazard", id: h.id });

  // Board -> map: a warning picked on the board highlights its markers and flies there.
  const prevLocate = useRef(locateKey);
  useEffect(() => {
    const relocate = locateKey !== prevLocate.current;
    prevLocate.current = locateKey;
    const own = emitted.current === selectedAlertId;
    emitted.current = undefined;
    if (own && !relocate) return; // the map itself just picked this warning
    if (!selectedAlertId) {
      setSel(null);
      return;
    }
    const hits = hazards.filter((h) => matchesAlert(h, selectedAlertId));
    if (!hits.length) {
      setSel(null);
      return;
    }
    if (!show) toggle(true);
    const primary = [...hits].sort((a, b) => (a.severity === b.severity ? b.value - a.value : a.severity === "warning" ? -1 : 1))[0];
    setSel(null);
    const pts = hits.flatMap((h) => [h.at, ...h.path]).map(([x, y]) => [y, x] as [number, number]);
    const b = L.latLngBounds(pts);
    let done = false;
    const open = () => {
      if (done) return;
      done = true;
      setSel({ kind: "hazard", id: primary.id });
    };
    map.once("moveend", open);
    const t = window.setTimeout(open, 1400);
    if (hits.length > 1) map.flyToBounds(b, { paddingTopLeft: [60, 140], paddingBottomRight: [80, 60], maxZoom: 16, duration: 0.6 });
    else map.flyTo([primary.at[1], primary.at[0]], Math.max(map.getZoom(), 15), { duration: 0.6 });
    return () => {
      window.clearTimeout(t);
      map.off("moveend", open);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAlertId, locateKey]);

  // Test / automation hook (merged into the PoiLayer one).
  useEffect(() => {
    const w = window as unknown as { __pawprintHazards?: unknown };
    w.__pawprintHazards = {
      list: () => hazards.map((h) => ({ id: h.id, alertId: h.alertId, kind: h.kind, severity: h.severity, index: h.index, at: h.at, astronaut: h.astronaut ?? null })),
      groups: () => groups.map((g) => ({ key: g.key, at: g.at, members: g.members.map((m) => m.id), offset: offsets[g.key] })),
      selected: () => selRef.current,
      open: (id: string) => {
        const h = hazards.find((x) => x.id === id);
        if (h) select(h);
        return !!h;
      },
      shown: () => show,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hazards, groups, offsets, show]);

  const related = useMemo(() => new Set(hazards.filter((h) => matchesAlert(h, selectedAlertId)).map((h) => h.id)), [hazards, selectedAlertId]);

  // Markers are memoized so selection changes re-create only the icons whose state changed.
  const markers = useMemo(
    () =>
      groups.map((g) => {
        const isSel = g.members.some((m) => (sel?.kind === "hazard" && m.id === sel.id) || (sel?.kind === "group" && sel.key === g.key));
        const state = isSel ? "sel" : g.members.some((m) => related.has(m.id)) ? "rel" : "";
        return (
          <Marker
            key={g.key}
            position={[g.at[1], g.at[0]]}
            icon={markerIcon(g, offsets[g.key] ?? [0, -30], state)}
            zIndexOffset={isSel ? 1500 : 800}
            keyboard
            eventHandlers={{
              click: () => (g.members.length > 1 ? setSel({ kind: "group", key: g.key }) : select(g.members[0])),
            }}
          />
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, offsets, sel, related],
  );

  // Closing the details panel (X, Esc) or selecting something else on the map un-highlights a warning that was
  // picked on the board. Internal clears (route changed, markers hidden, board cleared) stay quiet.
  const prevSel = useRef<Sel>(sel);
  const selKey = sel ? (sel.kind === "hazard" ? sel.id : `g:${sel.key}`) : "";
  useEffect(() => {
    const prev = prevSel.current;
    prevSel.current = sel;
    if (quiet.current) {
      quiet.current = false;
      return;
    }
    if (sel?.kind === "hazard") {
      const h = hazards.find((x) => x.id === sel.id);
      if (h && !matchesAlert(h, selectedAlertId)) emit(h.alertId);
    } else if (prev?.kind === "hazard") {
      const h = hazards.find((x) => x.id === prev.id);
      if (h && matchesAlert(h, selectedAlertId)) emit(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  // toggle control (screen space, outside the map panes)
  const ctrl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ctrl.current) {
      L.DomEvent.disableClickPropagation(ctrl.current);
      L.DomEvent.disableScrollPropagation(ctrl.current);
    }
  }, [hazards.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const nWarn = hazards.filter((h) => h.severity === "warning").length;

  return (
    <>
      <Pane name="route-hazards" style={{ zIndex: 460 }}>
        {show && selHazard && (
          <Fragment key={selHazard.id}>
            {selHazard.path.length > 1 ? (
              <>
                <Polyline positions={selHazard.path.map(([x, y]) => [y, x] as [number, number])} pathOptions={{ color: "#131522", weight: 13, opacity: 0.55, interactive: false, lineCap: "round", lineJoin: "round" }} />
                <Polyline positions={selHazard.path.map(([x, y]) => [y, x] as [number, number])} pathOptions={{ color: SEV_COLOR[selHazard.severity], weight: 7, opacity: 1, interactive: false, lineCap: "round", lineJoin: "round" }} />
              </>
            ) : null}
            <CircleMarker center={[selHazard.at[1], selHazard.at[0]]} radius={11} pathOptions={{ color: SEV_COLOR[selHazard.severity], weight: 2.5, fill: false, interactive: false, className: "hz-pulse" }} />
          </Fragment>
        )}
      </Pane>
      {markers}
      {hazards.length > 0 && (
        <div className="hz-toggle" ref={ctrl}>
          <button aria-pressed={show} onClick={() => toggle(!show)} title={show ? "Hide route warning markers" : "Show route warning markers"}>
            <Icon name="warn" size={14} />
            <span>{show ? "Hide" : "Show"} route warnings</span>
            <em className={nWarn ? "has-warn" : ""}>{hazards.length}</em>
          </button>
        </div>
      )}
    </>
  );
}
