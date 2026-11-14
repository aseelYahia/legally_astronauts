# PAWPRINT MARS: NASA Resources Integration

This document covers the "NASA Data Verification & Scientific Expansion" upgrade: which official NASA Space Apps challenge
resources PAWPRINT MARS uses, what data came from each one, how Python processed it, and how you can check it.
Paths are relative to `pawprint-mars/`. The pre-integration audit and the post-integration checks are in
[`DATA_VERIFICATION.md`](DATA_VERIFICATION.md).

Ground rules for this document: every number below can be traced to `analysis/pawprint/sources.py`,
`app/public/data/manifest.json`, the generated data files, or the tests. All imagery and orbital data are **archived**
products. Nothing in the app is live.

## 1. Summary

| | |
|---|---|
| New NASA/USGS data types integrated in this upgrade | **4**: Perseverance raw images, USGS SIM 3464 geologic units, CRISM MTRDR summary parameters, HiRISE controlled orthomosaic (via Mars Trek) |
| Total NASA/USGS dataset entries in the app | **11**: 7 from before (`DATASETS` in `sources.py`) plus these 4 (`EXTRA_DATASETS`) |
| Challenge resources used directly for data | **3**: NASA Mars Trek, USGS-NASA Geological Maps, Perseverance Raw Images |
| Challenge resources used only as design references | **2**: Curiosity's Proposed Route, NASA Worldview |
| Additional NASA archive used (not one of the five listed resources) | NASA PDS Geosciences Node / Mars Orbital Data Explorer (CRISM) |
| Build script | `analysis/scripts/build_nasa_extras.py [photos] [geology] [crism] [hirise]`, run after `build_layers.py` |

The 11 entries are not all of the same kind. MEDA weather is **archived** (sols 1127–1133 only). The sample table is
**transcribed** from NASA's web page. CRISM indicators are **derived** (thresholded) values. The rest are NASA/USGS
products used as published, apart from resampling.

## 2. Official challenge resources

This is the same table the app shows under **Science Data → Official challenge resources** (`CHALLENGE_RESOURCES` in
`app/src/components/ScienceExtras.tsx`).

| Resource | Used directly? | Dataset or feature | Source URL | Proof | Limitations |
|---|---|---|---|---|---|
| NASA Mars Trek | **Yes**, data integrated | HiRISE close-up photo layer: Mars 2020 TRN HiRISE controlled orthomosaic (25 cm source), Trek WMTS tiles at zoom 15. Trek's catalog also confirms the CTX mosaic we already used is the same product. | https://trek.nasa.gov/mars/ | Layer `hirise_ortho` in `manifest.json`, 90 tiles. Correlation with CTX is 0.956 at zero shift. The CTX name and byte size (36,269,402) are identical to the Trek catalog entry. | Downsampled to about 1.2 m from 25 cm. Covers only the HiRISE window. Trek's CTX/HiRISE DTMs duplicate products we already use, so they were not added. |
| USGS-NASA Geological Maps | **Yes**, data integrated | Geologic units layer: USGS SIM 3464 (Sun & Stack 2020) polygons from the official USGS ArcGIS feature service, with the USGS descriptions and interpretations | https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars | `geology_units.geojson`: 6 units, 22 polygons clipped to the area. Unit areas add up to about the area of interest. | 1:75,000 map drawn on a semi-controlled mosaic, so USGS reports 100–200 m offsets. The interpretations date from 2020, before landing. |
| Curiosity's Proposed Route | **No**, design reference only | Numbered science stops with names and objectives in the route itinerary | https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/ | The itinerary shows numbered stops, the geologic unit and the sample objective at each stop. | A 2019 Gale Crater graphic. None of its data is used or shown as Jezero data. |
| NASA Worldview | **No**, design reference only | Time-based exploration: a mission-timeline sol slider for archived rover drives and photos, plus a dated observation timeline | https://worldview.earthdata.nasa.gov/ | Layers panel → Rover tracks → Mission timeline. Science Data → Observation timeline. | Worldview is an Earth-observation tool. None of its Earth data is used. |
| Perseverance Raw Images | **Yes**, data integrated | Mars Ground View: real raw photos (Mastcam-Z, Hazcam, CacheCam, Navcam) from each sample's sealing sol, with NASA links, camera, sol and date | https://mars.nasa.gov/mars2020/multimedia/raw-images/ | `photos.json` from NASA's raw-image API. 62 of 64 photos are geolocated by an exact site/drive match. All 23 in-area sample markers are corroborated. | Rover cameras sit about 1–2 m up, not at astronaut eye level. A pin marks the rover's position, not the camera target. |

