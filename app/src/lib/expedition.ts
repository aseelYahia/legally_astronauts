import type { EvaSettings, LonLat, RouteResult, Stop } from "../types";
import type { EvaPlan, TeamEva } from "./eva";
import type { Alert } from "./safety";
import type { TeamSummary } from "./team";

/**
 * Expedition Log: pure state + arithmetic for executing a planned Marswalk.
 *
 * Honesty rules baked in here:
 *  - The timer is a stopwatch the astronaut drives by hand (timestamps, so it survives reloads).
 *  - Supplies are a SIMULATION: the user's own EVA budgets/rates (lib/eva.ts) × elapsed time.
 *    Nothing is measured from a suit.
 *  - Coordinates on evidence records are only ever user-entered or copied from a planned stop.
 *    Nothing here invents a position for the astronaut.
 */

// ------------------------------------------------------------------ //
// Timer state machine
// ------------------------------------------------------------------ //

export type Activity = "walking" | "break" | "obstacle";
export type TimerStatus = "idle" | Activity | "finished";

export interface Segment {
  kind: Activity;
  /** epoch ms */
  start: number;
  /** epoch ms; undefined while this segment is running */
  end?: number;
}

export interface TimerState {
  status: TimerStatus;
  segments: Segment[];
  startedAt: number | null;
  finishedAt: number | null;
}

export const NEW_TIMER: TimerState = { status: "idle", segments: [], startedAt: null, finishedAt: null };

/** Switch to an activity. Closes the running segment; total time keeps running across breaks and obstacles. */
export function setActivity(t: TimerState, kind: Activity, now: number): TimerState {
  if (t.status === "finished" || t.status === kind) return t;
  const segments = closeOpen(t.segments, now);
  segments.push({ kind, start: now });
  return { status: kind, segments, startedAt: t.startedAt ?? now, finishedAt: null };
}

/** Freeze every timer. Idempotent. */
export function finishTimer(t: TimerState, now: number): TimerState {
  if (t.status === "finished") return t;
  return { status: "finished", segments: closeOpen(t.segments, now), startedAt: t.startedAt ?? now, finishedAt: now };
}

function closeOpen(segs: Segment[], now: number): Segment[] {
  return segs.map((s) => (s.end === undefined ? { ...s, end: Math.max(s.start, now) } : s));
}

export interface Totals {
  totalMs: number;
  walkingMs: number;
  breakMs: number;
  obstacleMs: number;
}

export function timerTotals(t: TimerState, now: number): Totals {
  const out: Totals = { totalMs: 0, walkingMs: 0, breakMs: 0, obstacleMs: 0 };
  const stop = t.finishedAt ?? now;
  for (const s of t.segments) {
    const d = Math.max(0, (s.end ?? stop) - s.start);
    if (s.kind === "walking") out.walkingMs += d;
    else if (s.kind === "break") out.breakMs += d;
    else out.obstacleMs += d;
  }
  out.totalMs = t.startedAt === null ? 0 : Math.max(0, stop - t.startedAt);
  return out;
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => n.toString().padStart(2, "0")).join(":");
}

// ------------------------------------------------------------------ //
// Supplies simulation (from the user's own EVA settings)
// ------------------------------------------------------------------ //

export interface SupplyGauge {
  /** 0-100 (clamped) for drawing; `rawPct` keeps the true value (may be negative). */
  pct: number;
  rawPct: number;
  used: number;
  remaining: number;
  budget: number;
}

export interface TimeGauge {
  /** "eva-limit" = the user's available EVA time; "plan" = the planned EVA length (no limit entered). */
  basis: "eva-limit" | "plan";
  totalMin: number;
  remainingMin: number;
  pct: number;
}

export interface Supplies {
  o2: SupplyGauge | null;
  power: SupplyGauge | null;
  time: TimeGauge | null;
  /** Elapsed time at which the plan says to turn back (null if no EVA limit entered). */
  turnBackAtMin: number | null;
}

function gauge(budget: number | null, perHour: number | null, hours: number): SupplyGauge | null {
  if (budget === null || perHour === null || !(budget > 0) || !(perHour >= 0)) return null;
  const used = perHour * hours;
  const remaining = budget - used;
  const rawPct = (remaining / budget) * 100;
  return { pct: Math.max(0, Math.min(100, rawPct)), rawPct, used, remaining, budget };
}

