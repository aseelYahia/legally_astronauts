import type { jsPDF } from "jspdf";

/** Layout kit for the PAWPRINT MARS mission report (A4, millimetres, Soft Cosmic palette).
 *  Every block measures itself before drawing so it never splits across a page or overlaps. */

export type RGB = [number, number, number];
export const C = {
  navy: [19, 21, 34] as RGB,
  charcoal: [34, 36, 56] as RGB,
  lav: [169, 155, 221] as RGB,
  lavSoft: [240, 237, 251] as RGB,
  lavLine: [214, 207, 240] as RGB,
  turq: [118, 201, 194] as RGB,
  turqSoft: [230, 246, 244] as RGB,
  rose: [217, 142, 186] as RGB,
  roseSoft: [250, 236, 244] as RGB,
  roseInk: [158, 62, 117] as RGB,
  sand: [230, 199, 156] as RGB,
  sandSoft: [251, 243, 231] as RGB,
  sandInk: [138, 92, 32] as RGB,
  ivory: [241, 237, 245] as RGB,
  paper: [250, 249, 253] as RGB,
  ink: [36, 34, 56] as RGB,
  ink2: [74, 70, 100] as RGB,
  muted: [112, 108, 140] as RGB,
  line: [226, 223, 238] as RGB,
};

export const SIZE = { title: 24, h1: 18, h2: 13.5, body: 11, small: 9.5, tiny: 8.5 };
const PT = 0.3528; // mm per point
export const lineH = (size: number, k = 1.42) => size * PT * k;

export type Kind = "NASA DATA" | "DERIVED" | "ESTIMATE" | "ASSUMPTION" | "ARCHIVED" | "USER INPUT" | "NOT INGESTED";
export const KIND_COLOR: Record<Kind, [RGB, RGB]> = {
  "NASA DATA": [C.turqSoft, [32, 120, 112]],
  DERIVED: [C.lavSoft, [92, 76, 160]],
  ESTIMATE: [C.sandSoft, C.sandInk],
  ASSUMPTION: [[238, 238, 244], [90, 88, 112]],
  ARCHIVED: [C.sandSoft, C.sandInk],
  "USER INPUT": [[238, 238, 244], [90, 88, 112]],
  "NOT INGESTED": [[238, 238, 244], [90, 88, 112]],
};

export interface Art {
  cover?: string | HTMLImageElement | null;
  sitting?: string | HTMLImageElement | null;
  floating?: string | HTMLImageElement | null;
  crawling?: string | HTMLImageElement | null;
}

export class Kit {
  doc: jsPDF;
  font: string;
  safe: (t: string) => string;
  readonly W: number;
  readonly H: number;
  readonly M = 18;
  readonly CW: number;
  readonly bottom: number;
  y = 0;
  page = 1;
  pageTitle = "Mission Report";
  constructor(doc: jsPDF, font: string, safe: (t: string) => string) {
    this.doc = doc;
    this.font = font;
    this.safe = safe;
    this.W = doc.internal.pageSize.getWidth();
    this.H = doc.internal.pageSize.getHeight();
    this.CW = this.W - 2 * this.M;
    this.bottom = this.H - 20;
  }

  // ------------------------------------------------------------ text primitives
  set(size: number, bold = false, color: RGB = C.ink) {
    this.doc.setFont(this.font, bold ? "bold" : "normal");
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
  }
  wrap(t: string, width: number, size: number, bold = false): string[] {
    this.set(size, bold);
    return this.doc.splitTextToSize(this.safe(t), width) as string[];
  }
  textH(t: string, width: number, size: number, bold = false, k = 1.42) {
    return this.wrap(t, width, size, bold).length * lineH(size, k);
  }
  /** Draw wrapped text with its first baseline at y + ascent; returns the height used. */
  text(t: string, x: number, y: number, width: number, size: number, opts: { bold?: boolean; color?: RGB; k?: number; align?: "left" | "right" | "center" } = {}) {
    const lines = this.wrap(t, width, size, opts.bold);
    this.set(size, opts.bold, opts.color ?? C.ink);
    const lh = lineH(size, opts.k ?? 1.42);
    const asc = size * PT * 0.78;
    lines.forEach((ln, i) => {
      const xx = opts.align === "right" ? x + width : opts.align === "center" ? x + width / 2 : x;
      this.doc.text(ln, xx, y + asc + i * lh, opts.align && opts.align !== "left" ? { align: opts.align } : undefined);
    });
    return lines.length * lh;
  }