CRISM is not one of the five listed resources. It came from the NASA PDS Geosciences Node and was found with the Mars
Orbital Data Explorer (ODE) search. `sources.py` lists its `challenge_resource` as "NASA PDS / Mars Orbital Data Explorer
(Phase 3 requirement)".

## 3. Datasets in detail

### 3.1 Perseverance raw images (Mars Ground View)

| Item | Value |
|---|---|
| Registry key | `m2020_raw_images` (`EXTRA_DATASETS`) |
| Challenge resource | Perseverance Raw Images Gallery |
| Source | Gallery https://mars.nasa.gov/mars2020/multimedia/raw-images/ · API `https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=<sol>` |
| Format | JSON feed per sol (cached as `data/raw/extras/raw_images/sol_NNNNN.json`, 23 files). Images are JPEG files on NASA servers. The app stores 64 small thumbnails (`app/public/data/photos/`, 728 KB) and links to NASA's medium/large/full-resolution files. |
| Dimensions | 64 photos: Mastcam-Z left 22, CacheCam 22, Front Hazcam left 19, Navcam left 1. Only full frames with a short side of at least 600 px are selected. |
| Scientific meaning | Raw, unprocessed rover images: the context view (mast), the arm workspace (hazcam) and the sample tube (CacheCam) on the sol each sample was sealed, plus the landing day. |
| Coverage | The landing site (sol 13) and the sealing sols of the 23 samples inside the area of interest, 2021–2024 |
| Output | `app/public/data/photos.json` (64 records plus a `sample_position_check` list). Manifest layer `photos`: `count` 64, `geolocated` 62. |

**Processing** (`analysis/pawprint/photos.py`, `build_photos()` in `build_nasa_extras.py`):
1. For every point of interest in `pois.json`, fetch the feed for its sealing sol (sol 13 for the landing site).
2. `select_images()` picks at most one image per role, using cameras in order of preference: context (`MCZ_LEFT` →
   `NAVCAM_LEFT` → right-eye cameras), workspace (`FRONT_HAZCAM_LEFT_A/RIGHT_A`) and sample (`CACHECAM`). It keeps only
   `sample_type == "Full"` images that have a medium file and a short side of at least 600 px, and takes the largest frame.
3. `geolocate()` builds the rover motion counter `RMC = "<site>_<drive>"` from the image metadata and looks it up in
   NASA's MMGIS `M20_waypoints.json`. An image is placed only on an **exact** match that NASA does not mark "Interpolated".
   Nothing is interpolated or guessed. Unmatched images go to a non-geolocated gallery with a reason.
4. Corroboration check: for each sample, the build tests whether the marker's localization RMC is among the RMCs of
   all images taken on the sealing sol.

**Results:** 62 photos geolocated. Two landing-day images at RMC 3_28 have no NASA localization and appear only in the
gallery. The sample check passes for 23 of 23.

**Features:** Ground View photo pins on the map (one per rover position), the Ground View gallery and viewer
(`GroundView.tsx`), the Science Data "Mars Ground View photos" card, photos linked from sample markers, and the mission
timeline slider.

**Attribution:** NASA/JPL-Caltech. Mastcam-Z images are credited NASA/JPL-Caltech/ASU. The per-image `credit` field from
NASA is stored with each photo and shown with it.

### 3.2 USGS SIM 3464 geologic units

| Item | Value |
|---|---|
| Registry key | `usgs_sim3464` |
| Challenge resource | USGS-NASA Geological Maps |
| Source | https://pubs.usgs.gov/publication/sim3464 · DOI https://doi.org/10.3133/sim3464 · feature service `https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer/8` |
| Format | ArcGIS REST JSON (Esri polygon rings in Mars Transverse Mercator, central longitude 77.5° E), converted to GeoJSON MultiPolygons in planetocentric lon/lat |
| Dimensions | 32 polygons intersect the area-of-interest query, and 22 remain after clipping, forming 6 units. `geology_units.geojson` is 311 KB. |
| Scientific meaning | Map units (rock formations) mapped from orbit at 1:75,000, with USGS unit descriptions, additional characteristics and interpretations |
| Coverage | Clipped to the area of interest, 77.34–77.47° E, 18.42–18.51° N |

