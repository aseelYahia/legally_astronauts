import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  crismPreview,
  geologyPreview,
  getPath,
  localizationsPreview,
  photosPreview,
  rasterFacts,
  samplesPreview,
  slopeClassShares,
  traversePreview,
  traverseRecord,
  weatherPreview,
  type Preview,
  type TraverseFile,
} from "./dataExplainer";
import type { GeologyFile, PhotosFile } from "./nasaExtras";
import type { Manifest, Poi } from "../types";

const DATA = resolve(__dirname, "../../public/data");
// Fresh parse for every check so a preview can never be compared with itself.
const read = <T,>(f: string): T => JSON.parse(readFileSync(`${DATA}/${f}`, "utf-8")) as T;

/** Every preview cell must equal the field it claims to show, in a freshly parsed copy of the file. */
function expectFromSource(p: Preview, records: unknown[]) {
  expect(p.rows.length).toBeGreaterThan(0);
  expect(p.total).toBe(records.length);
  for (const r of p.rows) {
    const rec = records[r.ref];
    expect(rec).toBeDefined();
    p.columns.forEach((c, i) => {
      const v = getPath(rec, c.path);
      expect(v, `${p.file}[${r.ref}].${c.path}`).not.toBeUndefined();
      expect(r.values[i], `${p.file}[${r.ref}].${c.path}`).toEqual(v);
    });
  }
}

const manifest = read<Manifest>("manifest.json");
const pois = read<Poi[]>("pois.json");

describe("Understand the Data previews come from the real files", () => {
  it("samples and localizations read pois.json", () => {
    const fresh = read<Poi[]>("pois.json");
    const s = samplesPreview(pois);
    expectFromSource(s, fresh);
    expect(s.rows.every((r) => fresh[r.ref].category === "sample")).toBe(true);
    expectFromSource(localizationsPreview(pois), fresh);
  });

  it("weather reads weather.json sols, keeping nulls as null", () => {
    const sols = read<{ sols: Poi[] }>("weather.json").sols;
    const p = weatherPreview(read<{ sols: never[] }>("weather.json").sols);
    expectFromSource(p, sols);
  });

  it("traverse reads rover_traverse.geojson features", () => {
    const t = read<TraverseFile>("rover_traverse.geojson");
    const p = traversePreview(t);
    expectFromSource(p, read<TraverseFile>("rover_traverse.geojson").features.map(traverseRecord));
    expect(p.total).toBe(manifest.layers.rover.segments);
  });

  it("photos read photos.json and show distinct cameras", () => {
    const ph = read<PhotosFile>("photos.json");
    const p = photosPreview(ph);
    expectFromSource(p, read<PhotosFile>("photos.json").photos);
    const cams = p.rows.map((r) => ph.photos[r.ref].camera_label);
    expect(new Set(cams).size).toBe(cams.length);
  });

  it("geology reads geology_units.geojson units", () => {
    const g = read<GeologyFile>("geology_units.geojson");
    expectFromSource(geologyPreview(g), read<GeologyFile>("geology_units.geojson").units);
  });

  it("CRISM indicators read the manifest (olivine 3.381 km², carbonates none)", () => {
    const p = crismPreview(manifest)!;
    const inds = (read<Manifest>("manifest.json").layers.minerals as unknown as { indicators: { key: string; km2_in_aoi: number }[] }).indicators;
    expectFromSource(p, inds);
    expect(inds.find((i) => i.key === "olivine")?.km2_in_aoi).toBe(3.381);
    expect(inds.filter((i) => i.key.includes("carbonate")).every((i) => i.km2_in_aoi === 0)).toBe(true);
  });

  it("raster facts are taken from manifest values", () => {
    const ctx = rasterFacts(manifest, "ctx_dtm");
    const stats = manifest.layers.elevation.stats as Record<string, unknown>;
    expect(ctx.find((f) => f.label.startsWith("Grid"))?.value).toBe((stats.shape as number[]).join(" × "));
    expect(ctx.find((f) => f.label === "Cell size")?.value).toBe(`${manifest.datasets.ctx_dtm.resolution_m} m`);
    expect(ctx.find((f) => f.label === "Value range")?.value).toContain((stats.elevation_min_m as number).toFixed(1));
    for (const w of ["ctx_ortho", "hirise_dtm", "hirise_ortho", "crism"] as const) expect(rasterFacts(manifest, w).length).toBeGreaterThan(0);
    const shares = slopeClassShares(manifest);
    expect(shares.reduce((a, s) => a + s.pct, 0)).toBeCloseTo(100, 3);
    expect(shares.map((s) => s.range).join("|")).toBe("< 10°|10–15°|15–25°|≥ 25°");
  });
});
