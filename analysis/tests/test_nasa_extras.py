"""Tests for the official-challenge data layers: Ground View photos, USGS geology, CRISM indicators, Mars Trek HiRISE.

Unit tests use synthetic inputs; data tests run against the real generated files and are skipped if
analysis/scripts/build_nasa_extras.py has not been run.
"""
import json
import math
import pathlib
import re
import threading
import urllib.request
from http.server import ThreadingHTTPServer

import numpy as np
import pytest

from pawprint import crism as C
from pawprint import geology as G
from pawprint import photos as P

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB = ROOT / "app" / "public" / "data"
PROC = ROOT / "data" / "processed"
RAW = ROOT / "data" / "raw"


# --------------------------------------------------------------------- photos (unit)
def _img(cam, site, drive, w=1600, h=1200, sample="Full"):
    return {"imageid": f"X_{cam}_{site}_{drive}_{w}", "camera": {"instrument": cam}, "sample_type": sample, "site": site,
            "drive": str(drive), "sol": 749, "extended": {"dimension": f"({w},{h})"},
            "image_files": {"small": "s", "medium": "m", "large": "l", "full_res": "f"}, "date_taken_utc": "2023-03-30T09:00:00"}


def test_geolocate_requires_exact_nasa_localization():
    wps = {"37_0": {"lon": 77.38, "lat": 18.47, "sol": 736, "Note": "End-of-drive localization"},
           "37_9": {"lon": 77.39, "lat": 18.48, "sol": 740, "Note": "Interpolated"}}
    ok = P.geolocate(_img("MCZ_LEFT", 37, 0), wps)
    assert ok["geolocated"] and ok["lon"] == 77.38 and ok["rmc"] == "37_0"
    # a neighbouring drive is NOT guessed
    miss = P.geolocate(_img("MCZ_LEFT", 37, 1), wps)
    assert miss["geolocated"] is False and "lon" not in miss
    # NASA-interpolated localizations are not used either
    assert P.geolocate(_img("MCZ_LEFT", 37, 9), wps)["geolocated"] is False


def test_select_images_skips_thumbnails_and_subframes():
    imgs = [_img("MCZ_LEFT", 1, 0, 128, 128), _img("MCZ_LEFT", 1, 0, 1600, 1200, "Thumbnail"), _img("MCZ_LEFT", 1, 0, 1648, 1200),
            _img("NAVCAM_LEFT", 1, 0, 1280, 960), _img("CACHECAM", 1, 0, 1648, 1200)]
    picked = P.select_images(imgs)
    roles = {r: i for r, i in picked}
    assert set(roles) == {"context", "sample"}
    assert roles["context"]["camera"]["instrument"] == "MCZ_LEFT" and roles["context"]["extended"]["dimension"] == "(1648,1200)"


# --------------------------------------------------------------------- Ground View v2 selection (unit)
def _v2(iid, cam="MCZ_LEFT", az=10.0, el=-5.0, w=1648, h=1200, site=37, drive=0, sol=749):
    return {"imageid": iid, "camera": {"instrument": cam}, "sample_type": "Full", "site": site, "drive": str(drive), "sol": sol,
            "extended": {"dimension": f"({w},{h})", "mastAz": str(az), "mastEl": str(el)},
            "image_files": {"small": "s", "medium": "m", "large": "l", "full_res": "f"}, "date_taken_utc": f"2023-03-30T09:{sol % 60:02d}:00"}


def _stats(**kw):
    st = {"mean": 120.0, "std": 30.0, "edge": 10.0, "sky_frac": 0.0, "flat_frac": 0.05, "dark_frac": 0.0, "bright_frac": 0.0,
          "gray_frac": 0.0, "is_color": True, "sig": None}
    st.update(kw)
    return st


def test_parse_id_reads_sequence_and_zoom():
    m = P.parse_id("ZL0_0749_0733450395_307EBY_N0370000ZCAM05069_0340LMJ")
    assert m == {"sclk": 733450395, "product": "EBY", "sequence": "ZCAM05069", "focal_mm": 34}
    assert P.parse_id("NLMV0629_0722790172_888ECM_N0302149TRAV00229_00_2LLJ")["sequence"] == "TRAV00229"
    assert P.parse_id("not-an-id")["sequence"] is None