Unit areas inside the area of interest (from `geology_units.geojson`):

| Symbol | Unit | Area (km²) |
|---|---|---|
| NHjf2 | Jezero fan 2 unit | 15.75 |
| Njf | Jezero floor unit | 11.84 |
| Aeb | Eolian bedform unit | 4.31 |
| Nue | Upper etched unit | 3.29 |
| Nle | Lower etched unit | 3.27 |
| cr | Crater rim unit | 0.54 |

These add up to 39.00 km², and the area of interest itself is 38.99 km² (0.13° × 0.09° at 59,274.7 m per degree,
with cos 18.46°). The test `test_geologic_units_cover_the_aoi_and_stay_inside_it` checks that the two agree within 3 %.

**Processing** (`analysis/pawprint/geology.py`, `build_geology()`):
1. Read the layer's spatial reference (WKT) from the service metadata.
2. Transform the area-of-interest corners from Mars lon/lat (`+proj=longlat +R=3396190`) to the service's Mars
   Transverse Mercator with `rasterio.warp.transform` (PROJ). Pad by 1 km and query with an envelope
   (`esriSpatialRelIntersects`), requesting unit attributes and geometry. Only this query result is downloaded, not the
   349 MB map database.
3. Transform every ring back to lon/lat, clip it to the area of interest with a Sutherland–Hodgman clip (`clip_ring`),
   and round to 6 decimals.
4. Split Esri rings into GeoJSON polygons (`esri_rings_to_polygons`: clockwise rings are exteriors, counter-clockwise
   rings are holes, assigned to an exterior by point-in-ring).
5. Compute areas with the shoelace formula. Square degrees become km² using 59,274.7 m per degree × cos(18.46°).
   Each unit is assigned a palette colour in order of area.

**Features:** the Geologic units map layer with a legend and click lookup, the unit shown for each sample site, the unit
column in the route itinerary, and the Science Data "Geologic units (USGS SIM 3464)" card.

**Attribution:** Sun, V.Z., and Stack, K.M., 2020, *Geologic map of Jezero crater and the Nili Planum region, Mars*:
U.S. Geological Survey Scientific Investigations Map 3464, pamphlet 14 p., 1 sheet, scale 1:75,000,
https://doi.org/10.3133/sim3464. Public domain (USGS).

### 3.3 CRISM MTRDR summary parameters (mineral indicators)

| Item | Value |
|---|---|
| Registry key | `crism_mtrdr` (`kind: real-derived`) |
| Source archive | NASA PDS Geosciences Node, volume MROCR_4001: https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_4001/mtrdr/ · search via ODE REST (`pt=MTRDR`), https://ode.rsl.wustl.edu/mars/ |
| Products used | `FRT000047A3_07_SR166J_MTR3` (2007-02-26), `FRT0001FB74_07_SR166J_MTR3` (2011-08-14), `FRT00005C5E_07_SR166J_MTR3` (2007-05-19). The ODE search over the area of interest found 4 observations. HRL000040FF (36 m) was not used. |
| Format | ENVI/PDS BSQ float32 little-endian "SR" (refined summary parameter) cubes, ignore value 65535 |
| Bytes read | 6.1 / 8.1 / 8.6 MB (`bytes_read` 6,098,400 / 8,079,104 / 8,600,960), versus source files of roughly 164–190 MB each |
| Parameters read | 8: `R770` (albedo, used for co-registration) plus `MIN2295_2480`, `MIN2345_2537`, `OLINDEX3`, `D2300`, `BD2210_2`, `BD1900R2`, `LCPINDEX2` |
| Projection | Equirectangular, standard parallel 15° N, sphere R = 3,394,839.8 m, planetocentric, east-positive (from the ENVI header and PDS label) |
| Output grid | 18 m lon/lat grid over the area of interest. `crism_indicators.png` is 1284×888 px (each 18 m cell is drawn as 3×3 px). `data/processed/crism_grid.npz` holds the values and flags. |
| Coverage | 122,453 of 126,688 grid cells (296 × 428) have a measurement. The manifest reports this as 37.63 of 38.93 km² (true ground area, each grid row weighted by its cos(latitude) cell area; see §10). |
| Scientific meaning | Summary parameters measure spectral absorption band depths (Viviano-Beck et al. 2014). Above a threshold, they indicate that a mineral class *may* be present. |

