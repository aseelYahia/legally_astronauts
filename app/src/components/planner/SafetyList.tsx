import { NOT_CERTIFIED, SAFETY_THRESHOLDS, type Alert, type Severity } from "../../lib/safety";
import { DogTip, Icon, KindBadge } from "../ui";

const SEV_LABEL: Record<Severity, string> = { warning: "Warning", caution: "Caution", info: "Info" };

export function SeverityIcon({ s, size = 16 }: { s: Severity; size?: number }) {
  // Distinct shapes as well as colours, so severity never relies on colour alone.
  if (s === "warning")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z" fill="currentColor" />
        <path d="M12 7v6M12 16.5v.5" stroke="#131522" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  if (s === "caution")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.5l10.5 19h-21z" fill="currentColor" />
        <path d="M12 9.5v5M12 17.5v.5" stroke="#131522" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  return <Icon name="info" size={size} />;
}

export function AlertItem({ a, onLocate }: { a: Alert; onLocate?: (a: Alert) => void }) {
  return (
    <li className={`alert alert-${a.severity}`}>
      <span className="alert-icon"><SeverityIcon s={a.severity} /></span>
      <div className="alert-body">
        <div className="alert-title">
          <span className="sev">{SEV_LABEL[a.severity]}</span> {a.title}
        </div>
        <p>{a.why}</p>
        <details className="alert-src">
          <summary>Why is this shown?</summary>
          <p>{a.source}</p>
        </details>
      </div>
      {a.at && onLocate && (
        <button className="icon-btn" aria-label={`Show "${a.title}" on the map`} title="Show on map" onClick={() => onLocate(a)}>
          <Icon name="pin" size={15} />
        </button>
      )}
    </li>
  );
}

export function SafetyList({ alerts, onLocate, empty }: { alerts: Alert[]; onLocate: (a: Alert) => void; empty: string }) {
  const counts = { warning: 0, caution: 0, info: 0 };
  alerts.forEach((a) => counts[a.severity]++);
  return (
    <div className="safety">
      <div className="not-certified" role="note">
        <Icon name="warn" size={16} />
        <span>{NOT_CERTIFIED}</span>
      </div>
      {alerts.length === 0 ? (
        <DogTip pose="sitting" title="No alerts yet">{empty}</DogTip>
      ) : (
        <>
          <div className="sev-summary" aria-label="Alert counts">
            <span className="alert-warning"><SeverityIcon s="warning" size={14} /> {counts.warning} warning{counts.warning === 1 ? "" : "s"}</span>
            <span className="alert-caution"><SeverityIcon s="caution" size={14} /> {counts.caution} caution{counts.caution === 1 ? "" : "s"}</span>
            <span className="alert-info"><SeverityIcon s="info" size={14} /> {counts.info} info</span>
          </div>
          <ul className="alert-list">
            {alerts.map((a) => (
              <AlertItem key={a.id} a={a} onLocate={onLocate} />
            ))}
          </ul>
        </>
      )}
      <details className="disclosure">
        <summary>Alert thresholds</summary>
        <p className="fine">
          Steep: caution ≥ {SAFETY_THRESHOLDS.steepCautionDeg}°, warning ≥ {SAFETY_THRESHOLDS.steepWarningDeg}° · near limit: within {SAFETY_THRESHOLDS.nearLimitMarginDeg}° ·
          long walk: ≥ {SAFETY_THRESHOLDS.longDistanceCautionM / 1000} km (warning ≥ {SAFETY_THRESHOLDS.longDistanceWarningM / 1000} km) · climb: ≥ {SAFETY_THRESHOLDS.gainCautionM} m
          (warning ≥ {SAFETY_THRESHOLDS.gainWarningM} m).
        </p>
        <p className="fine muted">These are PAWPRINT planning <KindBadge kind="assumption" />, not NASA safety limits.</p>
      </details>
    </div>
  );
}
