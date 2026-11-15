import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { GLOSSARY, type GlossaryKey } from "../lib/glossary";

export type MascotPose = "standing" | "sitting" | "floating" | "crawling";

const SRC: Record<MascotPose, string> = {
  standing: "/mascot/dog-standing-wave.jpg",
  sitting: "/mascot/dog-sitting.jpg",
  floating: "/mascot/dog-floating.jpg",
  crawling: "/mascot/dog-crawling.jpg",
};

export function Mascot({ pose, size = 72, className = "" }: { pose: MascotPose; size?: number; className?: string }) {
  return (
    <span className={`mascot mascot-${pose} ${className}`} style={{ width: size, height: size }}>
      <img src={SRC[pose]} alt={`PAWPRINT astronaut dog, ${pose}`} draggable={false} />
    </span>
  );
}

/** Friendly contextual tip from the mascot. */
export function DogTip({ pose = "crawling", title = "Paw tip", children, compact }: { pose?: MascotPose; title?: string; children: ReactNode; compact?: boolean }) {
  return (
    <div className={`dog-tip ${compact ? "compact" : ""}`}>
      <Mascot pose={pose} size={compact ? 44 : 58} />
      <div>
        <div className="dog-tip-title">{title}</div>
        <div className="dog-tip-body">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  );
}

const KIND_LABEL: Record<string, string> = {
  real: "NASA DATA",
  "real-derived": "DERIVED",
  estimate: "ESTIMATE",
  estimated: "EST. POSITION",
  simulated: "SIMULATED",
  unavailable: "NOT INGESTED",
  archived: "ARCHIVED",
  assumption: "ASSUMPTION",
};

const KIND_HELP: Record<string, string> = {
  real: "Measured by NASA or USGS and used as published.",
  "real-derived": "Calculated in Python from real NASA/USGS data.",
  estimate: "A model estimate. Useful for comparison, not a measurement.",
  estimated: GLOSSARY.estimated.text,
  unavailable: "This dataset is not part of the prototype yet, so nothing is shown.",
  archived: "Real NASA data, but old: the public feed is no longer updated.",
  assumption: "A planning choice made by the PAWPRINT team, not a NASA rule.",
};

export function KindBadge({ kind, title }: { kind: string; title?: string }) {
  const k = kind.startsWith("real (") ? "real" : kind;
  return (
    <Hint text={title ?? KIND_HELP[k] ?? ""} title={KIND_LABEL[k] ?? k.toUpperCase()}>
      <span className={`kind kind-${k}`}>{KIND_LABEL[k] ?? k.toUpperCase()}</span>
    </Hint>
  );
}

/* ------------------------------------------------------------------ */
/* Tooltips: a single fixed-position layer so tips never get clipped   */
/* by scrolling panels.                                                 */
/* ------------------------------------------------------------------ */

interface TipState {
  title?: string;
  text: string;
  rect: DOMRect;
}
const TipCtx = createContext<(t: TipState | null) => void>(() => {});

