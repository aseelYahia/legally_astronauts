import type { Alert, Severity } from "./safety";

/**
 * Pure presentation mapping for safety alerts (shared by the planner Warnings board
 * and the map hazard layer). It NEVER creates, removes or re-grades alerts: severity,
 * title, explanation and source all come unchanged from lib/safety.ts, lib/eva.ts and
 * lib/team.ts. This file only decides which icon / category label to show.
 */

export type WarningType =
  | "steep"
  | "slope-limit"
  | "long-route"
  | "climb"
  | "effort"
  | "data-resolution"
  | "archived-weather"
  | "no-route"
  | "eva-time"
  | "oxygen"
  | "power"
  | "rendezvous"
  | "other";

export interface WarningInfo {
  type: WarningType;
  /** Short beginner-friendly category label ("Steep terrain"). */
  label: string;
  /** Key into WARNING_ICONS (24×24 stroke paths). */
  icon: WarningIconKey;
  /** "Warning" | "Caution" | "Info" — straight from the alert's severity. */
  severityLabel: string;
  /** True when the alert has a map position (`alert.at`) and can be shown as a map marker. */
  locational: boolean;
  /** "A" | "B" when the alert belongs to one astronaut in team mode. */
  astronaut?: "A" | "B";
}

export type WarningIconKey =
  | "steep"
  | "limit"
  | "distance"
  | "climb"
  | "effort"
  | "grid"
  | "weather"
  | "blocked"
  | "clock"
  | "oxygen"
  | "power"
  | "meet"
  | "info";

/** Stroke-only SVG paths on a 24×24 viewBox (fill="none", stroke="currentColor", round caps). */
export const WARNING_ICONS: Record<WarningIconKey, string[]> = {
  steep: ["M3 20h18L8 6z", "M8 6l3 6"],
  limit: ["M4 20h16", "M4 20L18 8", "M14 20a6 6 0 00-1.6-4.2"],
  distance: ["M3 12h18", "M7 8l-4 4 4 4", "M17 8l4 4-4 4"],
  climb: ["M3 19l6-10 4 6 2-3 6 7z", "M17 3v6", "M14.5 5.5L17 3l2.5 2.5"],
  effort: ["M4 18a8 8 0 1116 0", "M12 18l4-6", "M8 18h8"],
  grid: ["M4 4h16v16H4z", "M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"],
  weather: ["M7 18a5 5 0 01-.6-9.96A6 6 0 0118 9a4.5 4.5 0 010 9z", "M12 11v3l2 1"],
  blocked: ["M12 3a9 9 0 100 18 9 9 0 000-18z", "M5.6 5.6l12.8 12.8"],
  clock: ["M12 3a9 9 0 100 18 9 9 0 000-18z", "M12 7v5l3 2"],
  oxygen: ["M12 3a9 9 0 100 18 9 9 0 000-18z", "M10.5 9.5a2.5 2.5 0 10.01 0", "M14 15.5h2.5l-2.5 3h2.5"],
  power: ["M6 7h11a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1V8a1 1 0 011-1z", "M20 10.5v3", "M12 9l-2 3.5h3l-2 3.5"],
  meet: ["M6 19a3 3 0 100-6 3 3 0 000 6z", "M18 11a3 3 0 100-6 3 3 0 000 6z", "M8.5 14.5l7-5"],
  info: ["M12 3a9 9 0 100 18 9 9 0 000-18z", "M12 11v6M12 7.5v.5"],
};

export const SEVERITY_LABEL: Record<Severity, string> = { warning: "Warning", caution: "Caution", info: "Info" };

const TYPE_META: Record<WarningType, { label: string; icon: WarningIconKey }> = {
  steep: { label: "Steep terrain", icon: "steep" },
  "slope-limit": { label: "Near your slope limit", icon: "limit" },
  "long-route": { label: "Long route", icon: "distance" },
  climb: { label: "Significant climb", icon: "climb" },
  effort: { label: "High effort", icon: "effort" },
  "data-resolution": { label: "Limited terrain detail", icon: "grid" },
  "archived-weather": { label: "Archived weather only", icon: "weather" },
  "no-route": { label: "No safe route", icon: "blocked" },
  "eva-time": { label: "EVA time", icon: "clock" },
  oxygen: { label: "Oxygen budget", icon: "oxygen" },
  power: { label: "Power budget", icon: "power" },
  rendezvous: { label: "Rendezvous", icon: "meet" },
  other: { label: "Planning note", icon: "info" },
};

/** Strip the team-mode astronaut prefix ("A-steep" → "steep"). */
function splitId(id: string): { base: string; astronaut?: "A" | "B" } {
  const m = /^([AB])-(.+)$/.exec(id);
  return m ? { base: m[2], astronaut: m[1] as "A" | "B" } : { base: id };
}

export function warningType(id: string): WarningType {
  const { base } = splitId(id);
  if (base === "steep" || base === "moderate") return "steep";
  if (base === "near-limit") return "slope-limit";
  if (base === "distance") return "long-route";
  if (base === "gain") return "climb";
  if (base === "difficulty") return "effort";
  if (base === "resolution") return "data-resolution";
  if (base === "weather") return "archived-weather";
  if (base === "no-route" || base === "return" || base === "team-A" || base === "team-B") return "no-route";
  if (base === "eva-time" || base === "eva-reserve") return "eva-time";
  if (base.startsWith("eva-o2") || base === "team-o2") return "oxygen";
  if (base.startsWith("eva-power") || base === "team-power") return "power";
  if (base === "team-wait") return "rendezvous";
  return "other";
}

export function warningInfo(a: Alert): WarningInfo {
  const { astronaut: prefixed } = splitId(a.id);
  const teamWho = /^team-([AB])$/.exec(a.id)?.[1] as "A" | "B" | undefined;
  const type = warningType(a.id);
  const meta = TYPE_META[type];
  return {
    type,
    label: meta.label,
    icon: meta.icon,
    severityLabel: SEVERITY_LABEL[a.severity],
    locational: !!a.at,
    astronaut: prefixed ?? teamWho,
  };
}

/** Group alerts by severity in display order, keeping the incoming order inside each group. */
export function groupBySeverity(alerts: Alert[]): { severity: Severity; alerts: Alert[] }[] {
  const order: Severity[] = ["warning", "caution", "info"];
  return order.map((severity) => ({ severity, alerts: alerts.filter((a) => a.severity === severity) })).filter((g) => g.alerts.length > 0);
}
