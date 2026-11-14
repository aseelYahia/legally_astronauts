# PAWPRINT MARS 🐾

Interactive Mars exploration and astronaut EVA route planner for Jezero Crater, built for the NASA Space Apps Challenge. Every
number traces back to a NASA or USGS product. Anything that is not a measurement carries a badge that says so: derived,
estimate, assumption or not ingested.

## Run it

```bash
# 1. Python analysis (rasterio + numpy)
cd analysis
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # macOS/Linux: .venv/bin/python
.venv/Scripts/python scripts/build_layers.py               # raw data -> map layers + terrain grids
.venv/Scripts/python server.py                             # route API on http://127.0.0.1:8777

# 2. Web app (Node 16+)
cd ../app
npm install
npm run dev                                                # http://127.0.0.1:5173 (proxies /api to :8777)
```

Tests: `cd analysis && .venv/Scripts/python -m pytest` and `cd app && npm test`.

## Data (prototype area: 18.42–18.51° N, 77.34–77.47° E)

| Layer | Source | Resolution | Kind |
|---|---|---|---|
| Terrain base | USGS Mars 2020 TRN CTX orthomosaic, DOI 10.5066/P9GV1ND3 | 6 m | NASA data |
| Elevation / contours / slope | USGS Mars 2020 TRN CTX DTM, DOI 10.5066/P906QQT8 | 20 m | derived in Python |
| High-res detail window | USGS Mars 2020 TRN HiRISE DTM, DOI 10.5066/P9REJ9JN (read over HTTP range requests) | 1 m (routed at 4 m) | derived in Python |
| Rover tracks / landing site | NASA/JPL MMGIS `M20_traverse.json`, `M20_waypoints.json` | rover localizations | NASA data |
| Sample sites | NASA Mars Rock Samples page (names, sols, types) | positions **estimated** from the rover localization on the sealing sol | NASA data + estimate |
| Weather | NASA MEDA public feed, sols 1127–1133 (feed no longer updated) | daily | NASA data (archived) |
| Minerals (CRISM) | not ingested | — | disabled |

Raw files live in `data/raw/` (git-ignored). Provenance, dates and citations are in `analysis/pawprint/sources.py`, and the
app shows them under **Science Data**.

### Coordinate system
Mars 2020 TRN Equidistant Cylindrical (`+proj=eqc +lat_ts=0 +lon_0=0 +R=3396190`): planetocentric latitude, east-positive
longitude, and elevations relative to the Mars areoid. The map uses a custom Leaflet CRS in planetocentric degrees, which is
exactly linear in this projection. All distances are computed on the Mars sphere, and east-west ground spacing is scaled by
cos(latitude). That correction is about 5 % at Jezero.

### Validation (automated)
* HiRISE DTM vs NASA rover localization elevations (119 points): median Δ 0.00 m, MAD 0.01 m. Agreement this tight shows the
  localizations are referenced to the HiRISE TRN DTM, so this checks our windowing, georeferencing and datum. It is **not**
  an independent accuracy estimate.
* CTX DTM vs rover localization elevations (353 points): median Δ −0.15 m, MAD 1.6 m, which is effectively CTX vs HiRISE along the traverse.
* HiRISE vs CTX across the whole window: median −1.37 m (USGS reports −0.4 m over the full mosaic; a single 3 × 2.7 km window can differ).
* The HiRISE window is fetched by parsing the TIFF strip table and range-reading only the window bytes; two pixels are
  cross-checked against a GDAL read before the file is written.
* Synthetic-terrain tests for slope, aspect, roughness and hillshade, an A* optimality test against brute-force Dijkstra,
  and an end-to-end API test against the great-circle lower bound.

## Models and assumptions (labelled in the UI)
* **Slope**: Horn 3×3 on true ground spacing. A 20 m DTM smooths out boulders and small scarps, so real local slopes are steeper.
* **Slope classes**: <10° easy, 10–15° moderate, 15–25° hazard, ≥25° no-go. These are PAWPRINT planning assumptions, not NASA rules.
* **A\***: 8-connected. Cost is walking time from Tobler's hiking function (fitted to Earth hikers) × a slope-hazard factor,
  and cells over the max slope are impassable. Walk time and the difficulty score are **estimates**.

## Mascot
The four astronaut-dog illustrations in `app/public/mascot/` are the supplied artwork, used as-is: standing (onboarding),
sitting (empty states), floating (loading), crawling (tips).
