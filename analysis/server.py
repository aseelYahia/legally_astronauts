"""PAWPRINT MARS route API (Python stdlib only).

GET  /api/health                      -> status + loaded grids
GET  /api/terrain?lon=..&lat=..       -> elevation / slope / hazard class at a point
POST /api/route {points:[[lon,lat],...], max_slope_deg?, grid?: "auto"|"ctx"|"hirise"}
"""
from __future__ import annotations

import json
import pathlib
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "analysis"))
from pawprint.routing import TerrainGrid, plan_route  # noqa: E402
from pawprint.terrain import DEFAULT_MAX_SLOPE_DEG, hazard_class  # noqa: E402

PROC = ROOT / "data" / "processed"
GRIDS: dict[str, TerrainGrid] = {}


def load_grids() -> None:
    for name in ("hirise", "ctx"):
        f = PROC / f"{name}_grid.npz"
        if not f.exists():
            continue
        z = np.load(f)
        GRIDS[name] = TerrainGrid(
            elevation=z["elevation"].astype(np.float64), slope=z["slope"].astype(np.float64),
            dx_rows=z["dx_rows"], dy=float(z["dy"]), lon0=float(z["lon0"]), lat0=float(z["lat0"]),
            dlon=float(z["dlon"]), dlat=float(z["dlat"]), name=name, resolution_m=float(z["resolution_m"]),
        )
        print(f"loaded {name} grid {GRIDS[name].shape} @ {GRIDS[name].resolution_m} m", flush=True)


def choose_grid(points, wanted: str) -> TerrainGrid:
    if wanted in GRIDS:
        return GRIDS[wanted]
    # auto: finest grid containing every stop
    for name in ("hirise", "ctx"):
        g = GRIDS.get(name)
        if g and all(g.contains(lon, lat) for lon, lat in points):
            return g
    return GRIDS["ctx"]


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        u = urlparse(self.path)
        if u.path == "/api/health":
            return self._send(200, {"ok": True, "grids": {k: {"shape": g.shape, "resolution_m": g.resolution_m} for k, g in GRIDS.items()}})
        if u.path == "/api/terrain":
            q = parse_qs(u.query)
            try:
                lon, lat = float(q["lon"][0]), float(q["lat"][0])
            except (KeyError, ValueError):
                return self._send(400, {"error": "lon and lat required"})
            out = {}
            for name, g in GRIDS.items():
                if g.contains(lon, lat):
                    r, c = g.cell_of(lon, lat)
                    s = float(g.slope[r, c])
                    out[name] = {"elevation_m": float(g.elevation[r, c]), "slope_deg": s,
                                 "hazard_class": int(hazard_class(np.array([s]))[0]), "resolution_m": g.resolution_m}
            return self._send(200, {"lon": lon, "lat": lat, "samples": out})
        self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if urlparse(self.path).path != "/api/route":
            return self._send(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            points = [(float(p[0]), float(p[1])) for p in body["points"]]
            max_slope = float(body.get("max_slope_deg", DEFAULT_MAX_SLOPE_DEG))
            if not 5 <= max_slope <= 45:
                raise ValueError("max_slope_deg must be between 5 and 45")
        except (KeyError, ValueError, TypeError, json.JSONDecodeError) as e:
            return self._send(400, {"error": f"bad request: {e}"})
        grid = choose_grid(points, body.get("grid", "auto"))
        t = time.perf_counter()
        try:
            res = plan_route(grid, points, max_slope)
        except ValueError as e:
            return self._send(422, {"error": str(e), "grid": grid.name})
        res["compute_ms"] = round((time.perf_counter() - t) * 1000, 1)
        res["model"] = {
            "kind": "estimate",
            "note": "Distances and elevations come from the USGS DTM. Walking time uses Tobler's Earth hiking function plus a "
            "slope-hazard factor; it is an estimate not validated for suited EVA on Mars.",
        }
        self._send(200, res)

    def log_message(self, fmt, *args):
        sys.stdout.write("api " + fmt % args + "\n")


def main(port: int = 8777) -> None:
    load_grids()
    if "ctx" not in GRIDS:
        sys.exit("ctx grid missing: run analysis/scripts/build_layers.py")
    print(f"PAWPRINT route API on http://127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8777)