/**
 * Oxygen and power: user budget − user rate × elapsed hours (same arithmetic as lib/eva.ts).
 * Time left: the user's available EVA minutes − elapsed; without a limit, the planned EVA length − elapsed.
 */
export function supplyEstimate(eva: EvaSettings, elapsedMs: number, plannedTotalMin: number | null, turnBackByMin: number | null = null): Supplies {
  const hours = Math.max(0, elapsedMs) / 3_600_000;
  const elapsedMin = hours * 60;
  const avail = eva.availableMin !== null && eva.availableMin > 0 ? eva.availableMin : null;
  let time: TimeGauge | null = null;
  const base = avail ?? (plannedTotalMin && plannedTotalMin > 0 ? plannedTotalMin : null);
  if (base !== null) {
    const remainingMin = base - elapsedMin;
    time = { basis: avail !== null ? "eva-limit" : "plan", totalMin: base, remainingMin, pct: Math.max(0, Math.min(100, (remainingMin / base) * 100)) };
  }
  return {
    o2: gauge(eva.o2Budget, eva.o2RatePerHour, hours),
    power: gauge(eva.powerBudgetWh, eva.powerDrawW, hours),
    time,
    turnBackAtMin: avail !== null ? turnBackByMin : null,
  };
}

// ------------------------------------------------------------------ //
// Mission snapshot (frozen when the expedition starts, so it reopens after reload)
// ------------------------------------------------------------------ //

export interface PreviewPath {
  color: string;
  pts: LonLat[];
  dash?: boolean;
}
export interface PreviewPin {
  label: string;
  lon: number;
  lat: number;
  role: "start" | "destination" | "waypoint" | "meet";
}
export interface SnapAlert {
  id: string;
  severity: Alert["severity"];
  title: string;
  why: string;
  source: string;
}
export interface SnapLeg {
  who: "A" | "B";
  from: string;
  to: string;
  distance_m: number;
  gain_m: number;
  walkMin: number;
}

export interface MissionSnapshot {
  routeId: string;
  name: string;
  mode: "solo" | "team";
  startName: string;
  destName: string;
  missionId: string | null;
  distance_m: number;
  gain_m: number;
  /** Outbound walking estimate (Tobler × pace), minutes. */
  walkMin: number;
  /** Planned EVA incl. science and the walk back, minutes (null when not computable). */
  plannedTotalMin: number | null;
  turnBackByMin: number | null;
  maxSlope_deg: number;
  grid: string;
  eva: EvaSettings;
  stops: { name: string; lon: number; lat: number; role: string }[];
  legs: SnapLeg[];
  paths: PreviewPath[];
  pins: PreviewPin[];
  alerts: SnapAlert[];
}

/** Keep at most `max` points (always keeping the first and last). */
export function downsample(pts: LonLat[], max = 160): LonLat[] {
  if (pts.length <= max) return pts.map((p) => [p[0], p[1]] as LonLat);
  const out: LonLat[] = [];
  const step = (pts.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    const p = pts[Math.round(i * step)];
    out.push([p[0], p[1]]);
  }
  return out;
}

const snapAlerts = (alerts: Alert[]): SnapAlert[] => alerts.map(({ id, severity, title, why, source }) => ({ id, severity, title, why, source }));

export function soloSnapshot(a: {
  routeId: string;
  name: string;
  route: RouteResult;
  stops: Stop[];
  missionId: string | null;
  eva: EvaSettings;
  evaPlan: EvaPlan | null;
  alerts: Alert[];
  color: string;
}): MissionSnapshot {
  const start = a.stops.find((s) => s.role === "start");
  const dest = a.stops.find((s) => s.role === "destination");
  const pace = a.eva.paceFactor > 0 ? a.eva.paceFactor : 1;
  return {
    routeId: a.routeId,
    name: a.name.trim() || "Marswalk",
    mode: "solo",
    startName: start?.name ?? "Start",
    destName: dest?.name ?? "Destination",
    missionId: a.missionId,
    distance_m: a.route.distance_m,
    gain_m: a.route.elevation_gain_m,
    walkMin: a.evaPlan?.outboundMin ?? (a.route.walk_time_s / 60) * pace,
    plannedTotalMin: a.evaPlan?.totalMin ?? null,
    turnBackByMin: a.evaPlan?.turnBackByMin ?? null,
    maxSlope_deg: a.route.max_slope_deg,
    grid: a.route.grid.name,
    eva: { ...a.eva },
    stops: a.stops.map((s) => ({ name: s.name, lon: s.lon, lat: s.lat, role: s.role })),
    legs: [],
    paths: [{ color: a.color, pts: downsample(a.route.path_lonlat) }],
    pins: a.stops.map((s) => ({ label: s.name, lon: s.lon, lat: s.lat, role: s.role })),
    alerts: snapAlerts(a.alerts),
  };
}

