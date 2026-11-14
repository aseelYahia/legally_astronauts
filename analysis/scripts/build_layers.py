"""Build PAWPRINT MARS map layers from the raw NASA/USGS data.

Outputs
  data/processed/*.npz          terrain grids used by the Python route server
  app/public/data/*.png|json    map-ready layers + manifest with provenance
"""
from __future__ import annotations

import datetime as dt
import json
import math
import pathlib
import sys

import numpy as np
import rasterio
from PIL import Image
from rasterio.windows import from_bounds

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "analysis"))
from pawprint import terrain as T  # noqa: E402
from pawprint.mars import MARS_RADIUS_M, lonlat_to_eqc  # noqa: E402
from pawprint.samples import locate_samples  # noqa: E402
from pawprint.sources import AOI, DATASETS, HIRISE_WINDOW  # noqa: E402

RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
WEB = ROOT / "app" / "public" / "data"

# Pastel elevation ramp (low -> high): violet, lavender, turquoise-mint, pink, peach
RAMP = [
    (0.00, (110, 92, 230)),
    (0.25, (160, 140, 245)),
    (0.45, (125, 220, 215)),
    (0.70, (245, 160, 205)),
    (1.00, (255, 214, 170)),
]


def ramp(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,), dtype=np.float64)
    for (t0, c0), (t1, c1) in zip(RAMP, RAMP[1:]):
        m = (t >= t0) & (t <= t1)
        f = ((t - t0) / (t1 - t0))[m][:, None]
        out[m] = np.array(c0) * (1 - f) + np.array(c1) * f
    return out


def read_window(path: pathlib.Path, box: dict):
    x0, y0 = lonlat_to_eqc(box["lon_min"], box["lat_min"])
    x1, y1 = lonlat_to_eqc(box["lon_max"], box["lat_max"])
    with rasterio.open(path) as ds:
        win = from_bounds(x0, y0, x1, y1, ds.transform).round_offsets().round_lengths()
        a = ds.read(1, window=win).astype(np.float64)
        tr = ds.window_transform(win)
        nod = ds.nodata
    if nod is not None:
        a[a == nod] = np.nan
    a[a < -1e30] = np.nan
    res = tr.a
    left, top = tr.c, tr.f
    right, bottom = left + res * a.shape[1], top - res * a.shape[0]
    deg = lambda m: math.degrees(m / MARS_RADIUS_M)  # noqa: E731
    bounds = {"lon_min": deg(left), "lon_max": deg(right), "lat_min": deg(bottom), "lat_max": deg(top)}
    # pixel-centre coordinates
    lon0 = deg(left + res / 2)
    lat0 = deg(top - res / 2)
    dlon = deg(res)
    lat_rows = lat0 - dlon * np.arange(a.shape[0])
    return a, res, bounds, lon0, lat0, dlon, lat_rows


def save_png(arr: np.ndarray, name: str) -> None:
    Image.fromarray(arr).save(WEB / name, optimize=True)
    print("  wrote", name, arr.shape)


def leaflet_bounds(b: dict) -> list:
    return [[b["lat_min"], b["lon_min"]], [b["lat_max"], b["lon_max"]]]


def elevation_rgba(dem, shade, zmin, zmax, alpha=235):
    t = (dem - zmin) / (zmax - zmin)
    rgb = ramp(np.nan_to_num(t, nan=0))
    lit = 0.55 + 0.6 * shade[..., None]  # pastel: keep it light
    rgb = np.clip(rgb * lit, 0, 255)
    a = np.where(np.isfinite(dem), alpha, 0)
    return np.dstack([rgb, a]).astype(np.uint8)


def hazard_rgba(cls: np.ndarray, upscale: int) -> np.ndarray:
    big = np.kron(cls, np.ones((upscale, upscale), dtype=np.uint8))
    h, w = big.shape
    yy, xx = np.mgrid[0:h, 0:w]
    hatch = ((xx + yy) % 8) < 3
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    pink = (255, 79, 163)
    hot = (255, 40, 120)
    m2 = big == 2
    m3 = big == 3
    rgba[m2] = (*pink, 70)
    rgba[m2 & hatch] = (*pink, 170)
    rgba[m3] = (*hot, 120)
    rgba[m3 & hatch] = (*hot, 230)
    return rgba


