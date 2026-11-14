"""Fetch and process the official-challenge NASA/USGS resources for PAWPRINT MARS.

Run AFTER build_layers.py (it merges into app/public/data/manifest.json):
    python analysis/scripts/build_nasa_extras.py [photos] [geology] [crism] [hirise]

  photos  - Perseverance raw images (Mars Ground View), geolocated only by exact NASA RMC match
  geology - USGS SIM 3464 geologic units clipped to the AOI (USGS ArcGIS feature service)
  crism   - CRISM MTRDR "SR" summary parameters: HTTP range reads of the needed bands/rows only
  hirise  - Mars Trek HiRISE controlled orthomosaic tiles over the HiRISE DTM window

Downloads are cached under data/raw/extras/. Nothing here invents values: every number written to the app
comes from a NASA/USGS response or is a documented PAWPRINT assumption (CRISM indicator thresholds).
"""
from __future__ import annotations

import datetime as dt
import io
import json
import math
import pathlib
import ssl
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image
from rasterio.crs import CRS
from rasterio.warp import transform as warp_transform

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "analysis"))
from pawprint import crism as C  # noqa: E402
from pawprint import geology as G  # noqa: E402
from pawprint import photos as P  # noqa: E402
from pawprint.sources import AOI, EXTRA_DATASETS, HIRISE_WINDOW  # noqa: E402

RAW = ROOT / "data" / "raw" / "extras"
PROC = ROOT / "data" / "processed"
WEB = ROOT / "app" / "public" / "data"
UA = "PAWPRINT-MARS/1.0 (NASA Space Apps educational prototype)"


# ---------------------------------------------------------------------------- fetching
def fetch(url: str, rng: tuple[int, int] | None = None, timeout: int = 120) -> bytes:
    """GET with an optional byte range. Falls back to the OS curl when Python's OpenSSL cannot build the
    server's certificate chain (WUSTL PDS servers omit an intermediate certificate)."""
    headers = {"User-Agent": UA}
    if rng:
        headers["Range"] = f"bytes={rng[0]}-{rng[1]}"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
                data = r.read()
            if rng and len(data) != rng[1] - rng[0] + 1:
                raise IOError(f"range returned {len(data)} bytes")
            return data
        except (ssl.SSLError, urllib.error.URLError) as e:
            if isinstance(e, urllib.error.HTTPError) and e.code in (403, 404):
                raise
            if "CERTIFICATE" in str(e).upper():
                return _curl(url, rng, timeout)
            time.sleep(2 * (attempt + 1))
    raise IOError(f"failed: {url}")


def _curl(url, rng, timeout) -> bytes:
    exe = r"C:\Windows\System32\curl.exe" if sys.platform == "win32" else "curl"
    cmd = [exe, "-sS", "--fail", "-m", str(timeout), "-A", UA, url]
    if rng:
        cmd[1:1] = ["-r", f"{rng[0]}-{rng[1]}"]
    return subprocess.run(cmd, check=True, capture_output=True).stdout


def cached_json(name: str, url: str) -> dict:
    f = RAW / name
    if not f.exists():
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(fetch(url))
    return json.loads(f.read_text(encoding="utf-8"))


