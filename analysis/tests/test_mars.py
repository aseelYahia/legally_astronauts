import math

import pytest

from pawprint.mars import (
    MARS_RADIUS_M,
    METERS_PER_DEGREE,
    eqc_to_lonlat,
    great_circle_m,
    ground_scale_x,
    lonlat_to_eqc,
)


def test_meters_per_degree_mars():
    assert METERS_PER_DEGREE == pytest.approx(59274.7, abs=0.1)


def test_eqc_round_trip_at_jezero():
    lon, lat = 77.45088572, 18.44462715  # first Perseverance localization (NASA MMGIS)
    x, y = lonlat_to_eqc(lon, lat)
    lon2, lat2 = eqc_to_lonlat(x, y)
    assert lon2 == pytest.approx(lon, abs=1e-12)
    assert lat2 == pytest.approx(lat, abs=1e-12)


def test_eqc_matches_ctx_geotiff_corner():
    # Left edge of the USGS CTX DTM (from its GeoTIFF header) is x=4573663.250853 m
    lon, _ = eqc_to_lonlat(4573663.250853, 0)
    assert lon == pytest.approx(77.1600, abs=1e-3)


def test_great_circle_quarter_meridian():
    assert great_circle_m(0, 0, 0, 90) == pytest.approx(math.pi * MARS_RADIUS_M / 2, rel=1e-12)


def test_great_circle_small_distance_matches_planar():
    # 0.01 deg of latitude ~ 592.7 m on Mars
    assert great_circle_m(77.4, 18.4, 77.4, 18.41) == pytest.approx(592.747, abs=0.01)


def test_ground_scale_x_at_jezero():
    assert ground_scale_x(18.44) == pytest.approx(math.cos(math.radians(18.44)))
    assert 0.94 < ground_scale_x(18.44) < 0.96
