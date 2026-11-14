# PAWPRINT MARS — Data Verification Audit

Status: **Phase 1 (pre-integration) audit**, 2026-11-14. Read-only: no application code or dataset was changed to produce this section.
A post-integration section is appended at the end of this file.

Evidence was produced by `scratchpad/audit.py`-style checks re-run against the files listed below, the running route API
(`analysis/server.py`, port 8777), and live NASA/USGS endpoints. Paths are relative to `pawprint-mars/`.

## 1. Summary table

| # | Dataset / claim | Result | Evidence (short) |
|---|---|---|---|
| 1 | CTX DTM 20 m (elevation, slope, routing) | **PASS** | CRS `+proj=eqc +R=3396190`, 20 m, float32, matches USGS DOI 10.5066/P906QQT8; traced value identical end-to-end (§3) |
| 2 | CTX orthomosaic 6 m (Terrain imagery) | **PASS** | Same product label and **byte size (36,269,402)** as NASA Mars Trek's "MRO CTX, Jezero Mosaic, Controlled" |
| 3 | HiRISE DTM window (1 m source) | **PASS** | eqc, 1 m, 2964×2667 px, 77.42–77.47 E / 18.420–18.465 N; median HiRISE − rover elevation 0.001 m (n=119) |
| 4 | "HiRISE 1 m" wording for terrain read-outs | **WARNING** | Routing and `/api/terrain` use a **4 m** grid (2×2 block means of 2 m); map colours use 2 m. Science Data shows "1 m HiRISE" for a 4 m value |
| 5 | Rover traverse (Perseverance path) | **PASS** | First in-AOI vertex (77.4508857, 18.4446271) found verbatim in NASA MMGIS `M20_traverse.json`; 279 of 559 features in AOI |
| 6 | Rover localizations (waypoints) | **PASS** | 708 NASA localizations, sols 13–2022; 22 are flagged "Interpolated" by NASA (none used for samples) |
| 7 | Sample names / sols / dates / campaigns (1–25) | **PASS** | Re-checked against NASA's sample page on 2026-11-14: all 25 match |
| 8 | Sample rock sub-type ("igneous", "sedimentary", "silica-cemented carbonate") | **WARNING** | NASA's table says only "Rock Core"/"Regolith"/"Atmospheric"; the sub-type is a campaign-geology summary not in the cited table, while `science.ts` says "rock type comes from NASA's table" |
| 9 | Sample marker positions | **WARNING (labelled ESTIMATE)** | Last NASA end-of-drive localization on/before sealing sol; 2–23 sols before sealing. Already labelled "estimated" in UI |
| 10 | Landing marker | **PASS** | First NASA localization (sol 13, RMC 3_0), elevation −2569.91 m vs HiRISE −2569.90 m |
| 11 | MEDA weather | **PASS (ARCHIVED)** | Feed has only sols 1127–1133 (2024-04-21…27); "--" values preserved as null; UI says archived / no live weather |
| 12 | Slope (Horn 1981, cos-lat ground spacing) | **PASS** | Formula verified in `analysis/pawprint/terrain.py`; Jezero cos(18.4°)=0.949 correction applied |
| 13 | Roughness (Riley TRI, RMS of 8 neighbours) | **PASS (DERIVED)** | `terrain.roughness_rms`; reported in metres |
| 14 | Hazard classes 10/15/25° | **ASSUMPTION** | PAWPRINT planning thresholds, not NASA limits; labelled as assumptions in manifest and UI |
| 15 | Walking time (Tobler 1993) | **ASSUMPTION** | Earth hiking function, not validated for suited astronauts in Mars gravity; labelled ESTIMATE |
| 16 | A* objectives / risk multipliers / difficulty score | **ASSUMPTION** | Heuristic weights in `routing.py`; documented, not physical measurements |
| 17 | EVA oxygen / battery | **ASSUMPTION (user-entered)** | No defaults invented; computed only from user budgets/rates |
| 18 | Minerals layer | **NOT INGESTED** | Layer disabled; no CRISM data before this upgrade |
| 19 | Geologic units | **NOT INGESTED** | Not present before this upgrade |
| 20 | CTX vs HiRISE elevation agreement | **PASS (with known offset)** | median −1.37 m, MAD 1.59 m (n=19,832); USGS reports −0.4 m median offset for the mosaics |

