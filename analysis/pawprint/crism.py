"""CRISM MTRDR summary-parameter products: projection math and mineral-INDICATOR flags.

Products: MRO CRISM Map-projected Targeted Reduced Data Records (MTRDR), "SR" refined spectral summary
parameter cubes (Viviano-Beck et al. 2014, JGR Planets 119, doi:10.1002/2014JE004627; Seelos et al. 2016),
PDS volume MROCR_4001, https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/.

Projection (from each product's ENVI header / PDS label): equirectangular, standard parallel 15 deg N,
sphere radius 3,394,839.8 m (IAU 2000 "custom sphere lat15"), planetocentric, east-positive.
  x = R * cos(15 deg) * lon_rad,   y = R * lat_rad
Note the radius differs from the TRN rasters (3,396,190 m); we convert through lon/lat, never metres.

Indicator thresholds below are PAWPRINT ASSUMPTIONS chosen to be conservative for display. A flagged pixel
means "the summary parameter exceeds the threshold", i.e. a POTENTIAL mineral indicator, not a confirmed
identification. Confirmation needs full spectral analysis (ratioed I/F spectra), which this app does not do.
"""
from __future__ import annotations

import math
import re

import numpy as np

from .mars import MARS_RADIUS_M

CRISM_IGNORE = 65535.0

# parameter -> (indicator key, threshold, meaning)
INDICATORS: dict[str, tuple[str, float, str]] = {
    "MIN2295_2480": ("mg_carbonate", 0.01,
                     "Both the 2.3 and 2.5 µm absorptions are present: consistent with Mg-carbonate "
                     "(can also respond to some Mg-phyllosilicates)."),
    "MIN2345_2537": ("fe_ca_carbonate", 0.01,
                     "Both the 2.35 and 2.54 µm absorptions are present: consistent with Ca/Fe-carbonate."),
    "OLINDEX3": ("olivine", 0.12,
                 "Broad 1 µm absorption shaped like olivine; also raised by Fe-bearing glass or some carbonates."),
    "D2300": ("fe_mg_phyllosilicate", 0.015,
              "2.3 µm drop typical of Fe/Mg-OH (e.g. smectite clays); carbonates can raise it too."),
    "BD2210_2": ("al_oh", 0.01, "2.21 µm absorption typical of Al-OH minerals (e.g. Al clays, hydrated silica)."),
    "BD1900R2": ("hydration", 0.015, "1.9 µm water absorption: some hydrated mineral is present."),
    "LCPINDEX2": ("low_ca_pyroxene", 0.03, "1 and 2 µm absorptions typical of low-calcium pyroxene."),
}
PARAMS = ["R770"] + list(INDICATORS)

# Display priority (first match colours the pixel); every flag is still reported on click.
PRIORITY = ["mg_carbonate", "fe_ca_carbonate", "olivine", "fe_mg_phyllosilicate", "al_oh", "low_ca_pyroxene", "hydration"]


def parse_envi_header(text: str) -> dict:
    h: dict = {}
    for key in ("samples", "lines", "bands", "data type", "byte order", "header offset"):
        m = re.search(rf"^{key}\s*=\s*([-\d.eE+]+)", text, re.M)
        if m:
            h[key] = int(float(m.group(1)))
    m = re.search(r"interleave\s*=\s*(\w+)", text)
    h["interleave"] = m.group(1).lower() if m else None
    m = re.search(r"band names\s*=\s*\{([^}]*)\}", text, re.S)
    h["band_names"] = [b.strip() for b in m.group(1).replace("\n", " ").split(",")] if m else []
    m = re.search(r"map info\s*=\s*\{([^}]*)\}", text, re.S)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        h["ref_px"] = (float(parts[1]), float(parts[2]))
        h["ul_xy"] = (float(parts[3]), float(parts[4]))
        h["px_size"] = (float(parts[5]), float(parts[6]))
    m = re.search(r"projection info\s*=\s*\{\s*\d+\s*,\s*([\d.]+)\s*,\s*([-\d.]+)", text)
    if m:
        h["radius_m"] = float(m.group(1))
        h["std_parallel_deg"] = float(m.group(2))
    return h


