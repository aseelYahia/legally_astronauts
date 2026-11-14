import L from "leaflet";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type PointerEvent as RPointerEvent } from "react";
import {
  PANEL_IDS, PLACE_ORDER, PREFERRED, anchorRect, autoPlace, clampRect, clearLayout, defaultLayout, fromPos, loadLayout, moveInDock, restore, saveLayout,
  separate, setMode, setPos, thinPoints, toPos, type Layout, type PanelId, type PanelMode, type PanelPos, type Rect, type Size, type WeightedPoint,
} from "../../lib/panelLayout";
import "../../panels.css";

/** One floating information panel. Content is plain UI; it never touches map coordinates. */
export interface PanelDef {
  id: PanelId;
  /** Accessible name, e.g. "Elevation legend" */
  label: string;
  /** Short text on the minimized chip */
  short: string;
  /** Icon / swatch shown on the minimized chip */
  chipIcon: ReactNode;
  /** Extra classes on the panel card (tone, etc.) */
  className?: string;
  content: ReactNode;
  /** Shown even if minimized (e.g. the placement instruction while the user is placing a point) */
  forceOpen?: boolean;
  /** Text read out by screen readers while the panel is minimized */
  liveText?: string;
}

interface Props {
  map: L.Map | null;
  wrapRef: React.RefObject<HTMLDivElement>;
  panels: PanelDef[];
  /** Screen points (map container pixels) the panels should keep clear of, weighted by importance. */
  points: () => WeightedPoint[];
  /** Changes when the route / stops change: re-run the smart placement. */
  placeKey: string;
  /** Tablet / phone: no floating panels, a compact info sheet instead. */
  compact: boolean;
}

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const FIXED_SEL = ".map-buttons, .scalebar, .mp-tray";