No **FAIL** was found in the data pipeline. Two wording issues (rows 4 and 8) overstate precision/provenance and are corrected in the integration phase (see §8).

## 2. Dataset inventory

| Dataset | Source URL | Mission / instrument | Local file | Format / size | Resolution / CRS | Coverage | Used by |
|---|---|---|---|---|---|---|---|
| CTX DTM mosaic | https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif | MRO CTX stereo (SOCET SET), USGS for Mars 2020 TRN | `data/raw/JEZ_ctx_B_soc_008_DTM_…20m….tif` | GeoTIFF float32, 1596×1512, nodata −3.40e38 | 20 m; eqc lat_ts=0, R=3,396,190 m; areoid (MOLA geoid) heights | 77.160–77.699 E, 18.211–18.721 N | `build_layers.py` → `ctx_grid.npz`, `ctx_elevation.png`, `ctx_contours.png`, `ctx_slope_hazard.png`; API `/api/route`, `/api/compare`, `/api/terrain` |
| CTX orthomosaic | …/CTX/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif | MRO CTX | `data/raw/JEZ_ctx_B_soc_008_orthoMosaic_6m….tif` | GeoTIFF uint8, 5322×5040 | 6 m; eqc | same | `ctx_ortho.png` (0.5–99.5 % stretch) |
| HiRISE DTM mosaic (window) | …/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif | MRO HiRISE stereo | `data/raw/hirise_dtm_window_1m.tif` (range-read window) | GeoTIFF float32, 2964×2667 | 1 m; eqc | 77.420–77.470 E, 18.420–18.465 N | `hirise_grid.npz` (4 m), `hirise_elevation.png`, `hirise_slope_hazard.png` (2 m) |
| Rover traverse | https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json | Mars 2020 localization team (MMGIS) | `data/raw/M20_traverse.json` | GeoJSON, 559 features | lon/lat deg | sols 14 → present | `rover_traverse.geojson` (279 AOI segments) |
| Rover localizations | …/M20_waypoints.json | same | `data/raw/M20_waypoints.json` | GeoJSON points, 708; fields incl. `RMC`, `site`, `drive`, `sol`, `elev_geoid`, `Note`, `images` | lon/lat deg, metres | sols 13–2022 | sample positions, landing, validation |
| MEDA weather | https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json | MEDA | `data/raw/m2020_weather.json` | JSON, 7 sols | °C, Pa, LMST | sols 1127–1133 | `weather.json`, Science Data, safety notes |
| Sample table | https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/ | NASA (transcribed) | `analysis/pawprint/samples.py` | Python table, 25 rows | — | 23 inside the AOI | `pois.json`, markers, Science missions, report |

All rasters were confirmed to carry the projection `+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +R=3396190 +units=m`
(read with rasterio). Units are not declared in the GeoTIFF band metadata; metres and the areoid datum come from the USGS
release metadata (DOIs above).

## 3. End-to-end trace of one real elevation value

Point: **Melyn** sample marker (estimated position) lon 77.38398783 E, lat 18.4702116 N.

| Stage | Location | Value |
|---|---|---|
| 1. Original NASA/USGS file | `data/raw/JEZ_ctx_…_DTM_…20m….tif`, row 743, col 662 | **−2448.734375 m** |
| 2. Python processing | `data/processed/ctx_grid.npz` `elevation[117,130]` (window read, nodata→NaN, float32) | **−2448.734375 m** (identical) |
| 3. Generated layer | `app/public/data/ctx_elevation.png` pixel (117,130) = RGBA (229,153,189,235) | ramp colour for −2448.7 m is (245.7,163.7,202.6); pixel/ramp ratio 0.932/0.935/0.933 — one common hill-shade factor, so the colour encodes this elevation |
| 4. Backend API | `GET /api/terrain?lon=77.38398783&lat=18.4702116` | `ctx.elevation_m = −2448.734375`, slope 5.26°, hazard class 0 |
| 5. Displayed value | Explore panel / Science Data rounds `elevation_m` → **−2,449 m** | matches |