**Processing** (`analysis/pawprint/crism.py`, `read_crism_product()`, `coregister()`, `build_crism()`):
1. Download each product's `.hdr` and `.lbl` files and parse the ENVI header (`parse_envi_header`). The build asserts
   BSQ interleave, float32 data and little-endian byte order.
2. `CrismGrid` converts lon/lat to pixels: x = R·cos(15°)·lon, y = R·lat, with pixel centres taken from the ENVI map
   info. The test `test_crism_grid_matches_pds_label_bounds` checks that the PDS label bounds equal the first and last
   pixel centres.
3. For each of the 8 parameters, compute the byte offset of the area-of-interest rows (with a 2-pixel margin) inside the
   band and fetch only that range with an HTTP `Range` request. `fetch()` falls back to the OS `curl` when the PDS
   server's certificate chain is incomplete.
4. **Co-registration to CTX:** the CTX 6 m orthoimage is averaged 3×3 onto the 18 m grid. Both images are band-pass
   filtered (3×3 mean minus 31×31 mean, about 54–560 m). An exhaustive integer search over shifts up to ±30 px maximises
   the Pearson correlation of CRISM `R770` against CTX. A shift is applied only if r ≥ 0.3 and the peak lies inside the
   search window.

   | Product | r before | r after | Shift |
   |---|---|---|---|
   | FRT000047A3 | −0.073 | 0.873 | 306 m N, 171 m W |
   | FRT0001FB74 | 0.019 | 0.634 | 288 m N, 307 m W |
   | FRT00005C5E | −0.033 | 0.764 | 216 m N, 171 m W |

5. Mosaic the products in the listed order: where they overlap, the earlier product (lower emission angle) wins. Pixels
   used: 50,444 / 19,163 / 52,846.
6. Flag each indicator where the parameter exceeds the threshold (`indicator_flags`; NaN is never flagged). Then keep a
   flagged pixel only if at least 4 of its 8 neighbours are also flagged (`denoise`).
7. Outline the official ODE footprints, moved by the same co-registration shift as the data they enclose.

Indicator thresholds and results (thresholds are **PAWPRINT assumptions**). The areas are as written to the manifest and
shown in the app, computed as true ground area (cos(latitude)-corrected, see §10).

| Indicator | Parameter > threshold | Area in the area of interest |
|---|---|---|
| Mg-carbonate | MIN2295_2480 > 0.01 | none |
| Fe/Ca-carbonate | MIN2345_2537 > 0.01 | none |
| Olivine | OLINDEX3 > 0.12 | 3.381 km² |
| Fe/Mg phyllosilicate (clay) | D2300 > 0.015 | 0.077 km² |
| Al-OH | BD2210_2 > 0.01 | none |
| Hydration | BD1900R2 > 0.015 | 0.005 km² |
| Low-Ca pyroxene | LCPINDEX2 > 0.03 | none |

No carbonate indicator appears. The maximum MIN2295_2480 in the area is 0.0116 and its 99.9th percentile is 0.008, which
is at noise level. Jezero's strongest orbital carbonate signals lie outside this map.

**Features:** the Minerals map layer (pixel colour shows the highest-priority indicator), the point read-out via
`GET /api/minerals?lon=..&lat=..` (returns the parameter values, flagged indicators, product ID, observation time and
PDS label link, or `measured: false`), the Science Data "CRISM mineral indicators" card, the observation timeline, and
mineral wording in `science.ts` and the mission report.

**Attribution:** JHU/APL CRISM team; PDS Geosciences Node (Washington University in St. Louis).
Seelos, F.P., et al. (2016), CRISM MTRDR. Viviano-Beck, C.E., et al. (2014), Revised CRISM spectral parameters and
summary products, *JGR Planets* 119, doi:10.1002/2014JE004627.

### 3.4 HiRISE controlled orthomosaic (via NASA Mars Trek)