class CrismGrid:
    """Pixel <-> lon/lat for one MTRDR product (pixel centres; ENVI reference pixel is 1-based)."""

    def __init__(self, hdr: dict):
        self.R = hdr["radius_m"]
        self.k = math.cos(math.radians(hdr["std_parallel_deg"]))
        self.res = hdr["px_size"][0]
        rx, ry = hdr["ref_px"]
        ux, uy = hdr["ul_xy"]
        # x of the left edge of column 0 and y of the top edge of row 0
        self.x0 = ux - (rx - 1.0) * self.res
        self.y0 = uy + (ry - 1.0) * self.res
        self.samples, self.lines = hdr["samples"], hdr["lines"]

    def lonlat_to_px(self, lon, lat):
        x = self.R * self.k * np.radians(lon)
        y = self.R * np.radians(lat)
        col = (x - self.x0) / self.res - 0.5
        row = (self.y0 - y) / self.res - 0.5
        return row, col

    def px_to_lonlat(self, row, col):
        x = self.x0 + (np.asarray(col) + 0.5) * self.res
        y = self.y0 - (np.asarray(row) + 0.5) * self.res
        return np.degrees(x / (self.R * self.k)), np.degrees(y / self.R)


def indicator_flags(params: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Boolean flag per indicator; NaN (no measurement) is never flagged."""
    out = {}
    for p, (key, thr, _) in INDICATORS.items():
        v = params.get(p)
        if v is None:
            continue
        out[key] = np.isfinite(v) & (v > thr)
    return out


def indicators_at(grid: dict, lon: float, lat: float) -> dict | None:
    """Look up the co-registered CRISM values at a point in a ``crism_grid.npz``-style dict.
    Returns None outside the grid or where no CRISM measurement exists."""
    c = int(round((lon - float(grid["lon0"])) / float(grid["dlon"])))
    r = int(round((float(grid["lat0"]) - lat) / float(grid["dlat"])))
    src = grid["src"]
    if not (0 <= r < src.shape[0] and 0 <= c < src.shape[1]) or int(src[r, c]) < 0:
        return None
    params = {p: (None if not np.isfinite(grid[p][r, c]) else round(float(grid[p][r, c]), 5)) for p in PARAMS}
    flags = [key for _, (key, _, _) in INDICATORS.items() if bool(grid.get("flag_" + key, np.zeros((1, 1)))[r, c])]
    return {"product_index": int(src[r, c]), "params": params, "indicators": flags, "cell": [r, c]}


def denoise(flag: np.ndarray, min_neighbours: int = 4) -> np.ndarray:
    """Keep a flagged pixel only if at least ``min_neighbours`` of its 8 neighbours are flagged too
    (suppresses single-pixel noise; a spatial-coherence ASSUMPTION)."""
    f = np.pad(flag.astype(np.uint8), 1)
    n = sum(
        f[1 + dr: f.shape[0] - 1 + dr, 1 + dc: f.shape[1] - 1 + dc]
        for dr in (-1, 0, 1) for dc in (-1, 0, 1) if (dr, dc) != (0, 0)
    )
    return flag & (n >= min_neighbours)


def row_cell_area_km2(lat_centres_deg: np.ndarray, dlat_deg: float, dlon_deg: float,
                      radius_m: float = MARS_RADIUS_M) -> np.ndarray:
    """Exact ground area (km²) of one cell in each row of a regular lon/lat grid on the Mars sphere.

    A cell spanning ``dlon`` x ``dlat`` degrees centred at latitude phi covers the spherical band area
    R² · dlon_rad · (sin(phi + dlat/2) - sin(phi - dlat/2)) — i.e. ~R·dlat_rad north-south by
    ~R·dlon_rad·cos(phi) east-west. Using a square 18 m x 18 m cell instead overstates areas by
    1/cos(phi) (~5 % at Jezero). Default radius is the TRN/CTX sphere (3,396,190 m).
    """
    phi = np.radians(np.asarray(lat_centres_deg, dtype=float))
    h = math.radians(dlat_deg) / 2
    band = np.sin(phi + h) - np.sin(phi - h)
    return radius_m ** 2 * math.radians(dlon_deg) * band / 1e6


def mask_area_km2(mask: np.ndarray, row_area_km2: np.ndarray) -> float:
    """Ground area (km²) of the True cells of a (rows x cols) mask, weighting each row by its cell area."""
    return float(np.asarray(mask, dtype=bool).sum(axis=1) @ np.asarray(row_area_km2, dtype=float))
