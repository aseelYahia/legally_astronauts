import math

import numpy as np
import pytest

from pawprint import terrain as T


def plane(rows, cols, res, east_grad=0.0, north_grad=0.0):
    """z rises east by east_grad (m/m) and north by north_grad. Row 0 = north."""
    yy, xx = np.mgrid[0:rows, 0:cols]
    return xx * res * east_grad + (rows - 1 - yy) * res * north_grad


@pytest.mark.parametrize("deg", [0, 5, 10, 20, 35])
def test_slope_of_tilted_plane(deg):
    z = plane(20, 20, 2.0, east_grad=math.tan(math.radians(deg)))
    s, _ = T.slope_aspect(z, np.full(20, 2.0), 2.0)
    assert np.allclose(s[1:-1, 1:-1], deg, atol=1e-9)


def test_slope_uses_ground_dx_not_eqc_dx():
    # Same raster, but x ground spacing shrunk by cos(18.44 deg) -> steeper slope.
    z = plane(10, 10, 20.0, east_grad=0.1)
    dx = np.full(10, 20.0 * math.cos(math.radians(18.44)))
    s, _ = T.slope_aspect(z, dx, 20.0)
    expected = math.degrees(math.atan(0.1 / math.cos(math.radians(18.44))))
    assert s[5, 5] == pytest.approx(expected, abs=1e-9)


@pytest.mark.parametrize(
    "east,north,aspect",
    [(1, 0, 270.0), (-1, 0, 90.0), (0, 1, 180.0), (0, -1, 0.0)],
)
def test_aspect_faces_downhill(east, north, aspect):
    z = plane(9, 9, 1.0, east_grad=0.2 * east, north_grad=0.2 * north)
    _, a = T.slope_aspect(z, np.ones(9), 1.0)
    assert a[4, 4] % 360 == pytest.approx(aspect, abs=1e-9)


def test_roughness_zero_on_plane_and_positive_on_spike():
    z = plane(9, 9, 1.0, east_grad=0.3)
    # TRI on a plane is not zero (neighbours differ), but is constant in the interior
    r = T.roughness_rms(z)
    assert np.allclose(r[1:-1, 1:-1], r[4, 4])
    flat = np.zeros((7, 7))
    flat[3, 3] = 4.0
    rf = T.roughness_rms(flat)
    assert rf[3, 3] == pytest.approx(4.0)
    assert T.roughness_rms(np.zeros((5, 5))).max() == 0


def test_hazard_classes_and_nodata():
    s = np.array([0, 9.99, 10, 14.9, 15, 24.9, 25, 60, np.nan])
    assert T.hazard_class(s).tolist() == [0, 0, 1, 1, 2, 2, 3, 3, 255]


def test_hillshade_flat_equals_sin_altitude():
    hs = T.hillshade(np.zeros((5, 5)), np.ones(5), 1.0, altitude=45)
    assert np.allclose(hs, math.sin(math.radians(45)))


def test_hillshade_lit_vs_shadowed():
    # Slope facing NW (toward 315 sun) should be brighter than slope facing SE
    nw = plane(9, 9, 1.0, east_grad=-0.5, north_grad=0.5)  # downhill to... rises to NE? check: z rises west & north
    se = -nw
    hs_nw_rising = T.hillshade(nw, np.ones(9), 1.0)[4, 4]
    hs_se_rising = T.hillshade(se, np.ones(9), 1.0)[4, 4]
    # surface rising toward NW faces SE (dark under a NW sun); falling toward... faces NW (lit)
    assert hs_se_rising > hs_nw_rising


def test_block_reduce():
    a = np.arange(16, dtype=float).reshape(4, 4)
    assert T.block_reduce(a, 2, "mean").tolist() == [[2.5, 4.5], [10.5, 12.5]]
    assert T.block_reduce(a, 2, "max").tolist() == [[5, 7], [13, 15]]
