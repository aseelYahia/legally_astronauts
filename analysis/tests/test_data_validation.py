"""Checks against the real NASA/USGS data. Skipped if the pipeline has not run."""
import json
import pathlib

import numpy as np
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB = ROOT / "app" / "public" / "data"
PROC = ROOT / "data" / "processed"

manifest_path = WEB / "manifest.json"
pytestmark = pytest.mark.skipif(not manifest_path.exists(), reason="run analysis/scripts/build_layers.py first")


@pytest.fixture(scope="module")
def manifest():
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def test_ctx_dtm_agrees_with_rover_localizations(manifest):
    v = manifest["validation_ctx_vs_rover"]
    assert v["n"] > 100
    # 20 m CTX DTM vs rover elevations: expect metre-level agreement, no gross datum error
    assert abs(v["median_m"]) < 3.0
    assert v["mad_m"] < 5.0


def test_hirise_matches_ctx_when_present(manifest):
    v = manifest.get("validation_hirise_vs_ctx")
    if v is None:
        pytest.skip("HiRISE window not ingested")
    # USGS reports the HiRISE mosaic sits ~0.4 m below CTX (median); allow a few metres
    assert abs(v["median_m"]) < 3.0


def test_hirise_window_georeferencing_matches_rover(manifest):
    v = manifest.get("validation_hirise_vs_rover")
    if v is None:
        pytest.skip("HiRISE window not ingested")
    # Localizations are tied to the HiRISE TRN DTM: any windowing/half-pixel/datum error would show up here.
    assert v["n"] > 50
    assert abs(v["median_m"]) < 0.25
    assert v["mad_m"] < 0.25


def test_jezero_floor_elevations_plausible(manifest):
    s = manifest["layers"]["elevation"]["stats"]
    # Jezero floor/delta are roughly -2,600 to -2,400 m relative to the areoid
    assert -2700 < s["elevation_min_m"] < -2400
    assert -2600 < s["elevation_max_m"] < -2200


def test_layer_bounds_inside_aoi_and_mars_coords(manifest):
    aoi = manifest["aoi"]
    for name, layer in manifest["layers"].items():
        if "bounds" not in layer:
            continue
        (lat0, lon0), (lat1, lon1) = layer["bounds"]
        assert 0 <= lon0 < lon1 <= 360, name
        assert -90 <= lat0 < lat1 <= 90, name
        assert lon0 >= aoi["lon_min"] - 0.01 and lon1 <= aoi["lon_max"] + 0.01, name


def test_landing_site_matches_nasa(manifest):
    pois = json.loads((WEB / "pois.json").read_text(encoding="utf-8"))
    landing = next(p for p in pois if p["id"] == "landing")
    # NASA: Octavia E. Butler Landing at 18.4447 N, 77.4508 E
    assert landing["lat"] == pytest.approx(18.4447, abs=0.0005)
    assert landing["lon"] == pytest.approx(77.4508, abs=0.0005)


def test_samples_are_labeled_estimated():
    pois = json.loads((WEB / "pois.json").read_text(encoding="utf-8"))
    samples = [p for p in pois if p["category"] == "sample"]
    assert samples
    assert all(p["position_quality"] == "estimated" for p in samples)


def test_ctx_grid_slope_sane():
    g = np.load(PROC / "ctx_grid.npz")
    s = g["slope"]
    assert np.nanmax(s) < 60  # 20 m posts cannot resolve cliffs steeper than this here
    assert 0 < np.nanmean(s) < 15


def test_weather_marks_missing_values():
    wx = json.loads((WEB / "weather.json").read_text(encoding="utf-8"))
    for s in wx["sols"]:
        for k in ("min_temp_c", "max_temp_c", "pressure_pa"):
            assert s[k] is None or isinstance(s[k], (int, float))
        if s["pressure_pa"] is not None:
            assert 400 < s["pressure_pa"] < 1200  # Pa, Jezero surface range
