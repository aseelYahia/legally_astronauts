import L from "leaflet";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleMarker, Marker, useMap, useMapEvents } from "react-leaflet";
import { placeLabels, type LabelBox, type Rect } from "../../lib/labels";
import { selectedPoiIds } from "../../lib/mapSelection";
import type { Poi } from "../../types";
import { useMapSelection } from "./MapSelectionContext";

/** Sample markers with screen-space grouping and collision-free labels.
 *
 *  Geography is never altered: every sample keeps a pin (or a small dot inside a group) exactly at its
 *  own coordinate. Grouping only decides how many clickable symbols are drawn at the current zoom, and
 *  labels are placed in screen space beside the pins (with a leader line when they have to move away). */

export const GROUP_PX = 26; // pins closer than this on screen form one group
const LABEL_MIN_ZOOM = 14; // persistent labels from medium zoom; hover labels always

export interface PoiGroup {
  key: string;
  members: Poi[];
  lat: number; // centroid of members (only used for the group badge)
  lon: number;
  identical: boolean; // all members share one coordinate
}

/** Greedy screen-space grouping at a zoom level (CRS.Simple: 2^zoom pixels per degree). Pure, testable. */
export function groupPois(pois: Poi[], zoom: number, px = GROUP_PX): PoiGroup[] {
  const k = Math.pow(2, zoom);
  const groups: PoiGroup[] = [];
  const sorted = [...pois].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  for (const p of sorted) {
    const g = groups.find((g) => g.members.some((m) => Math.hypot((m.lon - p.lon) * k, (m.lat - p.lat) * k) < px));
    if (g) g.members.push(p);
    else groups.push({ key: p.id, members: [p], lat: p.lat, lon: p.lon, identical: true });
  }
  for (const g of groups) {
    g.lat = g.members.reduce((a, m) => a + m.lat, 0) / g.members.length;
    g.lon = g.members.reduce((a, m) => a + m.lon, 0) / g.members.length;
    g.identical = g.members.every((m) => m.lat === g.members[0].lat && m.lon === g.members[0].lon);
    g.key = g.members.map((m) => m.id).join("+");
  }
  return groups;
}