  // ------------------------------------------------------------ pages
  ensure(h: number) {
    if (this.y + h > this.bottom) this.newPage();
  }
  /** Start a new page only when less than `mm` of the current page is left. */
  breakIfLess(mm: number, title?: string) {
    if (title) this.pageTitle = title;
    if (this.bottom - this.y < mm) this.newPage(title);
  }
  /** Inline legend (line swatches) that wraps onto new rows instead of running off the page. */
  legend(items: [string, RGB, boolean][]) {
    const d = this.doc;
    let lx = this.M;
    const rowH = 5;
    for (const [t, col, dash] of items) {
      this.set(SIZE.tiny, false, C.ink2);
      const tw = d.getTextWidth(this.safe(t)) + 7.5;
      if (lx + tw > this.M + this.CW) {
        lx = this.M;
        this.y += rowH;
      }
      d.setDrawColor(...col);
      d.setLineWidth(1.2);
      if (dash) d.setLineDashPattern([1.4, 1.2], 0);
      d.line(lx, this.y + 1.8, lx + 6, this.y + 1.8);
      d.setLineDashPattern([], 0);
      this.set(SIZE.tiny, false, C.ink2);
      d.text(this.safe(t), lx + 7.5, this.y + 2.9);
      lx += tw + 6;
    }
    this.y += rowH;
  }
  newPage(title?: string) {
    this.doc.addPage();
    this.page++;
    if (title) this.pageTitle = title;
    this.miniHeader();
  }
  miniHeader() {
    const d = this.doc;
    d.setFillColor(...C.navy);
    d.rect(0, 0, this.W, 12, "F");
    this.set(9.5, true, C.ivory);
    d.text("PAWPRINT", this.M, 7.8);
    d.setTextColor(...C.rose);
    d.text("MARS", this.M + d.getTextWidth("PAWPRINT "), 7.8);
    this.set(9.5, false, [200, 196, 222]);
    d.text(this.safe(this.pageTitle), this.W - this.M, 7.8, { align: "right" });
    this.y = 22;
  }
  footer(generated: string) {
    const d = this.doc;
    const n = d.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      d.setPage(i);
      d.setDrawColor(...C.line);
      d.setLineWidth(0.3);
      d.line(this.M, this.H - 13, this.W - this.M, this.H - 13);
      this.set(SIZE.tiny, false, C.muted);
      d.text(this.safe(`PAWPRINT MARS · generated ${generated} UTC · planning estimate, not certified for astronaut safety`), this.M, this.H - 8);
      d.text(`Page ${i} of ${n}`, this.W - this.M, this.H - 8, { align: "right" });
    }
  }

  // ------------------------------------------------------------ building blocks
  image(img: string | HTMLImageElement | null | undefined, x: number, y: number, w: number, h: number) {
    if (!img) return false;
    try {
      this.doc.addImage(img as string, "JPEG", x, y, w, h);
      return true;
    } catch {
      return false;
    }
  }

  /** Section heading: coloured pill accent, eyebrow + title, optional small mascot on the right. */
  section(title: string, eyebrow: string, color: RGB, art?: string | HTMLImageElement | null, minAfter = 30) {
    const h = 15;
    this.ensure(h + minAfter);
    const d = this.doc;
    d.setFillColor(...color);
    d.roundedRect(this.M, this.y + 1, 3, 11.5, 1.5, 1.5, "F");
    this.set(SIZE.small, true, color === C.lav ? [110, 92, 180] : color === C.turq ? [40, 130, 122] : color === C.rose ? C.roseInk : C.sandInk);
    d.text(this.safe(eyebrow.toUpperCase()), this.M + 6, this.y + 4.4);
    this.set(SIZE.h1, true, C.ink);
    d.text(this.safe(title), this.M + 6, this.y + 11.6);
    if (art) this.image(art, this.W - this.M - 14, this.y - 1, 14, 14);
    this.y += h + 2;
  }

  h2(t: string, minAfter = 18) {
    this.ensure(lineH(SIZE.h2) + minAfter);
    this.y += this.text(t, this.M, this.y, this.CW, SIZE.h2, { bold: true }) + 1.6;
  }

  para(t: string, opts: { size?: number; color?: RGB; bold?: boolean; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? SIZE.body;
    const w = this.CW - (opts.indent ?? 0);
    const lines = this.wrap(t, w, size, opts.bold);
    const lh = lineH(size);
    // keep short paragraphs together; let long ones flow line by line
    if (lines.length <= 4) this.ensure(lines.length * lh);
    this.set(size, opts.bold, opts.color ?? C.ink);
    for (const ln of lines) {
      this.ensure(lh);
      this.doc.text(ln, this.M + (opts.indent ?? 0), this.y + size * PT * 0.78);
      this.y += lh;
    }
    this.y += opts.gap ?? 2.4;
  }

  bullets(items: string[], opts: { size?: number; color?: RGB; dot?: RGB; gap?: number } = {}) {
    const size = opts.size ?? SIZE.body;
    for (const it of items) {
      const h = this.textH(it, this.CW - 6, size);
      this.ensure(h);
      this.doc.setFillColor(...(opts.dot ?? C.lav));
      this.doc.circle(this.M + 1.6, this.y + size * PT * 0.5, 0.95, "F");
      this.y += this.text(it, this.M + 6, this.y, this.CW - 6, size, { color: opts.color }) + (opts.gap ?? 1.6);
    }
    this.y += 1.2;
  }

  /** Small rounded label. Returns its width. */
  pill(text: string, x: number, y: number, bg: RGB, fg: RGB, size = 7.6) {
    this.set(size, true, fg);
    const t = this.safe(text);
    const w = this.doc.getTextWidth(t) + 4.4;
    this.doc.setFillColor(...bg);
    this.doc.roundedRect(x, y, w, size * PT + 2.4, 1.6, 1.6, "F");
    this.doc.setTextColor(...fg);
    this.doc.text(t, x + 2.2, y + size * PT + 0.55);
    return w;
  }
  kind(k: Kind, x: number, y: number) {
    const [bg, fg] = KIND_COLOR[k];
    return this.pill(k, x, y, bg, fg, 7);
  }

  /** Row of metric cards. */
  cards(items: { label: string; value: string; sub?: string; kind?: Kind; accent?: RGB }[], cols = items.length) {
    const gap = 3.2;
    const w = (this.CW - gap * (cols - 1)) / cols;
    const pad = 3.2;
    let valSize = cols >= 5 ? 15 : 17;
    // shrink the value font until every value fits on one line
    for (; valSize > 10.5; valSize -= 0.5) {
      this.set(valSize, true);
      if (items.every((i) => this.doc.getTextWidth(this.safe(i.value)) <= w - 2 * pad)) break;
    }
    const subH = Math.max(...items.map((i) => (i.sub ? this.textH(i.sub, w - 2 * pad, 9, false, 1.3) : 0)));
    // labels may wrap on narrow cards: every card uses the tallest label so values stay aligned
    const labelH = Math.max(...items.map((i) => this.textH(i.label, w - 2 * pad, SIZE.tiny, true)));
    const h = pad + labelH + 1.2 + lineH(valSize, 1.15) + 1 + subH + 6.4 + pad;
    this.ensure(h);
    items.forEach((it, i) => {
      const x = this.M + i * (w + gap);
      const d = this.doc;
      d.setFillColor(...C.paper);
      d.setDrawColor(...C.line);
      d.setLineWidth(0.3);
      d.roundedRect(x, this.y, w, h, 2.6, 2.6, "FD");
      d.setFillColor(...(it.accent ?? C.lav));
      d.roundedRect(x, this.y, w, 1.6, 0.8, 0.8, "F");
      let yy = this.y + pad + 0.8;
      this.text(it.label, x + pad, yy, w - 2 * pad, SIZE.tiny, { bold: true, color: C.muted });
      yy += labelH + 1.2;
      this.text(it.value, x + pad, yy, w - 2 * pad, valSize, { bold: true, k: 1.15 });
      yy += lineH(valSize, 1.15) + 1;
      if (it.sub) this.text(it.sub, x + pad, yy, w - 2 * pad, 9, { color: C.ink2, k: 1.3 });
      if (it.kind) this.kind(it.kind, x + pad, this.y + h - pad - 3.4);
    });
    this.y += h + 4;
  }

  /** Table with header repeat, zebra rows, highlighted row and per-column alignment. */
  table(head: string[], rows: string[][], widths: number[], opts: { size?: number; highlight?: number; align?: ("l" | "r" | "c")[]; boldFirst?: boolean; links?: (string | null)[][] } = {}) {
    const size = opts.size ?? 10.5;
    const padX = 2.4;
    const padY = 2.2;
    const total = widths.reduce((a, b) => a + b, 0);
    const scale = this.CW / total;
    const ws = widths.map((w) => w * scale);
    const lh = lineH(size, 1.3);
    const measure = (cells: string[], header: boolean) =>
      cells.map((c, i) => this.wrap(c, ws[i] - 2 * padX, header ? size - 1.5 : size, header || (opts.boldFirst && i === 0)));
    const drawRow = (cells: string[], header: boolean, idx: number) => {
      const wrapped = measure(cells, header);
      const h = Math.max(...wrapped.map((w) => w.length)) * lh + 2 * padY;
      if (this.y + h > this.bottom) {
        this.newPage();
        if (!header) drawRow(head, true, -1);
      }
      const d = this.doc;
      if (header) {
        d.setFillColor(...C.charcoal);
        d.roundedRect(this.M, this.y, this.CW, h, 1.8, 1.8, "F");
      } else if (idx === opts.highlight) {
        d.setFillColor(...C.lavSoft);
        d.rect(this.M, this.y, this.CW, h, "F");
        d.setFillColor(...C.lav);
        d.rect(this.M, this.y, 1.4, h, "F");
      } else if (idx % 2 === 1) {
        d.setFillColor(...C.paper);
        d.rect(this.M, this.y, this.CW, h, "F");
      }
      let x = this.M;
      wrapped.forEach((lines, i) => {
        const al = opts.align?.[i] ?? "l";
        const bold = header || (opts.boldFirst && i === 0) || idx === opts.highlight && i === 0;
        this.set(header ? size - 1.5 : size, bold, header ? C.ivory : C.ink);
        const link = !header && opts.links?.[idx]?.[i];
        if (link) this.doc.setTextColor(40, 120, 150);
        lines.forEach((ln, j) => {
          const tx = al === "r" ? x + ws[i] - padX : al === "c" ? x + ws[i] / 2 : x + padX;
          const ty = this.y + padY + (header ? size - 1.5 : size) * PT * 0.8 + j * lh;
          if (link) this.doc.textWithLink(ln, tx, ty, { url: link });
          else this.doc.text(ln, tx, ty, al === "l" ? undefined : { align: al === "r" ? "right" : "center" });
        });
        x += ws[i];
      });
      if (!header) {
        d.setDrawColor(...C.line);
        d.setLineWidth(0.25);
        d.line(this.M, this.y + h, this.M + this.CW, this.y + h);
      }
      this.y += h;
    };
    this.ensure(lineH(size - 1, 1.3) + 2 * padY + lineH(size, 1.3) * 2 + 2 * padY);
    drawRow(head, true, -1);
    rows.forEach((r, i) => drawRow(r, false, i));
    this.y += 4;
  }

  /** Coloured callout card: title, plain-language body, optional small "source" line. */
  callout(title: string, body: string, tone: "warning" | "caution" | "info" | "note", source?: string, tag?: string) {
    const tones = {
      warning: { bg: C.roseSoft, bar: C.rose, ink: C.roseInk },
      caution: { bg: C.sandSoft, bar: C.sand, ink: C.sandInk },
      info: { bg: C.lavSoft, bar: C.lav, ink: [92, 76, 160] as RGB },
      note: { bg: C.turqSoft, bar: C.turq, ink: [32, 120, 112] as RGB },
    }[tone];
    const pad = 4;
    const iw = this.CW - 2 * pad - 3;
    const titleH = this.textH(title, iw - 26, 11.5, true, 1.3);
    const bodyH = this.textH(body, iw, SIZE.body);
    const srcH = source ? this.textH(source, iw, 9, false, 1.3) + 1.2 : 0;
    const h = pad + titleH + 1.4 + bodyH + srcH + pad;
    this.ensure(h + 3);
    const d = this.doc;
    d.setFillColor(...tones.bg);
    d.roundedRect(this.M, this.y, this.CW, h, 2.6, 2.6, "F");
    d.setFillColor(...tones.bar);
    d.roundedRect(this.M, this.y, 2.4, h, 1.2, 1.2, "F");
    const x = this.M + pad + 3;
    let yy = this.y + pad;
    if (tag) {
      const tw = this.pill(tag, this.W - this.M - pad - 22, yy - 0.4, tones.bar, C.navy, 7.4);
      void tw;
    }
    yy += this.text(title, x, yy, iw - 26, 11.5, { bold: true, color: tones.ink, k: 1.3 }) + 1.4;
    yy += this.text(body, x, yy, iw, SIZE.body, { color: C.ink });
    if (source) this.text(source, x, yy + 1.2, iw, 9, { color: C.muted, k: 1.3 });
    this.y += h + 3;
  }

  /** Horizontal stacked bar (EVA timeline). */
  bar(segments: { label: string; min: number; color: RGB }[], totalMin: number, opts: { height?: number; caption?: string } = {}) {
    const h = opts.height ?? 7;
    const legendH = lineH(SIZE.tiny, 1.3) + 1.5;
    this.ensure(h + legendH + 6);
    const d = this.doc;
    d.setFillColor(...C.line);
    d.roundedRect(this.M, this.y, this.CW, h, 2, 2, "F");
    let x = this.M;
    for (const s of segments) {
      const w = Math.max(0, (s.min / Math.max(totalMin, 1e-9)) * this.CW);
      if (w <= 0) continue;
      d.setFillColor(...s.color);
      d.rect(x, this.y, Math.min(w, this.M + this.CW - x), h, "F");
      x += w;
    }
    this.y += h + 2;
    let lx = this.M;
    for (const s of segments) {
      d.setFillColor(...s.color);
      d.roundedRect(lx, this.y + 0.4, 3, 3, 0.8, 0.8, "F");
      const t = `${s.label}`;
      this.set(SIZE.tiny, false, C.ink2);
      d.text(this.safe(t), lx + 4.4, this.y + 2.9);
      lx += d.getTextWidth(this.safe(t)) + 10;
    }
    this.y += legendH + (opts.caption ? 0 : 2);
    if (opts.caption) this.para(opts.caption, { size: SIZE.tiny, color: C.muted });
  }

  /** Resource gauge: label, used / budget bar, numbers. */
  gauge(label: string, used: number | null, budget: number | null, text: string, x: number, y: number, w: number) {
    const d = this.doc;
    this.text(label, x, y, w, SIZE.small, { bold: true, color: C.ink2 });
    const by = y + 5.2;
    d.setFillColor(...C.line);
    d.roundedRect(x, by, w, 4, 2, 2, "F");
    if (used !== null && budget) {
      const f = Math.max(0, Math.min(1, used / budget));
      const col = f > 0.9 ? C.rose : f > 0.7 ? C.sand : C.turq;
      d.setFillColor(...col);
      d.roundedRect(x, by, Math.max(4, w * f), 4, 2, 2, "F");
    }
    return 5.2 + 4 + 1.6 + this.text(text, x, by + 5.6, w, 10.5, { color: C.ink });
  }

  /** Two-column definition list (label | value), used sparingly. */
  facts(rows: [string, string][], labelW = 46, size = SIZE.body) {
    for (const [k, v] of rows) {
      const h = Math.max(this.textH(k, labelW - 3, size - 1), this.textH(v, this.CW - labelW, size));
      this.ensure(h + 1.4);
      this.text(k, this.M, this.y, labelW - 3, size - 1, { color: C.muted });
      this.text(v, this.M + labelW, this.y, this.CW - labelW, size);
      this.y += h + 1.4;
    }
    this.y += 1.6;
  }
}
