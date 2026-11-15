"""Ancient Water Evidence index: formula, missing-data handling and the built artefact."""
import json
import math
import pathlib

import numpy as np
import pytest

from pawprint import crism as C
from pawprint import water as W
from pawprint.sources import EXTRA_DATASETS

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB = ROOT / "app" / "public" / "data"


def test_weights_sum_to_one_and_documented():
    assert math.isclose(sum(W.WEIGHTS.values()), 1.0)
    assert set(W.UNIT_PRIOR) <= set(W.UNIT_REASON)
    assert all(0 <= v <= 1 for v in W.UNIT_PRIOR.values())


def test_aqueous_params_use_app_thresholds_and_exclude_igneous():
    for p in W.AQUEOUS_PARAMS:
        assert p in C.INDICATORS
    assert "OLINDEX3" not in W.AQUEOUS_PARAMS and "LCPINDEX2" not in W.AQUEOUS_PARAMS


def test_combine_weighted_mean_and_renormalises_over_available():
    comps = {"mineral": np.array([1.0, np.nan, np.nan]), "geology": np.array([0.5, 0.5, np.nan]), "landform": np.array([0.0, 1.0, 1.0])}
    score, cov = W.combine(comps)
    assert score[0] == pytest.approx(0.45 * 1 + 0.40 * 0.5 + 0)
    assert score[1] == pytest.approx((0.40 * 0.5 + 0.15 * 1.0) / 0.55)
    assert cov[1] == pytest.approx(0.55)
    # only landform (15 % of weight) -> insufficient data, never a low score
    assert np.isnan(score[2]) and cov[2] == pytest.approx(0.15)


def test_mineral_score_missing_vs_zero():
    m = W.mineral_score(np.array([0.0, 0.0, 0.3]), np.array([0.0, 0.0, 0.0]), np.array([1.0, 0.2, 1.0]))
    assert m[0] == 0.0  # measured, nothing found -> low evidence
    assert np.isnan(m[1])  # mostly unmeasured -> missing
    assert m[2] == 1.0  # saturates


def test_mineral_component_never_flags_nan_and_weak_is_exclusive():
    v = np.full((7, 7), 0.02)
    v[0, 0] = np.nan
    weak = np.full((7, 7), 0.012)  # 80 % of the 0.015 hydration threshold
    masks = W.mineral_component({"D2300": v, "BD1900R2": weak}, {"D2300": 0.015, "BD1900R2": 0.015}, C.denoise)
    assert not masks["strong"][0, 0]
    assert masks["strong"][3, 3]
    assert not (masks["strong"] & masks["weak"]).any()


def test_geology_prior_area_weighted():
    g = W.geology_score({"NHjf2": np.array([0.5, 0.0]), "Aeb": np.array([0.5, 0.1])})
    assert g[0] == pytest.approx(0.5)
    assert np.isnan(g[1])  # < 25 % of the cell mapped


def test_zones_connectivity():
    s = np.zeros((6, 6))
    s[0:2, 0:2] = 0.9
    s[4, 4] = s[5, 5] = s[4, 5] = s[5, 4] = 0.8
    s[3, 0] = 0.95  # single cell: too small
    z = W.zones(s, 0.6)
    assert [len(c) for c in z] == [4, 4]


def test_classes_tile_0_to_100_and_bands_agree():
    covered = [i for lo, hi, *_ in W.CLASSES for i in range(lo, hi + 1)]
    assert covered == list(range(101))
    assert W.band_label(None) == "Insufficient data"
    assert W.band_label(0.1) == "Low" and W.band_label(0.95) == "Very high"
    assert W.band_label(0.595) == "High"  # index 60: band follows the displayed index, not the raw score
    assert W.evidence_index(0.125) == 13 and W.evidence_index(0.5) == 50


def test_class_colours_differ_from_other_overlays():
    geology = {"#A99BDD", "#76C9C2", "#D98EBA", "#E6C79C", "#9FB8E8", "#C6A6E0"}
    minerals = {"#D98EBA", "#F0B59A", "#8FD3A7", "#76C9C2", "#9FB8E8", "#A99BDD", "#E6C79C"}
    water = {"#%02X%02X%02X" % c[4] for c in W.CLASSES}
    assert len(water) == 5 and not water & (geology | minerals)


def test_render_marks_missing_distinctly():
    img = W.render_rgba(np.array([[0, -1]]), scale=6)
    low = img[:, :6]
    miss = img[:, 6:]
    assert (low[..., 3] == 215).all()
    assert tuple(low[0, 0, :3]) == W.CLASSES[0][4]
    assert set(np.unique(miss[..., 3])) == {70, 200}  # hatch, not a class colour


def test_rejected_datasets_documented():
    keys = {i["key"] for i in EXTRA_DATASETS["water_rejected"]["items"]}
    assert {"sharad", "swim", "rimfax"} <= keys