def test_candidates_collapse_products_and_drop_sky_and_small_frames():
    imgs = [_v2("ZR0_0749_0733450395_307EBY_N0370000ZCAM05069_0340LMJ", "MCZ_RIGHT"),
            _v2("ZL0_0749_0733450395_307ECM_N0370000ZCAM05069_0340LMJ"),
            _v2("ZL0_0749_0733450395_307EBY_N0370000ZCAM05069_0340LMJ"),  # same exposure: left + colour EBY wins
            _v2("ZL0_0749_0733450500_307EBY_N0370000ZCAM01000_0340LMJ", el=35.0),  # Sun / sky pointing
            _v2("ZL0_0749_0733450600_307EBY_N0370000ZCAM05070_0340LMJ", w=128, h=128)]  # thumbnail-sized
    ids = [i["imageid"] for i in P.candidates(imgs)]
    assert ids == ["ZL0_0749_0733450395_307EBY_N0370000ZCAM05069_0340LMJ"]


def test_place_uses_only_nasa_localizations():
    wps = {"37_0": {"lon": 77.38, "lat": 18.47, "sol": 736, "Note": "End-of-drive"},
           "36_2000": {"lon": 77.381, "lat": 18.47, "sol": 730, "Note": "End-of-drive"},
           "35_100": {"lon": 77.39, "lat": 18.47, "sol": 700, "Note": "End-of-drive"},
           "30_0": {"lon": 77.45, "lat": 18.47, "sol": 600, "Note": "End-of-drive"}}
    at = P.place(P.geolocate(_v2("a", site=37, drive=0), wps), "37_0", wps)
    assert at == {"place": "at_site", "distance_m": 0.0}
    near = P.place(P.geolocate(_v2("b", site=36, drive=2000), wps), "37_0", wps)
    assert near["place"] == "nearby" and 50 < near["distance_m"] <= P.NEARBY_M  # 0.001 deg of longitude ~ 56 m here
    reg = P.place(P.geolocate(_v2("c", site=35, drive=100), wps), "37_0", wps)
    assert reg["place"] == "regional" and P.NEARBY_M < reg["distance_m"] <= P.REGIONAL_M
    assert P.place(P.geolocate(_v2("d", site=30, drive=0), wps), "37_0", wps)["place"] == "far"
    none = P.place(P.geolocate(_v2("e", site=99, drive=5), wps), "37_0", wps)
    assert none == {"place": "not_geolocated", "distance_m": None}


def test_marker_rmc_comes_from_the_documented_position_method():
    assert P.marker_rmc({"position_method": "Rover localization RMC 37_0 (sol 736), last fix on/before sealing sol"}) == "37_0"
    assert P.marker_rmc({"description": "Position is the rover's first NASA localization (sol 13, RMC 3_0)."}) == "3_0"
    assert P.marker_rmc({"description": "no localization"}) is None


def test_classify_keeps_hardware_samples_and_blank_frames_aside():
    seq = "ZL0_0749_0733450395_307EBY_N0370000ZCAM08000_0340LMJ"
    assert P.classify(_v2("CCF_0749_0733468274_245ECMUN0370000CACH00200_01_295J", "CACHECAM"), _stats())[0] == "other"
    assert P.classify(_v2("FLF_0749_0733445725_069ECM_N0370000FHAZ00203_07_195J", "FRONT_HAZCAM_LEFT_A"), _stats(sky_frac=0.3))[0] == "other"
    assert P.classify(_v2(seq), _stats(std=3.0))[0] == "other"  # nearly uniform
    assert P.classify(_v2(seq), _stats(gray_frac=0.3))[0] == "other"  # grey metal in a colour frame
    assert P.classify(_v2(seq, el=15.0), _stats())[0] == "other"  # looking up, no ground found
    assert P.classify(_v2(seq), _stats(sky_frac=0.2))[0] == "landscape"
    assert P.classify(_v2(seq, el=-40.0), _stats())[0] == "rocks"
    assert P.classify(_v2("SIF_0617_0721745926_074EBY_N0301172SRLC08027_0000LMJ", "SHERLOC_WATSON", el=-85.0), _stats())[0] == "rocks"
    assert P.classify(_v2("ZL0_0749_0733450395_307EBY_N0370000ZCAM08000_1100LMJ"), _stats()) == (
        "geology", "Mastcam-Z zoomed to 110 mm on terrain away from the rover.")
    assert P.classify(_v2(seq, el=-12.0), _stats())[0] == "geology"


