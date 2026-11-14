/** Mars geodesy for the UI. Must agree with analysis/pawprint/mars.py. */
export const MARS_RADIUS_M = 3_396_190;
export const METERS_PER_DEGREE = (MARS_RADIUS_M * Math.PI) / 180;

const rad = (d: number) => (d * Math.PI) / 180;

export function greatCircleM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Ground metres per degree of longitude at a latitude. */
export function metersPerDegLon(lat: number): number {
  return METERS_PER_DEGREE * Math.cos(rad(lat));
}

export function formatLat(lat: number, digits = 4): string {
  return `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? "N" : "S"}`;
}

/** Mars 2020 convention: planetocentric, east-positive longitude. */
export function formatLon(lon: number, digits = 4): string {
  const l = ((lon % 360) + 360) % 360;
  return `${l.toFixed(digits)}° E`;
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m.toString().padStart(2, "0")} min` : `${m} min`;
}

/** Parse "18.45, 77.42" / "18.45N 77.42E" into [lon, lat]. Latitude first, like the UI. */
export function parseLatLon(text: string): [number, number] | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?[\s,]+(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = parseFloat(m[1]);
  let lon = parseFloat(m[3]);
  if (m[2]?.toUpperCase() === "S") lat = -lat;
  if (m[4]?.toUpperCase() === "W") lon = 360 - lon;
  if (Math.abs(lat) > 90 || lon < -180 || lon > 360) return null;
  return [lon, lat];
}

/** A "nice" scale-bar length (1, 2, 5 x 10^n metres) that fits within maxMeters. */
export function niceScale(maxMeters: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(maxMeters)));
  for (const f of [5, 2, 1]) if (f * p <= maxMeters) return f * p;
  return p;
}
