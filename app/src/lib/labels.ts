/**
 * Label placement for the PDF map snapshot.
 * 1. Pins closer than `mergeDist` pixels share one label ("A start / Rendezvous").
 * 2. Each label tries 8 positions around its pin and takes the first that does not
 *    overlap an already-placed label, any pin, a reserved area or the canvas edge.
 * 3. If all 8 collide, it is pushed further out (stacked) with a leader line.
 */
export interface Pin {
  x: number;
  y: number;
  label: string;
  color: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelBox extends Rect {
  text: string;
  /** anchor (pin centre) */
  ax: number;
  ay: number;
  leader: boolean;
}

export interface Group extends Pin {
  members: Pin[];
}

export function mergePins(pins: Pin[], mergeDist = 18): Group[] {
  const groups: Group[] = [];
  for (const p of pins) {
    const g = groups.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < mergeDist);
    if (g) {
      g.members.push(p);
      if (!g.label.split(" / ").includes(p.label)) g.label = `${g.label} / ${p.label}`;
    } else groups.push({ ...p, members: [p] });
  }
  return groups;
}

const intersects = (a: Rect, b: Rect, m = 3) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

function hitsCircle(r: Rect, cx: number, cy: number, rad: number) {
  const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
  const ny = Math.max(r.y, Math.min(cy, r.y + r.h));
  return Math.hypot(nx - cx, ny - cy) < rad;
}

export function placeLabels(
  pins: Pin[],
  measure: (text: string) => number,
  W: number,
  H: number,
  opts: { h?: number; pinR?: number; reserved?: Rect[]; mergeDist?: number } = {},
): { groups: Group[]; boxes: LabelBox[] } {
  const h = opts.h ?? 28;
  const R = opts.pinR ?? 12;
  const reserved = opts.reserved ?? [];
  const groups = mergePins(pins, opts.mergeDist ?? 18);
  const placed: LabelBox[] = [];
  const free = (r: Rect) =>
    r.x >= 4 && r.y >= 4 && r.x + r.w <= W - 4 && r.y + r.h <= H - 4 &&
    !placed.some((b) => intersects(b, r)) &&
    !reserved.some((b) => intersects(b, r, 0)) &&
    !pins.some((p) => hitsCircle(r, p.x, p.y, R + 2));

  for (const g of groups) {
    const w = measure(g.label) + 16;
    const gap = R + 5;
    const cands: [number, number][] = [
      [gap, -h / 2],
      [-gap - w, -h / 2],
      [-w / 2, -gap - h],
      [-w / 2, gap],
      [gap - 4, -gap - h + 4],
      [gap - 4, gap - 4],
      [-gap - w + 4, -gap - h + 4],
      [-gap - w + 4, gap - 4],
    ];
    let box: LabelBox | null = null;
    for (const [dx, dy] of cands) {
      const r = { x: g.x + dx, y: g.y + dy, w, h };
      if (free(r)) {
        box = { ...r, text: g.label, ax: g.x, ay: g.y, leader: false };
        break;
      }
    }
    for (let k = 1; !box && k <= 12; k++) {
      for (const side of [1, -1]) {
        for (const dir of [-1, 1]) {
          const r = { x: side > 0 ? g.x + gap + 10 : g.x - gap - 10 - w, y: g.y - h / 2 + dir * k * (h + 6), w, h };
          if (free(r)) {
            box = { ...r, text: g.label, ax: g.x, ay: g.y, leader: true };
            break;
          }
        }
        if (box) break;
      }
    }
    // last resort: clamp to the canvas (may overlap, but never off-canvas)
    if (!box) box = { x: Math.min(Math.max(4, g.x + gap), W - w - 4), y: Math.min(Math.max(4, g.y - h / 2), H - h - 4), w, h, text: g.label, ax: g.x, ay: g.y, leader: false };
    placed.push(box);
  }
  return { groups, boxes: placed };
}
