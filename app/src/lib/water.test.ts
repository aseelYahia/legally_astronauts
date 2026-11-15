import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bandLabel, breakdownAt, cellIndex, classOf, evidenceIndex, explainAt, explainCell, observationPrompt, WATER_CLASSES, waterBreakdown, zoneIdFromName, zoneStopName, zoneWhy, type WaterFile } from "./water";

const water = JSON.parse(readFileSync(resolve(__dirname, "../../public/data/water_evidence.json"), "utf-8")) as WaterFile;
const manifest = JSON.parse(readFileSync(resolve(__dirname, "../../public/data/manifest.json"), "utf-8"));

describe("water evidence file", () => {
  it("is labelled as an estimate and never as a probability", () => {
    expect(water.kind).toBe("estimate");
    expect(water.not_a_probability).toMatch(/not probabilities/);
    expect(manifest.layers.water_evidence.kind).toBe("estimate");
    const total = Object.values(water.formula.weights).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("has one value per cell for every column", () => {
    const n = water.grid.rows * water.grid.cols;
    for (const v of Object.values(water.cells)) expect(v).toHaveLength(n);
  });

  it("documents SHARAD, SWIM and RIMFAX as not used", () => {
    const keys = water.rejected.map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["sharad", "swim", "rimfax"]));
    for (const r of water.rejected) expect(r.why.length).toBeGreaterThan(40);
  });
});

describe("cell lookup and explanation", () => {
  it("returns null outside the grid", () => {
    expect(cellIndex(water, 10, 10)).toBeNull();
    expect(explainAt(water, 77.0, 18.45)).toBeNull();
  });

  it("explains a zone target with three components and limitations", () => {
    const z = water.zones[0];
    const info = explainAt(water, z.target[0], z.target[1])!;
    expect(info.score).not.toBeNull();
    expect(info.components.map((c) => c.key)).toEqual(["mineral", "geology", "landform"]);
    expect(info.limitations.some((l) => /assumptions/.test(l))).toBe(true);
    const shares = info.components.reduce((s, c) => s + (c.share ?? 0), 0);
    expect(shares).toBeCloseTo(1, 1);
  });

  it("treats missing data as insufficient, not as low evidence", () => {
    const i = water.cells.score.findIndex((s) => s === null);
    expect(i).toBeGreaterThanOrEqual(0);
    const info = explainCell(water, i);
    expect(info.band).toBe("Insufficient data");
    expect(info.confidence).toBe("None");
    expect(bandLabel(0.05)).toBe("Low");
  });

  it("notes when CRISM is missing instead of counting it as zero", () => {
    const i = water.cells.mineral.findIndex((m, k) => m === null && water.cells.score[k] !== null);
    if (i < 0) return;
    const info = explainCell(water, i);
    expect(info.components[0].value).toBeNull();
    expect(info.limitations.some((l) => /No usable CRISM/.test(l))).toBe(true);
    expect(info.limitations.some((l) => /could be anywhere from/.test(l))).toBe(true);
  });

  it("highlighted regions never rely on missing data and report CRISM replication (audit 2026-11-15)", () => {
    expect(water.formula).toHaveProperty("zones_require_full_coverage", true);
    for (const z of water.zones) {
      expect(Object.values(z.components_mean).every((v) => v !== null)).toBe(true);
      expect(z.crism_signal).toBeDefined();
      const why = zoneWhy(water, z).join(" ");
      expect(why).toMatch(/second CRISM observation|Only one CRISM observation|scattered/);
    }
  });

  it("single-observation mineral signals are never 'Higher' confidence", () => {
    const C = water.cells;
    const i = C.score.findIndex((s, k) => s !== null && (C.crism_single?.[k] ?? 0) > 0 && (C.crism_replicated?.[k] ?? 0) === 0 && (C.mineral[k] ?? 0) > 0);
    expect(i).toBeGreaterThanOrEqual(0);
    const info = explainCell(water, i);
    expect(info.confidence).not.toBe("Higher");
    expect(info.limitations.some((l) => /single CRISM observation/.test(l))).toBe(true);
  });
});