export function teamSnapshot(a: {
  routeId: string;
  name: string;
  routes: { A: RouteResult; B: RouteResult; Aret?: RouteResult; Bret?: RouteResult };
  stops: { aStart: Stop; aDest: Stop; bStart: Stop; bDest: Stop; meet: Stop };
  summary: TeamSummary;
  teamEva: TeamEva | null;
  missionId: string | null;
  eva: EvaSettings;
  alerts: Alert[];
  colors: { A: string; B: string };
}): MissionSnapshot {
  const { aStart, aDest, bStart, bDest, meet } = a.stops;
  const t = a.teamEva;
  const turnBack = t?.A && t?.B && t.A.turnBackByMin !== null && t.B.turnBackByMin !== null ? Math.min(t.A.turnBackByMin, t.B.turnBackByMin) : null;
  const pace = a.eva.paceFactor > 0 ? a.eva.paceFactor : 1;
  const leg = (who: "A" | "B", from: Stop, to: Stop, r: RouteResult): SnapLeg => ({ who, from: from.name, to: to.name, distance_m: r.distance_m, gain_m: r.elevation_gain_m, walkMin: (r.walk_time_s / 60) * pace });
  return {
    routeId: a.routeId,
    name: a.name.trim() || "Marswalk",
    mode: "team",
    startName: "Astronauts A & B",
    destName: meet.name === "Rendezvous" ? "Rendezvous" : `${meet.name} rendezvous`,
    missionId: a.missionId,
    distance_m: a.summary.totalDistance_m,
    gain_m: a.summary.totalGain_m,
    walkMin: a.summary.meetMin,
    plannedTotalMin: t?.missionMin ?? null,
    turnBackByMin: turnBack,
    maxSlope_deg: a.summary.maxSlope,
    grid: a.routes.A.grid.name,
    eva: { ...a.eva },
    stops: [aStart, aDest, bStart, bDest, meet].map((s, i) => ({ name: s.name, lon: s.lon, lat: s.lat, role: ["A start", "A destination", "B start", "B destination", "Rendezvous"][i] })),
    legs: [leg("A", aStart, aDest, a.routes.A), leg("B", bStart, bDest, a.routes.B)],
    paths: [
      { color: a.colors.A, pts: downsample(a.routes.A.path_lonlat) },
      { color: a.colors.B, pts: downsample(a.routes.B.path_lonlat) },
      ...(a.routes.Aret ? [{ color: a.colors.A, pts: downsample(a.routes.Aret.path_lonlat, 80), dash: true }] : []),
      ...(a.routes.Bret ? [{ color: a.colors.B, pts: downsample(a.routes.Bret.path_lonlat, 80), dash: true }] : []),
    ],
    pins: [
      { label: `A: ${aStart.name}`, lon: aStart.lon, lat: aStart.lat, role: "start" },
      { label: `B: ${bStart.name}`, lon: bStart.lon, lat: bStart.lat, role: "start" },
      { label: `A: ${aDest.name}`, lon: aDest.lon, lat: aDest.lat, role: "destination" },
      { label: `B: ${bDest.name}`, lon: bDest.lon, lat: bDest.lat, role: "destination" },
      { label: "Rendezvous", lon: meet.lon, lat: meet.lat, role: "meet" },
    ],
    alerts: snapAlerts(a.alerts),
  };
}

// ------------------------------------------------------------------ //
// Notebook + photos
// ------------------------------------------------------------------ //

export type EntryCategory = "rock" | "water" | "mineral" | "general";
export type Confidence = "low" | "medium" | "high";