/** Smallest zoom at which every member of a group gets its own symbol (Infinity if they share a coordinate). */
export function splitZoom(g: PoiGroup, px = GROUP_PX): number {
  let min = Infinity;
  for (let i = 0; i < g.members.length; i++)
    for (let j = i + 1; j < g.members.length; j++) {
      const d = Math.hypot(g.members[i].lon - g.members[j].lon, g.members[i].lat - g.members[j].lat);
      if (d > 0) min = Math.min(min, d);
    }
  return min === Infinity ? Infinity : Math.log2(px / min) + 0.25;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const short = (p: Poi) => `${p.number ? `#${p.number} ` : ""}${p.name}`;

function groupIcon(g: PoiGroup) {
  const names = g.members.map((m) => `<b>${esc(short(m))}</b>`).join("");
  const label =
    `<div class="poi-label group-label">${names}` +
    `<span>${g.identical ? "Same rover position" : "Close together"} · ${esc(g.members[0].campaign ?? "")}</span>` +
    `<em>Click to choose a sample</em></div>`;
  return L.divIcon({
    className: "poi-marker poi-group-marker",
    html: `<div class="poi-cluster" aria-label="${g.members.length} samples"><span>${g.members.length}</span></div>${label}`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export function PoiLayer({ pois, icons }: { pois: Poi[]; icons: Record<string, L.DivIcon> }) {
  const map = useMap();
  const { sel, select } = useMapSelection();
  const [zoom, setZoom] = useState(map.getZoom());
  const [frame, setFrame] = useState(0);
  const [animating, setAnimating] = useState(false);
  const refs = useRef<Record<string, L.Marker | null>>({});
  // Read `select` through a ref so the memoized markers never need rebuilding for it.
  const selectRef = useRef(select);
  selectRef.current = select;

  // Label refresh is batched to at most one per animation frame.
  const rafId = useRef(0);
  const bump = () => {
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0;
      setFrame((f) => f + 1);
    });
  };
  useEffect(() => () => cancelAnimationFrame(rafId.current), []);
  useMapEvents({
    zoomstart: () => setAnimating(true),
    zoomend: () => {
      setAnimating(false);
      setZoom(map.getZoom());
    },
    move: bump,
    resize: bump,
  });

  const groups = useMemo(() => groupPois(pois, zoom), [pois, zoom]);
  const groupIcons = useMemo(() => Object.fromEntries(groups.filter((g) => g.members.length > 1).map((g) => [g.key, groupIcon(g)])), [groups]);

  // Which drawn symbol is highlighted: the pin, or the group, that holds a selected sample.
  const selIds = useMemo(() => new Set(selectedPoiIds(sel)), [sel]);
  const selectedKeys = useMemo(() => new Set(groups.filter((g) => g.members.some((m) => selIds.has(m.id))).map((g) => g.key)), [groups, selIds]);
  useEffect(() => {
    Object.entries(refs.current).forEach(([k, m]) => m?.getElement()?.classList.toggle("is-selected", selectedKeys.has(k)));
  }, [selectedKeys, groups]);

  // Test / automation hook: select any sample (also one inside a group), exactly as a click would.
  useEffect(() => {
    const api = {
      map,
      groups: () => groups.map((g) => ({ key: g.key, members: g.members.map((m) => m.id), identical: g.identical })),
      openPoi: async (q: string) => {
        const exact = pois.find((x) => x.id === q || x.name === q);
        const partial = pois.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()));
        const p = exact ?? (partial.length === 1 ? partial[0] : undefined);
        if (!p) throw new Error(partial.length > 1 ? `"${q}" matches several samples` : `no sample ${q}`);
        const g = groups.find((gg) => gg.members.some((m) => m.id === p.id))!;
        selectRef.current({ kind: "poi", id: p.id, groupIds: g.members.length > 1 ? g.members.map((m) => m.id) : undefined });
        await new Promise((r) => setTimeout(r, 120));
        return p.id;
      },
    };
    (window as unknown as { __pawprintMap?: unknown }).__pawprintMap = api;
  }, [map, groups, pois]);

  // collision-free labels (screen space), refreshed on every move
  const panelOpen = sel !== null;
  const labels = useMemo(() => {
    void frame;
    void panelOpen; // the side panel opening or closing changes the reserved areas
    if (animating || zoom < LABEL_MIN_ZOOM) return null;
    const size = map.getSize();
    const cont = map.getContainer();
    const cr = cont.getBoundingClientRect();
    const wrap = cont.closest(".map-wrap") ?? cont;
    const reserved: Rect[] = [...wrap.querySelectorAll(".map-title, .wx-chip, .legend, .map-buttons, .scalebar, .map-hint, .map-panel, .mp-tray, .map-info.mi-side")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .map((r) => ({ x: r.left - cr.left - 4, y: r.top - cr.top - 4, w: r.width + 8, h: r.height + 8 }));
    const pins = groups
      .map((g) => {
        const pt = map.latLngToContainerPoint([g.lat, g.lon]);
        const text = g.members.length === 1 ? short(g.members[0]) : g.members.length === 2 ? `${short(g.members[0])} · ${short(g.members[1])}` : `${g.members.length} samples · ${g.members[0].campaign ?? ""}`;
        return { x: pt.x, y: pt.y, label: text, color: "", key: g.key };
      })
      .filter((p) => p.x > -40 && p.y > -40 && p.x < size.x + 40 && p.y < size.y + 40);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    const placed = placeLabels(pins, (t) => ctx.measureText(t).width + 2, size.x, size.y, { h: 22, pinR: 13, reserved, mergeDist: 0 });
    // A label that could only be squeezed in under a control or the details panel is dropped (hover still shows it).
    const hit = (b: Rect, r: Rect) => b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h;
    // ...and so is one whose leader line would cross a control.
    const crosses = (b: LabelBox, r: Rect) => {
      if (!b.leader) return false;
      const x2 = b.x + (b.x > b.ax ? 0 : b.w);
      const y2 = b.y + b.h / 2;
      for (let t = 0.15; t <= 0.85; t += 0.05) {
        const x = b.ax + (x2 - b.ax) * t;
        const y = b.ay + (y2 - b.ay) * t;
        if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
      }
      return false;
    };
    const keep = placed.boxes.map((b) => !reserved.some((r) => hit(b, r) || crosses(b, r)));
    return { boxes: placed.boxes.filter((_, i) => keep[i]), keys: pins.map((p) => p.key).filter((_, i) => keep[i]) };
  }, [frame, zoom, animating, groups, map, panelOpen]);

  // Markers are memoized so the per-frame label refresh and selection changes never rebuild them.
  // A click only selects: the details appear in the map information panel (no Leaflet popup, so no auto-pan).
  const markers = useMemo(
    () => (
      <>
        {groups.map((g) => {
          if (g.members.length === 1) {
            const p = g.members[0];
            return (
              <Marker
                key={g.key}
                position={[p.lat, p.lon]}
                icon={icons[p.id]}
                riseOnHover
                title={short(p)}
                ref={(m) => (refs.current[g.key] = m)}
                eventHandlers={{ click: () => selectRef.current({ kind: "poi", id: p.id }) }}
              />
            );
          }
          return (
            <Fragment key={g.key}>
              {g.members.map((m) => (
                <CircleMarker key={m.id} center={[m.lat, m.lon]} radius={3.2} pathOptions={{ color: "#131522", weight: 1.2, fillColor: "#F1EDF5", fillOpacity: 1, interactive: false }} />
              ))}
              <Marker
                position={[g.lat, g.lon]}
                icon={groupIcons[g.key]}
                riseOnHover
                title={`${g.members.length} samples here`}
                zIndexOffset={200}
                ref={(m) => (refs.current[g.key] = m)}
                eventHandlers={{ click: () => selectRef.current({ kind: "poi-group", ids: g.members.map((m) => m.id), lon: g.lon, lat: g.lat, identical: g.identical }) }}
              />
            </Fragment>
          );
        })}
      </>
    ),
    [groups, icons, groupIcons],
  );

  return (
    <>
      {markers}
      {labels &&
        createPortal(
          <div className="map-labels" aria-hidden="true">
            <svg className="map-label-leaders" width="100%" height="100%">
              {labels.boxes.filter((b) => b.leader).map((b, i) => (
                <line key={i} x1={b.ax} y1={b.ay} x2={b.x + (b.x > b.ax ? 0 : b.w)} y2={b.y + b.h / 2} />
              ))}
            </svg>
            {labels.boxes.map((b, i) => (
              <div key={i} className={`map-label ${selectedKeys.has(labels.keys[i]) ? "sel" : ""}`} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
                {b.text}
              </div>
            ))}
          </div>,
          map.getContainer(),
        )}
    </>
  );
}