def test_repeated_rover_frame_pointing_or_sequence_marks_hardware():
    # the same pointing at three different NASA positions -> something fixed to the rover (e.g. the turret)
    turret = [_v2(f"ZL0_07{k}9_07334503{k}5_307EBY_N0370000ZCAM0507{k}_0340LMJ", az=336.5, el=-2.4, site=30 + k) for k in range(3)]
    land = _v2("ZL0_0749_0733459999_307EBY_N0370000ZCAM08999_0340LMJ", az=120.0, el=-2.0, site=37)
    rep = P.repeated_pointings(turret + [land])
    assert P.classify(turret[0], _stats(), rep)[0] == "other"
    assert P.classify(land, _stats(), rep)[0] == "geology"
    # a Mastcam-Z sequence id reused at three stops (drill-bit check), even at different pointings
    bit = [_v2(f"ZL0_07{k}9_07334504{k}5_307EBY_N0370000ZCAM05069_0340LMJ", az=10.0 + 40 * k, el=-3.0, site=40 + k) for k in range(3)]
    assert P.classify(bit[0], _stats(), P.repeated_pointings(bit))[0] == "other"


def test_image_stats_detect_sky_band_and_blank_frames(tmp_path):
    import io
    import numpy as np
    from PIL import Image
    rng = np.random.default_rng(0)
    a = np.full((240, 320, 3), 200, np.uint8)  # smooth bright sky ...
    a[80:] = rng.integers(40, 160, size=(160, 320, 3), dtype=np.uint8)  # ... over textured ground
    buf = io.BytesIO()
    Image.fromarray(a).save(buf, "JPEG", quality=95)
    st = P.image_stats(buf.getvalue())
    assert 0.25 < st["sky_frac"] < 0.4 and st["edge"] > 20 and len(st["sig"]) == 16 * 12
    flat = io.BytesIO()
    Image.fromarray(np.full((240, 320, 3), 90, np.uint8)).save(flat, "JPEG")
    st2 = P.image_stats(flat.getvalue())
    assert st2["std"] < P.BLANK_STD and st2["flat_frac"] == 1.0


def test_select_for_poi_prefers_terrain_at_the_site_and_keeps_one_sample_tube():
    def sc(iid, cat, place="at_site", q=1.0, cam="MCZ_LEFT", el=-5.0, sol=749, sig=None):
        return {"img": _v2(iid, cam, el=el, sol=sol), "category": cat, "place": place, "quality": q, "sig": sig}
    pool = [sc(f"ZL0_0749_07334503{k:02d}_307EBY_N0370000ZCAM080{k:02d}_0340LMJ", "rocks", q=3.0 + k) for k in range(8)]
    pool += [sc("ZL0_0749_0733450400_307EBY_N0370000ZCAM08100_0340LMJ", "landscape", q=0.5),
             sc("ZL0_0749_0733450401_307EBY_N0370000ZCAM08101_0340LMJ", "landscape", place="nearby", q=5.0),
             sc("ZL0_0749_0733450402_307EBY_N0370000ZCAM08102_0340LMJ", "geology", place="not_geolocated", q=9.0)]
    pool += [sc(f"CCF_07{40 + k}_07334682{k}4_245ECMUN0370000CACH0020{k}_01_295J", "other", cam="CACHECAM", sol=740 + k) for k in range(3)]
    out = P.select_for_poi(pool)
    cats = [s["category"] for s in out]
    assert cats[0] == "landscape" and out[0]["place"] == "at_site"  # landscapes lead, at the site before nearby
    assert [s["place"] for s in out if s["category"] != "other"] == sorted(
        [s["place"] for s in out if s["category"] != "other"], key=P.PLACES.index)
    assert sum(c != "other" for c in cats) == P.MAX_TERRAIN
    assert {"landscape", "geology", "rocks"} <= set(cats)  # quotas give every category a slot before rocks fill up
    tubes = [s for s in out if s["img"]["camera"]["instrument"] == "CACHECAM"]
    assert len(tubes) == 1 and tubes[0]["img"]["sol"] == 742  # one tube frame, the latest (sealing) sol


