"""Build the Ancient Water Evidence map from data PAWPRINT has ALREADY processed (no new downloads):

  data/processed/crism_grid.npz      CRISM MTRDR summary parameters, co-registered to CTX (build_nasa_extras.py crism)
  data/processed/ctx_grid.npz        CTX DTM elevation/slope, 20 m (build_layers.py)
  app/public/data/geology_units.geojson   USGS SIM 3464 units clipped to the AOI (build_nasa_extras.py geology)
  app/public/data/pois.json          Perseverance sample sites (only used to NAME zones, "near X")

Writes app/public/data/water_evidence.png + water_evidence.json and merges `layers.water_evidence` into the
manifest. Run:  analysis/.venv/Scripts/python analysis/scripts/build_water_evidence.py
The formula and every assumption are in analysis/pawprint/water.py.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import pathlib
import sys

import numpy as np
from PIL import Image
from rasterio import features
from rasterio.transform import from_origin

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "analysis"))
from pawprint import crism as C  # noqa: E402
from pawprint import water as W  # noqa: E402
from pawprint.sources import AOI, EXTRA_DATASETS  # noqa: E402

PROC = ROOT / "data" / "processed"
WEB = ROOT / "app" / "public" / "data"
M_PER_DEG = 59274.7  # Mars sphere R = 3,396,190 m
CELL_M = 90.0
SUB = 5  # geology sub-samples per cell side (18 m)
ZONE_THRESHOLD = 0.6
SLOPE_TARGET_MAX = 15.0


def grid_spec() -> dict:
    lat_mid = (AOI["lat_min"] + AOI["lat_max"]) / 2
    dlat = CELL_M / M_PER_DEG
    dlon = dlat / math.cos(math.radians(lat_mid))
    rows = int(math.ceil((AOI["lat_max"] - AOI["lat_min"]) / dlat))
    cols = int(math.ceil((AOI["lon_max"] - AOI["lon_min"]) / dlon))
    return {"lon0": AOI["lon_min"], "lat0": AOI["lat_max"], "dlon": dlon, "dlat": dlat, "rows": rows, "cols": cols}


def cell_index(g: dict, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    c = np.floor((lon - g["lon0"]) / g["dlon"]).astype(int)
    r = np.floor((g["lat0"] - lat) / g["dlat"]).astype(int)
    ok = (r >= 0) & (r < g["rows"]) & (c >= 0) & (c < g["cols"])
    return np.where(ok, r * g["cols"] + c, -1)


def crism_components(g: dict) -> dict:
    z = np.load(PROC / "crism_grid.npz")
    H, Wd = z["src"].shape
    lons = float(z["lon0"]) + np.arange(Wd) * float(z["dlon"])
    lats = float(z["lat0"]) - np.arange(H) * float(z["dlat"])
    LON, LAT = np.meshgrid(lons, lats)
    idx = cell_index(g, LON.ravel(), LAT.ravel())
    n = g["rows"] * g["cols"]
    thresholds = {p: C.INDICATORS[p][1] for p in W.AQUEOUS_PARAMS}
    masks = W.mineral_component({p: z[p].astype(float) for p in W.AQUEOUS_PARAMS}, thresholds, C.denoise)
    # Cross-observation check: re-sample EVERY observation (cached PDS bands, same co-registration shifts as the
    # mineral layer) on this grid and drop displayed signals that another observation of the same spot contradicts.
    signal_by_obs, valid_by_obs = per_observation_signals(LON, LAT, thresholds)
    rp = W.replication(signal_by_obs, valid_by_obs, z["src"].astype(int), displayed=masks["strong"] | masks["weak"])
    raw_strong, raw_weak = masks["strong"].copy(), masks["weak"].copy()
    masks["strong"] &= ~rp["contradicted"]
    masks["weak"] &= ~rp["contradicted"]
    for key in W.AQUEOUS_PARAMS.values():
        masks["ind_" + key] &= ~rp["contradicted"]
    measured = (z["src"] >= 0).ravel()
    _, tot = W.aggregate(idx, np.ones(idx.shape), n)
    meas, _ = W.aggregate(idx, measured, n)
    strong, _ = W.aggregate(idx, masks["strong"].ravel(), n)
    weak, _ = W.aggregate(idx, masks["weak"].ravel(), n)
    safe = np.maximum(meas, 1)
    out = {"measured_frac": meas / np.maximum(tot, 1), "strong_frac": strong / safe, "weak_frac": weak / safe}
    bits = np.zeros(n, dtype=int)
    for i, key in enumerate(W.AQUEOUS_PARAMS.values()):
        s, _ = W.aggregate(idx, masks["ind_" + key].ravel(), n)
        bits |= (s > 0).astype(int) << i
    out["indicator_bits"] = bits
    for cls in ("replicated", "single", "contradicted"):
        s, _ = W.aggregate(idx, rp[cls].ravel(), n)
        out["sig_" + cls] = s / safe
    out["pixels"] = {"strong_raw": int(raw_strong.sum()), "weak_raw": int(raw_weak.sum()),
                     "strong": int(masks["strong"].sum()), "weak": int(masks["weak"].sum()), "measured": int(measured.sum()),
                     **{cls: int(rp[cls].sum()) for cls in ("replicated", "single", "contradicted")}}
    return {k: (v.reshape(g["rows"], g["cols"]) if isinstance(v, np.ndarray) else v) for k, v in out.items()}


def per_observation_signals(LON: np.ndarray, LAT: np.ndarray, thresholds: dict) -> tuple[list, list]:
    """Indicator-or-weak mask and measured mask of each CRISM observation on the crism_grid lon/lat grid."""
    sys.path.insert(0, str(ROOT / "analysis" / "scripts"))
    import build_nasa_extras as B  # noqa: E402  (reads the cached PDS range reads; no network when cached)
    man = json.loads((WEB / "manifest.json").read_text(encoding="utf-8"))["layers"]["minerals"]["products"]
    d = B.CRISM_OUT_RES_DEG
    sig, val = [], []
    for (pid, stem), mp in zip(B.CRISM_PRODUCTS, man):
        assert mp["product_id"] == pid
        prod = B.read_crism_product(pid, stem)
        reg = mp["registration"]
        dy, dx = reg["shift_px"] if reg["accepted"] else (0, 0)
        vals = {q: B.sample_product(prod, LON + dx * d, LAT - dy * d, q) for q in W.AQUEOUS_PARAMS}
        m = W.mineral_component(vals, thresholds, C.denoise)
        sig.append(m["strong"] | m["weak"])
        val.append(np.isfinite(vals["D2300"]))
    return sig, val


def ctx_relief(g: dict) -> tuple[np.ndarray, np.ndarray]:
    z = np.load(PROC / "ctx_grid.npz")
    E, S = z["elevation"].astype(float), z["slope"].astype(float)
    H, Wd = E.shape
    lons = float(z["lon0"]) + np.arange(Wd) * float(z["dlon"])
    lats = float(z["lat0"]) - np.arange(H) * float(z["dlat"])
    LON, LAT = np.meshgrid(lons, lats)
    idx = cell_index(g, LON.ravel(), LAT.ravel())
    e, s = E.ravel(), S.ravel()
    n = g["rows"] * g["cols"]
    lo, hi = np.full(n, np.nan), np.full(n, np.nan)
    slope_med = np.full(n, np.nan)
    order = np.argsort(idx, kind="stable")
    idx_s = idx[order]
    starts = np.searchsorted(idx_s, np.arange(n))
    ends = np.searchsorted(idx_s, np.arange(n), side="right")
    for k in range(n):
        sel = order[starts[k]:ends[k]]
        v = e[sel]
        v = v[np.isfinite(v)]
        if v.size >= 4:
            lo[k], hi[k] = np.percentile(v, 5), np.percentile(v, 95)
            slope_med[k] = float(np.nanmedian(s[sel]))
    lo, hi = lo.reshape(g["rows"], g["cols"]), hi.reshape(g["rows"], g["cols"])
    # 3x3 neighbourhood relief (~270 m)
    P = lambda a, fill: np.pad(a, 1, constant_values=fill)  # noqa: E731
    lp, hp = P(np.where(np.isfinite(lo), lo, np.inf), np.inf), P(np.where(np.isfinite(hi), hi, -np.inf), -np.inf)
    rmin = np.min([lp[1 + dr: lp.shape[0] - 1 + dr, 1 + dc: lp.shape[1] - 1 + dc] for dr in (-1, 0, 1) for dc in (-1, 0, 1)], axis=0)
    rmax = np.max([hp[1 + dr: hp.shape[0] - 1 + dr, 1 + dc: hp.shape[1] - 1 + dc] for dr in (-1, 0, 1) for dc in (-1, 0, 1)], axis=0)
    relief = np.where(np.isfinite(lo), rmax - rmin, np.nan)
    return relief, slope_med.reshape(g["rows"], g["cols"])


def geology_fracs(g: dict, geo: dict) -> dict[str, np.ndarray]:
    syms = [u["symbol"] for u in geo["units"]]
    shapes = [(f["geometry"], syms.index(f["properties"]["symbol"]) + 1) for f in geo["features"]]
    tr = from_origin(g["lon0"], g["lat0"], g["dlon"] / SUB, g["dlat"] / SUB)
    ras = features.rasterize(shapes, out_shape=(g["rows"] * SUB, g["cols"] * SUB), transform=tr, fill=0, dtype="int16")
    blocks = ras.reshape(g["rows"], SUB, g["cols"], SUB)
    return {s: (blocks == i + 1).mean(axis=(1, 3)) for i, s in enumerate(syms)}


def crism_signal_shares(cr: dict, rr: np.ndarray, cc: np.ndarray) -> dict:
    """Share of the zone's COUNTED CRISM signal that another observation confirms vs. only one observation saw,
    plus the share of measured pixels whose signal was dropped as contradicted."""
    rep = float(cr["sig_replicated"][rr, cc].sum()); single = float(cr["sig_single"][rr, cc].sum())
    tot = rep + single
    return {"replicated_share": round(rep / tot, 2) if tot else None, "single_share": round(single / tot, 2) if tot else None,
            "contradicted_px_share": round(float(cr["sig_contradicted"][rr, cc].mean()), 3)}


def zone_name(unit: str, dist_m: float, poi: dict, lon: float, lat: float) -> str:
    """'Jezero fan 2 unit, 1.2 km NW of Otis Peak' (direction FROM the sample site TO the zone)."""
    if dist_m < 400:
        return f"{unit} at {poi['name']}"
    ang = math.degrees(math.atan2((lat - poi["lat"]), (lon - poi["lon"]) * math.cos(math.radians(lat))))
    compass = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"][int(((ang + 22.5) % 360) // 45)]
    return f"{unit}, {dist_m / 1000:.1f} km {compass} of {poi['name']}"


def main() -> None:
    g = grid_spec()
    print(f"Water evidence grid {g['rows']}x{g['cols']} cells of {CELL_M:.0f} m")
    cr = crism_components(g)
    relief, slope_med = ctx_relief(g)
    geo = json.loads((WEB / "geology_units.geojson").read_text(encoding="utf-8"))
    fr = geology_fracs(g, geo)
    comps = {
        "mineral": W.mineral_score(cr["strong_frac"], cr["weak_frac"], cr["measured_frac"]),
        "geology": W.geology_score(fr),
        "landform": W.landform_score(relief),
    }
    score, coverage = W.combine(comps)
    score_lo, score_hi = W.score_range(comps)
    full = coverage >= 0.999
    syms = list(fr)
    stack = np.stack([fr[s] for s in syms])
    dom = np.where(stack.max(axis=0) > 0, stack.argmax(axis=0), -1)

    # highlighted regions
    pois = json.loads((WEB / "pois.json").read_text(encoding="utf-8"))
    unit_name = {u["symbol"]: u["name"] for u in geo["units"]}
    zone_out = []
    for k, cells in enumerate(W.zones(score, ZONE_THRESHOLD, eligible=full)[:6]):
        rr = np.array([c[0] for c in cells]); cc = np.array([c[1] for c in cells])
        sc = score[rr, cc]
        sl = slope_med[rr, cc]
        cand = np.where(np.isfinite(sl) & (sl < SLOPE_TARGET_MAX))[0]
        best = cand[np.argmax(sc[cand])] if cand.size else int(np.argmax(sc))
        tr_, tc_ = int(rr[best]), int(cc[best])
        lon = g["lon0"] + (tc_ + 0.5) * g["dlon"]; lat = g["lat0"] - (tr_ + 0.5) * g["dlat"]
        means = {c: (None if not np.isfinite(np.nanmean(comps[c][rr, cc])) else round(float(np.nanmean(comps[c][rr, cc])), 2)) if np.isfinite(comps[c][rr, cc]).any() else None for c in comps}
        dsym = syms[int(np.bincount(dom[rr, cc][dom[rr, cc] >= 0], minlength=len(syms)).argmax())]
        near = min(((math.hypot((p["lon"] - lon) * M_PER_DEG * math.cos(math.radians(lat)), (p["lat"] - lat) * M_PER_DEG), p) for p in pois), key=lambda t: t[0])
        zone_out.append({
            "id": f"W{k + 1}",
            "name": zone_name(unit_name.get(dsym, dsym), near[0], near[1], lon, lat),
            "unit": dsym,
            "cells": len(cells),
            "area_km2": round(len(cells) * CELL_M * CELL_M / 1e6, 2),
            "score_mean": round(float(np.mean(sc)), 2),
            "score_max": round(float(np.max(sc)), 2),
            "components_mean": means,
            "crism_signal": crism_signal_shares(cr, rr, cc),
            "score_low_mean": round(float(np.mean(score_lo[rr, cc])), 2),
            "target": [round(lon, 6), round(lat, 6)],
            "target_slope_deg": None if not np.isfinite(slope_med[tr_, tc_]) else round(float(slope_med[tr_, tc_]), 1),
            "nearest_poi": {"id": near[1]["id"], "name": near[1]["name"], "distance_m": round(near[0])},
            "bbox": [float(g["lon0"] + cc.min() * g["dlon"]), float(g["lat0"] - (rr.max() + 1) * g["dlat"]),
                     float(g["lon0"] + (cc.max() + 1) * g["dlon"]), float(g["lat0"] - rr.min() * g["dlat"])],
        })

    def col(a, nd=2):
        return [None if not np.isfinite(v) else round(float(v), nd) for v in a.ravel()]

    out = {
        "title": "Ancient Water Evidence Map (project-defined index)",
        "generated_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "kind": "estimate",
        "not_a_probability": "Scores rank where orbital data and geologic mapping point to rocks formed or altered by ANCIENT water. "
                             "They are not probabilities of finding water, and say nothing about present-day water, ice or groundwater.",
        "grid": {**g, "cell_m": CELL_M},
        "formula": {
            "expression": "score = Σ wᵢ·sᵢ / Σ wᵢ over the components available in the cell; coverage = Σ wᵢ(available) / Σ wᵢ(all)",
            "weights": W.WEIGHTS,
            "min_coverage": W.MIN_COVERAGE,
            "zones_require_full_coverage": True,
            "mineral": {"params": W.AQUEOUS_PARAMS, "thresholds": {p: C.INDICATORS[p][1] for p in W.AQUEOUS_PARAMS},
                        "weak_fraction": W.WEAK_FRACTION, "weak_credit": W.WEAK_CREDIT, "saturation": W.MINERAL_SATURATION,
                        "min_measured": W.MIN_CRISM_MEASURED,
                        "replication_tol_px": W.REPLICATION_TOL_PX,
                        "text": "M = min(1, (indicator share + 0.4 × weak-signal share) / 0.25) of the cell's measured CRISM pixels, "
                                "counting only signals that no other CRISM observation of the same spot contradicts (±2 px)"},
            "geology": {"unit_prior": W.UNIT_PRIOR, "unit_reason": W.UNIT_REASON,
                        "text": "G = area-weighted prior of the USGS SIM 3464 units in the cell"},
            "landform": {"saturation_m": W.RELIEF_SATURATION_M,
                         "text": "L = min(1, local relief / 40 m), relief = p95 − p5 of CTX DTM elevation over a 3×3-cell (~270 m) window"},
            "bands": [{"below": hi, "label": lbl} for hi, lbl in W.BANDS],
            "assumption": "All weights, priors, thresholds and saturation values are PAWPRINT assumptions, not calibrated values.",
        },
        "units": [{"symbol": s, "name": unit_name.get(s, s), "prior": W.UNIT_PRIOR.get(s), "reason": W.UNIT_REASON.get(s)} for s in syms],
        "indicator_keys": list(W.AQUEOUS_PARAMS.values()),
        "cells": {
            "score": col(score), "coverage": col(coverage), "mineral": col(comps["mineral"]), "geology": col(comps["geology"]),
            "landform": col(comps["landform"]), "relief_m": col(relief, 1), "crism_measured": col(cr["measured_frac"]),
            "crism_indicator": col(cr["strong_frac"], 3), "crism_weak": col(cr["weak_frac"], 3),
            "crism_replicated": col(cr["sig_replicated"], 3), "crism_single": col(cr["sig_single"], 3),
            "crism_contradicted": col(cr["sig_contradicted"], 3),
            "score_low": col(score_lo), "score_high": col(score_hi),
            "indicator_bits": [int(v) for v in cr["indicator_bits"].ravel()], "unit": [int(v) for v in dom.ravel()],
        },
        "zones": zone_out,
        "zone_threshold": ZONE_THRESHOLD,
        "stats": {
            "cells": int(score.size), "scored": int(np.isfinite(score).sum()),
            "insufficient": int((~np.isfinite(score)).sum()),
            "mineral_missing": int((~np.isfinite(comps["mineral"])).sum()),
            "geology_missing": int((~np.isfinite(comps["geology"])).sum()),
            "landform_missing": int((~np.isfinite(comps["landform"])).sum()),
            "crism_pixels": cr["pixels"],
            "score_p50": round(float(np.nanpercentile(score, 50)), 3), "score_p90": round(float(np.nanpercentile(score, 90)), 3),
            "score_max": round(float(np.nanmax(score)), 3),
            "mineral_mean": round(float(np.nanmean(comps["mineral"])), 3),
            "partial_coverage_scored": int((np.isfinite(score) & ~full).sum()),
        },
        "sources": ["crism_mtrdr", "usgs_sim3464", "ctx_dtm"],
        "rejected": EXTRA_DATASETS["water_rejected"]["items"],
    }
    (WEB / "water_evidence.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    Image.fromarray(W.render_rgba(score)).save(WEB / "water_evidence.png", optimize=True)
    bounds = [[g["lat0"] - g["rows"] * g["dlat"], g["lon0"]], [g["lat0"], g["lon0"] + g["cols"] * g["dlon"]]]
    mf = WEB / "manifest.json"
    m = json.loads(mf.read_text(encoding="utf-8"))
    m["layers"]["water_evidence"] = {"file": "water_evidence.png", "data": "water_evidence.json", "bounds": bounds, "kind": "estimate",
                                     "sources": out["sources"], "cell_m": CELL_M, "zones": len(zone_out)}
    m["datasets"].pop("water_rejected", None)  # documented in water_evidence.json, not a dataset card
    m.setdefault("extras_generated_utc", {})["water_evidence"] = out["generated_utc"]
    mf.write_text(json.dumps(m, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(out["stats"], indent=1))
    for z in zone_out:
        print(f"  {z['id']} {z['name']:<45} {z['area_km2']:>5} km2  mean {z['score_mean']} max {z['score_max']}  {z['components_mean']}  target slope {z['target_slope_deg']}")


if __name__ == "__main__":
    main()