describe("zones -> mission planning", () => {
  it("zones are inside the AOI and pass the threshold", () => {
    const a = manifest.aoi;
    expect(water.zones.length).toBeGreaterThan(0);
    for (const z of water.zones) {
      expect(z.target[0]).toBeGreaterThanOrEqual(a.lon_min);
      expect(z.target[0]).toBeLessThanOrEqual(a.lon_max);
      expect(z.target[1]).toBeGreaterThanOrEqual(a.lat_min);
      expect(z.target[1]).toBeLessThanOrEqual(a.lat_max);
      expect(z.score_mean).toBeGreaterThanOrEqual(water.zone_threshold);
      expect(zoneWhy(water, z).length).toBeGreaterThan(0);
    }
  });

  it("stop names round-trip to the zone id for the Expedition Log", () => {
    const z = water.zones[0];
    expect(zoneIdFromName(zoneStopName(z))).toBe(z.id);
    expect(zoneIdFromName("Science Site")).toBeNull();
    expect(observationPrompt(z.id)).toMatch(/Record what you actually see/);
  });
});

describe("evidence index, classes and the panel breakdown (visualization upgrade)", () => {
  const classes = water.formula.classes!;
  it("the file's classes are the app's classes and tile 0-100 without gaps", () => {
    expect(classes.map((c) => [c.min, c.max, c.color])).toEqual(WATER_CLASSES.map((c) => [c.min, c.max, c.color]));
    const covered = classes.flatMap((c) => Array.from({ length: c.max - c.min + 1 }, (_, i) => c.min + i));
    expect(covered).toEqual(Array.from({ length: 101 }, (_, i) => i));
  });

  it("water colours never reuse a geology or CRISM indicator colour", () => {
    const others = new Set(["#A99BDD", "#76C9C2", "#D98EBA", "#E6C79C", "#9FB8E8", "#C6A6E0", "#F0B59A", "#8FD3A7"]);
    for (const c of classes) expect(others.has(c.color.toUpperCase())).toBe(false);
  });

  it("every stored index is the rounded score, and its class is the map colour class", () => {
    water.cells.score.forEach((s, i) => {
      const idx = water.cells.index![i];
      expect(idx).toBe(evidenceIndex(s));
      if (idx !== null) expect(classOf(idx, classes)).not.toBeNull();
    });
    expect(evidenceIndex(0.595)).toBe(60);
    expect(bandLabel(0.595)).toBe("High");
  });

  it("weighted contributions add up to the index for fully measured cells", () => {
    let checked = 0;
    water.cells.score.forEach((s, i) => {
      if (s === null || water.cells.coverage[i]! < 0.999 || checked > 400) return;
      const b = waterBreakdown(water, i);
      const sum = b.components.reduce((t, c) => t + (c.points ?? 0), 0);
      expect(Math.abs(sum - s * 100)).toBeLessThan(0.51); // score is stored to 2 decimals
      expect(b.components.map((c) => c.weight)).toEqual([0.45, 0.4, 0.15]);
      expect(b.partial).toBe(false);
      checked++;
    });
    expect(checked).toBeGreaterThan(100);
  });

  it("missing CRISM is never shown as zero: re-weighted, striped, with a range and a warning", () => {
    const i = water.cells.mineral.findIndex((m, k) => m === null && water.cells.score[k] !== null);
    const b = waterBreakdown(water, i);
    const m = b.components[0];
    expect(m.score).toBeNull();
    expect(m.points).toBeNull();
    expect(b.partial).toBe(true);
    expect(b.range![0]).toBeLessThanOrEqual(b.index!);
    expect(b.range![1]).toBeGreaterThanOrEqual(b.index!);
    expect(b.warnings.join(" ")).toMatch(/NOT counted as zero/);
    expect(b.confidence).not.toBe("Higher");
    expect(b.components[1].effectiveWeight!).toBeGreaterThan(0.4);
    const sum = b.components.reduce((t, c) => t + (c.points ?? 0), 0);
    expect(Math.abs(sum - water.cells.score[i]! * 100)).toBeLessThan(0.51);
  });

  it("the plain-language summary names the colour, its range and the index, and never says probability", () => {
    const z = water.zones[0];
    const b = breakdownAt(water, z.target[0], z.target[1])!;
    expect(b.summary).toContain(b.cls!.color_name.slice(1));
    expect(b.summary).toContain(`${b.cls!.min}-${b.cls!.max}`);
    expect(b.summary).toContain(`scores ${b.index}`);
    expect(b.summary.toLowerCase()).not.toMatch(/probab|chance|likely/);
    const none = waterBreakdown(water, water.cells.score.findIndex((s) => s === null));
    expect(none.summary).toMatch(/unknown, not low/);
  });
});
