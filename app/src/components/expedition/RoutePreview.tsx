import { useEffect, useRef, useState } from "react";
import type { Manifest } from "../../types";
import type { MissionSnapshot, PreviewPin } from "../../lib/expedition";

const PIN_COLOR: Record<string, string> = { start: "var(--turq)", destination: "var(--rose)", waypoint: "var(--lav)", meet: "var(--rose)" };

/** Which pins get a text label, and what it says (team labels are kept short). */
function labelFor(p: PreviewPin, mode: MissionSnapshot["mode"]): string | null {
  if (mode === "solo") return p.role === "start" || p.role === "destination" ? p.label : null;
  if (p.role === "start") return p.label.split(":")[0];
  if (p.role === "meet") return "Rendezvous";
  return null;
}

/**
 * Small static preview of the planned route over the same CTX orthoimage + elevation
 * tint the main map uses. The SVG viewBox is fitted to the route's bounding box at the
 * container's own aspect ratio, x = lon·cos(lat₀) so distances look right. Labels are
 * HTML placed at each pin. No live position is drawn.
 */
export function RoutePreview({ snap, manifest, onExpand }: { snap: MissionSnapshot; manifest: Manifest; onExpand?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(16 / 7);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setAspect(r.width / r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = [...snap.paths.flatMap((p) => p.pts), ...snap.pins.map((p) => [p.lon, p.lat] as [number, number])];
  if (all.length === 0) return null;
  const lat0 = all.reduce((s, p) => s + p[1], 0) / all.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const X = (lon: number) => lon * k;
  const Y = (lat: number) => -lat;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [lon, lat] of all) {
    x0 = Math.min(x0, X(lon)); x1 = Math.max(x1, X(lon));
    y0 = Math.min(y0, Y(lat)); y1 = Math.max(y1, Y(lat));
  }
  let w = x1 - x0, h = y1 - y0;
  const span = Math.max(w, h, 0.002);
  const pad = span * 0.2;
  w += pad * 2; h += pad * 2; x0 -= pad; y0 -= pad;
  if (w / h < aspect) { const nw = h * aspect; x0 -= (nw - w) / 2; w = nw; }
  else { const nh = w / aspect; y0 -= (nh - h) / 2; h = nh; }
  const u = Math.min(w, h * 2.2) / 100; // stroke unit
  const img = (key: string, op = 1) => {
    const L = manifest.layers[key];
    if (!L?.bounds) return null;
    const [[la0, lo0], [la1, lo1]] = L.bounds;
    return <image href={`/data/${L.file}`} x={X(lo0)} y={Y(la1)} width={X(lo1) - X(lo0)} height={la1 - la0} preserveAspectRatio="none" opacity={op} />;
  };
  return (
    <div className="xl-preview" ref={box}>
      <svg viewBox={`${x0} ${y0} ${w} ${h}`} role="img" aria-label={`Route preview: ${snap.startName} to ${snap.destName}`} preserveAspectRatio="none">
        <rect x={x0} y={y0} width={w} height={h} fill="#1a1b2c" />
        {img("terrain")}
        {img("elevation", 0.55)}
        {snap.paths.map((p, i) => (
          <polyline key={i} points={p.pts.map(([lon, lat]) => `${X(lon)},${Y(lat)}`).join(" ")} fill="none" stroke={p.color} strokeWidth={u * (p.dash ? 0.8 : 1.3)} strokeDasharray={p.dash ? `${u * 1.6} ${u * 1.4}` : undefined} strokeLinecap="round" strokeLinejoin="round" opacity={p.dash ? 0.8 : 1} />
        ))}
      </svg>
      {snap.pins.map((p, i) => {
        const left = ((X(p.lon) - x0) / w) * 100;
        const top = ((Y(p.lat) - y0) / h) * 100;
        const label = labelFor(p, snap.mode);
        return (
          <span key={i} className={`xl-pin role-${p.role}`} style={{ left: `${left}%`, top: `${top}%`, background: PIN_COLOR[p.role] ?? "var(--lav)" }} aria-hidden="true">
            {label && <span className={`xl-pin-label ${left > 60 ? "to-left" : ""} ${top > 70 || p.role === "meet" ? "above" : ""}`}>{label}</span>}
          </span>
        );
      })}
      {onExpand && (
        <button className="xl-expand" onClick={onExpand} aria-label="Open this route on the full map in Mission Planner" title="Open on the full map">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></svg>
        </button>
      )}
    </div>
  );
}
