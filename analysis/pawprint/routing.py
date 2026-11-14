"""Terrain-aware A* route planning on a Mars DTM grid.

Cost model (an ESTIMATE, surfaced as such in the UI)
----------------------------------------------------
Edge cost is walking time in seconds. Speed follows Tobler's hiking function
(Tobler 1993), v = 6 * exp(-3.5 * |tan(theta) + 0.05|) km/h, which was fitted
to Earth hikers. It has NOT been validated for suited astronauts on Mars; we use
it only to rank routes and give an order-of-magnitude EVA time.

On top of the along-track gradient we add a cross-terrain hazard factor from the
Horn slope of the destination cell (side-slopes are dangerous even when walking
along the contour), and cells steeper than ``max_slope_deg`` are impassable.

The heuristic is horizontal distance / Tobler's maximum speed, which never
over-estimates (all multipliers >= 1), so A* returns the optimal path.
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field

import numpy as np

from .terrain import DEFAULT_MAX_SLOPE_DEG, SLOPE_CLASSES_DEG

TOBLER_VMAX_MS = 6.0 * math.exp(-3.5 * 0.0) / 3.6  # peak speed at tan(theta) = -0.05


def tobler_speed_ms(gradient: float) -> float:
    return 6.0 * math.exp(-3.5 * abs(gradient + 0.05)) / 3.6


def hazard_multiplier(slope_deg: float) -> float:
    """1.0 on gentle ground, rising smoothly toward the no-go limit."""
    if slope_deg < SLOPE_CLASSES_DEG[0]:
        return 1.0
    return 1.0 + ((slope_deg - SLOPE_CLASSES_DEG[0]) / 10.0) ** 2


@dataclass
class TerrainGrid:
    """A DTM grid in GeoTIFF orientation (row 0 = north)."""

    elevation: np.ndarray  # metres, NaN = nodata
    slope: np.ndarray  # degrees
    dx_rows: np.ndarray  # ground metres per column step, per row
    dy: float  # ground metres per row step
    lon0: float  # lon of column 0 centre
    lat0: float  # lat of row 0 centre
    dlon: float  # degrees per column
    dlat: float  # degrees per row (positive; rows go south)
    name: str = "grid"
    resolution_m: float = 0.0
    passable: np.ndarray = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.passable = np.isfinite(self.elevation) & np.isfinite(self.slope)

    @property
    def shape(self) -> tuple[int, int]:
        return self.elevation.shape  # type: ignore[return-value]

    def cell_of(self, lon: float, lat: float) -> tuple[int, int]:
        c = int(round((lon - self.lon0) / self.dlon))
        r = int(round((self.lat0 - lat) / self.dlat))
        return r, c

    def lonlat_of(self, r: int, c: int) -> tuple[float, float]:
        return self.lon0 + c * self.dlon, self.lat0 - r * self.dlat

    def contains(self, lon: float, lat: float) -> bool:
        r, c = self.cell_of(lon, lat)
        return 0 <= r < self.shape[0] and 0 <= c < self.shape[1] and bool(self.passable[r, c])


_NEIGHBOURS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def astar(grid: TerrainGrid, start: tuple[int, int], goal: tuple[int, int], max_slope_deg: float = DEFAULT_MAX_SLOPE_DEG):
    """Return (list of (r, c) cells, total_cost_s) or (None, inf) if unreachable."""
    rows, cols = grid.shape
    elev, slope, ok = grid.elevation, grid.slope, grid.passable
    allowed = ok & (slope <= max_slope_deg)
    # Endpoints are always allowed so a planner can start on a steep pixel and walk off it.
    for r, c in (start, goal):
        if not (0 <= r < rows and 0 <= c < cols) or not ok[r, c]:
            return None, math.inf
    allowed = allowed.copy()
    allowed[start] = allowed[goal] = True

    # Flat-index arrays as plain Python lists: ~5x faster than numpy scalar indexing
    # and tuple-keyed dicts in this pure-Python loop. Same cost model as tobler_speed_ms
    # and hazard_multiplier (inlined), so results are identical.
    dx_rows = [float(v) for v in grid.dx_rows]
    dy = float(grid.dy)
    z = elev.ravel().tolist()
    hm = np.where(slope < SLOPE_CLASSES_DEG[0], 1.0, 1.0 + ((slope - SLOPE_CLASSES_DEG[0]) / 10.0) ** 2).ravel().tolist()
    ok_flat = allowed.ravel().tolist()
    n = rows * cols
    g = [math.inf] * n
    came = [-1] * n
    closed = bytearray(n)
    gr, gc = goal
    s_i, goal_i = start[0] * cols + start[1], gr * cols + gc
    inv_vmax = 1.0 / TOBLER_VMAX_MS
    exp, sqrt, hypot = math.exp, math.sqrt, math.hypot
    # per-row horizontal step lengths for the 8 moves (dx averaged across the two rows)
    steps = []
    for r in range(rows):
        row_moves = []
        for dr, dc in _NEIGHBOURS:
            nr = r + dr
            if 0 <= nr < rows:
                row_moves.append((dr, dc, dr * cols + dc, hypot(dc * 0.5 * (dx_rows[r] + dx_rows[nr]), dr * dy)))
        steps.append(row_moves)

    g[s_i] = 0.0
    heap = [(hypot((start[1] - gc) * dx_rows[start[0]], (start[0] - gr) * dy) * inv_vmax, 0.0, s_i)]
    push, pop = heapq.heappush, heapq.heappop
    while heap:
        _, gcur, cur = pop(heap)
        if closed[cur]:
            continue
        if cur == goal_i:
            path = []
            while cur != -1:
                path.append(divmod(cur, cols))
                cur = came[cur]
            return path[::-1], gcur
        closed[cur] = 1
        r, c = divmod(cur, cols)
        z0 = z[cur]
        for dr, dc, off, horiz in steps[r]:
            nc = c + dc
            if nc < 0 or nc >= cols:
                continue
            nxt = cur + off
            if closed[nxt] or not ok_flat[nxt]:
                continue
            grad = (z[nxt] - z0) / horiz
            speed = 1.6666666666666667 * exp(-3.5 * abs(grad + 0.05))  # Tobler, m/s
            ng = gcur + horiz * sqrt(1 + grad * grad) / speed * hm[nxt]
            if ng < g[nxt]:
                g[nxt] = ng
                came[nxt] = cur
                nr = r + dr
                push(heap, (ng + hypot((nc - gc) * dx_rows[nr], (nr - gr) * dy) * inv_vmax, ng, nxt))
    return None, math.inf


def path_metrics(grid: TerrainGrid, path: list[tuple[int, int]]) -> dict:
    """Distance, elevation, slope and difficulty statistics for a cell path."""
    elev = [float(grid.elevation[r, c]) for r, c in path]
    slopes = [float(grid.slope[r, c]) for r, c in path]
    cum = [0.0]
    horiz_total = 0.0
    gain = loss = 0.0
    time_s = 0.0
    class_dist = [0.0, 0.0, 0.0, 0.0]
    for i in range(1, len(path)):
        (r0, c0), (r1, c1) = path[i - 1], path[i]
        horiz = math.hypot((c1 - c0) * 0.5 * (grid.dx_rows[r0] + grid.dx_rows[r1]), (r1 - r0) * grid.dy)
        dz = elev[i] - elev[i - 1]
        seg = math.hypot(horiz, dz)
        horiz_total += horiz
        cum.append(cum[-1] + seg)
        if dz > 0:
            gain += dz
        else:
            loss -= dz
        grad = dz / horiz if horiz else 0.0
        time_s += seg / tobler_speed_ms(grad) * hazard_multiplier(slopes[i])
        k = int(np.digitize([slopes[i]], SLOPE_CLASSES_DEG)[0])
        class_dist[k] += seg
    total = cum[-1]
    frac = [d / total if total else 0.0 for d in class_dist]
    max_slope = max(slopes) if slopes else 0.0
    mean_slope = float(np.mean(slopes)) if slopes else 0.0
    return {
        "distance_m": total,
        "horizontal_distance_m": horiz_total,
        "elevation_start_m": elev[0],
        "elevation_end_m": elev[-1],
        "elevation_gain_m": gain,
        "elevation_loss_m": loss,
        "elevation_min_m": min(elev),
        "elevation_max_m": max(elev),
        "max_slope_deg": max_slope,
        "mean_slope_deg": mean_slope,
        "slope_class_fraction": {"easy": frac[0], "moderate": frac[1], "hazard": frac[2], "nogo": frac[3]},
        "est_time_s": time_s,
        "difficulty": difficulty_label(total, gain, max_slope, frac),
        "profile": {"distance_m": cum, "elevation_m": elev},
    }


def difficulty_label(distance_m: float, gain_m: float, max_slope: float, frac: list[float]) -> dict:
    """Heuristic 0-100 difficulty score. A PAWPRINT estimate, not a NASA metric."""
    km = distance_m / 1000.0
    score = 8.0 * km + 0.12 * gain_m + 1.6 * max_slope + 60.0 * (frac[2] + frac[3])
    score = max(0.0, min(100.0, score))
    label = "Easy" if score < 25 else "Moderate" if score < 50 else "Strenuous" if score < 75 else "Extreme"
    return {"score": round(score, 1), "label": label}


def plan_route(grid: TerrainGrid, points_lonlat: list[tuple[float, float]], max_slope_deg: float = DEFAULT_MAX_SLOPE_DEG) -> dict:
    """Plan through an ordered list of (lon, lat) stops. Raises ValueError on failure."""
    if len(points_lonlat) < 2:
        raise ValueError("need at least a start and a destination")
    cells = []
    for lon, lat in points_lonlat:
        if not grid.contains(lon, lat):
            raise ValueError(f"point ({lon:.5f}, {lat:.5f}) is outside the {grid.name} terrain grid or on nodata")
        cells.append(grid.cell_of(lon, lat))
    full: list[tuple[int, int]] = []
    leg_index = [0]
    for a, b in zip(cells, cells[1:]):
        leg, cost = astar(grid, a, b, max_slope_deg)
        if leg is None:
            raise ValueError(f"no route under {max_slope_deg:.0f} deg slope limit between stops")
        full.extend(leg if not full else leg[1:])
        leg_index.append(len(full) - 1)
    m = path_metrics(grid, full)
    m["path_lonlat"] = [list(grid.lonlat_of(r, c)) for r, c in full]
    m["stop_indices"] = leg_index
    m["grid"] = {"name": grid.name, "resolution_m": grid.resolution_m}
    m["max_slope_limit_deg"] = max_slope_deg
    return m