| Item | Value |
|---|---|
| Registry key | `trek_hirise_ortho` |
| Challenge resource | NASA Mars Trek |
| Source | https://trek.nasa.gov/mars/ · WMTS `https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/WMTSCapabilities.xml` · DOI https://doi.org/10.5066/P9QJDP48 |
| Format | 256 px greyscale+alpha PNG tiles, equirectangular, zoom 15 (180/2¹⁵ degrees per tile) |
| Dimensions | 90 tiles (5.0 MB cached in `data/raw/extras/trek_hirise/`), cropped to a 2330×2097 px mosaic of about 1.2 m pixels, saved as `app/public/data/hirise_ortho.jpg` (1.1 MB, JPEG quality 82) |
| Scientific meaning | Visible-light orthoimage from HiRISE, controlled to the Mars 2020 TRN base (25 cm source). It shows boulders, ripples and outcrops at a scale CTX cannot resolve. |
| Coverage | The HiRISE DTM window only: 77.42–77.47° E, 18.42–18.465° N |

**Processing** (`build_hirise_ortho()`): compute the tile rows and columns covering the HiRISE window at zoom 15, fetch
and cache each tile, assemble the grey and alpha channels into a canvas, crop to the window, and write the bounds to
manifest layer `hirise_ortho` (`zoom` 15, `pixel_deg` 2.1458e-5, `tiles` 90). Alignment check: correlation with CTX is
0.956 at zero shift, so no re-registration was needed.

**Features:** the "HiRISE close-up photo" basemap option in the Layers panel (`LayersPanel.tsx`, key `hirise_img`).

**Attribution:** Fergason, R.L., et al. (2020), *Mars 2020 Terrain Relative Navigation HiRISE orthorectified image
mosaic*, USGS Astrogeology, https://doi.org/10.5066/P9QJDP48 (CC0 1.0). Produced by USGS Astrogeology for NASA/JPL
Mars 2020 TRN and served by NASA Solar System Treks (JPL).

### 3.5 Datasets from before this upgrade (for completeness)

These are documented in [`DATA_VERIFICATION.md`](DATA_VERIFICATION.md) §2 and in `DATASETS`: the CTX DTM (20 m,
DOI 10.5066/P906QQT8), CTX orthomosaic (6 m, DOI 10.5066/P9GV1ND3), HiRISE DTM window (1 m, DOI 10.5066/P9REJ9JN),
MMGIS rover traverse and localizations, MEDA weather (archived, sols 1127–1133), and the NASA sample table (transcribed).
The Mars Trek catalog check confirms that the CTX orthomosaic is the same product Trek serves: the name is identical and
so is the size, 36,269,402 bytes.

## 4. Data still unavailable

* **Live weather.** The public MEDA feed stopped at sol 1133 (2024-04-27). Weather is shown as archived.
* **Samples 24–30** lie outside the area of interest and are not mapped. NASA lists samples 29–30 as "TBD".
* **CRISM HRL000040FF** (36 m) was found by the ODE search but not used. Carbonate indicators are absent inside the area
  of interest (below noise).
* **Confirmed mineralogy.** That requires ratioed I/F spectra and spectral analysis, which this app does not do.
* **HiRISE orthoimage outside the HiRISE window**, and the full 25 cm resolution (we use about 1.2 m).
* **Camera pointing / footprints** for rover photos. Only the rover position is known from NASA metadata.
* **Rock abundance / boulder counts, dust, radiation and illumination models.** None are ingested.
* **Geologic map at rover scale.** SIM 3464 is 1:75,000 and was mapped before landing.

## 5. Limitations and assumptions

