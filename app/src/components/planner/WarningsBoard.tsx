import { useEffect, useRef, type ReactNode } from "react";
import { NOT_CERTIFIED, SAFETY_THRESHOLDS, type Alert, type Severity } from "../../lib/safety";
import { groupBySeverity, WARNING_ICONS, warningInfo, type WarningIconKey } from "../../lib/warningCatalog";
import { Icon, KindBadge } from "../ui";
import { SeverityIcon } from "./SafetyList";

/** Bring `el` into view inside its nearest scrollable ancestor (a sheet or dock), never by scrolling the page or
 *  anything else that contains the map. */
function scrollWithinOwnArea(el: HTMLElement) {
  let p = el.parentElement;
  while (p && p !== document.body && p !== document.documentElement) {
    if (p.querySelector(".leaflet-container")) return; // the page (or a column) that also holds the map: leave it alone
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight + 1) {
      const r = el.getBoundingClientRect();
      const s = p.getBoundingClientRect();
      if (r.top < s.top) p.scrollBy({ top: r.top - s.top - 8, behavior: "smooth" });
      else if (r.bottom > s.bottom) p.scrollBy({ top: Math.min(r.bottom - s.bottom + 8, r.top - s.top - 8), behavior: "smooth" });
      return;
    }
    p = p.parentElement;
  }
}

const GROUP_TITLE: Record<Severity, { title: string; sub: string }> = {
  warning: { title: "Warnings", sub: "Look at these before you walk" },
  caution: { title: "Cautions", sub: "Worth a second look" },
  info: { title: "Data limits & context", sub: "What the data cannot tell you" },
};

export function WarningIcon({ k, size = 20 }: { k: WarningIconKey; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {WARNING_ICONS[k].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/**
 * Beginner-friendly safety board. Shows exactly the alerts computed by lib/safety, lib/eva
 * and lib/team (no new or hidden warnings); the catalog only adds an icon and a category label.
 */
export function WarningsBoard({
  alerts,
  selectedId,
  onSelect,
  onLocate,
  empty,
}: {
  alerts: Alert[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onLocate: (a: Alert) => void;
  /** Shown when there are no alerts (usually: no route planned yet). */
  empty: ReactNode;
}) {
  const counts = { warning: 0, caution: 0, info: 0 };
  alerts.forEach((a) => counts[a.severity]++);
  const groups = groupBySeverity(alerts);
  const boardRef = useRef<HTMLDivElement>(null);
  const clickedHere = useRef(false);
  const pick = (id: string | null) => {
    clickedHere.current = true;
    onSelect(id);
  };

  // A selection made elsewhere (e.g. a hazard marker on the map) scrolls its card into view, but only inside the
  // board's own scroll area. scrollIntoView also scrolled the planner PAGE, which pulled the map (and the
  // warning's details panel on it) out of view the moment a marker was clicked.
  useEffect(() => {
    const own = clickedHere.current;
    clickedHere.current = false;
    if (!selectedId || own) return;
    const el = boardRef.current?.querySelector<HTMLElement>(`[data-alert-id="${CSS.escape(selectedId)}"]`);
    if (el) scrollWithinOwnArea(el);
  }, [selectedId]);

  return (
    <div className="wboard" ref={boardRef}>
      <div className="not-certified" role="note">
        <Icon name="warn" size={16} />
        <span>{NOT_CERTIFIED}</span>
      </div>

      {alerts.length === 0 ? (
        empty
      ) : (
        <>
          <div className="wb-counts" aria-label="Alert counts">
            {(["warning", "caution", "info"] as Severity[]).map((s) => (
              <span key={s} className={`wb-count alert-${s} ${counts[s] ? "" : "zero"}`}>
                <SeverityIcon s={s} size={14} />
                <b>{counts[s]}</b> {s === "info" ? `data note${counts[s] === 1 ? "" : "s"}` : `${s}${counts[s] === 1 ? "" : "s"}`}
              </span>
            ))}
          </div>
          <p className="wb-help">Tap a card to see why it appears and where the numbers come from.</p>

          {groups.map((g) => (
            <section key={g.severity} className="wb-group" aria-label={GROUP_TITLE[g.severity].title}>
              <h4 className={`wb-group-title alert-${g.severity}`}>
                <SeverityIcon s={g.severity} size={14} />
                <span>{GROUP_TITLE[g.severity].title}</span>
                <em>{GROUP_TITLE[g.severity].sub}</em>
              </h4>
              <ul className="wb-grid">
                {g.alerts.map((a) => (
                  <WarningCard key={a.id} a={a} open={selectedId === a.id} onToggle={() => pick(selectedId === a.id ? null : a.id)} onLocate={onLocate} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <details className="disclosure wb-thresholds">
        <summary>How are warnings decided?</summary>
        <p className="fine">
          Steep ground: caution ≥ {SAFETY_THRESHOLDS.steepCautionDeg}°, warning ≥ {SAFETY_THRESHOLDS.steepWarningDeg}° · near your limit: within{" "}
          {SAFETY_THRESHOLDS.nearLimitMarginDeg}° · long route: ≥ {SAFETY_THRESHOLDS.longDistanceCautionM / 1000} km (warning ≥{" "}
          {SAFETY_THRESHOLDS.longDistanceWarningM / 1000} km) · climb: ≥ {SAFETY_THRESHOLDS.gainCautionM} m (warning ≥ {SAFETY_THRESHOLDS.gainWarningM} m). EVA
          warnings compare estimated time, oxygen and power with the budgets you entered.
        </p>
        <p className="fine muted">
          These thresholds are PAWPRINT planning <KindBadge kind="assumption" />, not NASA safety limits. Slopes and distances come from USGS/NASA terrain
          models whose grid cannot see small rocks or scarps.
        </p>
      </details>
    </div>
  );
}

function WarningCard({ a, open, onToggle, onLocate }: { a: Alert; open: boolean; onToggle: () => void; onLocate: (a: Alert) => void }) {
  const info = warningInfo(a);
  const bodyId = `wb-body-${a.id}`;
  return (
    <li className={`wcard alert-${a.severity} ${open ? "open" : ""}`} data-alert-id={a.id}>
      <button className="wcard-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="wcard-icon">
          <WarningIcon k={info.icon} />
        </span>
        <span className="wcard-text">
          <span className="wcard-meta">
            <span className="wcard-sev">
              <SeverityIcon s={a.severity} size={11} /> {info.severityLabel}
            </span>
            <span className="wcard-type">
              {info.label}
              {info.astronaut && !a.title.includes(`Astronaut ${info.astronaut}`) ? ` · Astronaut ${info.astronaut}` : ""}
            </span>
          </span>
          <b>{a.title}</b>
        </span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="wcard-body" id={bodyId}>
          <p className="wcard-why">{a.why}</p>
          <div className="wcard-src">
            <span>Where this comes from</span>
            <p>{a.source}</p>
          </div>
          {a.at && (
            <button className="btn-mini lav wcard-locate" onClick={() => onLocate(a)}>
              <Icon name="pin" size={13} /> Show on map
            </button>
          )}
        </div>
      )}
    </li>
  );
}