def test_select_for_poi_skips_near_duplicates():
    sig = [float(v % 7) for v in range(192)]
    a = {"img": _v2("ZL0_0749_0733450300_307EBY_N0370000ZCAM08000_0340LMJ"), "category": "rocks", "place": "at_site", "quality": 2.0, "sig": sig}
    b = {"img": _v2("ZL0_0749_0733450310_307EBY_N0370000ZCAM08001_0340LMJ", az=12.0), "category": "rocks", "place": "at_site", "quality": 1.0,
         "sig": [v + 0.01 for v in sig]}
    c = {"img": _v2("ZL0_0749_0733450320_307EBY_N0370000ZCAM08002_0340LMJ", az=150.0), "category": "rocks", "place": "at_site", "quality": 0.5,
         "sig": [v + 0.01 for v in sig]}  # same picture statistics but pointed elsewhere: kept
    assert [P.parse_id(s["img"]["imageid"])["sequence"] for s in P.select_for_poi([a, b, c])] == ["ZCAM08000", "ZCAM08002"]


# --------------------------------------------------------------------- geology (unit)
def test_clip_ring_to_box():
    sq = [(0, 0), (0, 2), (2, 2), (2, 0), (0, 0)]  # clockwise (ESRI exterior)
    c = G.clip_ring(sq, (1, 1, 3, 3))
    assert c[0] == c[-1]
    assert abs(abs(G.ring_area(c)) - 1.0) < 1e-12
    assert G.clip_ring(sq, (5, 5, 6, 6)) == []


def test_esri_rings_split_into_polygons_with_holes():
    outer = [(0, 0), (0, 10), (10, 10), (10, 0), (0, 0)]  # clockwise
    hole = [(2, 2), (4, 2), (4, 4), (2, 4), (2, 2)]  # counter-clockwise
    other = [(20, 0), (20, 5), (25, 5), (25, 0), (20, 0)]  # second exterior
    polys = G.esri_rings_to_polygons([outer, hole, other])
    assert len(polys) == 2 and len(polys[0]) == 2 and len(polys[1]) == 1
    assert G.polygon_area(polys[0]) == pytest.approx(96.0)


# --------------------------------------------------------------------- CRISM (unit)
HDR_47A3 = """ENVI
samples = 847
lines   = 808
bands   = 60
header offset = 0
data type = 4
interleave = bsq
byte order = 0
map info = {MRO Mars Equirectangular [IAU 2000] [15.00N; 0.00E], 1.0000, 1.0000, 4428386.8000, 1107292.6000, 1.8000000000e+01, 1.8000000000e+01, D_Mars_2000_IAU_IAG_custom_sphere_lat15, units=Meters}
projection info = {17, 3394839.8, 15.000000, 0.000000, 0.0, 0.0, D_Mars_2000_IAU_IAG_custom_sphere_lat15, MRO Mars Equirectangular [IAU 2000] [15.00N; 0.00E], units=Meters}
band names = {
 R770, RBR, OLINDEX3}
"""


def test_crism_grid_matches_pds_label_bounds():
    """FRT000047A3 PDS label: MAXIMUM_LATITUDE 18.6879740, WESTERNMOST_LONGITUDE 77.3759510."""
    h = C.parse_envi_header(HDR_47A3)
    assert h["interleave"] == "bsq" and h["band_names"] == ["R770", "RBR", "OLINDEX3"] and h["std_parallel_deg"] == 15.0
    g = C.CrismGrid(h)
    # The PDS label's MAXIMUM_LATITUDE / WESTERNMOST_LONGITUDE are the CENTRE of the first pixel ...
    lon, lat = g.px_to_lonlat(0, 0)
    assert float(lat) == pytest.approx(18.6879740, abs=1e-6)
    assert float(lon) == pytest.approx(77.3759510, abs=1e-6)
    # ... while the ENVI map-info tie point (pixel 1,1) is its upper-left CORNER, half a pixel (9 m) further out.
    clon, clat = g.px_to_lonlat(-0.5, -0.5)
    assert math.radians(float(clat)) * h["radius_m"] == pytest.approx(1107292.6, abs=1e-3)
    r, c = g.lonlat_to_px(*g.px_to_lonlat(100, 200))
    assert float(r) == pytest.approx(100) and float(c) == pytest.approx(200)