export function TooltipLayer({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TipState | null>(null);
  let style: React.CSSProperties | undefined;
  if (tip) {
    const w = 270;
    const left = Math.min(Math.max(8, tip.rect.left + tip.rect.width / 2 - w / 2), window.innerWidth - w - 8);
    const below = tip.rect.bottom + 130 < window.innerHeight;
    style = below ? { left, top: tip.rect.bottom + 8, width: w } : { left, top: tip.rect.top - 8, width: w, transform: "translateY(-100%)" };
  }
  return (
    <TipCtx.Provider value={setTip}>
      {children}
      {tip && tip.text && (
        <div className="tooltip" role="tooltip" style={style}>
          {tip.title && <b>{tip.title}</b>}
          {tip.text}
        </div>
      )}
    </TipCtx.Provider>
  );
}

/** Wrap any element to show an explanation on hover or keyboard focus. */
export function Hint({ text, title, children }: { text: string; title?: string; children: ReactNode }) {
  const set = useContext(TipCtx);
  const show = useCallback((e: React.SyntheticEvent<HTMLElement>) => text && set({ title, text, rect: e.currentTarget.getBoundingClientRect() }), [set, text, title]);
  const hide = useCallback(() => set(null), [set]);
  return (
    <span className="hint-wrap" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
    </span>
  );
}

/** A scientific term with a dotted underline that explains itself. */
export function Term({ k, children }: { k: GlossaryKey; children?: ReactNode }) {
  const g = GLOSSARY[k];
  return (
    <Hint title={g.term} text={g.text}>
      <span className="term" tabIndex={0} aria-label={`${g.term}: ${g.text}`}>
        {children ?? g.term}
      </span>
    </Hint>
  );
}

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const p: Record<string, ReactNode> = {
    explore: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>,
    route: <><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="6" r="2.2" /><path d="M8 17c6 0 2-10 8-10" /></>,
    bars: <><path d="M5 20V11M10 20V5M15 20v-8M20 20V8" /></>,
    map: <><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></>,
    files: <><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></>,
    layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
    terrain: <><path d="M2 19l7-11 4 6 3-4 6 9z" /></>,
    contour: <><ellipse cx="12" cy="12" rx="9" ry="7" /><ellipse cx="12" cy="12" rx="5" ry="3.5" /></>,
    warn: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>,
    crystal: <><path d="M12 2l4 6-4 14-4-14z" /><path d="M8 8h8M5 10l3-2M19 10l-3-2" /></>,
    rover: <><circle cx="5" cy="18" r="2" /><circle cx="19" cy="6" r="2" /><path d="M6.5 16.5l2-2M10.5 12.5l2-2M14.5 8.5l2-2" /></>,
    cloud: <><path d="M7 18a5 5 0 01-.6-9.96A6 6 0 0118 9a4.5 4.5 0 010 9z" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-5-5" /></>,
    pin: <><path d="M12 22s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></>,
    target: <><circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    minus: <><path d="M5 12h14" /></>,
    flag: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>,
    walker: <><circle cx="13" cy="4" r="2" /><path d="M9 21l3-7 3 3v4M12 14l-1-5 4 2 3 3M11 9l-4 3" /></>,
    save: <><path d="M6 3h12v18l-6-4-6 4z" /></>,
    chevron: <><path d="M9 6l6 6-6 6" /></>,
    chevronDown: <><path d="M6 9l6 6 6-6" /></>,
    chevronUp: <><path d="M6 15l6-6 6 6" /></>,
    chevronLeft: <><path d="M15 6l-6 6 6 6M20 6l-6 6 6 6" /></>,
    close: <><path d="M6 6l12 12M18 6L6 18" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17v.5" /></>,
    check: <><path d="M5 12.5l4.5 4.5L19 7.5" /></>,
    play: <><path d="M8 5.5v13l10-6.5z" /></>,
    sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 3v4M17 5h4" /></>,
    db: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
    thermo: <><path d="M14 14.8V4a2 2 0 10-4 0v10.8a4 4 0 104 0z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    gauge: <><path d="M4 18a8 8 0 1116 0" /><path d="M12 18l4-6" /></>,
    distance: <><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" /></>,
    mountain: <><path d="M3 19l6-10 4 6 2-3 6 7z" /></>,
    camera: <><path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" /><circle cx="12" cy="13" r="3.5" /></>,
    link: <><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    log: <><path d="M6 3h11a2 2 0 012 2v14a2 2 0 01-2 2H6z" /><path d="M6 3v18M4 7h4M4 12h4M4 17h4M11 8h5M11 12h5" /></>,
    drop: <><path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z" /></>,
    note: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
    coffee: <><path d="M5 9h11v5a5 5 0 01-5 5h-1a5 5 0 01-5-5z" /><path d="M16 10h1.5a2.5 2.5 0 010 5H16M8 3v3M11 3v3" /></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></>,
    download: <><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></>,
    expand: <><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>,
    box: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>,
    stop: <><rect x="6" y="6" width="12" height="12" rx="2" /></>,
    bolt: <><path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" /></>,
    shield: <><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></>,
    satellite: <><path d="M5 19a9 9 0 019-9M5 15a5 5 0 015-5" /><circle cx="5.5" cy="18.5" r="1" /><path d="M14 4l6 6-3 3-6-6z" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p[name]}
    </svg>
  );
}