def contours_rgba(dem: np.ndarray, interval: float, upscale: int) -> np.ndarray:
    h, w = dem.shape
    filled = np.where(np.isfinite(dem), dem, np.nanmean(dem)).astype(np.float32)
    big = np.asarray(Image.fromarray(filled, mode="F").resize((w * upscale, h * upscale), Image.BILINEAR))
    band = np.floor(big / interval)
    edge = np.zeros(big.shape, dtype=bool)
    edge[:-1, :] |= band[:-1, :] != band[1:, :]
    edge[:, :-1] |= band[:, :-1] != band[:, 1:]
    major = np.floor(big / (interval * 5))
    medge = np.zeros(big.shape, dtype=bool)
    medge[:-1, :] |= major[:-1, :] != major[1:, :]
    medge[:, :-1] |= major[:, :-1] != major[:, 1:]
    rgba = np.zeros(big.shape + (4,), dtype=np.uint8)
    rgba[edge] = (240, 235, 255, 110)
    rgba[medge] = (255, 255, 255, 210)
    return rgba


def grid_npz(name, dem, slope, res, lon0, lat0, dlon, lat_rows, resolution_m):
    np.savez_compressed(
        PROC / f"{name}_grid.npz",
        elevation=dem.astype(np.float32),
        slope=slope.astype(np.float32),
        dx_rows=T.row_ground_dx(res, lat_rows),
        dy=np.float64(res),
        lon0=np.float64(lon0),
        lat0=np.float64(lat0),
        dlon=np.float64(dlon),
        dlat=np.float64(dlon),
        resolution_m=np.float64(resolution_m),
    )
    print("  wrote", f"{name}_grid.npz", dem.shape)


def sample_grid(dem, lon0, lat0, dlon, lon, lat):
    c = int(round((lon - lon0) / dlon))
    r = int(round((lat0 - lat) / dlon))
    if 0 <= r < dem.shape[0] and 0 <= c < dem.shape[1]:
        v = dem[r, c]
        return float(v) if np.isfinite(v) else None
    return None


def in_box(lon, lat, b):
    return b["lon_min"] <= lon <= b["lon_max"] and b["lat_min"] <= lat <= b["lat_max"]


