import heapq
import math

import numpy as np
import pytest

from pawprint import routing as R
from pawprint import terrain as T


def make_grid(elev, res=10.0, slope=None):
    elev = np.asarray(elev, dtype=float)
    if slope is None:
        slope, _ = T.slope_aspect(elev, np.full(elev.shape[0], res), res)
    return R.TerrainGrid(
        elevation=elev, slope=np.asarray(slope, float), dx_rows=np.full(elev.shape[0], res), dy=res,
        lon0=77.0, lat0=18.5, dlon=res / 59274.7, dlat=res / 59274.7, name="test", resolution_m=res,
    )


def test_tobler_peak_and_symmetry():
    assert R.tobler_speed_ms(-0.05) == pytest.approx(6 / 3.6)
    assert R.tobler_speed_ms(0.0) == pytest.approx(5.036742 / 3.6, rel=1e-5)
    assert R.tobler_speed_ms(0.2) < R.tobler_speed_ms(0.0)


def test_flat_straight_route_length():
    g = make_grid(np.zeros((20, 20)))
    path, cost = R.astar(g, (10, 2), (10, 17))
    assert [p[0] for p in path] == [10] * 16
    m = R.path_metrics(g, path)
    assert m["distance_m"] == pytest.approx(150.0)
    assert m["elevation_gain_m"] == 0
    assert cost == pytest.approx(150.0 / R.tobler_speed_ms(0.0))


def test_flat_diagonal_route_length():
    g = make_grid(np.zeros((11, 11)))
    path, _ = R.astar(g, (0, 0), (10, 10))
    m = R.path_metrics(g, path)
    assert m["distance_m"] == pytest.approx(100 * math.sqrt(2))


def test_avoids_impassable_wall_through_gap():
    slope = np.zeros((15, 15))
    slope[:, 7] = 40.0  # cliff column
    slope[12, 7] = 0.0  # single gap
    g = make_grid(np.zeros((15, 15)), slope=slope)
    path, _ = R.astar(g, (2, 2), (2, 12), max_slope_deg=25)
    assert (12, 7) in path
    assert all(slope[p] <= 25 for p in path)


def test_unreachable_returns_none():
    slope = np.zeros((10, 10))
    slope[:, 5] = 40.0
    g = make_grid(np.zeros((10, 10)), slope=slope)
    path, cost = R.astar(g, (5, 1), (5, 8), max_slope_deg=25)
    assert path is None and math.isinf(cost)


def test_prefers_gentle_detour_over_steep_shortcut():
    slope = np.zeros((21, 21))
    slope[5:16, 6:15] = 22.0  # wide steep-but-passable block: 9 cells x 2.44 hazard factor
    g = make_grid(np.zeros((21, 21)), slope=slope)
    path, _ = R.astar(g, (10, 2), (10, 18))
    assert max(slope[p] for p in path) < 22.0  # detour (~210 m) beats crossing (~290 m-equivalent)


def test_crosses_thin_steep_band_when_cheaper():
    slope = np.zeros((21, 21))
    slope[5:16, 10] = 22.0  # one 10 m cell wide: crossing is cheaper than detouring
    g = make_grid(np.zeros((21, 21)), slope=slope)
    path, _ = R.astar(g, (10, 2), (10, 18))
    assert (10, 10) in path


def dijkstra_cost(g, s, t, max_slope):
    rows, cols = g.shape
    dist = {s: 0.0}
    pq = [(0.0, s)]
    seen = set()
    while pq:
        d, u = heapq.heappop(pq)
        if u in seen:
            continue
        if u == t:
            return d
        seen.add(u)
        r, c = u
        for dr, dc in R._NEIGHBOURS:
            v = (r + dr, c + dc)
            if not (0 <= v[0] < rows and 0 <= v[1] < cols):
                continue
            if g.slope[v] > max_slope and v != t:
                continue
            horiz = math.hypot(dc * g.dx_rows[r], dr * g.dy)
            grad = (g.elevation[v] - g.elevation[u]) / horiz
            w = horiz * math.sqrt(1 + grad * grad) / R.tobler_speed_ms(grad) * R.hazard_multiplier(float(g.slope[v]))
            if d + w < dist.get(v, math.inf):
                dist[v] = d + w
                heapq.heappush(pq, (d + w, v))
    return math.inf


@pytest.mark.parametrize("seed", [0, 1, 2, 3])
def test_astar_is_optimal_vs_dijkstra(seed):
    rng = np.random.default_rng(seed)
    elev = np.cumsum(rng.normal(0, 1.5, (25, 25)), axis=1)
    g = make_grid(elev, res=5.0)
    path, cost = R.astar(g, (1, 1), (23, 22), max_slope_deg=30)
    assert path is not None
    assert cost == pytest.approx(dijkstra_cost(g, (1, 1), (23, 22), 30), rel=1e-9)


def test_metrics_on_ramp():
    elev = np.tile(np.arange(11) * 1.0, (5, 1))  # rises 1 m per 10 m cell eastward
    g = make_grid(elev)
    path, _ = R.astar(g, (2, 0), (2, 10))
    m = R.path_metrics(g, path)
    assert m["elevation_gain_m"] == pytest.approx(10.0)
    assert m["elevation_loss_m"] == 0
    assert m["distance_m"] == pytest.approx(10 * math.hypot(10, 1))
    assert m["max_slope_deg"] == pytest.approx(math.degrees(math.atan(0.1)), abs=1e-6)
    assert len(m["profile"]["distance_m"]) == len(path)


def test_plan_route_multi_stop_and_out_of_bounds():
    g = make_grid(np.zeros((30, 30)))
    a, b, c = g.lonlat_of(2, 2), g.lonlat_of(25, 5), g.lonlat_of(5, 25)
    res = R.plan_route(g, [a, b, c])
    assert res["stop_indices"][0] == 0 and len(res["stop_indices"]) == 3
    assert res["path_lonlat"][res["stop_indices"][1]] == pytest.approx(list(b))
    with pytest.raises(ValueError):
        R.plan_route(g, [a, (0.0, 0.0)])
    with pytest.raises(ValueError):
        R.plan_route(g, [a])


def test_difficulty_is_monotonic():
    easy = R.difficulty_label(500, 5, 4, [1, 0, 0, 0])
    hard = R.difficulty_label(8000, 300, 24, [0.4, 0.3, 0.3, 0])
    assert easy["score"] < hard["score"]
    assert easy["label"] == "Easy"
