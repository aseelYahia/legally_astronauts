import type { SavedRoute } from "../types";

const KEY = "pawprint.routes.v1";

export function loadRoutes(store: Storage | undefined = safeStorage()): SavedRoute[] {
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.id === "string" && Array.isArray(r.stops)) : [];
  } catch {
    return [];
  }
}

export function saveRoute(route: SavedRoute, store: Storage | undefined = safeStorage()): SavedRoute[] {
  const all = loadRoutes(store).filter((r) => r.id !== route.id);
  all.unshift(route);
  write(all, store);
  return all;
}

export function deleteRoute(id: string, store: Storage | undefined = safeStorage()): SavedRoute[] {
  const all = loadRoutes(store).filter((r) => r.id !== id);
  write(all, store);
  return all;
}

function write(all: SavedRoute[], store?: Storage) {
  try {
    store?.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full or blocked: routes stay in memory for this session */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function flag(name: string, value?: boolean): boolean {
  try {
    if (value !== undefined) localStorage.setItem(`pawprint.${name}`, value ? "1" : "0");
    return localStorage.getItem(`pawprint.${name}`) === "1";
  } catch {
    return false;
  }
}