export const CATEGORIES: { id: EntryCategory; label: string; icon: string }[] = [
  { id: "rock", label: "Rock Layers", icon: "layers" },
  { id: "water", label: "Water Evidence", icon: "drop" },
  { id: "mineral", label: "Mineral Evidence", icon: "crystal" },
  { id: "general", label: "General Notes", icon: "note" },
];

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

export interface EntryCoords {
  lat: number;
  lon: number;
  /** Where the coordinate came from. Never generated by the app. */
  source: "manual" | "planned-stop";
  stopName?: string;
}

export interface NotebookEntry {
  id: string;
  category: EntryCategory;
  title: string;
  notes: string;
  confidence: Confidence;
  coords: EntryCoords | null;
  photoIds: string[];
  createdAt: number;
  updatedAt: number;
  /** Mission clock (ms) when the entry was first written, if the expedition had started. */
  missionMs: number | null;
}

export interface PhotoMeta {
  id: string;
  caption: string;
  createdAt: number;
  width: number;
  height: number;
  source: "camera" | "upload";
}

export interface Expedition {
  version: 1;
  id: string;
  createdAt: number;
  snapshot: MissionSnapshot;
  timer: TimerState;
  entries: NotebookEntry[];
  photos: PhotoMeta[];
  /** Route progress as REPORTED by the user (0-100), or null if never reported. Not tracked. */
  reportedProgressPct: number | null;
}

export function newExpedition(snapshot: MissionSnapshot, now: number, id = `x${now.toString(36)}`): Expedition {
  return { version: 1, id, createdAt: now, snapshot, timer: NEW_TIMER, entries: [], photos: [], reportedProgressPct: null };
}

/** Rough time-based progress: walking time so far ÷ planned outbound walk. An ESTIMATE, not a position. */
export function timeBasedProgress(walkingMs: number, walkMin: number): number | null {
  if (!(walkMin > 0)) return null;
  return Math.max(0, Math.min(100, (walkingMs / 60_000 / walkMin) * 100));
}

export function countByCategory(entries: NotebookEntry[]): Record<EntryCategory, number> {
  const c: Record<EntryCategory, number> = { rock: 0, water: 0, mineral: 0, general: 0 };
  for (const e of entries) c[e.category]++;
  return c;
}

/** Validate a user-typed coordinate pair. Returns null when it is not a plausible Mars lat/lon. */
export function validCoords(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 360;
}

// ------------------------------------------------------------------ //
// Persistence (localStorage; photos' pixels live in IndexedDB, see photoStore.ts)
// ------------------------------------------------------------------ //

export const EXPEDITION_KEY = "pawprint.expedition.v1";

function store(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function loadExpedition(s: Storage | undefined = store()): Expedition | null {
  if (!s) return null;
  try {
    const raw = s.getItem(EXPEDITION_KEY);
    if (!raw) return null;
    const x = JSON.parse(raw) as Expedition;
    if (!x || x.version !== 1 || !x.snapshot || !x.timer || !Array.isArray(x.entries) || !Array.isArray(x.photos)) return null;
    return x;
  } catch {
    return null;
  }
}

export function saveExpedition(x: Expedition | null, s: Storage | undefined = store()): boolean {
  if (!s) return false;
  try {
    if (x) s.setItem(EXPEDITION_KEY, JSON.stringify(x));
    else s.removeItem(EXPEDITION_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Plain export (no image pixels): everything the astronaut recorded, plus honesty notes. */
export function exportableLog(x: Expedition, now: number) {
  const t = timerTotals(x.timer, now);
  return {
    app: "PAWPRINT MARS · Expedition Log",
    exportedAt: new Date(now).toISOString(),
    disclaimer:
      "Field notes are observations, not confirmed findings: possible evidence needs laboratory confirmation. Supplies are a simulation from user-entered EVA budgets, not suit telemetry. Coordinates are user-entered or copied from planned stops; no live position tracking.",
    mission: x.snapshot,
    timers: { status: x.timer.status, startedAt: x.timer.startedAt && new Date(x.timer.startedAt).toISOString(), finishedAt: x.timer.finishedAt && new Date(x.timer.finishedAt).toISOString(), ...t, segments: x.timer.segments },
    reportedProgressPct: x.reportedProgressPct,
    entries: x.entries,
    photos: x.photos,
  };
}