@pytest.mark.skipif(not (WEB / "water_evidence.json").exists(), reason="artefact not built")
def test_built_artefact_is_consistent():
    d = json.loads((WEB / "water_evidence.json").read_text(encoding="utf-8"))
    g, cells = d["grid"], d["cells"]
    n = g["rows"] * g["cols"]
    assert all(len(v) == n for v in cells.values())
    assert "not probabilities" in d["not_a_probability"]
    for s, cov in zip(cells["score"], cells["coverage"]):
        if s is not None:
            assert 0 <= s <= 1 and cov >= W.MIN_COVERAGE
    aoi = json.loads((WEB / "manifest.json").read_text(encoding="utf-8"))["aoi"]
    for z in d["zones"]:
        lon, lat = z["target"]
        assert aoi["lon_min"] <= lon <= aoi["lon_max"] and aoi["lat_min"] <= lat <= aoi["lat_max"]
        assert z["score_mean"] >= d["zone_threshold"]


# ---- audit 2026-11-15 ---------------------------------------------------------------------------------------
def test_replication_classifies_confirmed_single_and_contradicted():
    z = np.zeros((9, 9), dtype=bool)
    a = z.copy(); a[2, 2] = a[6, 6] = a[4, 8] = True        # signals seen by observation 0
    b = z.copy(); b[3, 3] = True                             # observation 1: one signal 1 px away from (2,2)
    va = np.ones((9, 9), dtype=bool)
    vb = np.ones((9, 9), dtype=bool); vb[:, 8] = False       # obs 1 did not measure column 8
    winner = np.zeros((9, 9), dtype=int)
    r = W.replication([a, b], [va, vb], winner, tol=2)
    assert r["replicated"][2, 2]
    assert r["contradicted"][6, 6]                           # obs 1 measured it and saw nothing nearby
    assert r["single"][4, 8]                                 # nobody else measured it
    assert not (r["replicated"] & r["contradicted"]).any()


def test_score_range_brackets_missing_component():
    comps = {"mineral": np.array([np.nan, 0.5]), "geology": np.array([1.0, 1.0]), "landform": np.array([0.5, 0.5])}
    lo, hi = W.score_range(comps)
    assert lo[0] == pytest.approx(0.40 + 0.075) and hi[0] == pytest.approx(0.45 + 0.40 + 0.075)
    assert lo[1] == hi[1]


def test_zones_can_require_full_coverage():
    s = np.full((4, 4), 0.9)
    eligible = np.zeros((4, 4), dtype=bool); eligible[:2, :2] = True
    assert [len(c) for c in W.zones(s, 0.6, eligible=eligible)] == [4]


@pytest.mark.skipif(not (WEB / "water_evidence.json").exists(), reason="artefact not built")
def test_built_zones_use_only_fully_measured_cells_and_record_replication():
    d = json.loads((WEB / "water_evidence.json").read_text(encoding="utf-8"))
    assert d["formula"]["zones_require_full_coverage"] is True
    px = d["stats"]["crism_pixels"]
    assert px["replicated"] + px["single"] + px["contradicted"] == px["strong_raw"] + px["weak_raw"]
    assert px["strong"] + px["weak"] == px["replicated"] + px["single"]
    for z in d["zones"]:
        assert all(v is not None for v in z["components_mean"].values())
        assert z["score_low_mean"] == pytest.approx(z["score_mean"], abs=0.011)
        assert "crism_signal" in z


@pytest.mark.skipif(not (WEB / "water_evidence.json").exists(), reason="artefact not built")
def test_built_index_matches_score_and_classes():
    d = json.loads((WEB / "water_evidence.json").read_text(encoding="utf-8"))
    for s, i in zip(d["cells"]["score"], d["cells"]["index"]):
        assert (s is None) == (i is None)
        if s is not None:
            assert i == math.floor(s * 100 + 0.5)
    assert [c["min"] for c in d["formula"]["classes"]] == [0, 20, 40, 60, 80]


def test_partial_coverage_cells_are_striped_not_plain():
    img = W.render_rgba(np.array([[90, 90]]), scale=6, partial=np.array([[False, True]]))
    plain, part = img[:, :6, :3], img[:, 6:, :3]
    assert (plain != (250, 250, 252)).any(axis=-1).all()
    assert ((part == (250, 250, 252)).all(axis=-1)).sum() >= 4


@pytest.mark.skipif(not (WEB / "water_evidence.json").exists(), reason="artefact not built")
def test_every_published_score_recomputes_from_published_components():
    """Independent check of the shipped numbers: score = sum(w*s)/sum(w over available), index = round half up."""
    d = json.loads((WEB / "water_evidence.json").read_text(encoding="utf-8"))
    w = d["formula"]["weights"]
    assert w == {"mineral": 0.45, "geology": 0.40, "landform": 0.15}
    c = d["cells"]
    n = 0
    for i, s in enumerate(c["score"]):
        avail = {k: c[k][i] for k in w if c[k][i] is not None}
        cov = sum(w[k] for k in avail)
        if s is None:
            assert cov < d["formula"]["min_coverage"]
            continue
        assert s == pytest.approx(sum(w[k] * v for k, v in avail.items()) / cov, abs=0.0051)
        assert c["index"][i] == math.floor(s * 100 + 0.5)
        n += 1
    assert n == d["stats"]["scored"]
