/**
 * Expedition photos: downscaled JPEGs kept in IndexedDB (falls back to memory for this
 * session when IndexedDB is blocked, e.g. private windows). Every call is wrapped so a
 * storage failure never breaks the log.
 */

const DB = "pawprint-expedition";
const STORE = "photos";
export const MAX_EDGE = 1280;

const memory = new Map<string, Blob>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const r = run(db.transaction(STORE, mode).objectStore(STORE));
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

/** Returns true when the photo was persisted (IndexedDB), false when only kept in memory. */
export async function putPhoto(id: string, blob: Blob): Promise<boolean> {
  memory.set(id, blob);
  const ok = await tx("readwrite", (s) => s.put(blob, id));
  return ok !== undefined;
}

export async function getPhoto(id: string): Promise<Blob | null> {
  const m = memory.get(id);
  if (m) return m;
  const b = await tx<Blob>("readonly", (s) => s.get(id) as IDBRequest<Blob>);
  if (b) memory.set(id, b);
  return b ?? null;
}

export async function deletePhoto(id: string): Promise<void> {
  memory.delete(id);
  await tx("readwrite", (s) => s.delete(id));
}

export async function clearPhotos(ids: string[]): Promise<void> {
  await Promise.all(ids.map(deletePhoto));
}

/** Target size that fits inside MAX_EDGE while keeping the aspect ratio. */
export function fitSize(w: number, h: number, max = MAX_EDGE): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

/** Downscale any drawable (image file or video frame) to a compact JPEG. */
export async function downscale(source: Blob | HTMLVideoElement, max = MAX_EDGE, quality = 0.78): Promise<{ blob: Blob; width: number; height: number }> {
  let draw: CanvasImageSource;
  let w: number;
  let h: number;
  let cleanup = () => {};
  if (source instanceof Blob) {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(source);
      draw = bmp;
      w = bmp.width;
      h = bmp.height;
      cleanup = () => bmp.close();
    } else {
      const url = URL.createObjectURL(source);
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("This file could not be read as an image."));
        img.src = url;
      });
      draw = img;
      w = img.naturalWidth;
      h = img.naturalHeight;
      cleanup = () => URL.revokeObjectURL(url);
    }
  } else {
    draw = source;
    w = source.videoWidth;
    h = source.videoHeight;
  }
  const size = fitSize(w, h, max);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx || !size.width) {
    cleanup();
    throw new Error("Could not process this image.");
  }
  ctx.drawImage(draw, 0, 0, size.width, size.height);
  cleanup();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
  if (!blob) throw new Error("Could not compress this image.");
  return { blob, width: size.width, height: size.height };
}