def test_indicators_never_flag_missing_measurements():
    v = np.array([[0.2, np.nan], [0.05, 0.2]])
    f = C.indicator_flags({"OLINDEX3": v})["olivine"]
    assert f.tolist() == [[True, False], [False, True]]


def test_denoise_removes_isolated_pixels():
    f = np.zeros((7, 7), bool)
    f[1, 1] = True
    f[3:6, 3:6] = True
    d = C.denoise(f)
    assert not d[1, 1] and d[4, 4]


def _spherical_box_km2(lon_min, lon_max, lat_min, lat_max, r=3_396_190.0):
    return r ** 2 * math.radians(lon_max - lon_min) * (math.sin(math.radians(lat_max)) - math.sin(math.radians(lat_min))) / 1e6


def test_crism_cell_area_is_cos_lat_weighted_not_square():
    d = 18.0 / 59274.7
    a_eq, a_jez = C.row_cell_area_km2(np.array([0.0, 18.46]), d, d)
    assert a_eq == pytest.approx(18 * 18 / 1e6, rel=1e-4)  # square only at the equator
    assert a_jez == pytest.approx(18 * 18 * math.cos(math.radians(18.46)) / 1e6, rel=1e-6)
    assert a_jez < 0.96 * 18 * 18 / 1e6  # the old pixels*18*18 formula is ~5 % too high at Jezero
    # a whole grid of cells sums to the exact spherical box area
    lats = np.arange(18.51 - d / 2, 18.42, -d)
    h = len(lats)
    box = _spherical_box_km2(0, 100 * d, 18.51 - h * d, 18.51)
    assert C.row_cell_area_km2(lats, d, d).sum() * 100 == pytest.approx(box, rel=1e-9)
    mask = np.zeros((h, 100), bool)
    mask[0, :10] = mask[-1, :5] = True
    rows = C.row_cell_area_km2(lats, d, d)
    assert C.mask_area_km2(mask, rows) == pytest.approx(10 * rows[0] + 5 * rows[-1])


# --------------------------------------------------------------------- real generated data
photos_path = WEB / "photos.json"
geo_path = WEB / "geology_units.geojson"
crism_npz = PROC / "crism_grid.npz"


@pytest.fixture(scope="module")
def manifest():
    return json.loads((WEB / "manifest.json").read_text(encoding="utf-8"))


@pytest.mark.skipif(not photos_path.exists(), reason="run build_nasa_extras.py photos")
def test_photos_are_real_nasa_assets_with_exact_localizations():
    data = json.loads(photos_path.read_text(encoding="utf-8"))
    wps = {f["properties"]["RMC"]: f["properties"] for f in json.loads((RAW / "M20_waypoints.json").read_text(encoding="utf-8"))["features"]}
    assert len(data["photos"]) >= 20
    for p in data["photos"]:
        for k in ("img_small", "img_medium", "nasa_page"):
            assert p[k].startswith("https://mars.nasa.gov/"), p[k]
        assert re.fullmatch(r"[A-Z0-9_]+", p["id"])
        assert re.match(rf"^([A-Z0-9]{{3}}_|[A-Z0-9]{{4}}){p['sol']:04d}_", p["id"])  # sol is encoded in NASA's image id (ZL0_0749_, NLMV0629_)
        assert p["date_taken_utc"][:2] == "20" and p["camera"] and p["credit"].startswith("NASA")
        assert (WEB / p["thumb"]).exists()
        loc = p["location"]
        if loc["geolocated"]:
            wp = wps[loc["rmc"]]
            assert (loc["lon"], loc["lat"]) == (wp["lon"], wp["lat"])
            assert loc["rmc"] == f"{int(p['site'])}_{int(p['drive'])}"
        else:
            assert "lon" not in loc and loc["reason"]