HiRISE path, at the landing marker (77.45088572 E, 18.44462715 N): raw 1 m pixel −2569.904 m; 4×4 raw mean −2569.892 m;
4 m grid / API −2569.882 m; NASA rover localization `elev_geoid` −2569.91 m. CTX at the same point: −2567.19 m (2.7 m higher,
within the CTX/HiRISE spread in row 20).

## 4. Formulas inspected

| Quantity | Implementation | Status |
|---|---|---|
| Slope | Horn 3×3 kernel, `dx = res·cos(lat_row)`, `dy = res` (`terrain.slope_aspect`) | correct; eqc stretches x by 1/cos(lat) |
| Aspect / hill-shade | Horn gradients; display only | correct |
| Roughness | RMS elevation difference to 8 neighbours (Riley et al. 1999) | correct; metres |
| Hazard class | `np.digitize(slope, [10,15,25])` | assumption thresholds |
| Walking speed | Tobler: v = 6·exp(−3.5·|tanθ + 0.05|) km/h (`routing.tobler_speed_ms`) | Earth model, labelled estimate |
| A* cost | per-step time or distance × objective multiplier (`balanced`: 1+((s−10)/10)² above 10°; `lower_risk`: 1+((s−5)/5)² above 5°); cells ≥ max slope impassable; octile heuristic scaled by v_max (admissible) | heuristic weights (assumption) |
| Difficulty | `difficulty_label` score from distance, gain, max slope, class fractions | heuristic (assumption) |
| HiRISE routing grid | 1 m → 2 m mean (display) → 4 m mean (routing); slope = max of 2 m slopes in each 4 m cell | derived; conservative for slope |

## 5. Manually entered values, assumptions and estimates

