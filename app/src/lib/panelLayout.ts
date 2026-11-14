/** Screen-space layout of the floating map information panels (title, weather, legend, instructions).
 *  Pure functions only: no DOM, no Leaflet. Panels live in screen pixels and never touch map coordinates. */

export type PanelId = "title" | "weather" | "legend" | "hint";
export const PANEL_IDS: PanelId[] = ["hint", "title", "legend", "weather"];
/** Smart placement order: identity first, then the legend, the instructions and the weather. */
export const PLACE_ORDER: PanelId[] = ["title", "legend", "hint", "weather"];

export type PanelMode = "float" | "dock" | "min";
/** Position relative to the nearest corner, so a panel parked bottom-right stays bottom-right on resize. */
export interface PanelPos { h: "l" | "r"; dx: number; v: "t" | "b"; dy: number }
export interface PanelState {
  mode: PanelMode;
  /** User-chosen position; absent = smart automatic placement. */
  pos?: PanelPos;
  /** Where a minimized panel goes back to. */
  restore?: "float" | "dock";
}
export interface Layout { v: 1; panels: Record<PanelId, PanelState>; dock: PanelId[] }

export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }
export interface WeightedPoint { x: number; y: number; w: number }

export const MARGIN = 10;
export const STORAGE_KEY = "pawprint.mapPanels.v1";

export function defaultLayout(): Layout {
  return { v: 1, panels: { title: { mode: "float" }, weather: { mode: "float" }, legend: { mode: "float" }, hint: { mode: "float" } }, dock: [] };
}

/** Parse a stored layout; anything malformed falls back to the defaults field by field. */
export function parseLayout(raw: string | null): Layout {
  const base = defaultLayout();
  if (!raw) return base;
  try {
    const o = JSON.parse(raw) as Partial<Layout>;
    if (!o || o.v !== 1 || typeof o.panels !== "object") return base;
    for (const id of PANEL_IDS) {
      const p = (o.panels as Record<string, PanelState | undefined>)[id];
      if (!p || !["float", "dock", "min"].includes(p.mode)) continue;
      const st: PanelState = { mode: p.mode };
      const q = p.pos;
      if (q && (q.h === "l" || q.h === "r") && (q.v === "t" || q.v === "b") && Number.isFinite(q.dx) && Number.isFinite(q.dy)) {
        st.pos = { h: q.h, v: q.v, dx: Math.max(0, q.dx), dy: Math.max(0, q.dy) };
      }
      if (p.restore === "dock" || p.restore === "float") st.restore = p.restore;
      base.panels[id] = st;
    }
    const dock = Array.isArray(o.dock) ? o.dock.filter((d, i, a): d is PanelId => PANEL_IDS.includes(d as PanelId) && a.indexOf(d) === i) : [];
    // the dock order lists exactly the panels that are docked (or minimized from the dock)
    base.dock = dock.filter((d) => base.panels[d].mode === "dock" || (base.panels[d].mode === "min" && base.panels[d].restore === "dock"));
    for (const id of PANEL_IDS) if (base.panels[id].mode === "dock" && !base.dock.includes(id)) base.dock.push(id);
    return base;
  } catch {
    return base;
  }
}

export function loadLayout(storage: Pick<Storage, "getItem"> | null | undefined): Layout {
  try {
    return parseLayout(storage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(storage: Pick<Storage, "setItem"> | null | undefined, l: Layout) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(l));
  } catch {
    /* private mode / quota: layout simply isn't remembered */
  }
}

export function clearLayout(storage: Pick<Storage, "removeItem"> | null | undefined) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/* ---------- state transitions ---------- */

export function setMode(l: Layout, id: PanelId, mode: PanelMode, dockIndex?: number): Layout {
  const cur = l.panels[id];
  const panels = { ...l.panels };
  let dock = l.dock.filter((d) => d !== id);
  if (mode === "dock") {
    const i = dockIndex === undefined ? dock.length : Math.max(0, Math.min(dock.length, dockIndex));
    dock = [...dock.slice(0, i), id, ...dock.slice(i)];
    panels[id] = { ...cur, mode: "dock", restore: undefined };
  } else if (mode === "min") {
    const from = cur.mode === "min" ? cur.restore ?? "float" : cur.mode;
    if (from === "dock") dock = l.dock; // keep its slot for when it comes back
    panels[id] = { ...cur, mode: "min", restore: from };
  } else {
    panels[id] = { ...cur, mode: "float", restore: undefined };
  }
  return { ...l, panels, dock };
}

