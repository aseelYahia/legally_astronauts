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

## Features

- **Explore**: real CTX/HiRISE terrain, elevation, steep-ground shading, rover tracks, NASA sample sites, terrain probe.
- **Mission Planner** (A* over the USGS DTMs):
  - **Compare Routes**: Fastest / Shortest / Lower Risk, each a genuinely different optimisation, shown together on the map.
  - **Science Mission Selector**: suggests NASA sample sites for a chosen goal (ancient water, sedimentary, igneous, history).
  - **Safety Alerts**: severity-ranked, each explaining which calculation or dataset triggered it, with ⚠ map markers.
  - **Two-Astronaut mode**: separate routes to a shared rendezvous, with an estimated arrival timeline.
  - **EVA Resources**: walk-out / science / walk-back time, turn-back time and user-entered oxygen and power budgets
    (hypothetical planning arithmetic only).
  - **Mission Report**: PDF with map, statistics, alerts, science notes, sources and limitations.
- **Science Data**: every dataset, DOI, resolution, date and validation check.

API: `POST /api/route` (optional `objective`), `POST /api/compare`, `GET /api/terrain`, `GET /api/health`.
Routes are planning estimates from orbital data, **not certified safe for astronauts**. See `PROJECT_EXPLAINED.md`.

## Data (prototype area: 18.42–18.51° N, 77.34–77.47° E)

| Layer | Source | Resolution | Kind |
|---|---|---|---|
| Terrain base | USGS Mars 2020 TRN CTX orthomosaic, DOI 10.5066/P9GV1ND3 | 6 m | NASA data |
| Elevation / contours / slope | USGS Mars 2020 TRN CTX DTM, DOI 10.5066/P906QQT8 | 20 m | derived in Python |
| High-res detail window | USGS Mars 2020 TRN HiRISE DTM, DOI 10.5066/P9REJ9JN (read over HTTP range requests) | 1 m (routed at 4 m) | derived in Python |
| Rover tracks / landing site | NASA/JPL MMGIS `M20_traverse.json`, `M20_waypoints.json` | rover localizations | NASA data |
| Sample sites | NASA Mars Rock Samples page (names, sols, types) | positions **estimated** from the rover localization on the sealing sol | NASA data + estimate |
| Weather | NASA MEDA public feed, sols 1127–1133 (feed no longer updated) | daily | NASA data (archived) |
| Minerals (CRISM) | CRISM MTRDR summary parameters (PDS), 3 observations, co-registered to CTX | 18 m | derived: potential indicators from assumed thresholds |
| Geologic units | USGS SIM 3464 (Sun & Stack 2020), DOI 10.3133/sim3464 | 1:75,000 | NASA/USGS data (100–200 m offsets) |
| HiRISE close-up photo | Mars 2020 TRN HiRISE orthomosaic via NASA Mars Trek, DOI 10.5066/P9QJDP48 | ~1.2 m (from 25 cm) | NASA data |
| Mars Ground View | Perseverance raw-image API, geolocated by exact NASA site/drive match | rover photos | NASA data (archived) |

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

## NASA data verification & scientific expansion
`analysis/scripts/build_nasa_extras.py` adds four official-resource datasets: Perseverance raw images, the USGS geologic
map, CRISM mineral indicators and the Mars Trek HiRISE orthomosaic. Run it after `build_layers.py`.
* [`NASA_RESOURCES_INTEGRATION.md`](NASA_RESOURCES_INTEGRATION.md) covers every dataset, the challenge resource it came
  from, its processing, attribution, limitations and the final feature table.
* [`DATA_VERIFICATION.md`](DATA_VERIFICATION.md) has the pre-integration audit and the post-integration checks.

## Models and assumptions (labelled in the UI)
* **Slope**: Horn 3×3 on true ground spacing. A 20 m DTM smooths out boulders and small scarps, so real local slopes are steeper.
* **Slope classes**: <10° easy, 10–15° moderate, 15–25° hazard, ≥25° no-go. These are PAWPRINT planning assumptions, not NASA rules.
* **A\***: 8-connected. Cost is walking time from Tobler's hiking function (fitted to Earth hikers) × a slope-hazard factor,
  and cells over the max slope are impassable. Walk time and the difficulty score are **estimates**.

## Mascot
The four astronaut-dog illustrations in `app/public/mascot/` are the supplied artwork, used as-is: standing (onboarding),
sitting (empty states), floating (loading), crawling (tips).