@pytest.mark.skipif(not photos_path.exists(), reason="run build_nasa_extras.py photos")
def test_ground_view_selection_is_labelled_and_documented():
    data = json.loads(photos_path.read_text(encoding="utf-8"))
    wps = {f["properties"]["RMC"]: f["properties"] for f in json.loads((RAW / "M20_waypoints.json").read_text(encoding="utf-8"))["features"]}
    sel = data["selection"]
    assert set(sel["categories"]) == set(P.CATEGORIES) and set(sel["places"]) == set(P.PLACES)
    by_poi = {}
    for p in data["photos"]:
        by_poi.setdefault(p["poi_id"], []).append(p)
        assert p["category"] in P.CATEGORIES and p["category_reason"]
        if p["place"] == "at_site":
            assert p["location"]["rmc"] == p["marker_rmc"]
        elif p["place"] in ("nearby", "regional"):
            wp, mk = wps[p["location"]["rmc"]], wps[p["marker_rmc"]]
            d = P.distance_m(wp["lon"], wp["lat"], mk["lon"], mk["lat"])
            assert abs(d - p["distance_m"]) < 0.5 and d <= (P.NEARBY_M if p["place"] == "nearby" else P.REGIONAL_M)
        else:
            assert p["place"] == "not_geolocated" and not p["location"]["geolocated"]
    for poi, ps in by_poi.items():
        ps.sort(key=lambda p: p["rank"])
        assert ps[0]["category"] != "other", poi  # every gallery opens on a terrain photo
        assert sum(p["camera"] == "CACHECAM" for p in ps) <= 1
        assert all(p["category"] == "other" for p in ps if p["camera"] in ("CACHECAM", "FRONT_HAZCAM_LEFT_A", "FRONT_HAZCAM_RIGHT_A"))


@pytest.mark.skipif(not photos_path.exists(), reason="run build_nasa_extras.py photos")
def test_every_sample_marker_is_corroborated_by_sealing_sol_images():
    checks = json.loads(photos_path.read_text(encoding="utf-8"))["sample_position_check"]
    assert checks and all(c["corroborated"] for c in checks)


@pytest.mark.skipif(not geo_path.exists(), reason="run build_nasa_extras.py geology")
def test_geologic_units_cover_the_aoi_and_stay_inside_it(manifest):
    g = json.loads(geo_path.read_text(encoding="utf-8"))
    a = manifest["aoi"]
    total = sum(u["area_km2_in_aoi"] for u in g["units"])
    aoi_km2 = (a["lon_max"] - a["lon_min"]) * (a["lat_max"] - a["lat_min"]) * 59274.7 ** 2 * math.cos(math.radians(18.46)) / 1e6
    assert total == pytest.approx(aoi_km2, rel=0.03)  # USGS units tile the area with no gaps or overlaps
    for f in g["features"]:
        for poly in f["geometry"]["coordinates"]:
            for ring in poly:
                for x, y in ring:
                    assert a["lon_min"] - 1e-9 <= x <= a["lon_max"] + 1e-9 and a["lat_min"] - 1e-9 <= y <= a["lat_max"] + 1e-9
    assert all(u["description"] and u["interpretation"] for u in g["units"])
    assert "100-200 m" in g["positional_note"]


@pytest.mark.skipif(not crism_npz.exists(), reason="run build_nasa_extras.py crism")
def test_crism_colours_only_measured_pixels_and_is_coregistered(manifest):
    z = np.load(crism_npz)
    meas = z["src"] >= 0
    for k in [f for f in z.files if f.startswith("flag_")]:
        assert not (z[k] & ~meas).any(), k
    layer = manifest["layers"]["minerals"]
    from PIL import Image
    img = np.asarray(Image.open(WEB / layer["file"]))
    alpha = img[..., 3][::3, ::3]  # PNG is 3x upsampled
    assert not (alpha[~meas] > 0).any()
    for p in layer["products"]:
        reg = p["registration"]
        assert reg["accepted"] and reg["corr_after"] >= 0.5
        assert p["url"].startswith("https://pds-geosciences.wustl.edu/") and p["footprint"]