def main() -> None:
    PROC.mkdir(parents=True, exist_ok=True)
    WEB.mkdir(parents=True, exist_ok=True)
    manifest: dict = {
        "generated_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "crs": {
            "projection": "Equidistant Cylindrical (lat_ts=0, lon_0=0)",
            "body": "Mars",
            "radius_m": MARS_RADIUS_M,
            "latitude": "planetocentric",
            "longitude": "east-positive, 0-360",
            "elevation_datum": "Mars areoid (MOLA geoid)",
        },
        "aoi": AOI,
        "layers": {},
        "datasets": DATASETS,
        "assumptions": {
            "slope_classes_deg": T.SLOPE_CLASSES_DEG,
            "default_max_slope_deg": T.DEFAULT_MAX_SLOPE_DEG,
            "note": "Slope classes and the EVA walking model are PAWPRINT planning assumptions, not NASA requirements.",
        },
    }

    # ---------------- CTX DTM (20 m) ----------------
    print("CTX DTM")
    dem, res, b, lon0, lat0, dlon, lat_rows = read_window(RAW / DATASETS["ctx_dtm"]["file"], AOI)
    dx_rows = T.row_ground_dx(res, lat_rows)
    slope, aspect = T.slope_aspect(dem, dx_rows, res)
    rough = T.roughness_rms(dem)
    shade = T.hillshade(dem, dx_rows, res)
    cls = T.hazard_class(slope)
    zmin, zmax = float(np.nanpercentile(dem, 0.5)), float(np.nanpercentile(dem, 99.5))
    zmin, zmax = math.floor(zmin / 10) * 10, math.ceil(zmax / 10) * 10
    save_png(elevation_rgba(dem, shade, zmin, zmax), "ctx_elevation.png")
    save_png(hazard_rgba(cls, 4), "ctx_slope_hazard.png")
    save_png(contours_rgba(dem, 10.0, 4), "ctx_contours.png")
    grid_npz("ctx", dem, slope, res, lon0, lat0, dlon, lat_rows, 20.0)
    valid = np.isfinite(slope)
    ctx_stats = {
        "shape": list(dem.shape),
        "elevation_min_m": float(np.nanmin(dem)),
        "elevation_max_m": float(np.nanmax(dem)),
        "slope_mean_deg": float(np.nanmean(slope)),
        "slope_p95_deg": float(np.nanpercentile(slope, 95)),
        "slope_max_deg": float(np.nanmax(slope)),
        "roughness_mean_m": float(np.nanmean(rough)),
        "slope_class_fraction": {
            k: float(np.mean(cls[valid] == i)) for i, k in enumerate(["easy", "moderate", "hazard", "nogo"])
        },
    }
    manifest["layers"]["elevation"] = {
        "file": "ctx_elevation.png", "bounds": leaflet_bounds(b), "kind": "real-derived",
        "source": "ctx_dtm", "legend": {"min_m": zmin, "max_m": zmax, "ramp": RAMP}, "stats": ctx_stats,
    }
    manifest["layers"]["contours"] = {"file": "ctx_contours.png", "bounds": leaflet_bounds(b), "kind": "real-derived",
                                      "source": "ctx_dtm", "interval_m": 10, "major_m": 50}
    manifest["layers"]["slope"] = {"file": "ctx_slope_hazard.png", "bounds": leaflet_bounds(b), "kind": "real-derived",
                                   "source": "ctx_dtm", "classes_deg": T.SLOPE_CLASSES_DEG}

    # ---------------- CTX ortho (6 m) ----------------
    print("CTX ortho")
    img, _, ob, *_ = read_window(RAW / DATASETS["ctx_ortho"]["file"], AOI)
    lo, hi = np.nanpercentile(img, 0.5), np.nanpercentile(img, 99.5)
    g = np.clip((img - lo) / (hi - lo), 0, 1)
    g8 = np.where(np.isfinite(img), (g * 255), 0).astype(np.uint8)
    save_png(np.dstack([g8, g8, g8, np.where(np.isfinite(img), 255, 0).astype(np.uint8)]), "ctx_ortho.png")
    manifest["layers"]["terrain"] = {"file": "ctx_ortho.png", "bounds": leaflet_bounds(ob), "kind": "real", "source": "ctx_ortho",
                                     "note": "Contrast-stretched (0.5-99.5 percentile) for display."}

    # ---------------- HiRISE DTM window (1 m) ----------------
    hfile = RAW / DATASETS["hirise_dtm"]["file"]
    hdem4 = None
    if hfile.exists():
        print("HiRISE DTM")
        h1, hres, hb, hlon0, hlat0, hdlon, hlat_rows = read_window(hfile, HIRISE_WINDOW)
        # 2 m display / analysis grid (block mean of 1 m posts)
        h2 = T.block_reduce(h1, 2, "mean")
        h2_lat_rows = hlat0 - hdlon * (np.arange(h2.shape[0]) * 2 + 0.5)
        h2_dx = T.row_ground_dx(2 * hres, h2_lat_rows)
        s2, _ = T.slope_aspect(h2, h2_dx, 2 * hres)
        sh2 = T.hillshade(h2, h2_dx, 2 * hres)
        c2 = T.hazard_class(s2)
        save_png(elevation_rgba(h2, sh2, zmin, zmax, alpha=255), "hirise_elevation.png")
        save_png(hazard_rgba(c2, 1), "hirise_slope_hazard.png")
        hbounds = {"lon_min": hb["lon_min"], "lat_max": hb["lat_max"],
                   "lon_max": hb["lon_min"] + h2.shape[1] * 2 * hdlon, "lat_min": hb["lat_max"] - h2.shape[0] * 2 * hdlon}
        # 4 m routing grid: mean elevation, conservative (max) slope of the 2 m posts
        hdem4 = T.block_reduce(h2, 2, "mean")
        hs4 = T.block_reduce(s2, 2, "max")
        lon0_4 = hb["lon_min"] + 2 * hdlon
        lat0_4 = hb["lat_max"] - 2 * hdlon
        lat_rows4 = lat0_4 - 4 * hdlon * np.arange(hdem4.shape[0])
        grid_npz("hirise", hdem4, hs4, 4 * hres, lon0_4, lat0_4, 4 * hdlon, lat_rows4, 4.0)
        hvalid = np.isfinite(s2)
        # cross-check HiRISE vs CTX on the CTX grid
        diffs = []
        for r in range(0, dem.shape[0]):
            for c in range(0, dem.shape[1]):
                lon, lat = lon0 + c * dlon, lat0 - r * dlon
                if in_box(lon, lat, hbounds) and np.isfinite(dem[r, c]):
                    hv = sample_grid(h2, hb["lon_min"] + hdlon, hb["lat_max"] - hdlon, 2 * hdlon, lon, lat)
                    if hv is not None:
                        diffs.append(hv - dem[r, c])
        diffs = np.array(diffs)
        manifest["layers"]["hirise_elevation"] = {
            "file": "hirise_elevation.png", "bounds": leaflet_bounds(hbounds), "kind": "real-derived", "source": "hirise_dtm",
            "stats": {
                "shape_1m": list(h1.shape),
                "elevation_min_m": float(np.nanmin(h1)), "elevation_max_m": float(np.nanmax(h1)),
                "slope_mean_deg_2m": float(np.nanmean(s2)), "slope_p95_deg_2m": float(np.nanpercentile(s2, 95)),
                "slope_class_fraction_2m": {k: float(np.mean(c2[hvalid] == i)) for i, k in enumerate(["easy", "moderate", "hazard", "nogo"])},
            },
        }
        manifest["layers"]["hirise_slope"] = {"file": "hirise_slope_hazard.png", "bounds": leaflet_bounds(hbounds),
                                              "kind": "real-derived", "source": "hirise_dtm"}
        manifest["validation_hirise_vs_ctx"] = {
            "n": int(diffs.size), "median_m": float(np.median(diffs)), "mad_m": float(np.median(np.abs(diffs - np.median(diffs)))),
            "p05_m": float(np.percentile(diffs, 5)), "p95_m": float(np.percentile(diffs, 95)),
            "usgs_reported_median_offset_m": -0.4,
        }
    else:
        print("HiRISE window not present; skipping")

    # ---------------- Rover traverse + waypoints ----------------
    print("Rover data")
    trav = json.load(open(RAW / DATASETS["rover_traverse"]["file"], encoding="utf-8"))
    feats = []
    for f in trav["features"]:
        coords = [(x, y) for x, y, *_ in f["geometry"]["coordinates"] if in_box(x, y, AOI)]
        if len(coords) < 2:
            continue
        simp = [coords[0]]
        for x, y in coords[1:]:
            px, py = simp[-1]
            if math.hypot((x - px) * math.cos(math.radians(y)), y - py) * 59274.7 > 2.0:
                simp.append((x, y))
        if len(simp) < 2:
            simp.append(coords[-1])
        feats.append({"type": "Feature", "properties": {"sol": f["properties"]["sol"], "length_m": f["properties"].get("length")},
                      "geometry": {"type": "LineString", "coordinates": [[round(x, 7), round(y, 7)] for x, y in simp]}})
    (WEB / "rover_traverse.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    sols = [f["properties"]["sol"] for f in feats]
    manifest["layers"]["rover"] = {"file": "rover_traverse.geojson", "kind": "real", "source": "rover_traverse",
                                   "sol_min": min(sols), "sol_max": max(sols), "segments": len(feats)}
    print("  traverse segments in AOI:", len(feats))

    wp = [f["properties"] for f in json.load(open(RAW / DATASETS["rover_waypoints"]["file"], encoding="utf-8"))["features"]]
    # Validate CTX DTM against rover-localized elevations (independent NASA measurement)
    d = []
    for p in wp:
        if in_box(p["lon"], p["lat"], AOI) and p.get("elev_geoid") is not None:
            v = sample_grid(dem, lon0, lat0, dlon, p["lon"], p["lat"])
            if v is not None:
                d.append(v - p["elev_geoid"])
    d = np.array(d)
    if hdem4 is not None:
        dh = []
        for p in wp:
            if p.get("elev_geoid") is None or not in_box(p["lon"], p["lat"], hbounds):
                continue
            v = sample_grid(h1, hlon0, hlat0, hdlon, p["lon"], p["lat"])  # 1 m posts
            if v is not None:
                dh.append(v - p["elev_geoid"])
        dh = np.array(dh)
        if dh.size:
            manifest["validation_hirise_vs_rover"] = {
                "n": int(dh.size), "median_m": float(np.median(dh)), "mad_m": float(np.median(np.abs(dh - np.median(dh)))),
                "p05_m": float(np.percentile(dh, 5)), "p95_m": float(np.percentile(dh, 95)),
                "note": "HiRISE 1 m DTM at each rover localization minus the rover's elev_geoid. The ~cm agreement indicates NASA's "
                "localizations are referenced to this HiRISE DTM, so this is a consistency check of our windowing, georeferencing "
                "and datum, not an independent accuracy estimate.",
            }
            print("  HiRISE vs rover elevation:", manifest["validation_hirise_vs_rover"])
    manifest["validation_ctx_vs_rover"] = {
        "n": int(d.size), "median_m": float(np.median(d)), "mad_m": float(np.median(np.abs(d - np.median(d)))),
        "p05_m": float(np.percentile(d, 5)), "p95_m": float(np.percentile(d, 95)),
        "note": "CTX DTM at each rover localization minus the rover's elev_geoid (NASA MMGIS). Rover elevations appear tied to the "
        "HiRISE TRN DTM, so this effectively measures CTX-vs-HiRISE agreement along the traverse.",
    }
    print("  CTX vs rover elevation:", manifest["validation_ctx_vs_rover"])

    # ---------------- POIs ----------------
    samples = [s for s in locate_samples(wp) if in_box(s["lon"], s["lat"], AOI)]
    first = min(wp, key=lambda p: (p["sol"], p.get("dist_total_m", 0)))
    pois = [{
        "id": "landing", "name": "Octavia E. Butler Landing", "category": "landing",
        "lon": first["lon"], "lat": first["lat"], "elev_geoid_m": first.get("elev_geoid"),
        "description": "Perseverance touchdown site, 18 Feb 2021. Position is the rover's first NASA localization (sol "
        f"{first['sol']}, RMC {first.get('RMC')}).",
        "position_quality": "measured",
    }]
    for s in samples:
        s["category"] = "sample"
        s["elev_ctx_m"] = sample_grid(dem, lon0, lat0, dlon, s["lon"], s["lat"])
        pois.append(s)
    (WEB / "pois.json").write_text(json.dumps(pois, ensure_ascii=False, indent=1), encoding="utf-8")
    manifest["layers"]["geology"] = {"file": "pois.json", "kind": "real (positions estimated)", "source": "samples", "count": len(pois)}
    print("  POIs:", len(pois))

    # ---------------- Weather ----------------
    wx = json.load(open(RAW / DATASETS["meda_weather"]["file"], encoding="utf-8"))
    num = lambda v: v if isinstance(v, (int, float)) else None  # noqa: E731
    rows = [{"sol": int(s["sol"]), "earth_date": s["terrestrial_date"], "ls_deg": float(s["ls"]), "season": s["season"],
             "min_temp_c": num(s["min_temp"]), "max_temp_c": num(s["max_temp"]), "pressure_pa": num(s["pressure"]),
             "sunrise_lmst": s["sunrise"], "sunset_lmst": s["sunset"]} for s in wx["sols"]]
    fetched = (RAW / "fetched_at_nasa_json.txt").read_text().strip() if (RAW / "fetched_at_nasa_json.txt").exists() else None
    (WEB / "weather.json").write_text(json.dumps({"source": "meda_weather", "fetched_utc": fetched, "sols": rows}, indent=1), encoding="utf-8")
    manifest["layers"]["weather"] = {"file": "weather.json", "kind": "real", "source": "meda_weather", "latest_sol": rows[-1]["sol"]}

    (WEB / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print("manifest written")


if __name__ == "__main__":
    main()
