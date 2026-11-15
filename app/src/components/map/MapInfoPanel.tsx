import type L from "leaflet";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { hiddenBehind, panelLayout, panelWidth, sheetDragOutcome } from "../../lib/mapSelection";
import { Icon } from "../ui";
import "../../mapInfo.css";

/** Side panel (desktop) or bottom sheet (phones, narrow maps) that shows whatever is selected on the map.
 *
 *  It is a plain DOM element next to the Leaflet container, not a Leaflet layer. Opening it, switching what
 *  it shows, or re-rendering it never calls into Leaflet, so the map does not pan, zoom or animate. It is
 *  always laid out inside the viewport, and only its body scrolls. */

export type PanelTone = "lav" | "turq" | "rose" | "sand" | "peach" | "sky";

export interface PanelContent {
  /** Stable identity: a new key resets the body's scroll position. */
  key: string;
  icon: string;
  tone: PanelTone;
  kicker: string;
  title: ReactNode;
  /** Coordinates or a short fact under the title */
  sub?: ReactNode;
  badges?: ReactNode;
  body?: ReactNode;
  /** Primary actions, pinned under the body so they are always reachable */
  actions?: ReactNode;
  /** Where the selection is on the map (to tell the user when the panel covers it) */
  anchor?: { lat: number; lon: number } | null;
}

/** Side panel or sheet for this map, re-evaluated whenever the map or window is resized. */
export function usePanelLayout(wrapRef: RefObject<HTMLElement>) {
  const [st, setSt] = useState<{ layout: "side" | "sheet"; width: number }>({ layout: "side", width: 340 });
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.getBoundingClientRect().width;
      const next = { layout: panelLayout(window.innerWidth, w), width: panelWidth(w) };
      setSt((s) => (s.layout === next.layout && s.width === next.width ? s : next));
    };
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [wrapRef]);
  return st;
}

interface Props {
  content: PanelContent | null;
  layout: "side" | "sheet";
  width: number;
  map: L.Map | null;
  onClose: () => void;
}

export function MapInfoPanel({ content, layout, width, map, onClose }: Props) {
  const ref = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [covered, setCovered] = useState(false);
  const open = !!content;
  const key = content?.key ?? "";

  // Escape closes (unless something else, e.g. an open dialog or a text field, already handled it).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof Element && t.closest("input, textarea, select, [contenteditable=true], .modal-backdrop, [role=dialog][aria-modal=true]")) return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // New selection: start at the top of the body. Move keyboard focus to the panel when it opens, without
  // scrolling the page (preventScroll) so nothing on screen jumps.
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    if (open && !wasOpen.current) ref.current?.focus({ preventScroll: true });
    if (!open) setExpanded(false);
    wasOpen.current = open;
  }, [key, open]);

  // Tell the user when the selected spot is hidden behind the panel. Read-only: the map is never moved for them.
  const anchor = content?.anchor ?? null;
  useEffect(() => {
    if (!map || !anchor || !open) {
      setCovered(false);
      return;
    }
    const check = () => {
      const el = ref.current;
      if (!el) return;
      const c = map.getContainer().getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const pt = map.latLngToContainerPoint([anchor.lat, anchor.lon]);
      setCovered(hiddenBehind(pt, { left: r.left - c.left, top: r.top - c.top, right: r.right - c.left, bottom: r.bottom - c.top }));
    };
    check();
    map.on("moveend zoomend resize", check);
    const ro = typeof ResizeObserver !== "undefined" && ref.current ? new ResizeObserver(check) : null;
    if (ro && ref.current) ro.observe(ref.current);
    return () => {
      map.off("moveend zoomend resize", check);
      ro?.disconnect();
    };
  }, [map, anchor?.lat, anchor?.lon, open, layout, expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Explicit, user-requested: bring the covered spot into the visible part of the map. */
  const reveal = () => {
    if (!map || !anchor || !ref.current) return;
    const c = map.getContainer().getBoundingClientRect();
    const r = ref.current.getBoundingClientRect();
    const pt = map.latLngToContainerPoint([anchor.lat, anchor.lon]);
    // target: centre of the map area the panel does not cover
    const target =
      layout === "side"
        ? { x: (r.left - c.left) / 2, y: c.height / 2 }
        : { x: c.width / 2, y: Math.max(40, Math.min(c.height, r.top - c.top) / 2) };
    map.panBy([pt.x - target.x, pt.y - target.y], { animate: true, duration: 0.35 });
  };

  // Bottom sheet: drag the handle down to close (or collapse), up to expand.
  const drag = useRef<{ y: number; t: number; id: number } | null>(null);
  const [dragDy, setDragDy] = useState(0);
  const onPointerDown = (e: React.PointerEvent) => {
    if (layout !== "sheet") return;
    drag.current = { y: e.clientY, t: performance.now(), id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    setDragDy(Math.max(-40, e.clientY - drag.current.y));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setDragDy(0);
    if (!d) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) < 6) {
      setExpanded((x) => !x); // a tap on the handle toggles the size
      return;
    }
    const out = sheetDragOutcome(dy, performance.now() - d.t, expanded);
    if (out === "close") onClose();
    else if (out === "expand") setExpanded(true);
    else if (out === "collapse") setExpanded(false);
  };

  if (!content) return null;
  const titleId = "map-info-title";
  return (
    <aside
      ref={ref}
      className={`map-info mi-${layout} tone-${content.tone} ${expanded ? "is-expanded" : ""} ${dragDy ? "is-dragging" : ""}`}
      style={layout === "side" ? { width } : dragDy > 0 ? { transform: `translateY(${dragDy}px)` } : undefined}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="map-info"
      data-layout={layout}
      data-selection={content.key}
    >
      {layout === "sheet" && (
        <div
          className="mi-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { drag.current = null; setDragDy(0); }}
        >
          <button type="button" aria-label={expanded ? "Make the details sheet smaller" : "Make the details sheet taller"} aria-expanded={expanded} tabIndex={0}
            onClick={(e) => { if (e.detail === 0) setExpanded((x) => !x); /* keyboard only: pointer taps are handled above */ }}>
            <span className="mi-grip" />
          </button>
        </div>
      )}
      <header className="mi-head">
        <span className="mi-icon" aria-hidden="true"><Icon name={content.icon} size={20} /></span>
        <div className="mi-titles">
          <span className="mi-kicker">{content.kicker}</span>
          <h2 id={titleId}>{content.title}</h2>
          {content.sub && <div className="mi-sub">{content.sub}</div>}
        </div>
        <button type="button" className="mi-close" onClick={onClose} aria-label="Close details (Esc)" title="Close (Esc)">
          <Icon name="close" size={18} />
        </button>
      </header>
      {content.badges && <div className="mi-badges">{content.badges}</div>}
      {covered && (
        <div className="mi-covered" role="status">
          <Icon name="info" size={14} />
          <span>The selected spot is behind this panel.</span>
          <button type="button" className="link-btn" onClick={reveal}>Show it</button>
        </div>
      )}
      {content.body && (
        <div className="mi-body" ref={bodyRef}>
          {content.body}
        </div>
      )}
      {content.actions && <footer className="mi-actions">{content.actions}</footer>}
    </aside>
  );
}