| Topic | Limitation or assumption |
|---|---|
| Ground View pins | Mark the **rover** position at the image's site/drive, not what the camera saw. Rover cameras are about 1–2 m up, not at astronaut eye level. |
| Ground View geolocation | Exact RMC match only. Interpolated NASA localizations are excluded, so 2 images are not geolocated. |
| Geologic boundaries | 100–200 m random offsets relative to the controlled CTX basemap (USGS read-me). They are drawn as approximate and **never used for routing**. |
| Geologic interpretations | Written in 2020, before landing. Rover results (for example, igneous crater-floor rocks) refine some of them. |
| CRISM thresholds | `MIN2295_2480 > 0.01`, `MIN2345_2537 > 0.01`, `OLINDEX3 > 0.12`, `D2300 > 0.015`, `BD2210_2 > 0.01`, `BD1900R2 > 0.015`, `LCPINDEX2 > 0.03`, plus the 4-of-8 neighbour filter, are **PAWPRINT assumptions**. A coloured pixel is a **potential indicator, not a confirmed mineral**. Parameters can respond to more than one mineral (see the meanings in `crism.py`). |
| CRISM registration | Integer-pixel (18 m) shifts. FRT0001FB74 has the weakest correlation (0.634). |
| CRISM resolution | 18 m N–S, about 17.1 m E–W on the output grid, so it cannot resolve features at the scale of a single rover stop |
| HiRISE ortho | Downsampled to about 1.2 m. Covers only the HiRISE window. |
| Time | Every dataset is archived (2007–2024 observations). The mission timeline replays archived data and is not live. |
| Design references | Curiosity's route (Gale, 2019) and Worldview (Earth) only shaped the UI. None of their data appears in the app. |

## 6. Evidence that map values come from real datasets

* **Provenance in the manifest.** Each new layer in `app/public/data/manifest.json` names its `source` registry key, its
  `kind` (`real` or `real-derived`) and a generation timestamp (`extras_generated_utc`). CRISM products also carry their
  PDS `.img` URL, `.lbl` URL, the exact `bytes_read` and the registration statistics.
* **Cached raw responses.** `data/raw/extras/` keeps the NASA/USGS responses that the generated files were built from:
  the 23 raw-image feeds, the ArcGIS layer metadata and query result, the CRISM headers, labels and range-read band rows,
  the ODE search result, and the 90 Trek tiles. Re-running `build_nasa_extras.py` reproduces the outputs from them.
* **Photos.** Every record keeps NASA's `imageid`, `nasa_page`, `json_link`, image URLs, `credit`, `site`/`drive`, and
  the NASA localization it matched. `test_photos_are_real_nasa_assets_with_exact_localizations` re-checks these against
  `M20_waypoints.json`.
* **Sample markers.** Sealing-sol image metadata places the rover at the marker's RMC for 23 of 23 samples
  (`test_every_sample_marker_is_corroborated_by_sealing_sol_images`).
* **Geology.** Polygons stay inside the area of interest and their areas add up to about the area of interest
  (`test_geologic_units_cover_the_aoi_and_stay_inside_it`).
* **CRISM.** Only measured pixels are coloured and the products are co-registered
  (`test_crism_colours_only_measured_pixels_and_is_coregistered`). The grid math is checked against the PDS label
  (`test_crism_grid_matches_pds_label_bounds`), and the point API is tested end to end (`test_minerals_api`).
* **HiRISE ortho.** Coverage of the HiRISE window is tested (`test_trek_hirise_ortho_covers_the_hirise_window`), and
  the correlation with CTX is 0.956 at zero shift.
* **Base map (read-only verification).** The displayed CTX PNG correlates with the original GeoTIFF at 0.99998, with a
  maximum difference of 1 DN. All 24 marker coordinates exactly equal NASA localizations in a fresh NASA download (sha256
  identical to the local copies). All 6,671 displayed traverse vertices match NASA vertices at 7-decimal rounding.
  On-screen pins fall within 2.8 m (median 1.65 m) of their coordinates. See `DATA_VERIFICATION.md`,
  "Post-integration results".

## 7. Final report

| Feature | NASA source | Implemented? | Verified? | Limitations |
|---|---|---|---|---|
| Mars Ground View (photo pins, gallery, viewer) | Perseverance raw-image API + MMGIS localizations | Yes | Yes: 62/64 geolocated by exact RMC; 23/23 samples corroborated; tests | Pin is the rover position; camera height about 1–2 m; 2 photos not geolocated |
| Geologic units layer and unit lookup | USGS SIM 3464 (ArcGIS feature service, layer 8) | Yes | Yes: 6 units, 22 polygons; area check; geometry tests | 100–200 m offsets; pre-landing interpretations; not used for routing |
| Minerals layer and `/api/minerals` | CRISM MTRDR SR cubes (PDS / ODE) | Yes | Yes: label-bound test, co-registration r 0.634–0.873, API test | Threshold indicators (assumptions), not confirmed minerals; 18 m; no carbonate signal in the area of interest |
| HiRISE close-up photo layer | Mars 2020 TRN HiRISE ortho via NASA Mars Trek WMTS | Yes | Yes: r = 0.956 vs CTX at zero shift; coverage test | About 1.2 m (downsampled); HiRISE window only |
| CTX basemap product check | NASA Mars Trek catalog | Yes (check only) | Yes: identical name and 36,269,402-byte size | None |
| Numbered route itinerary with unit and objective | Curiosity's Proposed Route (design only) | Yes | Design reference, no data | No Gale data used |
| Mission timeline slider and observation timeline | NASA Worldview (design only), dates from the archived datasets | Yes | Design reference; dates come from manifest/photos | Archived data, not live |
| Corrected HiRISE terrain read-out label | HiRISE DTM (existing) | Yes | Yes: now labelled "4 m routing grid from 1 m DTM" | 4 m, not 1 m |
| Verbatim NASA sample type | NASA sample table (existing) | Yes | Yes: "Rock Core" etc. shown verbatim; sub-type marked as a PAWPRINT campaign summary | Sub-type is a summary, not from NASA's table |

