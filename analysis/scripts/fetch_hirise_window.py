"""Fetch a small window of the USGS Mars 2020 TRN HiRISE DTM via HTTP range requests.

The full mosaic is a 1.8 GB *uncompressed, one-row-per-strip* GeoTIFF. GDAL's
/vsicurl/ reader issues one request per row with long stalls on this server,
so we parse the TIFF strip table ourselves and fetch exactly the window's bytes
for each row (~12 KB each, ~32 MB total) with a small bounded worker pool.

The georeferencing comes from GDAL (rasterio) on the same remote file, and a
few sample pixels are cross-checked against a GDAL read before writing.
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import pathlib
import struct
import sys
import time
import urllib.request

import numpy as np
import rasterio
from rasterio.windows import Window, from_bounds

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "analysis"))
from pawprint.mars import lonlat_to_eqc  # noqa: E402
from pawprint.sources import DATASETS, HIRISE_WINDOW  # noqa: E402

OUT = ROOT / "data" / "raw" / DATASETS["hirise_dtm"]["file"]
URL = DATASETS["hirise_dtm"]["url"]
UA = {"User-Agent": "pawprint-mars-prototype/0.1 (research client)"}
WORKERS = 6

TYPE_SIZE = {3: 2, 4: 4, 16: 8}  # SHORT, LONG, LONG8
TYPE_FMT = {3: "H", 4: "I", 16: "Q"}


def get_range(start: int, length: int, tries: int = 8) -> bytes:
    for k in range(tries):
        try:
            req = urllib.request.Request(URL, headers={**UA, "Range": f"bytes={start}-{start + length - 1}"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            if len(data) == length:
                return data
            raise IOError(f"short read {len(data)} != {length}")
        except Exception as e:  # noqa: BLE001 - network: retry with backoff
            if k == tries - 1:
                raise
            time.sleep(min(30, 1.5 * 2**k))
            print(f"  retry {k + 1} @ {start}: {e}", flush=True)
    raise RuntimeError("unreachable")


def read_strip_table(r0: int, nrows: int):
    head = get_range(0, 16)
    bo = {b"II": "<", b"MM": ">"}[head[:2]]
    magic = struct.unpack(bo + "H", head[2:4])[0]
    big = magic == 43
    ifd = struct.unpack(bo + ("Q" if big else "I"), head[8:16] if big else head[4:8])[0]
    cnt_size, ent_size = (8, 20) if big else (2, 12)
    n = struct.unpack(bo + ("Q" if big else "H"), get_range(ifd, cnt_size))[0]
    raw = get_range(ifd + cnt_size, n * ent_size)
    tags = {}
    for i in range(n):
        e = raw[i * ent_size : (i + 1) * ent_size]
        tag, typ = struct.unpack(bo + "HH", e[:4])
        count = struct.unpack(bo + ("Q" if big else "I"), e[4:12] if big else e[4:8])[0]
        val = e[12:20] if big else e[8:12]
        tags[tag] = (typ, count, val)

    def scalar(tag):
        typ, _, val = tags[tag]
        return struct.unpack(bo + TYPE_FMT[typ], val[: TYPE_SIZE[typ]])[0]

    assert scalar(259) == 1, "expected uncompressed TIFF"
    assert scalar(278) == 1, "expected one row per strip"
    assert scalar(258) == 32 and scalar(339) == 3, "expected float32"
    typ, count, val = tags[273]
    ptr = struct.unpack(bo + ("Q" if big else "I"), val[: 8 if big else 4])[0]
    sz = TYPE_SIZE[typ]
    offs = np.frombuffer(get_range(ptr + r0 * sz, nrows * sz), dtype=np.dtype(bo + TYPE_FMT[typ]))
    return bo, offs.astype(np.int64)


def main() -> None:
    x0, y0 = lonlat_to_eqc(HIRISE_WINDOW["lon_min"], HIRISE_WINDOW["lat_min"])
    x1, y1 = lonlat_to_eqc(HIRISE_WINDOW["lon_max"], HIRISE_WINDOW["lat_max"])
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"), rasterio.open("/vsicurl/" + URL) as src:
        win = from_bounds(x0, y0, x1, y1, src.transform).round_offsets().round_lengths()
        r0, c0, h, w = int(win.row_off), int(win.col_off), int(win.height), int(win.width)
        profile = src.profile.copy()
        transform = src.window_transform(win)
        # independent GDAL reference pixels for cross-checking our byte arithmetic
        checks = [(r0 + h // 2, c0 + w // 3), (r0 + 7, c0 + w - 5)]
        ref = [float(src.read(1, window=Window(c, r, 1, 1))[0, 0]) for r, c in checks]
    print(f"window rows {r0}+{h}, cols {c0}+{w} -> {h * w * 4 / 1e6:.1f} MB", flush=True)

    bo, offs = read_strip_table(r0, h)
    out = np.empty((h, w), dtype=np.float32)
    dt_ = np.dtype(bo + "f4")
    t = time.time()

    def fetch(i: int) -> None:
        out[i] = np.frombuffer(get_range(int(offs[i]) + c0 * 4, w * 4), dtype=dt_)

    with cf.ThreadPoolExecutor(WORKERS) as ex:
        for k, _ in enumerate(ex.map(fetch, range(h)), 1):
            if k % 250 == 0 or k == h:
                print(f"  {k}/{h} rows  {time.time() - t:.0f}s", flush=True)

    for (r, c), v in zip(checks, ref):
        mine = float(out[r - r0, c - c0])
        assert (np.isnan(v) and np.isnan(mine)) or mine == v, f"pixel ({r},{c}) mismatch: {mine} vs GDAL {v}"
    print("cross-check vs GDAL OK:", ref, flush=True)

    profile.update(width=w, height=h, transform=transform, compress="deflate", predictor=3, tiled=True, blockxsize=256, blockysize=256)
    with rasterio.open(OUT, "w", **profile) as dst:
        dst.write(out, 1)
        dst.update_tags(
            SOURCE_URL=URL,
            SOURCE_DOI=DATASETS["hirise_dtm"]["doi"],
            WINDOW_LONLAT=str(HIRISE_WINDOW),
            WINDOW_PIXELS=f"row_off={r0} col_off={c0} height={h} width={w}",
            FETCHED_UTC=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        )
    print("wrote", OUT, out.shape, flush=True)


if __name__ == "__main__":
    main()
