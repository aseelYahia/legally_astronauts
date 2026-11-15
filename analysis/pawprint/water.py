"""Ancient Water Evidence index: a transparent, PROJECT-DEFINED score for Jezero Crater.

What it is: a weighted average of three evidence components, each in [0, 1], computed on a ~90 m grid:

  M  mineral  - CRISM MTRDR summary parameters (18 m). Share of the cell's measured CRISM pixels whose
                aqueous-alteration parameters (carbonate MIN2295_2480 / MIN2345_2537, Fe/Mg-OH D2300,
                Al-OH BD2210_2, hydration BD1900R2) exceed the app's indicator thresholds (full weight) or
                reach at least WEAK_FRACTION of them ("weak signal", WEAK_CREDIT weight), after the same 4-of-8
                neighbour coherence filter the mineral layer uses. Saturates when MINERAL_SATURATION of the
                cell is flagged. Olivine and pyroxene are NOT counted: they are igneous minerals, not water evidence.
  G  geology  - USGS SIM 3464 unit (Sun & Stack 2020) area-weighted over the cell, mapped to a prior from the
                USGS unit interpretation text (UNIT_PRIOR). Deltaic fan = 1.0 ... Amazonian wind ripples = 0.
  L  landform - Local relief from the CTX DTM (20 m): elevation range (p95 - p5) over the cell and its 8
                neighbours (~270 m), divided by RELIEF_SATURATION_M. Delta-front scarps, inverted channel ridges
                and butte flanks expose layered rock; flat floor does not. Relief alone is not water evidence.

  Only CRISM signals that no independent observation contradicts are counted (see ``replication``).

  score = sum(w_i * s_i) / sum(w_i)   over the components AVAILABLE in that cell
  coverage = sum(w_i available) / sum(w_i all)

A cell whose coverage is below MIN_COVERAGE is "insufficient data" (drawn hatched, never as low evidence).
Highlighted regions use only cells with ALL components measured (coverage = 1): re-normalising over the
available components would otherwise rank a cell without CRISM as if its missing mineral term matched the others.

Everything here (weights, priors, thresholds, saturation values) is a PAWPRINT ASSUMPTION chosen to be
explainable, not a calibrated model. The score ranks where orbital data and mapping point to ANCIENT
water-related rocks. It is NOT a probability of finding water, NOT a groundwater or ice map, and says nothing
about present-day water.
"""
from __future__ import annotations

import math
from collections import deque

import numpy as np

WEIGHTS = {"mineral": 0.45, "geology": 0.40, "landform": 0.15}

# CRISM aqueous parameters and the app's existing indicator thresholds (pawprint.crism.INDICATORS).
AQUEOUS_PARAMS = {
    "MIN2295_2480": "mg_carbonate",
    "MIN2345_2537": "fe_ca_carbonate",
    "D2300": "fe_mg_phyllosilicate",
    "BD2210_2": "al_oh",
    "BD1900R2": "hydration",
}
WEAK_FRACTION = 0.75       # "weak signal" = parameter >= 75 % of its indicator threshold
WEAK_CREDIT = 0.4          # a weak-signal pixel counts 40 % of an indicator pixel
MINERAL_SATURATION = 0.25  # M = 1 when a quarter of the cell's measured pixels are indicator pixels
MIN_CRISM_MEASURED = 0.5   # M is missing when CRISM measured < half the cell

RELIEF_SATURATION_M = 40.0  # L = 1 at >= 40 m local relief
MIN_COVERAGE = 0.5          # below this share of the total weight a cell is "insufficient data"

# Prior per SIM 3464 unit, justified by the USGS "Unit_Interpretation" field (quoted in UNIT_REASON).
UNIT_PRIOR = {"NHjf2": 1.0, "NHjf1": 1.0, "Nle": 0.5, "Njf": 0.4, "Nue": 0.15, "cr": 0.1, "Aeb": 0.0}
UNIT_REASON = {
    "NHjf2": "USGS: deltaic fan deposits; inlet and outlet channels 'suggest deposition into a lacustrine environment'.",
    "NHjf1": "USGS: older deltaic fan deposits of the same lake system.",
    "Nle": "USGS: 'either deposited into an existing lake within Jezero or subsequently altered by later lacustrine processes'.",
    "Njf": "USGS: volcanic ash or airfall deposit that 'may have been modified by subsequent lacustrine activity'.",
    "Nue": "USGS: volcanic ash or other clastic drape; no lake link stated, but it lies inside the former lake basin.",
    "cr": "USGS: impact target rock uplifted in the crater rim; not a water-lain deposit.",
    "Aeb": "USGS: young (Amazonian) wind-blown ripples that cover older rock, so they hide rather than show water evidence.",
}