/** Bring a minimized panel back where it was. */
export function restore(l: Layout, id: PanelId): Layout {
  const cur = l.panels[id];
  if (cur.mode !== "min") return l;
  return setMode(l, id, cur.restore ?? "float", cur.restore === "dock" ? l.dock.indexOf(id) : undefined);
}

export function moveInDock(l: Layout, id: PanelId, delta: number): Layout {
  const i = l.dock.indexOf(id);
  if (i < 0) return l;
  const j = Math.max(0, Math.min(l.dock.length - 1, i + delta));
  if (i === j) return l;
  const dock = [...l.dock];
  dock.splice(i, 1);
  dock.splice(j, 0, id);
  return { ...l, dock };
}

export function setPos(l: Layout, id: PanelId, pos: PanelPos | undefined): Layout {
  return { ...l, panels: { ...l.panels, [id]: { ...l.panels[id], mode: "float", pos, restore: undefined } }, dock: l.dock.filter((d) => d !== id) };
}

/* ---------- geometry ---------- */

/** Keep a panel fully inside the map area (or pinned to its top-left corner if it is larger than the area). */
export function clampRect(r: Rect, area: Size, m = MARGIN): Rect {
  const x = Math.max(m, Math.min(r.x, area.w - r.w - m));
  const y = Math.max(m, Math.min(r.y, area.h - r.h - m));
  return { ...r, x: Math.round(x), y: Math.round(y) };
}

export function toPos(r: Rect, area: Size): PanelPos {
  const right = r.x + r.w / 2 > area.w / 2;
  const bottom = r.y + r.h / 2 > area.h / 2;
  return {
    h: right ? "r" : "l",
    dx: Math.max(0, Math.round(right ? area.w - (r.x + r.w) : r.x)),
    v: bottom ? "b" : "t",
    dy: Math.max(0, Math.round(bottom ? area.h - (r.y + r.h) : r.y)),
  };
}

export function fromPos(p: PanelPos, size: Size, area: Size): Rect {
  const x = p.h === "l" ? p.dx : area.w - size.w - p.dx;
  const y = p.v === "t" ? p.dy : area.h - size.h - p.dy;
  return clampRect({ x, y, w: size.w, h: size.h }, area);
}

export const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Push panels apart so none overlap: each later rect is moved to the nearest free spot (down, up, left, right). */
export function separate(rects: Rect[], area: Size, fixed: Rect[] = [], gap = 8): Rect[] {
  const out: Rect[] = [];
  for (const r0 of rects) {
    let r = clampRect(r0, area);
    const taken = [...fixed, ...out];
    if (taken.some((t) => overlaps(r, t, gap))) {
      const cands: Rect[] = [];
      for (const t of taken) {
        cands.push({ ...r, y: t.y + t.h + gap }, { ...r, y: t.y - r.h - gap }, { ...r, x: t.x + t.w + gap }, { ...r, x: t.x - r.w - gap });
      }
      const free = cands
        .map((c) => clampRect(c, area))
        .filter((c) => !taken.some((t) => overlaps(c, t, gap - 1)))
        .sort((a, b) => Math.hypot(a.x - r.x, a.y - r.y) - Math.hypot(b.x - r.x, b.y - r.y));
      if (free.length) r = free[0];
    }
    out.push(r);
  }
  return out;
}

/* ---------- smart default placement ---------- */

export type Anchor = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";
export const PREFERRED: Record<PanelId, Anchor[]> = {
  title: ["tl", "bl", "tr", "br"],
  hint: ["tc", "tr", "bc", "tl"],
  weather: ["tr", "tl", "br", "bc"],
  legend: ["bl", "br", "tl", "tr"],
};

export function anchorRect(a: Anchor, size: Size, area: Size, m = MARGIN): Rect {
  const x = a[1] === "l" ? m : a[1] === "r" ? area.w - size.w - m : (area.w - size.w) / 2;
  const y = a[0] === "t" ? m : a[0] === "b" ? area.h - size.h - m : (area.h - size.h) / 2;
  return clampRect({ x, y, w: size.w, h: size.h }, area, m);
}

/** How bad is it to put a panel here: weight of covered markers/route + overlap with other furniture
 *  + a mild pull towards the panel's usual corner and towards the map edges (keep the centre clear). */
