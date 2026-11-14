import { useId, useMemo, useState } from "react";

interface Props {
  distance: number[];
  elevation: number[];
  stopIndices: number[];
  stopLabels: string[];
  height?: number;
  onHover?: (index: number | null) => void;
}

export function ElevationProfile({ distance, elevation, stopIndices, stopLabels, height = 150, onHover }: Props) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 340;
  const H = height;
  const pad = { l: 46, r: 12, t: 12, b: 24 };
  const geom = useMemo(() => {
    const dmax = distance[distance.length - 1] || 1;
    let zmin = Math.min(...elevation);
    let zmax = Math.max(...elevation);
    const span = Math.max(zmax - zmin, 10);
    zmin = Math.floor((zmin - span * 0.1) / 10) * 10;
    zmax = Math.ceil((zmax + span * 0.1) / 10) * 10;
    const x = (d: number) => pad.l + (d / dmax) * (W - pad.l - pad.r);
    const y = (z: number) => pad.t + (1 - (z - zmin) / (zmax - zmin)) * (H - pad.t - pad.b);
    const pts = distance.map((d, i) => `${x(d).toFixed(1)},${y(elevation[i]).toFixed(1)}`);
    const line = `M${pts.join("L")}`;
    const area = `${line}L${x(dmax)},${H - pad.b}L${x(0)},${H - pad.b}Z`;
    const ticks = 4;
    const yt = Array.from({ length: ticks }, (_, i) => zmin + ((zmax - zmin) * i) / (ticks - 1));
    return { x, y, line, area, yt, dmax };
  }, [distance, elevation, H, pad.b, pad.l, pad.r, pad.t]);

  const handleMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = (e.target as SVGRectElement).getBoundingClientRect();
    const fx = ((e.clientX - rect.left) / rect.width) * (W - pad.l - pad.r);
    const d = (fx / (W - pad.l - pad.r)) * geom.dmax;
    let best = 0;
    for (let i = 0; i < distance.length; i++) if (Math.abs(distance[i] - d) < Math.abs(distance[best] - d)) best = i;
    setHover(best);
    onHover?.(best);
  };

  return (
    <svg className="profile" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Route elevation profile">
      <defs>
        <linearGradient id={`fill${id}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#8b6cff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#2ee6d6" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id={`stroke${id}`} x1="0" x2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#5ff5e6" />
        </linearGradient>
      </defs>
      {geom.yt.map((z) => (
        <g key={z}>
          <line x1={pad.l} x2={W - pad.r} y1={geom.y(z)} y2={geom.y(z)} className="grid" />
          <text x={pad.l - 6} y={geom.y(z) + 3} textAnchor="end" className="axis">
            {Math.round(z).toLocaleString("en-US")}
          </text>
        </g>
      ))}
      <path d={geom.area} fill={`url(#fill${id})`} />
      <path d={geom.line} fill="none" stroke={`url(#stroke${id})`} strokeWidth="2" />
      {stopIndices.map((si, k) => (
        <g key={si + "-" + k}>
          <circle
            cx={geom.x(distance[si])}
            cy={geom.y(elevation[si])}
            r="4.5"
            className={`pstop ${k === 0 ? "start" : k === stopIndices.length - 1 ? "dest" : "wp"}`}
          />
          <text x={geom.x(distance[si])} y={H - 6} textAnchor={k === 0 ? "start" : k === stopIndices.length - 1 ? "end" : "middle"} className="axis label">
            {stopLabels[k]}
          </text>
        </g>
      ))}
      {hover !== null && (
        <g pointerEvents="none">
          <line x1={geom.x(distance[hover])} x2={geom.x(distance[hover])} y1={pad.t} y2={H - pad.b} className="hoverline" />
          <text x={Math.min(geom.x(distance[hover]) + 6, W - 90)} y={pad.t + 10} className="hovertext">
            {(distance[hover] / 1000).toFixed(2)} km · {Math.round(elevation[hover]).toLocaleString("en-US")} m
          </text>
        </g>
      )}
      <rect
        x={pad.l}
        y={pad.t}
        width={W - pad.l - pad.r}
        height={H - pad.t - pad.b}
        fill="transparent"
        onMouseMove={handleMove}
        onMouseLeave={() => {
          setHover(null);
          onHover?.(null);
        }}
      />
    </svg>
  );
}
