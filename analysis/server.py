"""PAWPRINT MARS route API (Python stdlib only).

GET  /api/health                      -> status + loaded grids
GET  /api/terrain?lon=..&lat=..       -> elevation / slope / hazard class at a point
GET  /api/minerals?lon=..&lat=..      -> CRISM summary parameters + indicator flags at a point (or measured=false)
POST /api/route {points:[[lon,lat],...], max_slope_deg?, grid?: "auto"|"ctx"|"hirise",
                 objective?: "balanced"(default)|"fastest"|"shortest"|"lower_risk"}
POST /api/compare {points, max_slope_deg?, grid?} -> fastest / shortest / lower_risk routes + similarity
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "analysis"))
from pawprint.routing import OBJECTIVES, TerrainGrid, compare_routes, plan_route  # noqa: E402
from pawprint.crism import indicators_at  # noqa: E402
from pawprint.terrain import DEFAULT_MAX_SLOPE_DEG, hazard_class  # noqa: E402

PROC = ROOT / "data" / "processed"
GRIDS: dict[str, TerrainGrid] = {}
CRISM: dict = {}
WEB = ROOT / "app" / "public" / "data"
STARTED_UTC = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def data_stamps() -> dict:
    """Modification times of the files this process loaded, so a stale instance is easy to spot."""
    out = {}
    for f in (PROC / "ctx_grid.npz", PROC / "hirise_grid.npz", PROC / "crism_grid.npz", WEB / "manifest.json"):
        if f.exists():
            out[f.name] = dt.datetime.fromtimestamp(f.stat().st_mtime, dt.timezone.utc).isoformat(timespec="seconds")
    return out


LOADED_STAMPS: dict = {}


class ExclusiveHTTPServer(ThreadingHTTPServer):
    """Refuses to share its port. Python's HTTPServer sets SO_REUSEADDR, which on Windows lets a second
    process bind the same port silently; requests then reach either process (possibly a stale one)."""

    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):  # Windows
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


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


def load_crism() -> None:
    f = PROC / "crism_grid.npz"
    if not f.exists():
        return
    z = np.load(f)
    CRISM.update({k: z[k] for k in z.files})
    man = json.loads((WEB / "manifest.json").read_text(encoding="utf-8"))
    CRISM["_layer"] = man["layers"].get("minerals", {})
    print(f"loaded CRISM grid {CRISM['src'].shape}", flush=True)


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
            return self._send(200, {
                "ok": True,
                "grids": {k: {"shape": g.shape, "resolution_m": g.resolution_m} for k, g in GRIDS.items()},
                "crism": bool(CRISM),
                "pid": os.getpid(),
                "started_utc": STARTED_UTC,
                "data_loaded": LOADED_STAMPS,
                "data_on_disk_changed": data_stamps() != LOADED_STAMPS,
            })
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
        if u.path == "/api/minerals":
            q = parse_qs(u.query)
            try:
                lon, lat = float(q["lon"][0]), float(q["lat"][0])
            except (KeyError, ValueError):
                return self._send(400, {"error": "lon and lat required"})
            if not CRISM:
                return self._send(200, {"lon": lon, "lat": lat, "available": False})
            hit = indicators_at(CRISM, lon, lat)
            if hit is None:
                return self._send(200, {"lon": lon, "lat": lat, "available": True, "measured": False})
            layer = CRISM["_layer"]
            prod = layer.get("products", [])[hit["product_index"]]
            meaning = {i["key"]: i for i in layer.get("indicators", [])}
            return self._send(200, {
                "lon": lon, "lat": lat, "available": True, "measured": True,
                "product": {k: prod.get(k) for k in ("product_id", "observation_id", "start_time", "label_url")},
                "resolution_m": layer.get("resolution_m"), "params": hit["params"],
                "indicators": [{"key": k, "parameter": meaning[k]["parameter"], "meaning": meaning[k]["meaning"]} for k in hit["indicators"]],
                "kind": "real-derived",
                "note": "Potential mineral indicators from CRISM summary parameters, not confirmed identifications.",
            })
        self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        if path not in ("/api/route", "/api/compare"):
            return self._send(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            points = [(float(p[0]), float(p[1])) for p in body["points"]]
            max_slope = float(body.get("max_slope_deg", DEFAULT_MAX_SLOPE_DEG))
            if not 5 <= max_slope <= 45:
                raise ValueError("max_slope_deg must be between 5 and 45")
            objective = str(body.get("objective", "balanced"))
            if objective not in OBJECTIVES:
                raise ValueError(f"objective must be one of {', '.join(OBJECTIVES)}")
        except (KeyError, ValueError, TypeError, json.JSONDecodeError) as e:
            return self._send(400, {"error": f"bad request: {e}"})
        grid = choose_grid(points, body.get("grid", "auto"))
        t = time.perf_counter()
        try:
            if path == "/api/route":
                res = plan_route(grid, points, max_slope, objective)
                res.pop("_cells", None)
            else:
                res = compare_routes(grid, points, max_slope)
        except ValueError as e:
            return self._send(422, {"error": str(e), "grid": grid.name})
        res["compute_ms"] = round((time.perf_counter() - t) * 1000, 1)
        model = {
            "kind": "estimate",
            "note": "Distances and elevations come from the USGS DTM. Walking time uses Tobler's Earth hiking function; "
            "slope penalties are PAWPRINT planning assumptions. Estimates are not validated for suited EVA on Mars.",
        }
        if path == "/api/compare":
            for r in res["routes"].values():
                r["compute_ms"] = res["compute_ms"]
                r["model"] = model
        else:
            res["model"] = model
        self._send(200, res)

    def log_message(self, fmt, *args):
        sys.stdout.write("api " + fmt % args + "\n")


def main(port: int = 8777) -> None:
    # Bind first: if another API already owns the port, fail fast instead of loading data for nothing.
    try:
        httpd = ExclusiveHTTPServer(("127.0.0.1", port), Handler)
    except OSError as e:
        sys.exit(f"Port {port} is already in use ({e.strerror or e}). Another PAWPRINT API is probably running: "
                 f"stop it first (check http://127.0.0.1:{port}/api/health for its pid).")
    load_grids()
    load_crism()
    if "ctx" not in GRIDS:
        httpd.server_close()
        sys.exit("ctx grid missing: run analysis/scripts/build_layers.py")
    LOADED_STAMPS.update(data_stamps())
    print(f"PAWPRINT route API on http://127.0.0.1:{port} (pid {os.getpid()})", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8777)
