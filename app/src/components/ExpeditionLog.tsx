import { useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORIES,
  CONFIDENCE_LABEL,
  countByCategory,
  exportableLog,
  fmtClock,
  finishTimer,
  newExpedition,
  setActivity,
  supplyEstimate,
  timeBasedProgress,
  timerTotals,
  type Activity,
  type EntryCategory,
  type Expedition,
  type MissionSnapshot,
  type NotebookEntry,
  type PhotoMeta,
  type SnapAlert,
} from "../lib/expedition";
import { fmtMin } from "../lib/eva";
import { formatDistance, formatLat, formatLon } from "../lib/mars";
import { clearPhotos, deletePhoto, downscale, putPhoto } from "../lib/photoStore";
import { NOT_CERTIFIED } from "../lib/safety";
import { MISSIONS } from "../lib/science";
import { WARNING_ICONS, warningInfo } from "../lib/warningCatalog";
import type { Manifest } from "../types";
import { observationPrompt, zoneIdFromName } from "../lib/water";
import { EntryEditor, type EntryDraft } from "./expedition/EntryEditor";
import { CameraModal, PhotoThumb, PhotoViewer, usePhotoPickers } from "./expedition/Photos";
import { Ring } from "./expedition/Ring";
import { RoutePreview } from "./expedition/RoutePreview";
import { DogTip, Hint, Icon, KindBadge, Mascot } from "./ui";

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

const ACTIVITY_LABEL: Record<Activity, string> = { walking: "Walking", break: "On a break", obstacle: "Facing an obstacle" };

/** Compact "~25 min" / "~1h 05m" for the ring centre. */
function shortMin(m: number): string {
  const sign = m < 0 ? "−" : "~";
  const a = Math.abs(Math.round(m));
  return a >= 60 ? `${sign}${Math.floor(a / 60)}h ${(a % 60).toString().padStart(2, "0")}m` : `${sign}${a} min`;
}

export function expeditionStatus(x: Expedition | null): string | null {
  if (!x) return null;
  const s = x.timer.status;
  if (s === "idle") return "Ready to start";
  if (s === "finished") return "Mission complete";
  if (s === "walking") return "In Progress";
  return s === "break" ? "In Progress · break" : "In Progress · obstacle";
}

/** Same signature check App uses to tell whether the open log belongs to the route planned now. */
export const snapSig = (s: MissionSnapshot) => `${s.routeId}|${s.mode}|${Math.round(s.distance_m)}|${s.destName}`;