def merge_manifest(layer_key: str, layer: dict, dataset_keys: list[str]) -> None:
    mf = WEB / "manifest.json"
    m = json.loads(mf.read_text(encoding="utf-8"))
    m["layers"][layer_key] = layer
    for k in dataset_keys:
        m["datasets"][k] = EXTRA_DATASETS[k]
    m.setdefault("extras_generated_utc", {})[layer_key] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    mf.write_text(json.dumps(m, indent=1, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------- photos
RAW_FEED = "https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol={sol}"


def build_photos() -> None:
    print("Mars Ground View (Perseverance raw images)")
    wps = json.loads((ROOT / "data/raw/M20_waypoints.json").read_text(encoding="utf-8"))["features"]
    by_rmc = {f["properties"]["RMC"]: f["properties"] for f in wps}
    pois = json.loads((WEB / "pois.json").read_text(encoding="utf-8"))
    thumbs, raw_thumbs = WEB / "photos", RAW / "raw_thumbs"
    thumbs.mkdir(exist_ok=True)
    raw_thumbs.mkdir(parents=True, exist_ok=True)

    def sol_images(sol: int) -> list[dict]:
        return cached_json(f"raw_images/sol_{sol:05d}.json", RAW_FEED.format(sol=sol)).get("images", [])

    def stats_for(imgs: list[dict]) -> dict:
        def one(i):
            f = raw_thumbs / f"{i['imageid']}.jpg"
            if not f.exists():
                f.write_bytes(fetch(i["image_files"]["small"]))
            return i["imageid"], P.image_stats(f.read_bytes())
        with ThreadPoolExecutor(8) as ex:
            return dict(ex.map(one, imgs))

    out, counts = P.build_selection(pois, by_rmc, sol_images, stats_for)
    for rec in out:  # NASA's own 320 px browse JPEG, copied unchanged
        tf = thumbs / f"{rec['id']}.jpg"
        if not tf.exists():
            tf.write_bytes((raw_thumbs / tf.name).read_bytes())
        rec["thumb"] = f"photos/{tf.name}"
    keep = {pathlib.Path(r["thumb"]).name for r in out}
    for f in thumbs.glob("*.jpg"):
        if f.name not in keep:
            f.unlink()
    corroboration = []
    for poi in pois:  # Does NASA image metadata corroborate the sample marker's localization?
        if poi.get("category") != "sample":
            continue
        sol = poi["sol_sealed"]
        marker_rmc = P.marker_rmc(poi)
        sol_rmcs = sorted({P.rmc_of(i) for i in sol_images(sol) if P.rmc_of(i)})
        corroboration.append({"poi_id": poi["id"], "name": poi["name"], "sol": sol, "marker_rmc": marker_rmc,
                              "image_rmcs_on_sealing_sol": sol_rmcs, "corroborated": marker_rmc in sol_rmcs})
    for poi in pois:
        mine = [r for r in out if r["poi_id"] == poi["id"]]
        cats = ", ".join(f"{c}:{sum(r['category'] == c for r in mine)}" for c in P.CATEGORIES)
        places = ", ".join(f"{p}:{sum(r['place'] == p for r in mine)}" for p in P.PLACES)
        print(f"  {poi['name']:<26} {len(mine):>3} photos ({cats}; {places})")
    data = {
        "source": "NASA Mars 2020 raw-image feed (mars.nasa.gov/rss/api, feed=raw_images)",
        "fetched_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "note": "Raw, unprocessed rover images. A geolocated photo is placed at the ROVER's NASA localization for the "
                "image's site/drive; the camera may be looking tens to hundreds of metres away. Rover camera heights "
                "(about 1-2 m) are not an astronaut's eye level.",
        "selection": {**P.SELECTION_DOC, "candidates": counts["candidates"], "candidates_by_category": counts["by_category"]},
        "photos": out,
        "sample_position_check": corroboration,
    }
    (WEB / "photos.json").write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    n_geo = sum(1 for p in out if p["location"]["geolocated"])
    n_cor = sum(1 for c in corroboration if c["corroborated"])
    print(f"  {len(out)} photos ({n_geo} geolocated) from {counts['candidates']} candidates; "
          f"sample markers corroborated by sealing-sol image RMC: {n_cor}/{len(corroboration)}")
    merge_manifest("photos", {"file": "photos.json", "kind": "real", "source": "m2020_raw_images", "count": len(out),
                              "geolocated": n_geo}, ["m2020_raw_images"])


# ---------------------------------------------------------------------------- geology
GEO_SVC = "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer/8/query"
MARS_LONLAT = CRS.from_proj4("+proj=longlat +R=3396190 +no_defs")

# Soft Cosmic pastel palette; assigned per unit in order of area.
GEO_COLORS = ["#A99BDD", "#76C9C2", "#D98EBA", "#E6C79C", "#9FB8E8", "#C6A6E0", "#8FD3A7", "#F0B59A", "#B8C4D6", "#E3A3C7", "#7FB3C9", "#CDB6A0"]


def build_geology() -> None:
    print("USGS SIM 3464 geologic units")
    meta = cached_json("geology/layer8.json", GEO_SVC.replace("/query", "?f=json"))
    mtm = CRS.from_wkt(meta["extent"]["spatialReference"]["wkt"]) if "wkt" in meta.get("extent", {}).get("spatialReference", {}) else None
    if mtm is None:
        svc = cached_json("geology/service.json", GEO_SVC.replace("/8/query", "?f=json"))
        mtm = CRS.from_wkt(svc["spatialReference"]["wkt"])
    # AOI envelope in the service's Mars Transverse Mercator metres (pad 1 km)
    lons = [AOI["lon_min"], AOI["lon_max"], AOI["lon_min"], AOI["lon_max"]]
    lats = [AOI["lat_min"], AOI["lat_min"], AOI["lat_max"], AOI["lat_max"]]
    xs, ys = warp_transform(MARS_LONLAT, mtm, lons, lats)
    env = f"{min(xs) - 1000},{min(ys) - 1000},{max(xs) + 1000},{max(ys) + 1000}"
    q = urllib.parse.urlencode({
        "where": "1=1", "geometry": env, "geometryType": "esriGeometryEnvelope", "spatialRel": "esriSpatialRelIntersects",
        "outFields": "OBJECTID,unit,name,symbol,Unit_Description,Additional_Characteristics,Unit_Interpretation",
        "returnGeometry": "true", "f": "json",
    })
    resp = cached_json("geology/units_aoi.json", f"{GEO_SVC}?{q}")
    feats = resp.get("features", [])
    box = (AOI["lon_min"], AOI["lat_min"], AOI["lon_max"], AOI["lat_max"])
    out_feats, units = [], {}
    for f in feats:
        a = f["attributes"]
        rings_ll = []
        for ring in f["geometry"]["rings"]:
            rx, ry = zip(*ring)
            lo, la = warp_transform(mtm, MARS_LONLAT, list(rx), list(ry))
            clipped = G.clip_ring(list(zip(lo, la)), box)
            if clipped:
                rings_ll.append([(round(x, 6), round(y, 6)) for x, y in clipped])
        polys = G.esri_rings_to_polygons(rings_ll)
        if not polys:
            continue
        sym = a.get("symbol") or a.get("unit")
        km2_per_deg2 = (59274.7 ** 2) * math.cos(math.radians(18.46)) / 1e6
        area_km2 = sum(G.polygon_area(p) for p in polys) * km2_per_deg2
        u = units.setdefault(sym, {"symbol": sym, "unit": a.get("unit"), "name": a.get("name"),
                                   "description": a.get("Unit_Description"), "characteristics": a.get("Additional_Characteristics"),
                                   "interpretation": a.get("Unit_Interpretation"), "area_km2_in_aoi": 0.0})
        u["area_km2_in_aoi"] += area_km2
        out_feats.append({"type": "Feature", "properties": {"symbol": sym, "objectid": a.get("OBJECTID")},
                          "geometry": {"type": "MultiPolygon",
                                       "coordinates": [[[list(pt) for pt in r] for r in p] for p in polys]}})
    ordered = sorted(units.values(), key=lambda u: -u["area_km2_in_aoi"])
    for i, u in enumerate(ordered):
        u["color"] = GEO_COLORS[i % len(GEO_COLORS)]
        u["area_km2_in_aoi"] = round(u["area_km2_in_aoi"], 2)
    gj = {"type": "FeatureCollection", "units": ordered, "features": out_feats,
          "source": "USGS SIM 3464 (Sun & Stack 2020) via USGS ArcGIS feature service, layer 8",
          "positional_note": "Drawn on a semi-controlled CTX mosaic; USGS states random offsets of about 100-200 m "
                             "relative to the Mars 2020 controlled CTX mosaic used for the PAWPRINT basemap."}
    (WEB / "geology_units.geojson").write_text(json.dumps(gj, ensure_ascii=False), encoding="utf-8")
    print(f"  {len(feats)} unit polygons intersect the AOI query; {len(out_feats)} kept after clipping; {len(units)} units")
    for u in ordered:
        print(f"   {u['symbol']:<8} {u['area_km2_in_aoi']:>7.2f} km2  {u['name']}")
    merge_manifest("geologic_units", {"file": "geology_units.geojson", "kind": "real", "source": "usgs_sim3464",
                                      "count": len(out_feats), "units": len(units)}, ["usgs_sim3464"])


# ---------------------------------------------------------------------------- CRISM
CRISM_PRODUCTS = [
    # (product id, PDS path stem) - SR (refined summary) cubes; order = display priority (lower emission angle first)
    ("FRT000047A3_07_SR166J_MTR3", "2007/2007_057/frt000047a3/frt000047a3_07_sr166j_mtr3"),
    ("FRT0001FB74_07_SR166J_MTR3", "2011/2011_226/frt0001fb74/frt0001fb74_07_sr166j_mtr3"),
    ("FRT00005C5E_07_SR166J_MTR3", "2007/2007_139/frt00005c5e/frt00005c5e_07_sr166j_mtr3"),
]
PDS_MTRDR = "https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_4001/mtrdr/"
CRISM_OUT_RES_DEG = 18.0 / 59274.7  # ~18 m output grid in lon/lat (matches CRISM sampling)
ODE_QUERY = ("https://oderest.rsl.wustl.edu/live2/?query=product&target=mars&results=copm&ihid=MRO&iid=CRISM&pt=MTRDR"
             f"&westernlon={AOI['lon_min']}&easternlon={AOI['lon_max']}&minlat={AOI['lat_min']}&maxlat={AOI['lat_max']}"
             "&output=JSON&limit=100")


def read_crism_product(pid: str, stem: str) -> dict:
    d = RAW / "crism" / pid
    d.mkdir(parents=True, exist_ok=True)
    for ext in ("hdr", "lbl"):
        f = d / f"{pid.lower()}.{ext}"
        if not f.exists():
            f.write_bytes(fetch(PDS_MTRDR + f"{stem}.{ext}"))
    hdr = C.parse_envi_header((d / f"{pid.lower()}.hdr").read_text(encoding="latin-1"))
    lbl = (d / f"{pid.lower()}.lbl").read_text(encoding="latin-1")
    assert hdr["interleave"] == "bsq" and hdr["data type"] == 4 and hdr["byte order"] == 0, hdr
    grid = C.CrismGrid(hdr)
    # rows covering the AOI (plus 2 px margin)
    r_top, _ = grid.lonlat_to_px(AOI["lon_min"], AOI["lat_max"])
    r_bot, _ = grid.lonlat_to_px(AOI["lon_min"], AOI["lat_min"])
    r0 = max(0, int(math.floor(r_top)) - 2)
    r1 = min(hdr["lines"] - 1, int(math.ceil(r_bot)) + 2)
    params = {}
    row_bytes = hdr["samples"] * 4
    band_bytes = row_bytes * hdr["lines"]
    total = 0
    for p in C.PARAMS:
        b = hdr["band_names"].index(p)
        f = d / f"{p}_rows{r0}-{r1}.f32"
        if not f.exists():
            start = hdr.get("header offset", 0) + b * band_bytes + r0 * row_bytes
            f.write_bytes(fetch(PDS_MTRDR + f"{stem}.img", (start, start + (r1 - r0 + 1) * row_bytes - 1)))
        total += f.stat().st_size
        a = np.frombuffer(f.read_bytes(), dtype="<f4").reshape(r1 - r0 + 1, hdr["samples"]).astype(np.float64)
        a[(a == C.CRISM_IGNORE) | ~np.isfinite(a)] = np.nan
        params[p] = a

    def lbl_val(key):
        import re
        m = re.search(rf"^\s*{key}\s*=\s*\"?([^\"\r\n]+)", lbl, re.M)
        return m.group(1).strip() if m else None

    return {"pid": pid, "hdr": hdr, "grid": grid, "r0": r0, "params": params, "bytes": total,
            "start_time": lbl_val("START_TIME"), "observation_id": pid[:11],
            "url": PDS_MTRDR + stem + ".img", "label_url": PDS_MTRDR + stem + ".lbl"}


def ctx_albedo_on_grid(LON: np.ndarray, LAT: np.ndarray) -> np.ndarray:
    """CTX orthoimage (6 m) averaged 3x3 onto the 18 m lon/lat grid: the registration reference."""
    import rasterio
    from pawprint.mars import MARS_RADIUS_M
    with rasterio.open(ROOT / "data/raw/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif") as ds:
        x, y = np.radians(LON) * MARS_RADIUS_M, np.radians(LAT) * MARS_RADIUS_M
        c = ((x - ds.bounds.left) / 6.0).astype(int)
        r = ((ds.bounds.top - y) / 6.0).astype(int)
        r0, c0 = r.min() - 2, c.min() - 2
        img = ds.read(1, window=((r0, r.max() + 3), (c0, c.max() + 3))).astype(float)
    img[img == 0] = np.nan
    acc, n = np.zeros(LON.shape), np.zeros(LON.shape)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            v = img[r - r0 + dr, c - c0 + dc]
            ok = np.isfinite(v)
            acc[ok] += v[ok]
            n[ok] += 1
    return np.where(n > 0, acc / np.maximum(n, 1), np.nan)


def sample_product(p: dict, LON: np.ndarray, LAT: np.ndarray, name: str) -> np.ndarray:
    row, col = p["grid"].lonlat_to_px(LON, LAT)
    ri = np.round(row).astype(int) - p["r0"]
    ci = np.round(col).astype(int)
    a = p["params"][name]
    ok = (ri >= 0) & (ri < a.shape[0]) & (ci >= 0) & (ci < a.shape[1])
    out = np.full(LON.shape, np.nan)
    out[ok] = a[ri[ok], ci[ok]]
    return out


CRISM_REG_MAX_PX = 30  # search radius for co-registration, output pixels (~540 m)
CRISM_REG_MIN_CORR = 0.3


def coregister(p: dict, LON, LAT, ctx_ref: np.ndarray, d: float) -> dict:
    """Find the lon/lat shift that best aligns this product's R770 albedo with the CTX basemap
    (band-pass 54-560 m, Pearson correlation, exhaustive integer search)."""
    from numpy.lib.stride_tricks import sliding_window_view as sw
    m = CRISM_REG_MAX_PX

    def band(u):
        f = np.where(np.isfinite(u), u, np.nanmean(u))
        lo = sw(np.pad(f, 1, mode="edge"), (3, 3)).mean(axis=(2, 3))
        bg = sw(np.pad(f, 15, mode="edge"), (31, 31)).mean(axis=(2, 3))
        return np.where(np.isfinite(u), lo - bg, np.nan)

    # sample the product on a grid padded by m pixels so shifted windows stay inside it
    pad_lon = np.arange(LON[0, 0] - m * d, LON[0, -1] + (m + 0.5) * d, d)[: LON.shape[1] + 2 * m]
    pad_lat = np.arange(LAT[0, 0] + m * d, LAT[-1, 0] - (m + 0.5) * d, -d)[: LAT.shape[0] + 2 * m]
    PL, PT = np.meshgrid(pad_lon, pad_lat)
    A = band(sample_product(p, PL, PT, "R770"))
    B = band(ctx_ref)
    H, W = B.shape
    zero = None
    best = (-2.0, 0, 0)
    for dy in range(-m, m + 1):
        for dx in range(-m, m + 1):
            a = A[m + dy: m + dy + H, m + dx: m + dx + W]
            ok = np.isfinite(a) & np.isfinite(B)
            if ok.sum() < 2000:
                continue
            cc = float(np.corrcoef(a[ok], B[ok])[0, 1])
            if dy == 0 and dx == 0:
                zero = cc
            if cc > best[0]:
                best = (cc, dy, dx)
    cc, dy, dx = best
    accepted = cc >= CRISM_REG_MIN_CORR and abs(dy) < m and abs(dx) < m
    return {"corr_before": None if zero is None else round(zero, 3), "corr_after": round(cc, 3),
            "shift_px": [dy, dx], "accepted": accepted,
            "shift_m_north_south": dy * 18, "shift_m_east_west": round(dx * 18 * math.cos(math.radians(18.46)))}


def build_crism() -> None:
    print("CRISM MTRDR summary parameters")
    prods = [read_crism_product(pid, stem) for pid, stem in CRISM_PRODUCTS]
    for p in prods:
        print(f"  {p['pid']}: rows {p['r0']}+{next(iter(p['params'].values())).shape[0]}, {p['bytes'] / 1e6:.1f} MB read, start {p['start_time']}")
    # output lon/lat grid over the AOI, pixel centres
    d = CRISM_OUT_RES_DEG
    lons = np.arange(AOI["lon_min"] + d / 2, AOI["lon_max"], d)
    lats = np.arange(AOI["lat_max"] - d / 2, AOI["lat_min"], -d)
    LON, LAT = np.meshgrid(lons, lats)
    H, W = LON.shape
    ctx_ref = ctx_albedo_on_grid(LON, LAT)
    src = np.full((H, W), -1, dtype=np.int8)  # product index per output pixel (-1 = no measurement)
    vals = {p: np.full((H, W), np.nan) for p in C.PARAMS}
    for k, p in enumerate(prods):
        reg = coregister(p, LON, LAT, ctx_ref, d)
        p["registration"] = reg
        print(f"  {p['pid']} co-registration: corr {reg['corr_before']} -> {reg['corr_after']} at shift {reg['shift_px']} px "
              f"({reg['shift_m_north_south']} m N-S, {reg['shift_m_east_west']} m E-W), accepted={reg['accepted']}")
        dy, dx = reg["shift_px"] if reg["accepted"] else (0, 0)
        # CRISM content seen at output pixel (i+dy, j+dx) belongs at (i, j)
        SLON, SLAT = LON + dx * d, LAT - dy * d
        a0 = sample_product(p, SLON, SLAT, "R770")
        take = np.isfinite(a0) & (src < 0)  # earlier products (lower emission angle) win where they overlap
        for name in C.PARAMS:
            vals[name][take] = sample_product(p, SLON, SLAT, name)[take]
        src[take] = k
    flags = C.indicator_flags(vals)
    flags = {k: C.denoise(v) for k, v in flags.items()}
    # colour by priority
    colors = {"mg_carbonate": (217, 142, 186), "fe_ca_carbonate": (240, 181, 154), "olivine": (143, 211, 167),
              "fe_mg_phyllosilicate": (118, 201, 194), "al_oh": (159, 184, 232), "low_ca_pyroxene": (230, 199, 156),
              "hydration": (169, 155, 221)}
    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    cls = np.zeros((H, W), dtype=np.uint8)
    for i, key in enumerate(reversed(C.PRIORITY)):
        m = flags[key]
        rgba[m] = (*colors[key], 200)
        cls[m] = len(C.PRIORITY) - i
    meas = src >= 0
    # official PDS footprints (ODE), moved by the same co-registration shift as the data they outline
    ode = cached_json("crism/ode_mtrdr_aoi.json", ODE_QUERY)["ODEResults"]["Products"]["Product"]
    for k, p in enumerate(prods):
        rec = next((o for o in ode if o["pdsid"].upper().startswith(p["observation_id"])), None)
        if not rec:
            continue
        reg = p["registration"]
        dy, dx = reg["shift_px"] if reg["accepted"] else (0, 0)
        ring = [(float(a), float(b)) for a, b in (pt.split() for pt in
                rec["Footprint_C0_geometry"].split("((")[1].split("))")[0].split(","))]
        p["footprint"] = [[round(lo - dx * d, 6), round(la + dy * d, 6)] for lo, la in ring]
        p["emission_angle"] = float(rec.get("Emission_angle") or "nan")
    Image.fromarray(np.kron(rgba, np.ones((3, 3, 1), dtype=np.uint8))).save(WEB / "crism_indicators.png", optimize=True)
    bounds = [[float(lats[-1] - d / 2), float(lons[0] - d / 2)], [float(lats[0] + d / 2), float(lons[-1] + d / 2)]]
    PROC.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(PROC / "crism_grid.npz", lon0=lons[0], lat0=lats[0], dlon=d, dlat=d, src=src,
                        **{p: vals[p].astype(np.float32) for p in C.PARAMS},
                        **{"flag_" + k: v for k, v in flags.items()})
    # cells are d x d DEGREES: 18 m N-S but only 18*cos(lat) m E-W, so weight each row by its true area
    row_km2 = C.row_cell_area_km2(lats, d, d)
    stats = {k: {"pixels": int(v.sum()), "km2": round(C.mask_area_km2(v, row_km2), 3)} for k, v in flags.items()}
    measured_km2 = round(C.mask_area_km2(meas, row_km2), 2)
    aoi_km2 = round(float(row_km2.sum()) * W, 2)
    print(f"  measured {measured_km2} of {aoi_km2} km2 in AOI;", json.dumps(stats))
    layer = {
        "file": "crism_indicators.png", "bounds": bounds, "kind": "real-derived", "source": "crism_mtrdr",
        "resolution_m": 18,
        "products": [{"product_id": p["pid"], "observation_id": p["observation_id"], "start_time": p["start_time"],
                      "url": p["url"], "label_url": p["label_url"], "bytes_read": p["bytes"],
                      "pixels_used": int((src == k).sum()), "registration": p["registration"],
                      "footprint": p.get("footprint")} for k, p in enumerate(prods)],
        "registration_method": "Each observation's R770 albedo was correlated with the CTX orthoimage (3x3-averaged to 18 m, "
                               "band-pass 54-560 m) over integer shifts up to 30 px; the best shift is applied only if r >= 0.3 "
                               "and the peak is inside the search window.",
        "indicators": [{"key": key, "parameter": prm, "threshold": thr, "meaning": meaning,
                        "color": "#%02X%02X%02X" % colors[key], "km2_in_aoi": stats[key]["km2"]}
                       for prm, (key, thr, meaning) in C.INDICATORS.items()],
        "priority": C.PRIORITY,
        "measured_km2": measured_km2, "aoi_km2": aoi_km2,
        "assumptions": "Thresholds and the 4-of-8 neighbour coherence filter are PAWPRINT assumptions. A coloured pixel "
                       "is a potential mineral indicator, not a confirmed identification.",
    }
    merge_manifest("minerals", layer, ["crism_mtrdr"])


# ---------------------------------------------------------------------------- Mars Trek HiRISE ortho
TREK_HIRISE = ("https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/"
               "1.0.0/default/default028mm/{z}/{row}/{col}.png")
TREK_Z = 15  # 180/2^15 deg per 256 px tile = ~1.27 m/px at Jezero


def build_hirise_ortho() -> None:
    print("Mars Trek HiRISE controlled orthomosaic (tiles)")
    tdeg = 180.0 / 2 ** TREK_Z
    b = HIRISE_WINDOW
    c0, c1 = int((b["lon_min"] + 180) // tdeg), int((b["lon_max"] + 180) // tdeg)
    r0, r1 = int((90 - b["lat_max"]) // tdeg), int((90 - b["lat_min"]) // tdeg)
    canvas = np.zeros(((r1 - r0 + 1) * 256, (c1 - c0 + 1) * 256), dtype=np.uint8)
    alpha = np.zeros_like(canvas)
    cache = RAW / "trek_hirise"
    cache.mkdir(parents=True, exist_ok=True)
    n, nbytes = 0, 0
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            f = cache / f"{TREK_Z}_{r}_{c}.png"
            if not f.exists():
                try:
                    f.write_bytes(fetch(TREK_HIRISE.format(z=TREK_Z, row=r, col=c)))
                except Exception as e:  # noqa: BLE001
                    print("   missing tile", r, c, e)
                    continue
            im = Image.open(io.BytesIO(f.read_bytes())).convert("LA")
            a = np.asarray(im)
            canvas[(r - r0) * 256:(r - r0 + 1) * 256, (c - c0) * 256:(c - c0 + 1) * 256] = a[..., 0]
            alpha[(r - r0) * 256:(r - r0 + 1) * 256, (c - c0) * 256:(c - c0 + 1) * 256] = a[..., 1]
            n += 1
            nbytes += f.stat().st_size
    west, north = -180 + c0 * tdeg, 90 - r0 * tdeg
    px = tdeg / 256
    # crop to the HiRISE DTM window
    x0 = int(round((b["lon_min"] - west) / px)); x1 = int(round((b["lon_max"] - west) / px))
    y0 = int(round((north - b["lat_max"]) / px)); y1 = int(round((north - b["lat_min"]) / px))
    g, a = canvas[y0:y1, x0:x1], alpha[y0:y1, x0:x1]
    valid = a > 0
    # JPEG (no alpha) keeps imagery small; tiles outside the mosaic footprint stay black and are reported below
    Image.fromarray(g).save(WEB / "hirise_ortho.jpg", quality=82, optimize=True)
    bounds = [[north - y1 * px, west + x0 * px], [north - y0 * px, west + x1 * px]]
    print(f"  {n} tiles ({nbytes / 1e6:.1f} MB), mosaic {g.shape[1]}x{g.shape[0]} px at {px * 59274.7 * math.cos(math.radians(18.44)):.2f} m (E-W) "
          f"/ {px * 59274.7:.2f} m (N-S); valid {valid.mean() * 100:.1f}%")
    merge_manifest("hirise_ortho", {"file": "hirise_ortho.jpg", "bounds": bounds, "kind": "real", "source": "trek_hirise_ortho",
                                    "zoom": TREK_Z, "pixel_deg": px, "tiles": n}, ["trek_hirise_ortho"])


if __name__ == "__main__":
    steps = sys.argv[1:] or ["photos", "geology", "crism", "hirise"]
    RAW.mkdir(parents=True, exist_ok=True)
    for s in steps:
        {"photos": build_photos, "geology": build_geology, "crism": build_crism, "hirise": build_hirise_ortho}[s]()
