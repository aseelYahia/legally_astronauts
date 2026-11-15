import { useEffect, useRef, useState } from "react";
import type { NotebookEntry, PhotoMeta } from "../../lib/expedition";
import { getPhoto } from "../../lib/photoStore";
import { Icon } from "../ui";

/** Object URL for a stored photo (revoked on unmount). */
export function usePhotoUrl(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    let made: string | null = null;
    void getPhoto(id).then((b) => {
      if (!live || !b) return;
      try {
        made = URL.createObjectURL(b);
        setUrl(made);
      } catch {
        /* ignore */
      }
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [id]);
  return url;
}

export function PhotoThumb({ id, alt, className = "" }: { id: string; alt: string; className?: string }) {
  const url = usePhotoUrl(id);
  return url ? <img className={className} src={url} alt={alt} draggable={false} /> : <span className={`xl-thumb-missing ${className}`} aria-label={`${alt} (image not available on this device)`}><Icon name="camera" size={18} /></span>;
}

/** Hidden file inputs + the live camera, shared by the Photo panel and the notebook editor. */
export function usePhotoPickers(onFiles: (files: File[], source: "camera" | "upload") => void) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);
  const canLiveCamera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const inputs = (
    <>
      <input ref={uploadRef} type="file" accept="image/*" multiple hidden data-testid="xl-upload-input" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onFiles(f, "upload"); }} />
      <input ref={captureRef} type="file" accept="image/*" capture="environment" hidden data-testid="xl-capture-input" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onFiles(f, "camera"); }} />
    </>
  );
  return {
    inputs,
    camera,
    closeCamera: () => setCamera(false),
    fallbackCapture: () => captureRef.current?.click(),
    upload: () => uploadRef.current?.click(),
    takePicture: () => (canLiveCamera ? setCamera(true) : captureRef.current?.click()),
  };
}

/** Live camera via getUserMedia. Falls back to the device's own camera/file picker when unavailable or denied. */
export function CameraModal({ onCapture, onClose, onFallback }: { onCapture: (v: HTMLVideoElement) => Promise<void>; onClose: () => void; onFallback: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"starting" | "live" | "error">("starting");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let live = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!live) return stream.getTracks().forEach((t) => t.stop());
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => {});
        }
        setState("live");
      } catch (e) {
        if (!live) return;
        setErr(e instanceof Error && e.name === "NotAllowedError" ? "Camera permission was declined." : "No camera is available here.");
        setState("error");
      }
    })();
    return () => {
      live = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Take a picture" onClick={onClose}>
      <div className="xl-modal xl-camera" onClick={(e) => e.stopPropagation()}>
        <div className="xl-modal-head">
          <h3><Icon name="camera" /> Take a picture</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close camera"><Icon name="close" /></button>
        </div>
        <div className="xl-camera-view">
          <video ref={video} playsInline muted aria-label="Camera preview" />
          {state === "starting" && <p className="xl-camera-msg">Starting the camera…</p>}
          {state === "error" && (
            <div className="xl-camera-msg">
              <p>{err} You can still use your device's camera app or choose an existing photo.</p>
              <button className="btn btn-secondary" onClick={() => { onClose(); onFallback(); }}><Icon name="upload" /> Use device camera / choose photo</button>
            </div>
          )}
        </div>
        <div className="xl-modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={state !== "live" || busy}
            onClick={async () => {
              if (!video.current) return;
              setBusy(true);
              try {
                await onCapture(video.current);
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name="camera" /> {busy ? "Saving…" : "Capture"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PhotoViewer({ photo, entries, onCaption, onDelete, onClose }: { photo: PhotoMeta; entries: NotebookEntry[]; onCaption: (c: string) => void; onDelete: () => void; onClose: () => void }) {
  const url = usePhotoUrl(photo.id);
  const [caption, setCaption] = useState(photo.caption);
  const linked = entries.filter((e) => e.photoIds.includes(photo.id));
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Photo details" onClick={onClose}>
      <div className="xl-modal xl-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="xl-modal-head">
          <h3><Icon name="camera" /> Photo</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close photo"><Icon name="close" /></button>
        </div>
        <div className="xl-viewer-img">{url ? <img src={url} alt={photo.caption || "Expedition photo"} /> : <p className="muted">Image not available on this device.</p>}</div>
        <label className="xl-field">
          <span>Caption</span>
          <input value={caption} maxLength={160} placeholder="What does this photo show?" onChange={(e) => setCaption(e.target.value)} onBlur={() => onCaption(caption.trim())} />
        </label>
        <p className="xl-small muted">
          {new Date(photo.createdAt).toLocaleString()} · {photo.width}×{photo.height} px · {photo.source === "camera" ? "taken with camera" : "uploaded"}
          {linked.length > 0 && <> · attached to {linked.map((e) => `“${e.title || "Untitled"}”`).join(", ")}</>}
        </p>
        <div className="xl-modal-actions">
          <button className="btn btn-ghost xl-danger" onClick={() => { if (window.confirm("Delete this photo? It is also removed from any notebook entries.")) onDelete(); }}><Icon name="trash" /> Delete</button>
          <button className="btn btn-primary" onClick={() => { onCaption(caption.trim()); onClose(); }}>Done</button>
        </div>
      </div>
    </div>
  );
}