* **Manually entered**: the 25-row sample table (`samples.py`, transcribed from NASA's page); AOI and HiRISE window boxes (`sources.py`); slope classes; colour ramps.
* **Assumed safety thresholds**: 10/15/25° slope classes; default 25° max walkable slope; alert thresholds in `app/src/lib/safety.ts` (long walk, steep stretch, elevation gain). All labelled ASSUMPTION.
* **Estimated locations**: all sample markers (rover's last localization on/before sealing sol, offset 2–23 sols).
* **Historical weather**: MEDA sols 1127–1133 only (April 2024), several fields missing ("--").
* **User-entered**: all EVA budgets (oxygen, battery, time, pace, science time).

## 6. Coverage gaps and missing measurements

* HiRISE elevation covers only a 5.3 × 4.7 km window around the landing site / south Séítah; everything else uses 20 m CTX, which smooths metre-scale slopes (slopes are underestimated there).
* Samples 24–30 lie outside the AOI (Margin unit east edge, Neretva Vallis, crater rim) and are not shown; NASA's list now runs to 30 samples (29–30 still "TBD").
* No orbital mineralogy, no geologic map, no rover ground imagery, no HiRISE orthoimagery before this upgrade.
* No live weather; no dust, radiation or illumination model.
* Rock abundance / boulder hazards are not mapped (no HiRISE rock-count product ingested).

## 7. Claims that exceed the data

| Claim | Where | Issue |
|---|---|---|
| "1 m HiRISE" next to a terrain read-out | `app/src/components/ScienceView.tsx:46` | value is from the 4 m routing grid |
| "The rock type comes from NASA's table" | `app/src/lib/science.ts:116` | only the coarse type (Rock Core/Regolith) is in NASA's table; the igneous/sedimentary sub-type is a summary |

Everything else reviewed (route safety, EVA, weather, minerals) is already worded as estimate / assumption / archived / not ingested.

## 8. Planned corrections (applied in Phase 3–4)

1. Label HiRISE read-outs "HiRISE (4 m routing grid from 1 m DTM)".
2. Show NASA's sample type verbatim and mark the igneous/sedimentary sub-type as a campaign-context summary.

No scientific formula was found to be in error; none will be changed.

---

# Post-integration results

Status: **after the "NASA Data Verification & Scientific Expansion" upgrade**, 2026-11-14. The Phase 1 audit above is
unchanged. Dataset-by-dataset processing details are in [`NASA_RESOURCES_INTEGRATION.md`](NASA_RESOURCES_INTEGRATION.md).

## P1. Updated summary table

| # | Dataset / claim | Result | Evidence (short) |
|---|---|---|---|
| 4 | HiRISE terrain read-out wording | **FIXED** | Read-outs are now labelled "HiRISE (4 m routing grid from 1 m DTM)" |
| 8 | Sample rock sub-type | **FIXED** | NASA's type is shown verbatim ("Rock Core" and so on). The igneous/sedimentary sub-type is marked as a PAWPRINT campaign summary. Mineral wording in `science.ts` and the report was updated to match. |
| 9 | Sample marker positions | **PASS (still ESTIMATE)** | Images from the sealing sol were taken at the same NASA RMC as the marker for **23 of 23** in-area samples (`photos.json` → `sample_position_check`) |
| 18 | Minerals layer | **INGESTED (DERIVED)** | CRISM MTRDR SR cubes FRT000047A3, FRT0001FB74 and FRT00005C5E, read by HTTP range requests and co-registered to CTX. Shown as *potential indicators* from PAWPRINT thresholds. |
| 19 | Geologic units | **INGESTED** | USGS SIM 3464 (Sun & Stack 2020) from the USGS ArcGIS feature service, layer 8: 6 units, 22 polygons |
| 21 | Rover ground photos | **INGESTED** | 64 NASA raw images. 62 are geolocated by exact site/drive match to NASA localizations, and 2 (landing day, RMC 3_28) are not. |
| 22 | HiRISE orthoimagery | **INGESTED** | Mars Trek WMTS, zoom 15: 90 tiles, 2330×2097 px, about 1.2 m. Correlation with CTX is 0.956 at zero shift. |
| 23 | CTX orthomosaic identity | **PASS** | Mars Trek catalog entry has the identical name and 36,269,402-byte size |
| 24 | CRISM area labels (km²) | **PASS (fixed)** | Previously about 5 % high (cells counted as 18 m × 18 m although the grid is 18 m in degrees on both axes, i.e. 18·cos(lat) m east–west). `build_crism()` now weights each grid row by its exact spherical cell area (`crism.row_cell_area_km2`, R = 3,396,190 m): `aoi_km2` 41.05 → 38.93 (spherical AOI 38.99 km², 0.15 %), `measured_km2` 39.67 → 37.63. Pixels, flags, overlay PNG and co-registration are unchanged. Guarded by `test_crism_areas_use_true_ground_area`. |
| 25 | Geologic unit areas (km²) | **PASS (documented approximation, unchanged)** | `build_geology()` converts each polygon's planar lon/lat area with one fixed factor, 59,274.7² m²/deg² × cos(18.46°) (`analysis/scripts/build_nasa_extras.py`, lines 186–187), instead of a per-latitude or spherical area. Across the AOI (18.42–18.51° N) cos(lat) varies by only about ±0.03 %, so each unit's area is within about 0.03 % (unit sum 39.00 km² vs spherical AOI 38.99 km²). These areas are display-only (legend, Science Data); they do not feed routing or any scientific calculation. Left as is on purpose. |

## P2. Displayed map vs source data (read-only checks)

| Check | Result |
|---|---|
| Displayed CTX PNG vs original CTX GeoTIFF | correlation 0.99998, maximum difference 1 DN |
| 24 map markers (landing + 23 samples) vs NASA localizations | all exactly equal to a fresh NASA `M20_waypoints.json` download (sha256 identical to the local copy) |
| Displayed rover traverse | all 6,671 displayed vertices match NASA vertices at 7-decimal rounding |
| On-screen pin placement | within 2.8 m (median 1.65 m) of the stated coordinates |
| Landing marker vs published landing site | consistent with NASA's published rounded 18.44° N, 77.45° E. More precise published figures could not be verified, so none are claimed. |
| Geologic unit area sum vs area of interest | 39.00 km² vs 38.99 km² (test tolerance 3 %) |
| CRISM label bounds vs pixel centres | equal (`test_crism_grid_matches_pds_label_bounds`) |
| CRISM co-registration to CTX (R770 vs albedo correlation) | 47A3 −0.073 → 0.873 (306 m N, 171 m W); FB74 0.019 → 0.634 (288 m N, 307 m W); 5C5E −0.033 → 0.764 (216 m N, 171 m W) |

## P3. CRISM indicator results in the area of interest

As reported by the manifest (true ground areas, cos(latitude)-corrected; see P1 row 24):

| Indicator (assumed threshold) | km² |
|---|---|
| Olivine (OLINDEX3 > 0.12) | 3.381 |
| Fe/Mg clay (D2300 > 0.015) | 0.077 |
| Hydration (BD1900R2 > 0.015) | 0.005 |
| Mg-carbonate (MIN2295_2480 > 0.01), Fe/Ca-carbonate (MIN2345_2537 > 0.01), Al-OH (BD2210_2 > 0.01), low-Ca pyroxene (LCPINDEX2 > 0.03) | none |

No carbonate is flagged: MIN2295_2480 reaches at most 0.0116 here (99.9th percentile 0.008), which is at noise level. All
thresholds and the 4-of-8 neighbour filter are PAWPRINT assumptions. A coloured pixel is a potential indicator, not a
confirmed mineral.

## P4. Remaining assumptions, estimates and gaps

* Sample marker positions are still **estimates** (the rover's localization on or before the sealing sol), now
  corroborated by image metadata.
* Ground View pins show the **rover** position, not the camera target. Rover cameras sit about 1–2 m above the ground.
* Geologic boundaries carry 100–200 m offsets (USGS read-me), are not used for routing, and reflect 2020 pre-landing
  interpretations. Their km² areas use a single cos(18.46°) factor (about ±0.03 %; see P1 row 25).
* The CRISM HRL000040FF observation (36 m) was not used. The HiRISE orthoimage covers only the HiRISE window.
* Weather remains archived (MEDA sols 1127–1133). Nothing in the app is live.
* Curiosity's Proposed Route and NASA Worldview were used as **design references only**. None of their data is shown.

## P5. Tests observed for this report

Run on 2026-11-14 while other sessions were editing code in this folder, so these numbers describe the tree at that
moment:

* `analysis/.venv/Scripts/python -m pytest -q` (in `analysis/`): **86 passed** (85 plus
  `test_api_refuses_to_share_its_port`, added with the API restart fix below)
* `npx vitest run` (in `app/`): **63 tests** in 7 files; all 63 passed before the Ground View rework regenerated
  `photos.json`. One ID-format check in `src/lib/nasaExtras.test.ts` was then too strict for NASA's `NLMV…` image IDs
  and was handed to the Ground View session to relax (data unaffected).
* Production build (`tsc --noEmit && vite build`): **passes**; one non-fatal warning that the main JS chunk is 501 kB
  (over Vite's 500 kB suggestion).

## P6. Route API restart reliability

* Found: Python's `HTTPServer` sets `SO_REUSEADDR`, which on Windows lets a second API process bind port 8777
  silently; two instances were observed listening at once, so requests could reach a stale one.
* Fixed in `analysis/server.py`: `ExclusiveHTTPServer` (no address reuse, `SO_EXCLUSIVEADDRUSE` on Windows) binds
  before loading data; a duplicate start exits with code 1 and a clear "port already in use" message. `/api/health`
  now reports `pid`, `started_utc`, the data files' timestamps and `data_on_disk_changed`.
* The `pawprint-api` launch configuration now has `autoPort: false`, so a busy port is reported instead of being
  silently "moved" (the server always binds the port given in its arguments).
* Verified: three stop/start cycles via the launch configuration, each ready in 0.2–0.3 s with a new pid, exactly one
  listener, identical route (Lower Risk 4,437 m) and mineral (olivine) answers, and the Vite `/api` proxy reaching it.
