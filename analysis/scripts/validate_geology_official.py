"""Validate the ArcGIS-derived geology layer against the OFFICIAL USGS SIM 3464 database (audit 2026-11-15).

Official source: Sun & Stack (2020), USGS SIM 3464, https://doi.org/10.3133/sim3464,
https://pubs.usgs.gov/sim/3464/sim3464_database.zip (349 MB, mostly rasters). Only the file geodatabase
Nili.gdb (22.6 MB) is fetched, by HTTP range reads of the zip's central directory, into
data/raw/extras/geology/usgs_sim3464/Nili.gdb (git-ignored).

Needs pyogrio + shapely + pyproj, which the analysis venv does not ship. Use a separate venv:
    python -m venv .gisvenv && .gisvenv/Scripts/pip install pyogrio shapely pyproj numpy
    .gisvenv/Scripts/python analysis/scripts/validate_geology_official.py fetch     # once
    .gisvenv/Scripts/python analysis/scripts/validate_geology_official.py compare
Run from the pawprint-mars folder. Prints per-unit official vs ArcGIS areas and IoU, boundary distances and
point-label agreement inside the AOI.

Result on 2026-11-15 (after the hole fix in pawprint/geology.py): identical unit codes and names, same CRS
(MTM clon 77.5E on the Mars 2000 sphere), per-unit IoU >= 0.9999, boundary distance max 0.04 m,
label agreement 99.998 % of 46,800 sample points.
"""
import json
import math
import pathlib
import struct
import subprocess
import sys
import zlib

URL = "https://pubs.usgs.gov/sim/3464/sim3464_database.zip"
OUT = pathlib.Path("data/raw/extras/geology/usgs_sim3464/Nili.gdb")
AOI = (77.34, 18.42, 77.47, 18.51)
CURL = r"C:\Windows\System32\curl.exe" if sys.platform == "win32" else "curl"


def _get(a: int, b: int) -> bytes:
    return subprocess.run([CURL, "-sS", "--fail", "-A", "PAWPRINT-MARS/1.0", "-r", f"{a}-{b}", URL], check=True, capture_output=True).stdout


def fetch() -> None:
    head = subprocess.run([CURL, "-sIL", "-A", "PAWPRINT-MARS/1.0", URL], capture_output=True, text=True).stdout
    size = int([ln.split(":")[1] for ln in head.splitlines() if ln.lower().startswith("content-length")][-1])
    tail = _get(size - 66000, size - 1)
    i = tail.rfind(b"PK\x05\x06")
    cd_size, cd_off = struct.unpack("<II", tail[i + 12:i + 20])
    cd, p = _get(cd_off, cd_off + cd_size - 1), 0
    OUT.mkdir(parents=True, exist_ok=True)
    while p < len(cd) and cd[p:p + 4] == b"PK\x01\x02":
        meth, = struct.unpack("<H", cd[p + 10:p + 12])
        csz, = struct.unpack("<I", cd[p + 20:p + 24])
        fl, el, cl = struct.unpack("<HHH", cd[p + 28:p + 34])
        off, = struct.unpack("<I", cd[p + 42:p + 46])
        name = cd[p + 46:p + 46 + fl].decode("cp437")
        p += 46 + fl + el + cl
        if "Nili.gdb/" in name and not name.endswith("/") and csz:
            h = _get(off, off + 29)
            f2, e2 = struct.unpack("<HH", h[26:30])
            raw = _get(off + 30 + f2 + e2, off + 30 + f2 + e2 + csz - 1)
            (OUT / pathlib.Path(name).name).write_bytes(zlib.decompress(raw, -15) if meth == 8 else raw)
    print("fetched", OUT)


def compare() -> None:
    import numpy as np
    import pyogrio
    import shapely
    from pyproj import CRS, Transformer
    from shapely.geometry import box, shape
    from shapely.ops import transform as stransform

    meta, _, geoms, fields = pyogrio.raw.read(str(OUT), layer="GeoUnits_v1")[:4]
    names = list(meta["fields"])
    crs_off = CRS.from_user_input(meta["crs"])
    print("official layer GeoUnits_v1, CRS:", crs_off.name, "/", crs_off.ellipsoid)
    tr = Transformer.from_crs(crs_off, CRS.from_proj4("+proj=longlat +R=3396190 +no_defs"), always_xy=True)
    aoi = box(*AOI)
    off: dict = {}
    for i, wkb in enumerate(geoms):
        g = stransform(lambda x, y, z=None: tr.transform(x, y), shapely.from_wkb(wkb)).intersection(aoi)
        if g.is_empty:
            continue
        rec = {n: fields[k][i] for k, n in enumerate(names)}
        off.setdefault(rec["symbol"] or rec["unit"], {"geoms": [], "name": rec["name"]})["geoms"].append(g)
    arc = json.loads(pathlib.Path("app/public/data/geology_units.geojson").read_text(encoding="utf-8"))
    mine: dict = {}
    for f in arc["features"]:
        mine.setdefault(f["properties"]["symbol"], []).append(shape(f["geometry"]).buffer(0))
    U = shapely.unary_union
    km2 = 59274.7 ** 2 * math.cos(math.radians(18.465)) / 1e6
    print("unit   official_km2  arcgis_km2  IoU     official name / arcgis name")
    arc_name = {u["symbol"]: u["name"] for u in arc["units"]}
    for s in sorted(set(off) | set(mine)):
        o = U(off[s]["geoms"]) if s in off else None
        m = U(mine[s]) if s in mine else None
        iou = o.intersection(m).area / o.union(m).area if (o is not None and m is not None) else 0.0
        print(f"{s:<6} {o.area * km2 if o else 0:>11.3f} {m.area * km2 if m else 0:>11.3f}  {iou:.4f}  "
              f"{off.get(s, {}).get('name')} / {arc_name.get(s)}")
    mpd, k = 59274.7, math.cos(math.radians(18.465))
    to_m = lambda g: stransform(lambda x, y, z=None: (np.asarray(x) * mpd * k, np.asarray(y) * mpd), g)  # noqa: E731
    inner = aoi.buffer(-1e-4)
    bo = to_m(U([U(v["geoms"]).boundary for v in off.values()]).intersection(inner))
    bm = to_m(U([U(v).boundary for v in mine.values()]).intersection(inner))
    d = np.array([bm.distance(shapely.Point(c)) for c in shapely.get_coordinates(shapely.segmentize(bo, 20))])
    print(f"boundary distance official->arcgis: median {np.median(d):.2f} m, p95 {np.percentile(d, 95):.2f} m, max {d.max():.2f} m")
    xs = np.linspace(AOI[0] + 1e-5, AOI[2] - 1e-5, 260)
    ys = np.linspace(AOI[1] + 1e-5, AOI[3] - 1e-5, 180)
    P = shapely.points(*np.meshgrid(xs, ys))

    def labels(dct, key):
        out = np.full(P.shape, "", dtype=object)
        for s, gs in dct.items():
            u = U(gs[key] if key else gs)
            shapely.prepare(u)
            out[shapely.contains(u, P)] = s
        return out

    lo, lm = labels(off, "geoms"), labels(mine, None)
    both = (lo != "") | (lm != "")
    print(f"point label agreement: {(lo[both] == lm[both]).mean():.5f} of {int(both.sum())} points")


if __name__ == "__main__":
    {"fetch": fetch, "compare": compare}[sys.argv[1] if len(sys.argv) > 1 else "compare"]()