BANDS = [(0.2, "Low"), (0.4, "Modest"), (0.6, "Moderate"), (0.8, "High"), (1.01, "Very high")]


def band_label(score: float | None) -> str:
    if score is None or not math.isfinite(score):
        return "Insufficient data"
    return next(lbl for hi, lbl in BANDS if score < hi)


def mineral_component(params: dict[str, np.ndarray], thresholds: dict[str, float], denoise) -> dict[str, np.ndarray]:
    """Per-PIXEL aqueous indicator / weak-signal masks on the CRISM grid (NaN = not measured, never flagged)."""
    strong = np.zeros(next(iter(params.values())).shape, dtype=bool)
    weak = np.zeros_like(strong)
    per = {}
    for p, key in AQUEOUS_PARAMS.items():
        v = params.get(p)
        if v is None:
            continue
        thr = thresholds[p]
        fin = np.isfinite(v)
        s = denoise(fin & (v > thr))
        w = denoise(fin & (v >= thr * WEAK_FRACTION)) & ~s
        per[key] = s
        strong |= s
        weak |= w
    weak &= ~strong
    return {"strong": strong, "weak": weak, **{"ind_" + k: m for k, m in per.items()}}


REPLICATION_TOL_PX = 2  # co-registration is integer-pixel; allow +/- 2 px (36 m) when comparing observations


def dilate(mask: np.ndarray, r: int) -> np.ndarray:
    out = mask.copy()
    H, W_ = mask.shape
    for dr in range(-r, r + 1):
        for dc in range(-r, r + 1):
            if dr == dc == 0:
                continue
            src = mask[max(0, -dr): H - max(0, dr), max(0, -dc): W_ - max(0, dc)]
            out[max(0, dr): H - max(0, -dr), max(0, dc): W_ - max(0, -dc)] |= src
    return out


def replication(signal_by_obs: list[np.ndarray], valid_by_obs: list[np.ndarray], winner: np.ndarray,
                tol: int = REPLICATION_TOL_PX, displayed: np.ndarray | None = None) -> dict[str, np.ndarray]:
    """Classify each signal pixel of the displayed (winning) observation by what the OTHER observations saw.

    signal_by_obs[k]: indicator-or-weak mask of observation k on the common grid; valid_by_obs[k]: k measured it;
    winner: index of the observation shown at each pixel (-1 = none); displayed: optional signal mask of the
    stitched mosaic to classify (defaults to each winner's own mask).
      replicated    - another observation that measured the spot also has a signal within +/- tol px
      single        - no other observation measured the spot (cannot be checked)
      contradicted  - at least one other observation measured the spot and shows NO signal within +/- tol px
    Added after the 2026-11-15 audit: FRT00005C5E covers all of FRT000047A3 and confirms none of its 149
    indicator pixels, so unreplicated signals there must not count as evidence."""
    n = len(signal_by_obs)
    if displayed is not None:  # the stitched mosaic's own signal mask (denoised after stitching)
        sig = displayed & (winner >= 0)
    else:
        sig = np.zeros(winner.shape, dtype=bool)
        for k in range(n):
            sig |= (winner == k) & signal_by_obs[k]
    near = [dilate(s, tol) for s in signal_by_obs]
    checked = np.zeros(winner.shape, dtype=bool)
    agreed = np.zeros(winner.shape, dtype=bool)
    for k in range(n):
        mine = winner == k
        for j in range(n):
            if j == k:
                continue
            other_valid = valid_by_obs[j] & mine
            checked |= other_valid
            agreed |= other_valid & near[j]
    return {"replicated": sig & agreed, "single": sig & ~checked, "contradicted": sig & checked & ~agreed}


def score_range(components: dict[str, np.ndarray], weights: dict[str, float] = WEIGHTS) -> tuple[np.ndarray, np.ndarray]:
    """Score if every MISSING component were 0 (low) or 1 (high). Equal to the score where nothing is missing."""
    lo = 0.0
    hi = 0.0
    for k, w in weights.items():
        c = components[k]
        ok = np.isfinite(c)
        lo = lo + np.where(ok, c, 0.0) * w
        hi = hi + np.where(ok, c, 1.0) * w
    tot = sum(weights.values())
    return lo / tot, hi / tot


def aggregate(cell_idx: np.ndarray, values: np.ndarray, n_cells: int) -> tuple[np.ndarray, np.ndarray]:
    """Sum and count of ``values`` per cell (cell_idx < 0 = outside the grid)."""
    ok = cell_idx >= 0
    s = np.bincount(cell_idx[ok], weights=values[ok].astype(float), minlength=n_cells)
    n = np.bincount(cell_idx[ok], minlength=n_cells).astype(float)
    return s, n


