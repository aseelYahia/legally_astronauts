"""End-to-end test of the route API on the real CTX grid."""
import json
import pathlib
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.skipif(not (ROOT / "data/processed/ctx_grid.npz").exists(), reason="no processed grid")


@pytest.fixture(scope="module")
def base_url():
    import server

    server.load_grids()
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_health(base_url):
    with urllib.request.urlopen(base_url + "/api/health") as r:
        assert json.loads(r.read())["grids"]["ctx"]["resolution_m"] == 20.0


def test_route_landing_to_delta_on_ctx(base_url):
    landing = [77.45088572, 18.44462715]
    delta = [77.40, 18.455]
    code, res = post(base_url + "/api/route", {"points": [landing, delta], "grid": "ctx"})
    assert code == 200, res
    assert res["grid"]["name"] == "ctx"
    # path cannot be shorter than the great-circle separation (~2.9 km)
    from pawprint.mars import great_circle_m

    gc = great_circle_m(*landing, *delta)
    assert res["horizontal_distance_m"] >= gc - 30
    assert res["horizontal_distance_m"] < gc * 1.6
    assert res["max_slope_deg"] <= 25
    assert res["model"]["kind"] == "estimate"


def test_auto_grid_prefers_hirise_inside_window(base_url):
    if not (ROOT / "data/processed/hirise_grid.npz").exists():
        pytest.skip("HiRISE grid not built")
    # Landing site -> ~1.2 km west, both inside the HiRISE window (77.42-77.47 E, 18.42-18.465 N)
    code, res = post(base_url + "/api/route", {"points": [[77.45088572, 18.44462715], [77.430, 18.450]]})
    assert code == 200, res
    assert res["grid"] == {"name": "hirise", "resolution_m": 4.0}
    from pawprint.mars import great_circle_m

    assert res["horizontal_distance_m"] >= great_circle_m(77.45088572, 18.44462715, 77.430, 18.450) - 10
    # A stop outside the window falls back to CTX
    code, res = post(base_url + "/api/route", {"points": [[77.45088572, 18.44462715], [77.40, 18.455]]})
    assert code == 200 and res["grid"]["name"] == "ctx"


def test_route_rejects_outside_aoi(base_url):
    code, res = post(base_url + "/api/route", {"points": [[77.45, 18.44], [10.0, 10.0]]})
    assert code == 422 and "outside" in res["error"]


def test_route_validates_input(base_url):
    assert post(base_url + "/api/route", {"points": [[77.45, 18.44]], "max_slope_deg": 90})[0] == 400


def test_terrain_point(base_url):
    with urllib.request.urlopen(base_url + "/api/terrain?lon=77.4509&lat=18.4446") as r:
        d = json.loads(r.read())
    assert -2600 < d["samples"]["ctx"]["elevation_m"] < -2540  # rover measured -2569.9 m here
