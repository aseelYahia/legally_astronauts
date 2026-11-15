"""USGS SIM 3464 geologic units: geometry helpers.

Source: Sun, V.Z., and Stack, K.M., 2020, Geologic map of Jezero crater and the Nili Planum region, Mars:
USGS Scientific Investigations Map 3464, 1:75,000, https://doi.org/10.3133/sim3464 (public domain), served by
USGS as the ArcGIS feature service "Jezero_FeatureServiceFromPro" (layer 8, Geologic Units).
The map was drawn on a semi-controlled CTX mosaic and, per the USGS read-me, has random offsets of about
100-200 m relative to the Mars 2020 controlled CTX mosaic used by PAWPRINT. Unit boundaries are therefore
approximate at the scale of this app and are never used for routing.
"""
from __future__ import annotations

Box = tuple[float, float, float, float]  # lon_min, lat_min, lon_max, lat_max


def _clip_edge(pts, inside, intersect):
    out = []
    if not pts:
        return out
    prev = pts[-1]
    for cur in pts:
        if inside(cur):
            if not inside(prev):
                out.append(intersect(prev, cur))
            out.append(cur)
        elif inside(prev):
            out.append(intersect(prev, cur))
        prev = cur
    return out


def clip_ring(ring: list[tuple[float, float]], box: Box) -> list[tuple[float, float]]:
    """Sutherland-Hodgman clip of a polygon ring to an axis-aligned box. Returns [] when nothing is left."""
    x0, y0, x1, y1 = box
    pts = [tuple(p) for p in ring]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]

    def ix(a, b, x):
        t = (x - a[0]) / (b[0] - a[0])
        return (x, a[1] + t * (b[1] - a[1]))

    def iy(a, b, y):
        t = (y - a[1]) / (b[1] - a[1])
        return (a[0] + t * (b[0] - a[0]), y)

    pts = _clip_edge(pts, lambda p: p[0] >= x0, lambda a, b: ix(a, b, x0))
    pts = _clip_edge(pts, lambda p: p[0] <= x1, lambda a, b: ix(a, b, x1))
    pts = _clip_edge(pts, lambda p: p[1] >= y0, lambda a, b: iy(a, b, y0))
    pts = _clip_edge(pts, lambda p: p[1] <= y1, lambda a, b: iy(a, b, y1))
    if len(pts) < 3:
        return []
    return pts + [pts[0]]


def ring_area(ring: list[tuple[float, float]]) -> float:
    """Signed shoelace area in the ring's own units."""
    s = 0.0
    for (xa, ya), (xb, yb) in zip(ring, ring[1:]):
        s += xa * yb - xb * ya
    return s / 2.0


def esri_rings_to_polygons(rings: list[list[tuple[float, float]]]) -> list[list[list[tuple[float, float]]]]:
    """ESRI polygon rings -> list of GeoJSON polygons (exterior first, then holes).
    ESRI exteriors are clockwise (negative shoelace area, y up) and holes counter-clockwise."""
    exteriors = [[r] for r in rings if ring_area(r) < 0]
    for h in (r for r in rings if ring_area(r) >= 0):
        host = hole_host(h, exteriors)
        if host is not None:
            host.append(h)
    return exteriors


def hole_host(hole: list[tuple[float, float]], exteriors: list[list[list[tuple[float, float]]]]):
    """Exterior that contains a hole ring, by majority vote over ALL hole vertices.

    Testing only the first vertex fails when a hole has been clipped at the AOI box: its first vertex can then
    lie exactly on the exterior's clipped edge, where a ray-casting test is undefined, and the hole is silently
    dropped (found in the 2026-11-15 audit: a 0.021 km² NHjf2 island inside a Nue polygon at the AOI's NW edge
    was drawn as Nue AND NHjf2). Vertices on the boundary are ambiguous, so the exterior containing the most
    vertices wins."""
    best, best_n = None, 0
    for p in exteriors:
        n = sum(point_in_ring(x, y, p[0]) for x, y in hole[:-1])
        if n > best_n:
            best, best_n = p, n
    return best


def polygon_area(poly: list[list[tuple[float, float]]]) -> float:
    """Unsigned area of exterior minus holes."""
    return abs(ring_area(poly[0])) - sum(abs(ring_area(h)) for h in poly[1:])


def point_in_ring(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    for i in range(n - 1):
        (xa, ya), (xb, yb) = ring[i], ring[i + 1]
        if (ya > y) != (yb > y) and x < (xb - xa) * (y - ya) / (yb - ya) + xa:
            inside = not inside
    return inside
