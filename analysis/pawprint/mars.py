"""Mars geodesy helpers.

All PAWPRINT MARS products use the Mars 2020 TRN map projection:
Equidistant Cylindrical (``+proj=eqc +lat_ts=0 +lon_0=0 +R=3396190``), i.e. the
IAU Mars sphere radius of 3,396,190 m, planetocentric latitude and
east-positive longitude. In this projection x = R * lon_rad and y = R * lat_rad,
so the conversions below are exact for the source rasters.
"""
from __future__ import annotations

import math

MARS_RADIUS_M = 3_396_190.0  # IAU 2000 Mars sphere, as declared in the TRN GeoTIFF CRS
MARS_GRAVITY_MS2 = 3.72076  # standard Mars surface gravity (for EVA metabolic notes)
METERS_PER_DEGREE = MARS_RADIUS_M * math.pi / 180.0  # ~59,274.7 m along a meridian

EQC_PROJ4 = "+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs"


def lonlat_to_eqc(lon_deg: float, lat_deg: float) -> tuple[float, float]:
    """Planetocentric lon/lat (deg, east-positive) -> eqc metres."""
    return (math.radians(lon_deg) * MARS_RADIUS_M, math.radians(lat_deg) * MARS_RADIUS_M)


def eqc_to_lonlat(x_m: float, y_m: float) -> tuple[float, float]:
    """eqc metres -> planetocentric lon/lat (deg, east-positive)."""
    return (math.degrees(x_m / MARS_RADIUS_M), math.degrees(y_m / MARS_RADIUS_M))


def great_circle_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Haversine distance on the Mars sphere, metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * MARS_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def ground_scale_x(lat_deg: float) -> float:
    """True east-west ground distance per eqc metre at a latitude.

    eqc with lat_ts=0 preserves distance along meridians and the equator only;
    at latitude phi an eqc metre in x spans cos(phi) metres on the ground.
    At Jezero (~18.4 N) this is ~0.949, a 5 % correction we must not ignore.
    """
    return math.cos(math.radians(lat_deg))