## 8. Tests

* Python, `analysis/tests/test_nasa_extras.py`: geolocation needs an exact NASA localization; thumbnails and sub-frames
  are skipped; ring clipping; Esri rings become polygons with holes; CRISM grid matches PDS label bounds; missing
  measurements are never flagged; denoise removes isolated pixels; photos are real NASA assets with exact localizations;
  every sample marker is corroborated; geologic units cover the area of interest and stay inside it; CRISM colours only
  measured pixels and is co-registered; CRISM cell areas are cos(latitude)-weighted and the manifest km² equal
  true ground areas; Trek HiRISE ortho covers the HiRISE window; `/api/minerals` API.
* TypeScript, `app/src/lib/nasaExtras.test.ts`: geologic unit lookup (exterior vs hole); only NASA-hosted images with
  camera, sol and date; only localized photos are mapped, grouped per rover position; every in-area sample is linked to
  photos and a corroborated position; every sample site gets a mapped unit, kept separate from mineral indicators; the
  challenge resources table distinguishes data integration from design inspiration.
* Current totals are in `DATA_VERIFICATION.md`, "Post-integration results" §P5.

## 9. Screenshots (`docs/screenshots/`)

| File | Shows |
|---|---|
| `01_geology_units.png` | Geologic units layer (USGS SIM 3464) |
| `02_crism_mineral_indicators.png` | CRISM mineral-indicator layer |
| `03_ground_view_map_pins.png` | Mars Ground View photo pins on the map |
| `04_ground_view_gallery.png` | Mars Ground View gallery |
| `05_mars_trek_hirise.png` | HiRISE close-up layer from Mars Trek |
| `06_science_official_resources.png` | Science Data: official challenge resources table |
| `07_science_crism_card.png` | Science Data: CRISM mineral indicators card |

## 10. Unresolved issues

* The landing marker matches NASA's published rounded coordinates (18.44° N, 77.45° E). More precise published figures
  (4 decimals) could not be verified, so none are claimed.
* The 2 landing-day images (RMC 3_28) have no NASA localization and stay unmapped.
* CRISM HRL000040FF was not integrated. Co-registration for FRT0001FB74 is the weakest (r = 0.634).
* Geologic unit boundaries are not re-registered to the controlled CTX basemap. The USGS-stated 100–200 m offsets remain.
* The CRISM thresholds have not been validated against spectral analysis. They are display assumptions.
* ~~CRISM area figures are about 5 % too high.~~ **Fixed.** The grid spacing is 18 m / 59,274.7 m per degree in both
  longitude and latitude, so an east–west step is 18·cos(lat) ≈ 17.1 m; areas used to be computed as cells × 18 m × 18 m.
  `build_crism()` now weights each row by its exact spherical cell area (`crism.row_cell_area_km2`, R = 3,396,190 m).
  New values: `aoi_km2` 41.05 → 38.93 (spherical AOI 38.99 km²), `measured_km2` 39.67 → 37.63, olivine 3.565 → 3.381,
  Fe/Mg clay 0.081 → 0.077, hydration 0.005 (unchanged at 3 decimals). Pixels, flags, overlay and co-registration are
  unchanged; `test_crism_areas_use_true_ground_area` guards it.
* No live NASA data source is available for weather. All layers are archived snapshots, fetched at build time.