function SafetyIcon({ alert }: { alert: SnapAlert }) {
  const info = warningInfo(alert);
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {WARNING_ICONS[info.icon].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

export function ExpeditionLog({
  expedition,
  setExpedition,
  candidate,
  manifest,
  onOpenPlanner,
  onOpenAlert,
  liveAlertIds,
}: {
  expedition: Expedition | null;
  setExpedition: (x: Expedition | null) => void;
  /** Snapshot of the route planned right now (null if nothing is planned). */
  candidate: MissionSnapshot | null;
  manifest: Manifest;
  onOpenPlanner: (tab?: "eva" | "safety" | "goal") => void;
  /** Open the planner's Warnings board on this alert (only for alerts of the route planned now). */
  onOpenAlert: (id: string) => void;
  liveAlertIds: Set<string>;
}) {
  // An unsaved draft from the planned route: the first action commits it.
  const draft = useMemo(() => (candidate ? newExpedition(candidate, Date.now()) : null), [candidate]);
  const x = expedition ?? draft;
  const [now, setNow] = useState(() => Date.now());
  const running = !!x && (x.timer.status === "walking" || x.timer.status === "break" || x.timer.status === "obstacle");
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  const [catFilter, setCatFilter] = useState<EntryCategory | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: EntryDraft } | null>(null);
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const [openAlert, setOpenAlert] = useState<string | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const pendingPick = useRef<((ids: string[]) => void) | null>(null);

  // Always mutate from the latest committed state (photo saves resolve asynchronously).
  const latest = useRef(x);
  latest.current = x;
  const update = (fn: (e: Expedition) => Expedition) => {
    const base = latest.current;
    if (!base) return;
    const next = fn(base);
    latest.current = next;
    setExpedition(next);
  };

  const savePhotos = async (sources: (File | HTMLVideoElement)[], source: "camera" | "upload"): Promise<string[]> => {
    setPhotoBusy(true);
    setPhotoMsg(null);
    const metas: PhotoMeta[] = [];
    let memoryOnly = false;
    let failed = 0;
    for (const src of sources) {
      try {
        if (src instanceof File && !src.type.startsWith("image/")) { failed++; continue; }
        const { blob, width, height } = await downscale(src);
        const id = uid("p");
        const ok = await putPhoto(id, blob);
        if (!ok) memoryOnly = true;
        metas.push({ id, caption: src instanceof File ? src.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 80) : "", createdAt: Date.now(), width, height, source });
      } catch {
        failed++;
      }
    }
    if (metas.length) update((e) => ({ ...e, photos: [...e.photos, ...metas] }));
    setPhotoBusy(false);
    const msgs = [];
    if (failed) msgs.push(`${failed} file${failed > 1 ? "s" : ""} could not be read as an image.`);
    if (memoryOnly) msgs.push("This browser blocked photo storage, so photos are kept only until you close the tab.");
    setPhotoMsg(msgs.length ? msgs.join(" ") : null);
    return metas.map((m) => m.id);
  };
  const pickers = usePhotoPickers((files, source) => {
    void savePhotos(files, source).then((ids) => {
      pendingPick.current?.(ids);
      pendingPick.current = null;
    });
  });

  if (!x) {
    return (
      <div className="xlog xlog-empty">
        <div className="xl-card xl-empty-card">
          <Mascot pose="sitting" size={120} />
          <div>
            <h2>No Marswalk to log yet</h2>
            <p>The Expedition Log tracks a walk you have planned. Plan a route in the Mission Planner first: pick a start, a destination and press Plan Route.</p>
            <button className="btn btn-primary" onClick={() => onOpenPlanner()}><Icon name="route" /> Go to Mission Planner</button>
          </div>
        </div>
      </div>
    );
  }

  const snap = x.snapshot;
  const t = x.timer;
  const totals = timerTotals(t, running ? now : Date.now());
  const supplies = supplyEstimate(snap.eva, totals.totalMs, snap.plannedTotalMin, snap.turnBackByMin);
  const goal = MISSIONS.find((m) => m.id === snap.missionId) ?? null;
  const waterZoneId = zoneIdFromName(snap.destName) ?? snap.stops.map((s) => zoneIdFromName(s.name)).find(Boolean) ?? null;
  const counts = countByCategory(x.entries);
  const latestEntry = [...x.entries].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  const shownEntries = [...x.entries].filter((e) => !catFilter || e.category === catFilter).sort((a, b) => b.updatedAt - a.updatedAt);
  const finished = t.status === "finished";
  const est = timeBasedProgress(totals.walkingMs, snap.walkMin);
  const differentRoute = !!expedition && !!candidate && snapSig(candidate) !== snapSig(expedition.snapshot);
  const elapsedMin = totals.totalMs / 60_000;
  const pastTurnBack = supplies.turnBackAtMin !== null && elapsedMin > supplies.turnBackAtMin;

  const act = (k: Activity) => {
    update((e) => ({ ...e, timer: setActivity(e.timer, k, Date.now()) }));
    setNow(Date.now());
  };

  const addPhotos = (how: "camera" | "upload") =>
    new Promise<string[]>((resolve) => {
      pendingPick.current = resolve;
      if (how === "upload") pickers.upload();
      else pickers.takePicture();
    });

  const saveEntry = (d: EntryDraft) => {
    const ts = Date.now();
    if (editing?.id) update((e) => ({ ...e, entries: e.entries.map((n) => (n.id === editing.id ? { ...n, ...d, updatedAt: ts } : n)) }));
    else {
      const tot = timerTotals(latest.current!.timer, ts);
      const n: NotebookEntry = { ...d, id: uid("e"), createdAt: ts, updatedAt: ts, missionMs: latest.current!.timer.startedAt ? tot.totalMs : null };
      update((e) => ({ ...e, entries: [...e.entries, n] }));
    }
    setEditing(null);
  };

  const removePhoto = (id: string) => {
    void deletePhoto(id);
    update((e) => ({ ...e, photos: e.photos.filter((p) => p.id !== id), entries: e.entries.map((n) => ({ ...n, photoIds: n.photoIds.filter((p) => p !== id) })) }));
    setViewPhoto(null);
  };

  const startNew = () => {
    if (!window.confirm(expedition ? "Close this expedition log and start a new one for the route planned now? Its notes and photos are deleted from this device (export it first if you want to keep it)." : "Start a new log?")) return;
    if (expedition) void clearPhotos(expedition.photos.map((p) => p.id));
    setExpedition(candidate ? newExpedition(candidate, Date.now()) : null);
    setShowSummary(false);
  };

  const exportJson = () => {
    try {
      const blob = new Blob([JSON.stringify(exportableLog(x, Date.now()), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${snap.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "marswalk"}-expedition-log.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch {
      window.alert("Could not export the log in this browser.");
    }
  };

  const pctText = (p: number) => `${Math.round(p)}%`;
  const viewing = viewPhoto ? x.photos.find((p) => p.id === viewPhoto) : null;

  return (
    <div className="xlog">
      {differentRoute && (
        <div className="xl-banner" role="status">
          <Icon name="info" />
          <span>This log is for <b>{expedition!.snapshot.name}</b> ({expedition!.snapshot.startName} → {expedition!.snapshot.destName}). You have since planned a different route.</span>
          <button className="btn-mini lav" onClick={startNew}>Start a new log for it</button>
        </div>
      )}

      <div className="xl-grid">
        {/* ---------------- Left / main column ---------------- */}
        <div className="xl-main">
          <section className="xl-hero" aria-labelledby="xl-title">
            <div className="xl-hero-icon"><Icon name="log" size={28} /></div>
            <div className="xl-hero-text">
              <h2 id="xl-title">Expedition Log</h2>
              <p>Execute, track and document your Marswalk.</p>
            </div>
            <Mascot pose="floating" size={92} className="bob xl-hero-dog" />
          </section>

          <section className="xl-card xl-summary" aria-label="Mission summary">
            <div className="xl-sum-main">
              <div className="xl-sum-route">
                <span className="xl-sum-icon"><Icon name="mountain" size={24} /></span>
                <div>
                  <span className="xl-eyebrow">{snap.name}{snap.mode === "team" ? " · two astronauts" : ""}</span>
                  <h3>{snap.startName} <span className="xl-arrow">→</span> {snap.destName}</h3>
                </div>
              </div>
              <div className="xl-sum-goal">
                <span className="xl-sum-icon small"><Icon name="target" size={20} /></span>
                <div>
                  <b>Science goal</b>
                  {goal ? <p>{goal.title}</p> : <p className="muted">No goal chosen. <button className="xl-link" onClick={() => onOpenPlanner("goal")}>Pick one in the planner</button></p>}
                </div>
              </div>
              {waterZoneId && (
                <p className="xl-water" data-testid="xl-water"><Icon name="drop" size={16} /><span>{observationPrompt(waterZoneId)}</span></p>
              )}
              {snap.legs.length > 0 && (
                <ul className="xl-legs">
                  {snap.legs.map((l) => (
                    <li key={l.who}><i className={`dot dot-${l.who}`} /> <b>Astronaut {l.who}</b> {l.from} → {l.to} · {formatDistance(l.distance_m)} · {fmtMin(l.walkMin)}</li>
                  ))}
                </ul>
              )}
            </div>
            <dl className="xl-sum-stats">
              <div><Icon name="route" size={20} /><dt>{snap.mode === "team" ? "Total distance" : "Distance"}</dt><dd>{formatDistance(snap.distance_m)}</dd></div>
              <div><Icon name="clock" size={20} /><dt>{snap.mode === "team" ? "Time to rendezvous" : "Est. walk out"} <KindBadge kind="estimate" title="Tobler walking-time estimate × your pace factor. Not a measurement." /></dt><dd>{fmtMin(snap.walkMin)}</dd></div>
              <div><Icon name="mountain" size={20} /><dt>Elevation gain <KindBadge kind="real-derived" /></dt><dd>+{Math.round(snap.gain_m)} m</dd></div>
            </dl>
            <RoutePreview snap={snap} manifest={manifest} onExpand={() => onOpenPlanner()} />
          </section>

          <section className="xl-card xl-control" aria-labelledby="xl-control-title">
            <div className="xl-card-head">
              <Icon name="walker" size={22} />
              <h3 id="xl-control-title">Expedition Control</h3>
              <span className={`xl-state xl-state-${t.status}`}>{t.status === "idle" ? "Not started" : t.status === "finished" ? "Finished" : ACTIVITY_LABEL[t.status]}</span>
            </div>
            <div className="xl-timers">
              <div className="xl-total" aria-live="off">
                <Icon name="clock" size={30} />
                <div>
                  <b className="xl-clock" data-testid="xl-total">{fmtClock(totals.totalMs)}</b>
                  <span>Total mission time</span>
                </div>
              </div>
              <div className={`xl-sub ${t.status === "walking" ? "on" : ""}`}><Icon name="walker" size={22} /><div><span>Walking</span><b data-testid="xl-walking">{fmtClock(totals.walkingMs)}</b></div></div>
              <div className={`xl-sub ${t.status === "break" ? "on" : ""}`}><Icon name="coffee" size={22} /><div><span>Breaks</span><b data-testid="xl-break">{fmtClock(totals.breakMs)}</b></div></div>
              <div className={`xl-sub ${t.status === "obstacle" ? "on" : ""}`}><Icon name="mountain" size={22} /><div><span>Obstacles</span><b data-testid="xl-obstacle">{fmtClock(totals.obstacleMs)}</b></div></div>
            </div>
            {finished ? (
              <div className="xl-finished">
                <Icon name="check" /> Mission finished {t.finishedAt ? `at ${new Date(t.finishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}. Timers are frozen.
                <button className="btn-mini teal" onClick={() => setShowSummary(true)}>View summary</button>
              </div>
            ) : (
              <div className="xl-actions">
                <button className="btn btn-primary" disabled={t.status === "walking"} onClick={() => act("walking")}>
                  <Icon name="play" /> {t.status === "idle" ? "Start Walking" : t.status === "walking" ? "Walking…" : "Resume Walking"}
                </button>
                <button className="btn btn-secondary" disabled={t.status === "idle" || t.status === "break"} onClick={() => act("break")}><Icon name="coffee" /> Take a Break</button>
                <button className="btn btn-secondary" disabled={t.status === "idle" || t.status === "obstacle"} onClick={() => act("obstacle")}><Icon name="mountain" /> Facing Obstacle</button>
                <button className="btn btn-ghost xl-finish" disabled={t.status === "idle"} onClick={() => setConfirmFinish(true)}><Icon name="flag" /> Finish Mission</button>
              </div>
            )}
            {t.status === "idle" && <p className="xl-small muted">Press Start Walking when you set off{snap.mode === "solo" ? ` from ${snap.startName}` : ""}. The total keeps running through breaks and obstacles, and the log is saved on this device if you reload.</p>}
            {pastTurnBack && !finished && (
              <p className="xl-turnback" role="alert"><Icon name="warn" size={16} /> Past the planned turn-back time ({fmtMin(supplies.turnBackAtMin!)} elapsed, from your EVA plan).</p>
            )}
          </section>

          <section className="xl-card xl-notebook" aria-labelledby="xl-nb-title">
            <div className="xl-card-head">
              <Icon name="note" size={22} />
              <h3 id="xl-nb-title">Scientific Notebook</h3>
              <button className="btn-mini teal xl-head-btn" onClick={() => setEditing({ id: null, draft: { category: catFilter ?? "rock", title: "", notes: "", confidence: "medium", coords: null, photoIds: [] } })}>
                <Icon name="plus" size={14} /> New Entry
              </button>
            </div>
            <div className="xl-nb-top">
              <div className="xl-cats" role="group" aria-label="Filter notebook by category">
                {CATEGORIES.map((k) => (
                  <button key={k.id} className={`xl-cat ${catFilter === k.id ? "on" : ""}`} aria-pressed={catFilter === k.id} onClick={() => setCatFilter(catFilter === k.id ? null : k.id)}>
                    <Icon name={k.icon} size={22} />
                    <span>{k.label}</span>
                    <em>({counts[k.id]})</em>
                  </button>
                ))}
              </div>
              <div className="xl-latest">
                {latestEntry ? (
                  <button className="xl-latest-btn" onClick={() => setEditing({ id: latestEntry.id, draft: latestEntry })}>
                    {latestEntry.photoIds[0] ? <PhotoThumb id={latestEntry.photoIds[0]} alt={latestEntry.title} className="xl-latest-img" /> : <span className="xl-latest-img ph"><Icon name={CATEGORIES.find((c) => c.id === latestEntry.category)!.icon} size={24} /></span>}
                    <span className="xl-latest-text">
                      <span className="xl-eyebrow">Latest entry</span>
                      <b>{latestEntry.title || "Untitled observation"}</b>
                      <span className="xl-small">{latestEntry.coords ? <><Icon name="pin" size={12} /> {formatLat(latestEntry.coords.lat, 3)}, {formatLon(latestEntry.coords.lon, 3)}</> : "No location recorded"}</span>
                      <span className="xl-tags">
                        <span className={`xl-tag cat-${latestEntry.category}`}>{latestEntry.category === "water" || latestEntry.category === "mineral" ? "Possible evidence" : CATEGORIES.find((c) => c.id === latestEntry.category)!.label}</span>
                        <span className="xl-tag">{CONFIDENCE_LABEL[latestEntry.confidence]}</span>
                      </span>
                    </span>
                    <Icon name="chevron" />
                  </button>
                ) : (
                  <DogTip compact pose="crawling" title="Sniff out some science">Add an observation for each interesting rock, layer or texture you see. Attach photos and a location from a planned stop.</DogTip>
                )}
              </div>
            </div>
            {shownEntries.length > 0 && (
              <ul className="xl-entries">
                {shownEntries.map((e) => (
                  <li key={e.id} className="xl-entry">
                    <span className={`xl-entry-icon cat-${e.category}`}><Icon name={CATEGORIES.find((c) => c.id === e.category)!.icon} size={18} /></span>
                    <div className="xl-entry-body">
                      <b>{e.title || "Untitled observation"}</b>
                      {e.notes && <p>{e.notes}</p>}
                      <span className="xl-small muted">
                        {CATEGORIES.find((c) => c.id === e.category)!.label} · {CONFIDENCE_LABEL[e.confidence]}
                        {e.coords && <> · {formatLat(e.coords.lat, 4)}, {formatLon(e.coords.lon, 4)} ({e.coords.source === "planned-stop" ? `planned stop: ${e.coords.stopName}` : "entered by you"})</>}
                        {e.missionMs !== null && <> · at {fmtClock(e.missionMs)}</>}
                      </span>
                      {(e.category === "water" || e.category === "mineral") && <span className="xl-small xl-caution-inline">Possible evidence, needs confirmation.</span>}
                      {e.photoIds.length > 0 && (
                        <div className="xl-entry-photos">
                          {e.photoIds.map((pid) => <button key={pid} onClick={() => setViewPhoto(pid)} aria-label="Open attached photo"><PhotoThumb id={pid} alt="Attached photo" /></button>)}
                        </div>
                      )}
                    </div>
                    <div className="xl-entry-actions">
                      <button className="icon-btn" aria-label={`Edit ${e.title || "entry"}`} onClick={() => setEditing({ id: e.id, draft: e })}><Icon name="edit" size={16} /></button>
                      <button className="icon-btn" aria-label={`Delete ${e.title || "entry"}`} onClick={() => { if (window.confirm("Delete this notebook entry? Its photos stay in Photo Documentation.")) update((s) => ({ ...s, entries: s.entries.filter((n) => n.id !== e.id) })); }}><Icon name="trash" size={16} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {catFilter && shownEntries.length === 0 && <p className="xl-small muted xl-pad">No {CATEGORIES.find((c) => c.id === catFilter)!.label.toLowerCase()} entries yet.</p>}
          </section>

          <section className="xl-card xl-bottom" aria-label="Route progress and position">
            <div className="xl-progress">
              <div className="xl-progress-head">
                <Icon name="pin" size={20} />
                <b>Route Progress</b>
                <KindBadge kind="assumption" title="Reported by you with the slider. PAWPRINT does not track your position." />
              </div>
              <div className="xl-progress-bar" aria-hidden="true"><span style={{ width: `${x.reportedProgressPct ?? 0}%` }} /></div>
              <label className="xl-progress-input">
                <span className="sr-only">Route progress you report</span>
                <input type="range" min={0} max={100} step={5} value={x.reportedProgressPct ?? 0} disabled={finished} onChange={(e) => update((s) => ({ ...s, reportedProgressPct: Number(e.target.value) }))} aria-label="Route progress you report, percent" />
                <span>{x.reportedProgressPct === null ? "Not reported yet" : `${x.reportedProgressPct}% · you reported · ~${formatDistance((snap.mode === "team" ? snap.distance_m / 2 : snap.distance_m) * (1 - x.reportedProgressPct / 100))} left`}</span>
              </label>
              {est !== null && t.status !== "idle" && (
                <p className="xl-small muted">Time-based estimate: about {pctText(est)} of the planned walk out, from walking time ÷ {fmtMin(snap.walkMin)} <KindBadge kind="estimate" title="Walking time so far divided by the planned outbound walking estimate. Not a position." /></p>
              )}
            </div>
            <div className="xl-gps">
              <span className="xl-gps-icon"><Icon name="satellite" size={22} /></span>
              <div>
                <b>Live Position Tracking</b> <span className="xl-soon">Coming Soon</span>
                <p className="xl-small muted">Real-time location along the route is not available in this prototype. PAWPRINT never shows a made-up position.</p>
              </div>
            </div>
          </section>
        </div>

        {/* ---------------- Right column ---------------- */}
        <aside className="xl-side">
          <section className="xl-card" aria-labelledby="xl-sup-title">
            <div className="xl-card-head">
              <Icon name="box" size={22} />
              <h3 id="xl-sup-title">Supplies &amp; Resources</h3>
              <KindBadge kind="simulated" title="Your EVA budgets and rates × the mission clock. Not suit telemetry." />
            </div>
            <div className="xl-rings">
              <div className="xl-ring-col">
                <Ring pct={supplies.o2?.pct ?? null} color="var(--turq)" warn={!!supplies.o2 && supplies.o2.rawPct < Math.max(10, snap.eva.reservePct)} label={supplies.o2 ? `Oxygen ${pctText(supplies.o2.rawPct)} remaining (simulated)` : "Oxygen: no budget entered"}>
                  <span className="xl-ring-sym">O₂</span>
                  <b>{supplies.o2 ? pctText(supplies.o2.rawPct) : "—"}</b>
                </Ring>
                <span>Oxygen</span>
              </div>
              <div className="xl-ring-col">
                <Ring pct={supplies.power?.pct ?? null} color="var(--lav)" warn={!!supplies.power && supplies.power.rawPct < Math.max(10, snap.eva.reservePct)} label={supplies.power ? `Power ${pctText(supplies.power.rawPct)} remaining (simulated)` : "Power: no budget entered"}>
                  <span className="xl-ring-sym">⚡</span>
                  <b>{supplies.power ? pctText(supplies.power.rawPct) : "—"}</b>
                </Ring>
                <span>Power</span>
              </div>
              <div className="xl-ring-col">
                <Ring pct={supplies.time?.pct ?? null} color="var(--rose)" warn={!!supplies.time && supplies.time.remainingMin < 0} label={supplies.time ? `About ${fmtMin(supplies.time.remainingMin)} left` : "Time left: no EVA time entered"}>
                  <Icon name="clock" size={16} />
                  <b className={supplies.time && Math.abs(supplies.time.remainingMin) >= 100 ? "sm" : ""}>{supplies.time ? shortMin(supplies.time.remainingMin) : "—"}</b>
                </Ring>
                <span>{supplies.time?.basis === "plan" ? "Plan left" : "Time left"}</span>
              </div>
            </div>
            <p className="xl-caption">Simulation based on EVA planning estimates{snap.mode === "team" ? " (per suit; both use the same entered rates)" : ""}.</p>
            {(!supplies.o2 || !supplies.power || supplies.time?.basis !== "eva-limit") && (
              <div className="xl-need-eva">
                <span>
                  {[!supplies.o2 && "oxygen", !supplies.power && "power", supplies.time?.basis !== "eva-limit" && "available EVA time"].filter(Boolean).join(", ")} not set.
                  {supplies.time?.basis === "plan" && " Time shows the planned EVA length instead."}
                </span>
                <button className="btn-mini lav" onClick={() => onOpenPlanner("eva")}>Enter budgets in EVA</button>
              </div>
            )}
            {supplies.o2 && <p className="xl-small muted">O₂: {supplies.o2.used.toFixed(2)} of {supplies.o2.budget} {snap.eva.o2Unit} used at {snap.eva.o2RatePerHour}/h. {supplies.power && <>Power: {Math.round(supplies.power.used)} of {supplies.power.budget} Wh at {snap.eva.powerDrawW} W.</>}</p>}
          </section>

          <section className="xl-card" aria-labelledby="xl-safety-title">
            <div className="xl-card-head">
              <Icon name="warn" size={22} />
              <h3 id="xl-safety-title">Safety Reminders</h3>
              <Hint text={NOT_CERTIFIED}><span className="xl-info"><Icon name="info" size={16} /></span></Hint>
            </div>
            {snap.alerts.length === 0 ? (
              <p className="xl-small muted">No warnings were raised for this route. {NOT_CERTIFIED}</p>
            ) : (
              <ul className="xl-safety">
                {snap.alerts.map((a) => {
                  const info = warningInfo(a);
                  const open = openAlert === a.id;
                  return (
                    <li key={a.id} className={`xl-safe sev-${a.severity} ${open ? "open" : ""}`}>
                      <button className="xl-safe-btn" aria-expanded={open} onClick={() => setOpenAlert(open ? null : a.id)}>
                        <span className="xl-safe-icon"><SafetyIcon alert={a} /></span>
                        <span className="xl-safe-text"><b>{a.title}</b><em>{info.label} · {info.severityLabel}</em></span>
                        <Icon name={open ? "chevronUp" : "chevronDown"} size={16} />
                      </button>
                      {open && (
                        <div className="xl-safe-detail">
                          <p>{a.why}</p>
                          <p className="xl-small muted">Source: {a.source}</p>
                          {liveAlertIds.has(a.id) && !differentRoute && <button className="btn-mini rose" onClick={() => onOpenAlert(a.id)}><Icon name="pin" size={13} /> Show in Mission Planner</button>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="xl-card" aria-labelledby="xl-photo-title">
            <div className="xl-card-head">
              <Icon name="camera" size={22} />
              <h3 id="xl-photo-title">Photo Documentation</h3>
              {x.photos.length > 0 && <span className="xl-count">{x.photos.length}</span>}
            </div>
            <div className="xl-photo-actions">
              <button className="btn btn-primary" disabled={photoBusy} onClick={() => void addPhotos("camera")}><Icon name="camera" /> Take Picture</button>
              <button className="btn btn-secondary" disabled={photoBusy} onClick={() => void addPhotos("upload")}><Icon name="upload" /> Upload Photo</button>
            </div>
            {photoBusy && <p className="xl-small muted" role="status">Compressing and saving…</p>}
            {photoMsg && <p className="xl-small xl-error" role="alert">{photoMsg}</p>}
            <div className="xl-photos">
              {x.photos.map((p) => (
                <button key={p.id} className="xl-photo" onClick={() => setViewPhoto(p.id)} aria-label={`Open photo${p.caption ? `: ${p.caption}` : ""}`}>
                  <PhotoThumb id={p.id} alt={p.caption || "Expedition photo"} />
                  {p.caption && <span className="xl-photo-cap">{p.caption}</span>}
                </button>
              ))}
              <button className="xl-photo xl-photo-add" onClick={() => void addPhotos("upload")} aria-label="Add a photo"><Icon name="plus" size={22} /></button>
            </div>
            <p className="xl-small muted">Photos are downscaled and stored only in this browser.</p>
          </section>
        </aside>
      </div>

      {pickers.inputs}
      {pickers.camera && (
        <CameraModal
          onClose={() => { pickers.closeCamera(); }}
          onFallback={pickers.fallbackCapture}
          onCapture={async (v) => {
            const ids = await savePhotos([v], "camera");
            pendingPick.current?.(ids);
            pendingPick.current = null;
          }}
        />
      )}
      {editing && <EntryEditor initial={editing.draft} snap={snap} photos={x.photos} onSave={saveEntry} onCancel={() => setEditing(null)} onAddPhotos={addPhotos} />}
      {viewing && (
        <PhotoViewer
          photo={viewing}
          entries={x.entries}
          onCaption={(c) => update((s) => ({ ...s, photos: s.photos.map((p) => (p.id === viewing.id ? { ...p, caption: c } : p)) }))}
          onDelete={() => removePhoto(viewing.id)}
          onClose={() => setViewPhoto(null)}
        />
      )}
      {confirmFinish && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="xl-fin-title" onClick={() => setConfirmFinish(false)}>
          <div className="xl-modal xl-confirm" onClick={(e) => e.stopPropagation()}>
            <Mascot pose="sitting" size={84} />
            <h3 id="xl-fin-title">Finish this Marswalk?</h3>
            <p>All timers stop at {fmtClock(totals.totalMs)} and are frozen. Your notes and photos stay editable.</p>
            <div className="xl-modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmFinish(false)}>Keep going</button>
              <button className="btn btn-primary" onClick={() => { update((e) => ({ ...e, timer: finishTimer(e.timer, Date.now()) })); setConfirmFinish(false); setShowSummary(true); }}><Icon name="flag" /> Finish Mission</button>
            </div>
          </div>
        </div>
      )}
      {showSummary && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="xl-sum-title" onClick={() => setShowSummary(false)}>
          <div className="xl-modal xl-summary-modal" onClick={(e) => e.stopPropagation()}>
            <div className="xl-modal-head">
              <h3 id="xl-sum-title"><Icon name="flag" /> Mission summary</h3>
              <button className="icon-btn" onClick={() => setShowSummary(false)} aria-label="Close summary"><Icon name="close" /></button>
            </div>
            <div className="xl-sum-hero">
              <Mascot pose="standing" size={72} />
              <div>
                <b>{snap.name}</b>
                <p>{snap.startName} → {snap.destName}</p>
              </div>
            </div>
            <dl className="xl-sum-grid">
              <div><dt>Total time</dt><dd>{fmtClock(totals.totalMs)}</dd></div>
              <div><dt>Walking</dt><dd>{fmtClock(totals.walkingMs)}</dd></div>
              <div><dt>Breaks</dt><dd>{fmtClock(totals.breakMs)}</dd></div>
              <div><dt>Obstacles</dt><dd>{fmtClock(totals.obstacleMs)}</dd></div>
              <div><dt>Planned walk out</dt><dd>{fmtMin(snap.walkMin)}</dd></div>
              <div><dt>Progress (you reported)</dt><dd>{x.reportedProgressPct === null ? "—" : `${x.reportedProgressPct}%`}</dd></div>
              {CATEGORIES.map((k) => <div key={k.id}><dt>{k.label}</dt><dd>{counts[k.id]}</dd></div>)}
              <div><dt>Photos</dt><dd>{x.photos.length}</dd></div>
            </dl>
            <p className="xl-small muted">Observations are field notes. Anything marked as water or mineral evidence is possible evidence that needs confirmation. Supplies were simulated from your EVA settings. {NOT_CERTIFIED}</p>
            <div className="xl-modal-actions">
              <button className="btn btn-ghost" onClick={exportJson}><Icon name="download" /> Export log (.json)</button>
              {candidate && <button className="btn btn-secondary" onClick={startNew}>Start a new expedition</button>}
              <button className="btn btn-primary" onClick={() => setShowSummary(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
