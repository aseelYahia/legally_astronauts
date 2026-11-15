import type { ReactNode } from "react";

/** Circular gauge. `pct` null renders an empty dashed ring (no budget entered). */
export function Ring({ pct, color, children, label, warn }: { pct: number | null; color: string; children: ReactNode; label: string; warn?: boolean }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className={`xl-ring ${pct === null ? "no-budget" : ""} ${warn ? "warn" : ""}`} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} className="xl-ring-track" strokeDasharray={pct === null ? "4 5" : undefined} />
        {pct !== null && (
          <circle cx="50" cy="50" r={r} className="xl-ring-fill" stroke={warn ? "var(--rose)" : color} strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 50 50)" />
        )}
      </svg>
      <div className="xl-ring-in">{children}</div>
    </div>
  );
}
