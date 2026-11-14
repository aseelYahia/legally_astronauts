import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHALLENGE_RESOURCES } from "../components/ScienceExtras";
import {
  categoryOf,
  filterCounts,
  filterPhotos,
  galleryFor,
  photoSites,
  photosForPoi,
  placeLabel,
  placeOf,
  sampleCheck,
  stepIndex,
  unitAt,
  type GeologyFile,
  type Photo,
  type PhotosFile,
} from "./nasaExtras";

const DATA = resolve(__dirname, "../../public/data");
const read = <T,>(f: string): T | null => (existsSync(`${DATA}/${f}`) ? (JSON.parse(readFileSync(`${DATA}/${f}`, "utf-8")) as T) : null);
const photos = read<PhotosFile>("photos.json");
const geology = read<GeologyFile>("geology_units.geojson");
const pois = read<{ id: string; category: string; lon: number; lat: number; campaign?: string }[]>("pois.json") ?? [];

describe("geologic unit lookup", () => {
  const geo: GeologyFile = {
    type: "FeatureCollection",
    source: "test",
    positional_note: "",
    units: [{ symbol: "A", unit: "A", name: "Unit A", description: "d", characteristics: null, interpretation: "i", area_km2_in_aoi: 1, color: "#fff" }],
    features: [
      {
        type: "Feature",
        properties: { symbol: "A", objectid: 1 },
        geometry: { type: "MultiPolygon", coordinates: [[[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]] },
      },
    ],
  };
  it("finds the unit inside the exterior ring and not inside a hole", () => {
    expect(unitAt(geo, 2, 2)?.name).toBe("Unit A");
    expect(unitAt(geo, 5, 5)).toBeNull();
    expect(unitAt(geo, 20, 20)).toBeNull();
    expect(unitAt(null, 2, 2)).toBeNull();
  });
});

describe.skipIf(!photos)("Mars Ground View data (real NASA files)", () => {
  it("uses only NASA-hosted images with camera, sol and date metadata", () => {
    for (const p of photos!.photos) {
      expect(p.img_medium.startsWith("https://mars.nasa.gov/mars2020-raw-images/")).toBe(true);
      expect(p.nasa_page.startsWith("https://mars.nasa.gov/mars2020/multimedia/raw-images/")).toBe(true);
      expect(p.camera_label.length).toBeGreaterThan(0);
      expect(p.id).toMatch(new RegExp(`^([A-Z0-9]{3}_|[A-Z0-9]{4})${String(p.sol).padStart(4, "0")}_`)); // e.g. ZL0_0749_ or NLMV0629_
      expect(Number.isNaN(Date.parse(p.date_taken_utc))).toBe(false);
    }
  });

  it("places on the map only photos with a NASA localization, grouped per rover position", () => {
    const sites = photoSites(photos);
    const geolocated = new Set(photos!.photos.filter((p) => p.location.geolocated).map((p) => p.id));
    expect(sites.reduce((n, s) => n + s.photos.length, 0)).toBe(geolocated.size); // an image shared by two samples is one pin entry
    for (const s of sites) for (const p of s.photos) expect(p.location.rmc).toBe(s.rmc);
    for (const p of photos!.photos.filter((x) => !x.location.geolocated)) expect(placeOf(p)).toBe("not_geolocated");
    expect(photoSites(photos, 300).every((s) => s.photos.every((p) => p.sol <= 300))).toBe(true);
  });

  it("labels every photo's place only from NASA localizations", () => {
    for (const p of photos!.photos) {
      const place = placeOf(p);
      if (place === "at_site") expect(p.location.rmc).toBe(p.marker_rmc);
      if (place === "nearby" || place === "regional") {
        expect(p.location.geolocated).toBe(true);
        expect(p.location.rmc).not.toBe(p.marker_rmc);
        expect(p.distance_m).toBeGreaterThan(0);
        expect(p.distance_m!).toBeLessThanOrEqual(place === "nearby" ? photos!.selection!.thresholds.nearby_m : photos!.selection!.thresholds.regional_m);
      }
      if (place === "not_geolocated") expect(p.location.lon).toBeUndefined();
    }
  });

  it("leads every site's gallery with a terrain photo and keeps rover/sample frames aside", () => {
    for (const poi of new Set(photos!.photos.map((p) => p.poi_id!))) {
      const { terrain, other } = galleryFor(photos, poi);
      expect(terrain.length, poi).toBeGreaterThan(0);
      expect(terrain.every((p) => categoryOf(p) !== "other")).toBe(true);
      expect(other.every((p) => categoryOf(p) === "other")).toBe(true);
      expect(other.filter((p) => p.camera === "CACHECAM").length).toBeLessThanOrEqual(1);
      expect(terrain.some((p) => p.camera === "CACHECAM")).toBe(false);
    }
  });

  it("links every in-area sample to its photos and a corroborated position", () => {
    for (const p of pois.filter((x) => x.category === "sample")) {
      expect(photosForPoi(photos, p.id).length).toBeGreaterThan(0);
      expect(sampleCheck(photos, p.id)?.corroborated).toBe(true);
    }
  });
});

describe("Ground View gallery helpers", () => {
  const base = { title: "", camera_note: "", date_taken_mars: "", credit: "NASA/JPL-Caltech", caption: "", nasa_page: "", json_link: "", img_small: "", img_medium: "", img_large: "", img_full: "", thumb: "", site: 37, drive: "0", poi_name: "X", context: "" };
  const mk = (id: string, extra: Partial<Photo>): Photo => ({
    ...base,
    id,
    role: "context",
    camera: "MCZ_LEFT",
    camera_label: "Mastcam-Z (left)",
    sol: 749,
    date_taken_utc: "2023-03-30T12:00:00",
    location: { geolocated: true, rmc: "37_0", lon: 77.38, lat: 18.47 },
    poi_id: "s1",
    marker_rmc: "37_0",
    ...extra,
  });
  const file: PhotosFile = {
    source: "t",
    fetched_utc: "2026-11-14",
    note: "",
    sample_position_check: [],
    photos: [
      mk("tube", { camera: "CACHECAM", role: "sample", category: "other", rank: 4, place: "at_site" }),
      mk("rock", { category: "rocks", rank: 2, place: "at_site" }),
      mk("land", { category: "landscape", rank: 0, place: "at_site" }),
      mk("near", { category: "geology", rank: 1, place: "nearby", distance_m: 84.6, location: { geolocated: true, rmc: "36_2000", lon: 77.381, lat: 18.471 } }),
      mk("nogeo", { category: "rocks", rank: 3, place: "not_geolocated", location: { geolocated: false, rmc: "36_2010", reason: "No NASA localization exists for this site/drive." } }),
      mk("legacy", { poi_id: "s2" }),
    ],
  };

  it("orders the gallery by rank and keeps rover/sample frames out of every filter", () => {
    const { terrain, other } = galleryFor(file, "s1");
    expect(terrain.map((p) => p.id)).toEqual(["land", "near", "rock", "nogeo"]);
    expect(other.map((p) => p.id)).toEqual(["tube"]);
    expect(filterPhotos(terrain, "landscape").map((p) => p.id)).toEqual(["land"]);
    expect(filterPhotos(terrain, "rocks").map((p) => p.id)).toEqual(["rock", "nogeo"]);
    expect(filterPhotos(terrain, "geology").map((p) => p.id)).toEqual(["near"]);
    expect(filterPhotos(terrain, "all")).toHaveLength(4);
    expect(filterCounts(terrain)).toEqual({ landscape: 1, rocks: 2, geology: 1, all: 4 });
  });

  it("labels location status without inventing positions", () => {
    const [land, near, , nogeo] = galleryFor(file, "s1").terrain;
    expect(placeLabel(land)).toMatchObject({ short: "At this site", tone: "ok" });
    expect(placeLabel(land).long).toContain("37_0");
    expect(placeLabel(near)).toMatchObject({ short: "Nearby · 85 m", tone: "near" });
    expect(placeLabel(near).long).toContain("36_2000");
    expect(placeLabel(nogeo)).toMatchObject({ short: "Not geolocated", tone: "none" });
    expect(placeLabel(mk("r", { place: "regional", distance_m: 1234 })).short).toBe("Regional · 1.2 km");
  });

  it("falls back sensibly for files written before automatic categories", () => {
    const legacy = file.photos.find((p) => p.id === "legacy")!;
    expect(placeOf(legacy)).toBe("at_site");
    expect(categoryOf(legacy)).toBe("rocks");
    expect(categoryOf(mk("w", { role: "workspace" }))).toBe("other");
    expect(placeOf(mk("u", { location: { geolocated: false, rmc: null } }))).toBe("not_geolocated");
  });

  it("wraps viewer navigation in both directions", () => {
    expect(stepIndex(0, 5, -1)).toBe(4);
    expect(stepIndex(4, 5, 1)).toBe(0);
    expect(stepIndex(2, 5, 1)).toBe(3);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });
});

describe.skipIf(!geology)("USGS geologic units (real file)", () => {
  it("assigns every sample site a mapped unit, kept separate from mineral indicators", () => {
    for (const p of pois) expect(unitAt(geology, p.lon, p.lat), p.id).not.toBeNull();
    expect(geology!.units.every((u) => !/carbonate|olivine/i.test(u.symbol))).toBe(true);
  });
});

describe("official challenge resources", () => {
  it("distinguishes data integration from design inspiration", () => {
    const direct = CHALLENGE_RESOURCES.filter((r) => r.direct).map((r) => r.name);
    expect(direct).toEqual(["NASA Mars Trek", "USGS-NASA Geological Maps", "Perseverance Raw Images"]);
    for (const r of CHALLENGE_RESOURCES.filter((x) => !x.direct)) expect(r.use).toMatch(/Design reference only/);
  });
});