function GripIcon() {
  return (
    <svg viewBox="0 0 10 16" width="8" height="14" aria-hidden="true">
      {[3, 8, 13].map((y) => (
        <g key={y}><circle cx="2.5" cy={y} r="1.3" /><circle cx="7.5" cy={y} r="1.3" /></g>
      ))}
    </svg>
  );
}
const MinIcon = () => (<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>);
const DockIcon = () => (<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M2.5 10h11" stroke="currentColor" strokeWidth="1.6" /></svg>);
const FloatIcon = () => (<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="2" y="5" width="9" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M7 2.5h6.5V9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>);
const ResetIcon = () => (<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>);
const ArrowIcon = ({ dir }: { dir: "l" | "r" }) => (<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d={dir === "l" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>);

interface DragState { id: PanelId; rect: Rect; overDock: boolean; dockIndex: number; from: "float" | "dock" }

export function MapPanels({ map, wrapRef, panels, points, placeKey, compact }: Props) {
  const [layout, setLayoutState] = useState<Layout>(() => loadLayout(storage()));
  const setLayout = useCallback((f: (l: Layout) => Layout) => {
    setLayoutState((prev) => {
      const next = f(prev);
      if (next !== prev) saveLayout(storage(), next);
      return next;
    });
  }, []);
  const defs = useMemo(() => Object.fromEntries(panels.map((p) => [p.id, p])) as Partial<Record<PanelId, PanelDef>>, [panels]);
  const avail = PANEL_IDS.filter((id) => defs[id]);

  // effective mode: a "forceOpen" panel (placement instruction) shows even when minimized
  const eff = useCallback(
    (id: PanelId): PanelMode => {
      const st = layout.panels[id];
      if (st.mode === "min" && defs[id]?.forceOpen) return st.restore ?? "float";
      return st.mode;
    },
    [layout, defs],
  );

  /* ---------- measuring ---------- */
  const [wrapSize, setWrapSize] = useState<Size>({ w: 0, h: 0 });
  const [dockH, setDockH] = useState(0);
  const [sizes, setSizes] = useState<Partial<Record<PanelId, Size>>>({});
  const [fixed, setFixed] = useState<Rect[]>([]);
  const area: Size = useMemo(() => ({ w: wrapSize.w, h: Math.max(0, wrapSize.h - dockH) }), [wrapSize, dockH]);
  const areaRef = useRef(area);
  areaRef.current = area;

  const measureFixed = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return [];
    const wr = wrap.getBoundingClientRect();
    return [...wrap.querySelectorAll(FIXED_SEL)]
      .filter((el) => !el.closest(".mp-dock"))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .map((r) => ({ x: r.left - wr.left, y: r.top - wr.top, w: r.width, h: r.height }));
  }, [wrapRef]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      setWrapSize((s) => (s.w === wrap.clientWidth && s.h === wrap.clientHeight ? s : { w: wrap.clientWidth, h: wrap.clientHeight }));
    });
    ro.observe(wrap);
    setWrapSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    return () => ro.disconnect();
  }, [wrapRef]);

  // (created in an effect, not a memo, so React StrictMode's mount/unmount/mount leaves a live observer)
  const roRef = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      setSizes((prev) => {
        let next = prev;
        for (const e of entries) {
          const el = e.target as HTMLElement;
          const id = el.dataset.panel as PanelId;
          const s = { w: el.offsetWidth, h: el.offsetHeight };
          const p = prev[id];
          if (!p || Math.abs(p.w - s.w) > 0.5 || Math.abs(p.h - s.h) > 0.5) next = { ...next, [id]: s };
        }
        return next;
      });
    });
    roRef.current = ro;
    observed.current.forEach((el) => ro.observe(el));
    return () => {
      ro.disconnect();
      roRef.current = null;
    };
  }, []);
  // Panels sit beside the Leaflet container (not inside it), but stop clicks/wheel anyway so no gesture on a
  // panel can ever pan, zoom or click the map. Each element is isolated once.
  const isolated = useRef(new WeakSet<HTMLElement>());
  const isolate = useCallback((el: HTMLElement | null) => {
    if (el && !isolated.current.has(el)) {
      isolated.current.add(el);
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
    }
  }, []);
  const observed = useRef(new Map<PanelId, HTMLElement>());
  const floatRefs = useMemo(
    () =>
      Object.fromEntries(
        PANEL_IDS.map((id) => [
          id,
          (el: HTMLElement | null) => {
            const prev = observed.current.get(id);
            if (prev && prev !== el) roRef.current?.unobserve(prev);
            if (el && prev !== el) {
              observed.current.set(id, el);
              roRef.current?.observe(el);
            }
            if (!el) observed.current.delete(id);
            isolate(el);
          },
        ]),
      ) as Record<PanelId, (el: HTMLElement | null) => void>,
    [isolate],
  );

  /* ---------- dock ---------- */
  const dockRef = useRef<HTMLDivElement | null>(null);
  const docked = compact ? [] : layout.dock.filter((id) => defs[id] && eff(id) === "dock");
  const dockShown = docked.length > 0;
  useLayoutEffect(() => {
    const el = dockRef.current;
    if (!dockShown || !el) {
      setDockH(0);
      return;
    }
    const ro = new ResizeObserver(() => setDockH(el.offsetHeight));
    ro.observe(el);
    setDockH(el.offsetHeight);
    return () => ro.disconnect();
  }, [dockShown]);
  useLayoutEffect(() => {
    wrapRef.current?.style.setProperty("--dock-h", `${dockH}px`);
  }, [dockH, wrapRef]);

  /* ---------- smart placement of panels the user hasn't moved ---------- */
  const [auto, setAuto] = useState<Partial<Record<PanelId, PanelPos>>>({});
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const floating = compact ? [] : avail.filter((id) => eff(id) === "float");
  const floatKey = floating.map((id) => `${id}:${layout.panels[id].pos ? "u" : "a"}:${Math.round(sizes[id]?.w ?? 0)}x${Math.round(sizes[id]?.h ?? 0)}`).join(",");
  const stateRef = useRef({ floating, layout, sizes });
  stateRef.current = { floating, layout, sizes };

  const replace = useCallback(
    (hysteresis: number) => {
      const { floating, layout, sizes } = stateRef.current;
      const a = areaRef.current;
      if (a.w < 60 || a.h < 60) return;
      const fx = measureFixed();
      setFixed((prev) => (JSON.stringify(prev) === JSON.stringify(fx) ? prev : fx));
      const users = floating.filter((id) => layout.panels[id].pos && sizes[id]).map((id) => fromPos(layout.panels[id].pos!, sizes[id]!, a));
      const items = PLACE_ORDER.filter((id) => floating.includes(id))
        .filter((id) => !layout.panels[id].pos && sizes[id])
        .map((id) => {
          const cur = autoRef.current[id];
          return { id, size: sizes[id]!, current: cur && hysteresis >= 0 ? fromPos(cur, sizes[id]!, a) : undefined };
        });
      if (!items.length) return;
      const pts = thinPoints(pointsRef.current(), a);
      const placed = autoPlace(items, a, pts, [...fx, ...users], Math.max(0, hysteresis));
      setAuto((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [id, r] of Object.entries(placed)) {
          const p = toPos(r, a);
          const q = prev[id as PanelId];
          if (!q || q.h !== p.h || q.v !== p.v || Math.abs(q.dx - p.dx) > 1 || Math.abs(q.dy - p.dy) > 1) {
            next[id as PanelId] = p;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    [measureFixed],
  );

  // layout / size / route changes: place right away (keep a spot that is still good)
  useEffect(() => {
    if (compact) return;
    const t = setTimeout(() => replace(1), 30);
    return () => clearTimeout(t);
  }, [compact, floatKey, area.w, area.h, replace]);
  // a new route: re-place once the camera has settled on it, with no stickiness
  useEffect(() => {
    if (compact || !map) return;
    let t = setTimeout(() => replace(-1), 1200);
    const once = () => {
      map.off("moveend", once); // explicit on/off: Leaflet's once() wrapper can't be removed by off()
      clearTimeout(t);
      t = setTimeout(() => replace(-1), 60);
    };
    map.on("moveend", once);
    return () => {
      clearTimeout(t);
      map.off("moveend", once);
    };
  }, [placeKey, map, compact, replace]);
  // panning / zooming: only move a panel if its spot became clearly worse (avoid jumpy UI)
  useEffect(() => {
    if (compact || !map) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      clearTimeout(t);
      t = setTimeout(() => replace(6), 350);
    };
    map.on("moveend", on);
    return () => {
      clearTimeout(t);
      map.off("moveend", on);
    };
  }, [map, compact, replace]);

  /* ---------- rectangles to render ---------- */
  const [drag, setDrag] = useState<DragState | null>(null);
  const rects = useMemo(() => {
    const out: Partial<Record<PanelId, Rect>> = {};
    if (area.w < 40 || area.h < 40) return out;
    const user: PanelId[] = [];
    const autos: PanelId[] = [];
    for (const id of floating) {
      if (drag?.id === id) continue;
      (layout.panels[id].pos ? user : autos).push(id);
    }
    const order = [...user, ...autos];
    const raw = order.map((id) => {
      const s = sizes[id] ?? { w: 200, h: 40 };
      const st = layout.panels[id];
      if (st.pos) return fromPos(st.pos, s, area);
      const ap = auto[id];
      return ap ? fromPos(ap, s, area) : anchorRect(PREFERRED[id][0], s, area);
    });
    // (the panel being dragged doesn't shove the others around mid-gesture; they settle on drop)
    const sep = separate(raw, area, fixed);
    order.forEach((id, i) => (out[id] = sep[i]));
    return out;
  }, [floating, layout, sizes, area, auto, fixed, drag?.id]);

  // tell the label layer that the furniture moved, so sample labels re-flow around the panels
  const rectSig = JSON.stringify(rects) + dockH;
  useEffect(() => {
    if (!map) return;
    const t = setTimeout(() => map.fire("move"), 60);
    return () => clearTimeout(t);
  }, [rectSig, map]);

  /* ---------- dragging ---------- */
  const dragRef = useRef<{ id: PanelId; sx: number; sy: number; ox: number; oy: number; w: number; h: number; from: "float" | "dock"; moved: boolean; last?: DragState } | null>(null);

  // insertion index in the (wrapping) dock: cards on earlier rows, or left of the pointer on its row
  const dockIndexAt = useCallback((clientX: number, clientY: number, id: PanelId) => {
    const cards = [...(dockRef.current?.querySelectorAll<HTMLElement>(".map-panel[data-panel]") ?? [])].filter((c) => c.dataset.panel !== id);
    const top = dockRef.current?.getBoundingClientRect().top ?? Infinity;
    if (clientY < top) return cards.length; // dropped on the map's bottom edge: append
    return cards.filter((c) => {
      const r = c.getBoundingClientRect();
      return r.bottom < clientY || (r.top <= clientY && r.left + r.width / 2 < clientX);
    }).length;
  }, []);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      const wrap = wrapRef.current;
      if (!d || !wrap) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      if (!d.moved) document.body.classList.add("mp-dragging");
      d.moved = true;
      e.preventDefault();
      const a = areaRef.current;
      const wr = wrap.getBoundingClientRect();
      const py = e.clientY - wr.top;
      const overDock = py > a.h - 30 && py < wr.height + 4 && e.clientX > wr.left && e.clientX < wr.right;
      // docked cards are picked up under the pointer
      const ox = d.from === "dock" ? e.clientX - wr.left - d.w / 2 : d.ox + dx;
      const oy = d.from === "dock" ? Math.min(py - 12, a.h - d.h - 10) : d.oy + dy;
      const rect = clampRect({ x: ox, y: oy, w: d.w, h: d.h }, a);
      const st: DragState = { id: d.id, rect, overDock, dockIndex: overDock ? dockIndexAt(e.clientX, e.clientY, d.id) : -1, from: d.from };
      d.last = st;
      setDrag(st);
    },
    [wrapRef, dockIndexAt],
  );

  const onUp = useCallback(() => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    document.body.classList.remove("mp-dragging");
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.moved && d.last) {
      const st = d.last;
      if (st.overDock) setLayout((l) => setMode(l, st.id, "dock", st.dockIndex));
      else setLayout((l) => setPos(l, st.id, toPos(st.rect, areaRef.current)));
    }
    setDrag(null);
  }, [onMove, setLayout]);

  useEffect(() => () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  }, [onMove, onUp]);

  const onPointerDown = (id: PanelId, from: "float" | "dock") => (e: RPointerEvent<HTMLElement>) => {
    e.stopPropagation(); // never let a panel gesture reach the map (no pan, no click-to-place)
    if (e.button !== 0 || compact) return;
    if ((e.target as Element).closest(".mp-act, a, input, select")) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    dragRef.current = { id, sx: e.clientX, sy: e.clientY, ox: r.left - wr.left, oy: r.top - wr.top, w: r.width, h: r.height, from, moved: false };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  /* ---------- keyboard ---------- */
  const [focusGrip, setFocusGrip] = useState<PanelId | null>(null);
  useEffect(() => {
    if (!focusGrip) return;
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-grip="${focusGrip}"]`);
    el?.focus();
    setFocusGrip(null);
  });
  const onGripKey = (id: PanelId, where: "float" | "dock") => (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 50 : 10;
    if (where === "dock") {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        setLayout((l) => moveInDock(l, id, e.key === "ArrowLeft" ? -1 : 1));
        setFocusGrip(id);
      } else if (e.key === "ArrowUp" || e.key === "Escape") {
        setLayout((l) => setMode(l, id, "float"));
        setFocusGrip(id);
      } else return;
      e.preventDefault();
      return;
    }
    const r = rects[id];
    if (!r) return;
    const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (mv[e.key]) {
      const [dx, dy] = mv[e.key];
      const nr = clampRect({ ...r, x: r.x + dx, y: r.y + dy }, area);
      setLayout((l) => setPos(l, id, toPos(nr, area)));
    } else if (e.key === "Home") {
      setLayout((l) => setPos(l, id, undefined)); // back to automatic placement
    } else if (e.key === "End") {
      setLayout((l) => setMode(l, id, "dock"));
      setFocusGrip(id);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  /* ---------- actions ---------- */
  const minimize = (id: PanelId) => setLayout((l) => setMode(l, id, "min"));
  const reset = () => {
    clearLayout(storage());
    setLayoutState(defaultLayout());
    setAuto({});
    setTimeout(() => replace(-1), 60);
  };
  const dockAll = () => setLayout((l) => avail.reduce((acc, id) => (acc.panels[id].mode === "float" ? setMode(acc, id, "dock") : acc), l));
  const minimized = avail.filter((id) => layout.panels[id].mode === "min" && !defs[id]?.forceOpen);
  const anyFloating = floating.length > 0;

  /* ---------- compact (tablet / phone) ---------- */
  const [sheet, setSheet] = useState(false);
  const sheetClose = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (sheet) sheetClose.current?.focus();
  }, [sheet]);
  useEffect(() => {
    if (!compact) setSheet(false);
  }, [compact]);

  const live = avail
    .filter((id) => defs[id]?.liveText && (compact ? id === "hint" && layout.panels.hint.mode === "min" && !defs.hint?.forceOpen : eff(id) === "min"))
    .map((id) => defs[id]!.liveText)
    .join(" ");

  if (compact) {
    const hint = defs.hint;
    const hintOpen = hint && (layout.panels.hint.mode !== "min" || hint.forceOpen);
    const sheetIds = avail.filter((id) => id !== "hint");
    return (
      <>
        {hint && hintOpen && (
          <div className={`map-panel mp-compact-hint p-hint ${hint.className ?? ""}`} ref={isolate} role="region" aria-label={hint.label} onPointerDown={(e) => e.stopPropagation()}>
            <div className="mp-body">{hint.content}</div>
            {!hint.forceOpen && (
              <button className="mp-act" aria-label={`Minimize ${hint.label}`} title="Minimize" onClick={() => minimize("hint")}>
                <MinIcon />
              </button>
            )}
          </div>
        )}
        {hint && !hintOpen && (
          <button className="map-panel mp-chip mp-compact-hint-chip" ref={isolate} aria-label={`Show ${hint.label}`} title={`Show ${hint.label}`} onClick={() => setLayout((l) => restore(l, "hint"))}>
            {hint.chipIcon}
          </button>
        )}
        {sheetIds.length > 0 && !sheet && (
          <button className="map-panel mp-info-btn" ref={isolate} aria-expanded={false} aria-controls="mp-sheet" onClick={() => setSheet(true)}>
            {defs.legend ? defs.legend.chipIcon : null}
            <span>Map info</span>
          </button>
        )}
        {sheet && (
          <div
            id="mp-sheet"
            className="map-panel mp-sheet"
            ref={isolate}
            role="dialog"
            aria-label="Map information"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && setSheet(false)}
          >
            <div className="mp-sheet-head">
              <b>Map information</b>
              <button ref={sheetClose} className="mp-act" aria-label="Close map information" onClick={() => setSheet(false)}>
                <MinIcon />
              </button>
            </div>
            {sheetIds.map((id) => (
              <section key={id} className={`mp-sheet-card p-${id}`} aria-label={defs[id]!.label}>
                {defs[id]!.content}
              </section>
            ))}
          </div>
        )}
        {live && <div className="mp-sr" role="status">{live}</div>}
      </>
    );
  }

  const card = (id: PanelId, where: "float" | "dock", style?: React.CSSProperties, extra = "") => {
    const d = defs[id]!;
    return (
      <div
        key={`${where}-${id}`}
        ref={where === "float" ? floatRefs[id] : isolate}
        data-panel={id}
        className={`map-panel p-${id} ${d.className ?? ""} ${where === "dock" ? "in-dock" : ""} ${extra}`}
        style={style}
        role="region"
        aria-label={d.label}
        onPointerDown={onPointerDown(id, where)}
      >
        <button
          className="mp-grip"
          data-grip={id}
          aria-label={`Move ${d.label}`}
          title={where === "dock" ? "Drag to rearrange or drag up onto the map. Keys: ← → reorder, ↑ float" : "Drag to move. Keys: arrows move, End docks, Home auto-places"}
          onKeyDown={onGripKey(id, where)}
        >
          <GripIcon />
        </button>
        <div className="mp-body">{d.content}</div>
        <div className="mp-acts">
          {where === "dock" ? (
            <>
              <button className="mp-act mp-arrow" aria-label={`Move ${d.label} left in the dock`} title="Move left" onClick={() => setLayout((l) => moveInDock(l, id, -1))}>
                <ArrowIcon dir="l" />
              </button>
              <button className="mp-act mp-arrow" aria-label={`Move ${d.label} right in the dock`} title="Move right" onClick={() => setLayout((l) => moveInDock(l, id, 1))}>
                <ArrowIcon dir="r" />
              </button>
              <button className="mp-act" aria-label={`Float ${d.label} on the map`} title="Float on the map" onClick={() => setLayout((l) => setMode(l, id, "float"))}>
                <FloatIcon />
              </button>
            </>
          ) : (
            <button className="mp-act" aria-label={`Dock ${d.label} below the map`} title="Dock below the map" onClick={() => setLayout((l) => setMode(l, id, "dock"))}>
              <DockIcon />
            </button>
          )}
          {!d.forceOpen && (
            <button className="mp-act" aria-label={`Minimize ${d.label}`} title="Minimize" onClick={() => minimize(id)}>
              <MinIcon />
            </button>
          )}
        </div>
      </div>
    );
  };

  const tray = (inDock: boolean) =>
    (minimized.length > 0 || anyFloating || dockShown) && (
      <div className={`mp-tray ${inDock ? "in-dock" : ""}`} ref={isolate} role="toolbar" aria-label="Map panels" onPointerDown={(e) => e.stopPropagation()}>
        {minimized.map((id) => (
          <button key={id} className="mp-chip" aria-label={`Show ${defs[id]!.label}`} title={`Show ${defs[id]!.label}`} onClick={() => setLayout((l) => restore(l, id))}>
            {defs[id]!.chipIcon}
            <span>{defs[id]!.short}</span>
          </button>
        ))}
        {minimized.length > 0 && <span className="mp-tray-sep" aria-hidden="true" />}
        {anyFloating && (
          <button className="mp-chip ghost" title="Move all map panels into the dock below the map" onClick={dockAll}>
            <DockIcon />
            <span>Dock all</span>
          </button>
        )}
        <button className="mp-chip ghost" title="Put every map panel back in its default place" onClick={reset}>
          <ResetIcon />
          <span>Reset layout</span>
        </button>
      </div>
    );

  return (
    <>
      <div className="mp-layer" style={{ height: area.h }}>
        {floating.map((id) => {
          const r = drag?.id === id ? drag.rect : rects[id];
          const measured = !!sizes[id];
          const st: React.CSSProperties = { left: r?.x ?? 0, top: r?.y ?? 0, visibility: measured && r ? "visible" : "hidden" };
          return card(id, "float", st, `${drag?.id === id ? "is-dragging" : ""} ${layout.panels[id].pos ? "is-user" : "is-auto"}`);
        })}
        {drag && drag.from === "dock" && (
          <div className="map-panel-ghost" style={{ left: drag.rect.x, top: drag.rect.y, width: drag.rect.w, height: drag.rect.h }} aria-hidden="true" />
        )}
        {drag && !dockShown && (
          <div className={`mp-dropzone ${drag.overDock ? "hot" : ""}`} aria-hidden="true">
            <DockIcon /> Drop here to dock below the map
          </div>
        )}
        {!dockShown && tray(false)}
      </div>
      {dockShown && (
        <div className={`mp-dock ${drag ? "dragging" : ""} ${drag?.overDock ? "hot" : ""}`} ref={dockRef} role="region" aria-label="Information dock">
          {docked.map((id) => {
            // caret = where the dragged panel will land, counted among the other docked panels
            const k = docked.filter((x) => x !== drag?.id).indexOf(id);
            return (
              <span key={id} style={{ display: "contents" }}>
                {drag?.overDock && k >= 0 && drag.dockIndex === k && <span className="mp-caret" aria-hidden="true" />}
                {card(id, "dock", undefined, drag?.id === id ? "is-ghost" : "")}
              </span>
            );
          })}
          {drag?.overDock && drag.dockIndex >= docked.filter((x) => x !== drag.id).length && <span className="mp-caret" aria-hidden="true" />}
          {tray(true)}
        </div>
      )}
      {live && <div className="mp-sr" role="status">{live}</div>}
    </>
  );
}
