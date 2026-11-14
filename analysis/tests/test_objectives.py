"""Compare Routes: the three objectives are genuinely different and each is optimal for its own cost."""
import heapq
import math

import numpy as np
import pytest

from pawprint import routing as R
from pawprint import terrain as T


def grid_from(elev, res=10.0, slope=None):
    elev = np.asarray(elev, dtype=float)
    if slope is None:
        slope, _ = T.slope_aspect(elev, np.full(elev.shape[0], res), res)
    return R.TerrainGrid(
        elevation=elev, slope=np.asarray(slope, float), dx_rows=np.full(elev.shape[0], res), dy=res,
        lon0=77.0, lat0=18.5, dlon=res / 59274.7, dlat=res / 59274.7, name="t", resolution_m=res,
    )


def edge_cost(g, u, v, objective):
    horiz = math.hypot((v[1] - u[1]) * g.dx_rows[u[0]], (v[0] - u[0]) * g.dy)
    grad = (g.elevation[v] - g.elevation[u]) / horiz
    seg = horiz * math.sqrt(1 + grad * grad)
    if objective == "shortest":
        return seg
    mult = {"fastest": 1.0, "balanced": R.hazard_multiplier(float(g.slope[v])), "lower_risk": R.risk_multiplier(float(g.slope[v]))}[objective]
    return seg / R.tobler_speed_ms(grad) * mult


def dijkstra(g, s, t, max_slope, objective):
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
        for dr, dc in R._NEIGHBOURS:
            v = (u[0] + dr, u[1] + dc)
            if not (0 <= v[0] < rows and 0 <= v[1] < cols) or (g.slope[v] > max_slope and v != t):
                continue
            nd = d + edge_cost(g, u, v, objective)
            if nd < dist.get(v, math.inf):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return math.inf


def test_risk_multiplier_values():
    assert R.risk_multiplier(0) == 1 and R.risk_multiplier(4.99) == 1
    assert R.risk_multiplier(10) == pytest.approx(2.0)
    assert R.risk_multiplier(15) == pytest.approx(5.0)
    assert R.risk_multiplier(25) == pytest.approx(17.0)
    # stronger than the original (balanced) penalty everywhere above 5 deg
    for s in (6, 10, 15, 20, 30):
        assert R.risk_multiplier(s) > R.hazard_multiplier(s)


@pytest.mark.parametrize("objective", R.OBJECTIVES)
@pytest.mark.parametrize("seed", [1, 2, 3])
def test_each_objective_is_optimal_for_its_cost(objective, seed):
    rng = np.random.default_rng(seed)
    elev = np.cumsum(rng.normal(0, 1.0, (22, 22)), axis=1)  # rough but walkable terrain
    g = grid_from(elev, res=5.0)
    path, cost = R.astar(g, (1, 1), (20, 19), 40, objective)
    assert path is not None
    assert cost == pytest.approx(dijkstra(g, (1, 1), (20, 19), 40, objective), rel=1e-9)


def test_unknown_objective_rejected():
    g = grid_from(np.zeros((5, 5)))
    with pytest.raises(ValueError):
        R.astar(g, (0, 0), (4, 4), 25, "scenic")


def test_each_route_wins_on_its_own_measure():
    rng = np.random.default_rng(7)
    elev = np.cumsum(rng.normal(0, 2.0, (40, 40)), axis=1)
    g = grid_from(elev, res=10.0)
    pts = [g.lonlat_of(2, 2), g.lonlat_of(37, 36)]
    c = R.compare_routes(g, pts, 30)
    rs = c["routes"]
    for o in R.COMPARE_OBJECTIVES:
        assert rs["fastest"]["walk_time_s"] <= rs[o]["walk_time_s"] + 1e-6
        assert rs["shortest"]["distance_m"] <= rs[o]["distance_m"] + 1e-6
        assert rs["lower_risk"]["objective_costs"]["lower_risk_s"] <= rs[o]["objective_costs"]["lower_risk_s"] + 1e-6
    assert c["identical"]["fastest"]["fastest"] is True
    assert c["similarity"]["shortest"]["shortest"] == 1.0
    assert "_cells" not in rs["fastest"]


def test_objectives_diverge_on_a_moderate_slope_band():
    """A wide 12-degree band across the direct line: Shortest crosses it, Lower Risk walks around it."""
    slope = np.zeros((31, 31))
    slope[4:31, 12:19] = 12.0  # band open only at the top rows 0-3
    g = grid_from(np.zeros((31, 31)), slope=slope)
    pts = [g.lonlat_of(6, 2), g.lonlat_of(6, 28)]  # opening is 3 rows away: a short detour
    c = R.compare_routes(g, pts, 25)
    rs = c["routes"]
    assert rs["shortest"]["max_slope_deg"] == pytest.approx(12.0)
    assert rs["lower_risk"]["max_slope_deg"] < 5.0
    assert rs["lower_risk"]["distance_m"] > rs["shortest"]["distance_m"]
    assert c["identical"]["shortest"]["lower_risk"] is False


def test_flat_ground_objectives_cost_the_same():
    g = grid_from(np.zeros((15, 15)))
    c = R.compare_routes(g, [g.lonlat_of(7, 1), g.lonlat_of(7, 13)], 25)
    d = {o: c["routes"][o]["distance_m"] for o in R.COMPARE_OBJECTIVES}
    assert d["fastest"] == pytest.approx(d["shortest"]) == pytest.approx(d["lower_risk"])


def test_profile_has_per_point_slope_and_cumulative_walk_time():
    elev = np.tile(np.arange(11) * 1.0, (5, 1))
    g = grid_from(elev)
    r = R.plan_route(g, [g.lonlat_of(2, 0), g.lonlat_of(2, 10)], 25, "fastest")
    prof = r["profile"]
    assert len(prof["slope_deg"]) == len(prof["walk_time_s"]) == len(prof["distance_m"])
    assert prof["walk_time_s"][0] == 0 and prof["walk_time_s"][-1] == pytest.approx(r["walk_time_s"])
    assert all(b >= a for a, b in zip(prof["walk_time_s"], prof["walk_time_s"][1:]))
    # balanced estimate >= pure walking time (penalties are >= 1)
    assert r["est_time_s"] >= r["walk_time_s"]
