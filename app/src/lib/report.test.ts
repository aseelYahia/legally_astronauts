import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CompareResult, Manifest, Poi, RouteResult, Stop, WeatherSol } from "../types";
import { DEFAULT_EVA, evaPlan, toblerSpeed } from "./eva";
import { buildReportPdf, pdfText, type ReportInput } from "./report";
import { routeAlerts } from "./safety";

const DATA = resolve(__dirname, "../../public/data");
const manifest: Manifest = JSON.parse(readFileSync(`${DATA}/manifest.json`, "utf-8"));
const pois: Poi[] = JSON.parse(readFileSync(`${DATA}/pois.json`, "utf-8"));
const weather: WeatherSol[] = JSON.parse(readFileSync(`${DATA}/weather.json`, "utf-8")).sols;

function route(elev: number[], slopes: number[], dist0: number): RouteResult {
  const d = [0];
  const t = [0];
  for (let i = 1; i < elev.length; i++) {
    const dz = elev[i] - elev[i - 1];
    const seg = Math.hypot(dist0, dz);
    d.push(d[i - 1] + seg);
    t.push(t[i - 1] + seg / toblerSpeed(dz / dist0));
  }
  return {
    distance_m: d[d.length - 1], horizontal_distance_m: dist0 * (elev.length - 1), elevation_start_m: elev[0], elevation_end_m: elev[elev.length - 1],
    elevation_gain_m: 12, elevation_loss_m: 3, elevation_min_m: Math.min(...elev), elevation_max_m: Math.max(...elev), max_slope_deg: Math.max(...slopes), mean_slope_deg: 4,
    slope_class_fraction: { easy: 0.9, moderate: 0.05, hazard: 0.05, nogo: 0 }, est_time_s: t[t.length - 1] * 1.1, walk_time_s: t[t.length - 1],
    objective_costs: { fastest_s: 1, shortest_m: 1, lower_risk_s: 1, balanced_s: 1 }, difficulty: { score: 31.5, label: "Moderate" },
    profile: { distance_m: d, elevation_m: elev, slope_deg: slopes, walk_time_s: t },
    path_lonlat: elev.map((_, i) => [77.4509 - i * 0.002, 18.4446 + i * 0.0008] as [number, number]), stop_indices: [0, elev.length - 1],
    grid: { name: "ctx", resolution_m: 20 }, max_slope_limit_deg: 25, compute_ms: 5, model: { kind: "estimate", note: "test" },
  };
}

describe("Mission report PDF", () => {
  const sky = pois.find((p) => p.name === "Skyland")!;
  const landing = pois.find((p) => p.id === "landing")!;
  const stops: Stop[] = [
    { id: "a", role: "start", name: "Base Camp", lon: landing.lon, lat: landing.lat, poiId: "landing" },
    { id: "b", role: "destination", name: "Skyland", lon: sky.lon, lat: sky.lat, poiId: sky.id },
  ];
  const lr = route([-2567, -2560, -2555, -2550, -2548], [3, 6, 17, 4, 2], 600);
  const fa = route([-2567, -2561, -2552, -2550, -2548], [3, 9, 19, 4, 2], 590);
  const compare: CompareResult = {
    routes: { lower_risk: lr, fastest: fa, shortest: fa },
    identical: { lower_risk: { lower_risk: true, fastest: false, shortest: false }, fastest: { lower_risk: false, fastest: true, shortest: true }, shortest: { lower_risk: false, fastest: true, shortest: true } },
    similarity: { lower_risk: { lower_risk: 1, fastest: 0.2, shortest: 0.2 }, fastest: { lower_risk: 0.2, fastest: 1, shortest: 1 }, shortest: { lower_risk: 0.2, fastest: 1, shortest: 1 } },
    grid: { name: "ctx", resolution_m: 20 }, compute_ms: 5,
  };
  const eva = { ...DEFAULT_EVA, availableMin: 120, scienceMinPerStop: 20, o2Budget: 10, o2RatePerHour: 2, o2Unit: "kg" };
  const input: ReportInput = {
    name: "Marswalk Report Test", notes: "Bring the core sampler.", mode: "solo", objective: "lower_risk", compare, route: lr, stops, missionId: "water",
    alerts: routeAlerts(lr, 25, weather), eva, evaPlan: evaPlan(lr, 1, eva), team: null, manifest, weather, pois, maxSlope: 25,
    generatedAt: new Date("2026-11-14T12:00:00Z"),
  };

  it("builds a multi-page PDF that reflects the selected plan", () => {
    const doc = buildReportPdf(input, null, null);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
    const raw = doc.output();
    for (const s of [
      "Marswalk Report Test",
      "Investigate evidence of ancient water",
      "Lower Risk",
      "Skyland",
      "Bring the core sampler.",
      "Hypothetical",
      "not certified",
      "Mars 2020 Terrain Relative Navigation CTX DTM Mosaic",
      "P906QQT8",
      "archived MEDA",
      formatKm(lr.distance_m),
    ]) {
      expect(raw.toLowerCase(), s).toContain(s.toLowerCase());
    }
  });

  it("maps characters outside the PDF font to safe equivalents", () => {
    expect(pdfText("Ch'ał ≥ 15° − 2")).toBe("Ch'al >= 15° - 2");
    expect(pdfText("Séítah")).toBe("Séítah");
  });
});

function formatKm(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}
