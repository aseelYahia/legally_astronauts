import { useState } from "react";
import { CATEGORIES, CONFIDENCE_LABEL, validCoords, type Confidence, type EntryCategory, type EntryCoords, type MissionSnapshot, type NotebookEntry, type PhotoMeta } from "../../lib/expedition";
import { formatLat, formatLon } from "../../lib/mars";
import { Icon } from "../ui";
import { PhotoThumb } from "./Photos";

export type EntryDraft = Omit<NotebookEntry, "id" | "createdAt" | "updatedAt" | "missionMs">;

const CAUTION: Record<EntryCategory, string> = {
  rock: "Describe what you see (layering, grain size, colour). Interpretation needs follow-up analysis.",
  water: "Record it as possible evidence only. Field observations cannot prove past water; it needs laboratory confirmation.",
  mineral: "Visual identification is tentative. Treat it as possible evidence that needs instrument or lab confirmation.",
  general: "Anything worth remembering about the walk, the terrain or the samples.",
};

type CoordMode = "none" | "manual" | "stop";

export function EntryEditor({
  initial,
  snap,
  photos,
  onSave,
  onCancel,
  onAddPhotos,
}: {
  initial: EntryDraft;
  snap: MissionSnapshot;
  photos: PhotoMeta[];
  onSave: (d: EntryDraft) => void;
  onCancel: () => void;
  /** Opens the upload / camera picker; resolves with the ids of the new photos. */
  onAddPhotos: (how: "camera" | "upload") => Promise<string[]>;
}) {
  const [d, setD] = useState<EntryDraft>(initial);
  const c = initial.coords;
  const [mode, setMode] = useState<CoordMode>(!c ? "none" : c.source === "planned-stop" ? "stop" : "manual");
  const [lat, setLat] = useState(c && c.source === "manual" ? String(c.lat) : "");
  const [lon, setLon] = useState(c && c.source === "manual" ? String(c.lon) : "");
  const stopIdx0 = c && c.source === "planned-stop" ? Math.max(0, snap.stops.findIndex((s) => s.name === c.stopName)) : 0;
  const [stopIdx, setStopIdx] = useState(stopIdx0);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof EntryDraft>(k: K, v: EntryDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const togglePhoto = (id: string) => set("photoIds", d.photoIds.includes(id) ? d.photoIds.filter((p) => p !== id) : [...d.photoIds, id]);

  const submit = () => {
    let coords: EntryCoords | null = null;
    if (mode === "manual") {
      const la = Number(lat.replace(",", ".")), lo = Number(lon.replace(",", "."));
      if (!lat.trim() || !lon.trim() || !validCoords(la, lo)) {
        setErr("Enter latitude (−90 to 90) and east longitude (e.g. 18.4447 and 77.4508), or choose “No location”.");
        return;
      }
      coords = { lat: la, lon: lo, source: "manual" };
    } else if (mode === "stop") {
      const s = snap.stops[stopIdx];
      if (!s) { setErr("Choose a planned stop."); return; }
      coords = { lat: s.lat, lon: s.lon, source: "planned-stop", stopName: s.name };
    }
    if (!d.title.trim() && !d.notes.trim()) { setErr("Give the entry a title or a note."); return; }
    onSave({ ...d, title: d.title.trim(), notes: d.notes.trim(), coords });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="xl-entry-title" onClick={onCancel}>
      <div className="xl-modal xl-editor" onClick={(e) => e.stopPropagation()}>
        <div className="xl-modal-head">
          <h3 id="xl-entry-title"><Icon name="log" /> {initial.title || initial.notes ? "Edit observation" : "New observation"}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Close without saving"><Icon name="close" /></button>
        </div>
        <div className="xl-editor-scroll">
          <fieldset className="xl-field">
            <legend>Evidence type</legend>
            <div className="xl-seg" role="radiogroup" aria-label="Evidence type">
              {CATEGORIES.map((k) => (
                <button key={k.id} type="button" role="radio" aria-checked={d.category === k.id} className={d.category === k.id ? "on" : ""} onClick={() => set("category", k.id)}>
                  <Icon name={k.icon} size={15} /> {k.label}
                </button>
              ))}
            </div>
            <p className="xl-small xl-caution"><Icon name="info" size={14} /> {CAUTION[d.category]}</p>
          </fieldset>
          <label className="xl-field">
            <span>Title</span>
            <input value={d.title} maxLength={90} placeholder="e.g. Thin layered outcrop at the delta edge" onChange={(e) => set("title", e.target.value)} autoFocus />
          </label>
          <label className="xl-field">
            <span>Notes</span>
            <textarea rows={4} value={d.notes} maxLength={2000} placeholder="What did you observe? Size, colour, texture, context…" onChange={(e) => set("notes", e.target.value)} />
          </label>
          <fieldset className="xl-field">
            <legend>Your confidence in this observation</legend>
            <div className="xl-seg" role="radiogroup" aria-label="Confidence level">
              {(Object.keys(CONFIDENCE_LABEL) as Confidence[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={d.confidence === k} className={d.confidence === k ? "on" : ""} onClick={() => set("confidence", k)}>{CONFIDENCE_LABEL[k]}</button>
              ))}
            </div>
            <p className="xl-small muted">This is the observer's own judgement, not a scientific confirmation.</p>
          </fieldset>
          <fieldset className="xl-field">
            <legend>Location</legend>
            <div className="xl-seg" role="radiogroup" aria-label="Location source">
              <button type="button" role="radio" aria-checked={mode === "none"} className={mode === "none" ? "on" : ""} onClick={() => setMode("none")}>No location</button>
              <button type="button" role="radio" aria-checked={mode === "stop"} className={mode === "stop" ? "on" : ""} onClick={() => setMode("stop")}>A planned stop</button>
              <button type="button" role="radio" aria-checked={mode === "manual"} className={mode === "manual" ? "on" : ""} onClick={() => setMode("manual")}>Enter coordinates</button>
            </div>
            {mode === "stop" && (
              <select className="xl-input" aria-label="Planned stop" value={stopIdx} onChange={(e) => setStopIdx(Number(e.target.value))}>
                {snap.stops.map((s, i) => (
                  <option key={i} value={i}>{s.name} ({s.role}) · {formatLat(s.lat, 4)}, {formatLon(s.lon, 4)}</option>
                ))}
              </select>
            )}
            {mode === "manual" && (
              <div className="xl-coords">
                <label><span>Latitude °N</span><input inputMode="decimal" value={lat} placeholder="18.4447" onChange={(e) => setLat(e.target.value)} /></label>
                <label><span>Longitude °E</span><input inputMode="decimal" value={lon} placeholder="77.4508" onChange={(e) => setLon(e.target.value)} /></label>
              </div>
            )}
            <p className="xl-small muted">PAWPRINT never fills in a position for you: there is no live tracking. A planned stop's coordinates are where the stop was planned, not a measured fix.</p>
          </fieldset>
          <fieldset className="xl-field">
            <legend>Photos</legend>
            <div className="xl-attach">
              {photos.map((p) => (
                <button key={p.id} type="button" className={`xl-attach-item ${d.photoIds.includes(p.id) ? "on" : ""}`} aria-pressed={d.photoIds.includes(p.id)} onClick={() => togglePhoto(p.id)} title={p.caption || "Photo"}>
                  <PhotoThumb id={p.id} alt={p.caption || "Expedition photo"} />
                  {d.photoIds.includes(p.id) && <span className="xl-attach-check"><Icon name="check" size={14} /></span>}
                </button>
              ))}
              <button type="button" className="xl-attach-add" onClick={async () => { const ids = await onAddPhotos("upload"); if (ids.length) set("photoIds", [...d.photoIds, ...ids]); }}>
                <Icon name="upload" size={18} /><span>Upload</span>
              </button>
              <button type="button" className="xl-attach-add" onClick={async () => { const ids = await onAddPhotos("camera"); if (ids.length) set("photoIds", [...d.photoIds, ...ids]); }}>
                <Icon name="camera" size={18} /><span>Camera</span>
              </button>
            </div>
          </fieldset>
          {err && <p className="xl-error" role="alert">{err}</p>}
        </div>
        <div className="xl-modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}><Icon name="check" /> Save entry</button>
        </div>
      </div>
    </div>
  );
}