def mineral_score(strong_frac: np.ndarray, weak_frac: np.ndarray, measured_frac: np.ndarray) -> np.ndarray:
    m = np.clip((strong_frac + WEAK_CREDIT * weak_frac) / MINERAL_SATURATION, 0.0, 1.0)
    return np.where(measured_frac >= MIN_CRISM_MEASURED, m, np.nan)


def geology_score(unit_fracs: dict[str, np.ndarray]) -> np.ndarray:
    """Area-weighted unit prior; NaN where no mapped unit covers the cell. Unknown symbols are ignored."""
    num = None
    den = None
    for sym, f in unit_fracs.items():
        if sym not in UNIT_PRIOR:
            continue
        num = f * UNIT_PRIOR[sym] if num is None else num + f * UNIT_PRIOR[sym]
        den = f if den is None else den + f
    if num is None:
        raise ValueError("no known units")
    return np.where(den > 0.25, num / np.maximum(den, 1e-9), np.nan)


def landform_score(relief_m: np.ndarray) -> np.ndarray:
    return np.clip(relief_m / RELIEF_SATURATION_M, 0.0, 1.0)


def combine(components: dict[str, np.ndarray], weights: dict[str, float] = WEIGHTS) -> tuple[np.ndarray, np.ndarray]:
    """Weighted mean over available components -> (score, coverage). score is NaN when coverage < MIN_COVERAGE."""
    total = sum(weights.values())
    num = 0.0
    den = 0.0
    for k, w in weights.items():
        c = components[k]
        ok = np.isfinite(c)
        num = num + np.where(ok, c, 0.0) * w
        den = den + ok * w
    coverage = den / total
    score = np.where(coverage >= MIN_COVERAGE, num / np.maximum(den, 1e-9), np.nan)
    return score, coverage


def zones(score: np.ndarray, threshold: float, min_cells: int = 4, eligible: np.ndarray | None = None) -> list[list[tuple[int, int]]]:
    """8-connected clusters of cells with score >= threshold (and ``eligible``, e.g. full coverage), largest first."""
    H, W = score.shape
    hit = np.isfinite(score) & (score >= threshold)
    if eligible is not None:
        hit &= eligible
    seen = np.zeros_like(hit)
    out = []
    for r0 in range(H):
        for c0 in range(W):
            if not hit[r0, c0] or seen[r0, c0]:
                continue
            q = deque([(r0, c0)])
            seen[r0, c0] = True
            cells = []
            while q:
                r, c = q.popleft()
                cells.append((r, c))
                for dr in (-1, 0, 1):
                    for dc in (-1, 0, 1):
                        rr, cc = r + dr, c + dc
                        if 0 <= rr < H and 0 <= cc < W and hit[rr, cc] and not seen[rr, cc]:
                            seen[rr, cc] = True
                            q.append((rr, cc))
            if len(cells) >= min_cells:
                out.append(cells)
    return sorted(out, key=len, reverse=True)


# Soft Cosmic ramp: pale turquoise (low) -> lavender (high). Missing data is hatched grey, never on the ramp.
RAMP = [(0.0, (206, 242, 236)), (0.3, (118, 201, 194)), (0.6, (159, 184, 232)), (0.85, (169, 155, 221)), (1.0, (124, 104, 206))]


def ramp_rgb(t: float) -> tuple[int, int, int]:
    t = min(1.0, max(0.0, float(t)))
    for (t0, c0), (t1, c1) in zip(RAMP, RAMP[1:]):
        if t <= t1:
            f = (t - t0) / (t1 - t0)
            return tuple(int(round(x + (y - x) * f)) for x, y in zip(c0, c1))  # type: ignore[return-value]
    return RAMP[-1][1]


def render_rgba(score: np.ndarray, scale: int = 6) -> np.ndarray:
    """RGBA image: ramp colour for scored cells, transparent-ish diagonal hatch for insufficient data."""
    H, W = score.shape
    img = np.zeros((H * scale, W * scale, 4), dtype=np.uint8)
    yy, xx = np.mgrid[0: H * scale, 0: W * scale]
    hatch = ((xx + yy) % 6) < 2
    for r in range(H):
        for c in range(W):
            s = score[r, c]
            blk = img[r * scale:(r + 1) * scale, c * scale:(c + 1) * scale]
            if np.isfinite(s):
                blk[...] = (*ramp_rgb(float(s)), 215)
            else:
                h = hatch[r * scale:(r + 1) * scale, c * scale:(c + 1) * scale]
                blk[h] = (150, 146, 170, 200)
                blk[~h] = (40, 38, 60, 70)
    return img