export function scoreRect(r: Rect, points: WeightedPoint[], obstacles: Rect[], area: Size, prefPenalty: number, pad = 12): number {
  let s = prefPenalty;
  for (const p of points) if (p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad) s += p.w;
  for (const o of obstacles) {
    const a = overlapArea(r, { x: o.x - 6, y: o.y - 6, w: o.w + 12, h: o.h + 12 });
    if (a > 0) s += 60 + (120 * a) / Math.max(1, r.w * r.h);
  }
  // keep the middle of the map clear: prefer the top and bottom bands, then the side edges
  const vEdge = Math.min(r.y, area.h - r.y - r.h) - MARGIN;
  const hEdge = Math.min(r.x, area.w - r.x - r.w) - MARGIN;
  s += Math.max(0, vEdge) * 0.012 + Math.max(0, hEdge) * 0.004;
  return s;
}

export function candidates(size: Size, area: Size, prefs: Anchor[], m = MARGIN, near: Rect[] = [], gap = 8): { r: Rect; pen: number }[] {
  const out: { r: Rect; pen: number }[] = prefs.map((a, i) => ({ r: anchorRect(a, size, area, m), pen: i * 0.6 }));
  // tidy stacks: directly below / above / beside furniture that is already placed
  for (const o of near) {
    for (const [x, y] of [
      [o.x, o.y + o.h + gap], [o.x + o.w - size.w, o.y + o.h + gap], [o.x, o.y - size.h - gap], [o.x + o.w - size.w, o.y - size.h - gap],
      [o.x + o.w + gap, o.y], [o.x - size.w - gap, o.y], [o.x + o.w + gap, o.y + o.h - size.h], [o.x - size.w - gap, o.y + o.h - size.h],
    ])
      out.push({ r: clampRect({ x, y, w: size.w, h: size.h }, area, m), pen: 1.2 });
  }
  const nx = 8, ny = 6;
  const spanX = Math.max(0, area.w - size.w - 2 * m), spanY = Math.max(0, area.h - size.h - 2 * m);
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= ny; j++) {
      const r = clampRect({ x: m + (spanX * i) / nx, y: m + (spanY * j) / ny, w: size.w, h: size.h }, area, m);
      out.push({ r, pen: 2.4 });
    }
  return out;
}

export interface AutoInput { id: PanelId; size: Size; current?: Rect }

/** Greedy placement in priority order. A panel that already has a decent spot only moves when the new spot
 *  is clearly better (hysteresis), so panels don't jump around while the user pans. */
export function autoPlace(items: AutoInput[], area: Size, points: WeightedPoint[], fixed: Rect[], hysteresis = 2.5): Record<string, Rect> {
  const placed: Record<string, Rect> = {};
  const obstacles = [...fixed];
  for (const it of items) {
    const prefs = PREFERRED[it.id];
    let best: { r: Rect; s: number } | null = null;
    for (const c of candidates(it.size, area, prefs, MARGIN, obstacles)) {
      const s = scoreRect(c.r, points, obstacles, area, c.pen);
      if (!best || s < best.s) best = { r: c.r, s };
    }
    let r = best!.r;
    if (it.current) {
      const cur = clampRect({ ...it.current, w: it.size.w, h: it.size.h }, area);
      const ai = prefs.findIndex((a) => {
        const ar = anchorRect(a, it.size, area);
        return Math.abs(ar.x - cur.x) < 2 && Math.abs(ar.y - cur.y) < 2;
      });
      const curScore = scoreRect(cur, points, obstacles, area, ai >= 0 ? ai * 0.6 : 2.4);
      if (curScore <= best!.s + hysteresis) r = cur;
    }
    placed[it.id] = r;
    obstacles.push(r);
  }
  return placed;
}

/** Drop near-duplicate screen points (dense route vertices) so scoring stays cheap. */
export function thinPoints(pts: WeightedPoint[], area: Size, minDist = 8): WeightedPoint[] {
  const out: WeightedPoint[] = [];
  let last: WeightedPoint | null = null;
  for (const p of pts) {
    if (p.x < -20 || p.y < -20 || p.x > area.w + 20 || p.y > area.h + 20) { last = null; continue; }
    if (last && Math.abs(p.x - last.x) < minDist && Math.abs(p.y - last.y) < minDist && p.w <= last.w) continue;
    out.push(p);
    last = p;
  }
  return out;
}
