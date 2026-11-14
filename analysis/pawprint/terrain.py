"""Terrain derivatives computed from a DTM on the Mars eqc grid.

Ground spacing: the TRN rasters are equidistant-cylindrical with lat_ts=0, so a
pixel is ``res`` metres along the meridian (y) but only ``res * cos(lat)``
metres on the ground east-west (x). Every derivative here uses true ground
spacing, varying per row.
"""
from __future__ import annotations

import numpy as np

# --- Planning thresholds -------------------------------------------------------
# These are PAWPRINT MARS planning assumptions for a suited astronaut on foot,
# NOT NASA requirements. They are surfaced in the UI as assumptions.
SLOPE_CLASSES_DEG = (10.0, 15.0, 25.0)  # <10 easy, 10-15 moderate, 15-25 hazard, >=25 no-go
DEFAULT_MAX_SLOPE_DEG = 25.0


def row_ground_dx(res_x: float, lat_deg_rows: np.ndarray) -> np.ndarray:
    """Ground east-west spacing (m) for each raster row."""
    return res_x * np.cos(np.radians(lat_deg_rows))


def _pad_edge(a: np.ndarray) -> np.ndarray:
    return np.pad(a, 1, mode="edge")


def slope_aspect(dem: np.ndarray, dx_rows: np.ndarray, dy: float) -> tuple[np.ndarray, np.ndarray]:
    """Horn (1981) 3x3 slope and aspect.

    dem: 2-D elevation (m), NaN for nodata. Row 0 is NORTH (GeoTIFF order).
    dx_rows: ground spacing in x for each row (m), shape (rows,).
    dy: ground spacing in y (m).
    Returns slope in degrees and aspect in degrees clockwise from north
    (direction the slope faces, i.e. downhill direction).
    """
    z = _pad_edge(dem.astype(np.float64))
    a, b, c = z[:-2, :-2], z[:-2, 1:-1], z[:-2, 2:]
    d, f = z[1:-1, :-2], z[1:-1, 2:]
    g, h, i = z[2:, :-2], z[2:, 1:-1], z[2:, 2:]
    dx = np.asarray(dx_rows, dtype=np.float64)[:, None]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8.0 * dx)  # +east
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8.0 * dy)  # +south (rows increase southward)
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    # downhill direction: east component -dzdx, north component +dzdy (since dzdy is +south)
    aspect = (np.degrees(np.arctan2(-dzdx, dzdy)) + 360.0) % 360.0
    return slope, aspect


def roughness_rms(dem: np.ndarray) -> np.ndarray:
    """Terrain Ruggedness Index (Riley et al. 1999): RMS elevation difference to
    the 8 neighbours, metres. Edge cells use replicated borders."""
    z = _pad_edge(dem.astype(np.float64))
    centre = z[1:-1, 1:-1]
    acc = np.zeros_like(centre)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            nb = z[1 + dr : z.shape[0] - 1 + dr, 1 + dc : z.shape[1] - 1 + dc]
            acc += (nb - centre) ** 2
    return np.sqrt(acc / 8.0)


def hazard_class(slope_deg: np.ndarray, thresholds=SLOPE_CLASSES_DEG) -> np.ndarray:
    """0 easy, 1 moderate, 2 hazard, 3 no-go, 255 nodata."""
    out = np.digitize(slope_deg, thresholds).astype(np.uint8)
    out[~np.isfinite(slope_deg)] = 255
    return out


def hillshade(dem: np.ndarray, dx_rows: np.ndarray, dy: float, azimuth=315.0, altitude=45.0) -> np.ndarray:
    """Standard illumination model, 0..1. Azimuth clockwise from north."""
    z = _pad_edge(dem.astype(np.float64))
    dx = np.asarray(dx_rows, dtype=np.float64)[:, None]
    dzdx = ((z[:-2, 2:] + 2 * z[1:-1, 2:] + z[2:, 2:]) - (z[:-2, :-2] + 2 * z[1:-1, :-2] + z[2:, :-2])) / (8 * dx)
    dzdn = ((z[:-2, :-2] + 2 * z[:-2, 1:-1] + z[:-2, 2:]) - (z[2:, :-2] + 2 * z[2:, 1:-1] + z[2:, 2:])) / (8 * dy)  # +north
    slope = np.arctan(np.hypot(dzdx, dzdn))
    # aspect of the upslope gradient expressed clockwise from north
    az = np.radians(azimuth)
    alt = np.radians(altitude)
    # illumination = cos(zenith)cos(slope) + sin(zenith)sin(slope)cos(az - aspect_downhill)
    downhill = np.arctan2(-dzdx, -dzdn)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - downhill)
    return np.clip(shade, 0.0, 1.0)


def block_reduce(a: np.ndarray, k: int, how: str = "mean") -> np.ndarray:
    """Reduce by integer factor k (crops remainder). NaN-aware."""
    r, c = (a.shape[0] // k) * k, (a.shape[1] // k) * k
    v = a[:r, :c].reshape(r // k, k, c // k, k)
    if how == "mean":
        return np.nanmean(v, axis=(1, 3))
    if how == "max":
        return np.nanmax(v, axis=(1, 3))
    raise ValueError(how)