@pytest.mark.skipif(not crism_npz.exists(), reason="run build_nasa_extras.py crism")
def test_crism_areas_use_true_ground_area(manifest):
    z = np.load(crism_npz)
    layer = manifest["layers"]["minerals"]
    a = manifest["aoi"]
    h, w = z["src"].shape
    d = float(z["dlat"])
    lats = float(z["lat0"]) - d * np.arange(h)
    rows = C.row_cell_area_km2(lats, d, float(z["dlon"]))
    assert layer["aoi_km2"] == pytest.approx(_spherical_box_km2(a["lon_min"], a["lon_max"], a["lat_min"], a["lat_max"]), rel=0.005)
    assert layer["aoi_km2"] == pytest.approx(rows.sum() * w, abs=0.006)
    assert layer["measured_km2"] == pytest.approx(C.mask_area_km2(z["src"] >= 0, rows), abs=0.006)
    for ind in layer["indicators"]:
        assert ind["km2_in_aoi"] == pytest.approx(C.mask_area_km2(z["flag_" + ind["key"]], rows), abs=6e-4), ind["key"]


@pytest.mark.skipif("hirise_ortho" not in json.loads((WEB / "manifest.json").read_text(encoding="utf-8")).get("layers", {}) if (WEB / "manifest.json").exists() else True,
                    reason="run build_nasa_extras.py hirise")
def test_trek_hirise_ortho_covers_the_hirise_window(manifest):
    from pawprint.sources import HIRISE_WINDOW as b
    (s, w), (n, e) = manifest["layers"]["hirise_ortho"]["bounds"]
    px = manifest["layers"]["hirise_ortho"]["pixel_deg"]
    assert abs(w - b["lon_min"]) < px and abs(e - b["lon_max"]) < px and abs(s - b["lat_min"]) < px and abs(n - b["lat_max"]) < px


# --------------------------------------------------------------------- API
@pytest.fixture(scope="module")
def base_url():
    import server

    server.load_grids()
    server.load_crism()
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


@pytest.mark.skipif(not crism_npz.exists(), reason="run build_nasa_extras.py crism")
def test_minerals_api(base_url):
    get = lambda q: json.loads(urllib.request.urlopen(base_url + "/api/minerals?" + q).read())  # noqa: E731
    out = get("lon=77.0&lat=18.4")
    assert out["available"] and out["measured"] is False and "indicators" not in out
    z = np.load(crism_npz)
    r, c = np.argwhere(z["flag_olivine"])[0]
    lon, lat = float(z["lon0"]) + c * float(z["dlon"]), float(z["lat0"]) - r * float(z["dlat"])
    hit = get(f"lon={lon}&lat={lat}")
    assert hit["measured"] and any(i["key"] == "olivine" for i in hit["indicators"])
    assert hit["product"]["product_id"].endswith("_MTR3") and "not confirmed" in hit["note"]


def test_hole_clipped_at_the_aoi_edge_is_kept():
    """Audit 2026-11-15: a hole whose clipped ring starts ON the exterior's edge was dropped by the old
    first-vertex test, so a NHjf2 island inside a Nue polygon was drawn as both units."""
    box = (0, 0, 10, 10)
    outer = [(0, 0), (0, 10), (10, 10), (10, 0), (0, 0)]  # clockwise exterior (ESRI)
    hole = G.clip_ring([(-2, 4), (6, 4), (6, 8), (-2, 8), (-2, 4)], box)  # counter-clockwise, crosses x=0
    assert hole and hole[0][0] == 0  # first vertex lies exactly on the exterior's edge
    polys = G.esri_rings_to_polygons([outer, hole])
    assert len(polys) == 1 and len(polys[0]) == 2


def test_geologic_units_do_not_overlap(manifest):
    """Units are a partition: summed (unrounded) polygon area equals the AOI, so no ground is drawn as two units.
    Before the hole fix the sum exceeded the AOI by 0.0214 km2."""
    import math
    gj = json.loads(geo_path.read_text(encoding="utf-8"))
    deg2 = sum(G.polygon_area([[tuple(pt) for pt in r] for r in poly]) for f in gj["features"] for poly in f["geometry"]["coordinates"])
    a = manifest["aoi"]
    box_deg2 = (a["lon_max"] - a["lon_min"]) * (a["lat_max"] - a["lat_min"])
    assert deg2 == pytest.approx(box_deg2, abs=box_deg2 * 1e-4)  # < ~0.004 km2
