# Water Evidence Explorer: scientific data validation audit

**Date:** 2026-11-15. **Scope:** the geology layer, the CRISM indicators, the scoring formula, the highlighted regions, and how the map is framed.

**Result:** 3 confirmed errors were found and fixed. The highlighted regions went from 6 to 5; 3 of the old regions were artefacts of the errors.

## 1. Geology layer vs the official USGS map

**Official source:** Sun & Stack (2020), USGS SIM 3464, [doi:10.3133/sim3464](https://doi.org/10.3133/sim3464).
- `sim3464_database.zip` is 349 MB, mostly rasters. Only the geodatabase `Nili.gdb` was fetched (22.6 MB), via HTTP range reads; layer `GeoUnits_v1` has 1,304 polygons.
- The official map sheet (`sim3464.pdf`, 36 MB) and pamphlet were also fetched.
- Everything is stored under `data/raw/extras/geology/usgs_sim3464/`, which is git-ignored.

| Check | Result |
|---|---|
| Source of our layer | ArcGIS feature service `Jezero_FeatureServiceFromPro/FeatureServer/8`. It has no owner or copyright text, so it is still **unattributed**. |
| Coordinates / CRS | Same projection as the official layer: MTM, central longitude 77.5°E, Mars 2000 sphere (R = 3,396,190 m). |
| Unit codes and names | Identical for all 6 units in the area: NHjf2, Njf, Aeb, Nue, Nle, cr. |
| Boundaries | After the fix: per-unit IoU ≥ 0.9999, boundary distance ≤ 0.04 m (median 0.01 m), and label agreement 99.998% of 46,800 sample points. The one disagreeing point lies on a shared boundary. |
| Unit interpretations we quote | All quoted phrases appear on the official map sheet's Description of Map Units. The ArcGIS copy has minor wording differences (Aeb: "Amazonian-aged bedforms" vs "Amazonian bedforms"). |
| Positional accuracy | Unchanged USGS caveat: 100–200 m random offsets to the controlled CTX basemap (official readme). |

**Error found and fixed (E1):** PAWPRINT's own clipping dropped one hole.
- Where: a hole in a Nue polygon (ArcGIS objectid 1303) crosses the AOI's north-west edge.
- Cause: after clipping, the hole's first vertex sat exactly on the exterior's edge. The first-vertex point-in-polygon test then failed, so the hole was discarded.
- Effect: 0.0214 km² of NHjf2 (delta) was drawn as **both** Nue and NHjf2. Nue's area read 3.29 km² instead of 3.268.
- Fix: `pawprint/geology.py` (`hole_host`) now assigns holes by a majority vote over all their vertices.
- Tests: a regression test, plus a partition test based on unrounded areas. The old 3% tolerance in the coverage test hid this error.
- Unit colours are now pinned per unit, so the fix does not swap colours.

## 2. CRISM indicators vs the original NASA data

| Check | Result |
|---|---|
| Bytes vs PDS | 9 random rows (3 parameters × 3 observations) were re-read from PDS Geosciences. Our cached values are **byte-identical**. |
| Missing-data value | 65535, as in the product headers; it is converted to NaN. No pixel is marked "measured" while an aqueous parameter is NaN, and none the other way round. |
| Band order / format | PC_REAL 32-bit band-sequential images, read using the band names in each product's header (the PDS label points to it for ENVI band names). |
| Thresholds | These **cannot** be validated against NASA data, because PDS publishes summary *parameters*, not detection thresholds. They remain documented PAWPRINT assumptions. The parameter definitions follow Viviano-Beck et al. (2014). |
| Missing-data handling | NaN is never flagged. A cell with less than 50% CRISM coverage gets "no data", not zero. |
| Footprint edges | Indicator pixels are ~4× more common within 3 px of an observation's footprint edge (14.6% vs 3.5%). This is a known noise pattern in CRISM targeted observations; it is listed as a limitation. |

**Error found and fixed (E2): CRISM signals were not reproducible.**
- FRT00005C5E (2007-05-19) covers 100% of FRT000047A3's (2007-02-26) area.
- None of FRT000047A3's 149 indicator pixels show an indicator in FRT00005C5E, even allowing a ±2 px (36 m) misregistration.
- Counting weak signals too, only 17% overlap.
- FRT0001FB74 (2011) has 0 indicator pixels.

The old score counted all of these as evidence. Now `water.replication()` sorts every displayed signal pixel into one of three classes:
- **replicated:** another observation of the same spot also shows a signal within ±2 px;
- **single:** no other observation covers the spot, so it cannot be checked;
- **contradicted:** another observation covers the spot and shows nothing within ±2 px.

Only contradicted pixels are dropped. Of 3,712 signal pixels, 2,067 were contradicted and dropped, 431 are replicated and 1,214 come from a single observation. A cell whose signal comes from a single observation is never given "Higher" confidence, and the popup says so.

## 3. Scoring and the highlighted regions

The formula is unchanged, apart from the two fixes:

```
score = Σ wᵢ·sᵢ / Σ wᵢ
weights: minerals 0.45, geology 0.40, landform 0.15 (assumptions)
```

How the original 6 regions fared:

| Old | Mean | Fate | Reason |
|---|---|---|---|
| W1 Mageik | 0.78 | **Removed** (now 0.55) | Its mineral term came only from FRT000047A3 signals that FRT00005C5E contradicts |
| W2 2.0 km NE of Swift Run | 0.78 | **Removed** (0.55) | Same reason |
| W4 2.5 km NE of Swift Run | 0.85 | **Removed** (0.55) | Same reason |
| W3 near Melyn | 0.82 | Kept → new **W1** | Its signal is 76% replicated |
| W5 Upper etched | 0.70 | Kept → new **W3** | Single-observation signal |
| W6 3.3 km SW of Mageik | 0.86 | **Removed** | No CRISM coverage (see section 4) |

The new regions, each the mean over the region's cells:

| New | Region | Score | M / G / L | Weighted contribution (M + G + L) | CRISM signal |
|---|---|---|---|---|---|
| W1 | Fan 2, 0.8 km NE of Melyn | 0.78 | 0.67 / 1.00 / 0.51 | 0.30 + 0.40 + 0.08 | 76% replicated |
| W2 | Fan 2, 1.9 km NE of Swift Run | 0.84 | 0.65 / 1.00 / 0.95 | 0.29 + 0.40 + 0.14 | 100% replicated (most robust) |
| W3 | Upper etched (Nue) plus the corrected NHjf2 island, 1.2 km N of Lefroy Bay | 0.70 | 0.98 / 0.35 / 0.79 | 0.44 + 0.14 + 0.12 | Single observation (FRT00005C5E only), 1.85 km inside its footprint |
| W4 | Fan 2, 1.0 km NE of Otis Peak | 0.74 | 0.67 / 1.00 / 0.26 | 0.30 + 0.40 + 0.04 | Single observation |
| W5 | Fan 2 at Otis Peak | 0.77 | 0.73 / 0.83 / 0.70 | 0.33 + 0.33 + 0.11 | Single observation |

**Why they score high:**
- In W1, W2, W4 and W5, the deltaic-fan unit prior alone contributes 0.40. With weak CRISM clay or hydration signals clustered in the cell, they pass 0.6. **The geologic map is the main driver, and the mineral signal is weak.** Most counted pixels are below the indicator thresholds, and no carbonate passes the thresholds anywhere.
- W3 is the only region driven mainly by CRISM. Its signal is unconfirmed, because only one observation covers it.

## 4. W6 and missing data

**Error found and fixed (E3):** W6's CRISM coverage was 0%, so its score was averaged over geology and landform only. That reached 0.86, the second-highest mean of the six (W4 was 0.85).
- This silently assumed W6's missing mineral term was as high as its geology.
- The regions that did have CRISM data were pulled down by it.
- With the mineral term set to 0 or 1, W6 would score anywhere from 0.47 to 0.92.

The fix:
- Highlighted regions now use only fully measured cells (`zones_require_full_coverage`).
- Cells with missing data still appear on the heatmap. Their popup now shows the score range ("could be anywhere from X to Y") from `score_low` and `score_high`.

The ranking is now not skewed by missing data.

## 5. What the heatmap represents

The heatmap ranks where existing orbital data and mapping point to rocks formed or altered by **ancient** water. It is a set of **exploration priorities**.
- It is **not** a map of confirmed water deposits.
- It is **not** a probability. No calibration exists that could turn it into one.

This wording is in `water_evidence.json` (`not_a_probability`), the layer row, the explorer panel, the cell card ("0–1, not a probability"), the Science Data card, and the ESTIMATE / ASSUMPTION badges. A text search of the water UI found no claim of detection or probability.

Two small wording changes:
- "Partly confirmed" became "Partly repeated in a second observation", so it can't be read as a confirmed mineral.
- The region list now says "all data present".

## Remaining limitations (not fixable with current data)

- **Thresholds and weights:** the CRISM thresholds, unit priors and weights are uncalibrated assumptions.
- **Geology source:** still served from an unattributed ArcGIS service, though it is now verified against the official database. Switching to reading `Nili.gdb` directly would need GDAL or pyogrio in the analysis venv.
- **Single-observation signals:** W3–W5 rely on signals that only one observation sees.
- **Footprint-edge noise:** CRISM noise clusters near footprint edges. No edge mask is applied (W1 crosses FRT000047A3's edge, but 76% of its signal is replicated).
- **Saved stop names:** saved routes or logs from before this audit may name "Water evidence W1"–"W6" with the **old** numbering.

## Recommended next steps

1. Use full spectral analysis (ratioed I/F spectra from the TRDR products) to confirm the W2 and W1 signals.
2. Optionally add a footprint-edge mask (for example 3 px) and test how sensitive the scores are.
3. Read the official `Nili.gdb` directly in `build_nasa_extras.py geology` once a GDAL-capable dependency is acceptable.
4. Do a weight-sensitivity sweep, for example ±0.1 per weight, and report how stable each region is.

## Verification

- **pytest:** 113 passed. New tests: hole regression, unit partition, replication classes, score range, full-coverage zones, and built-artefact consistency.
- **vitest:** 138 passed (11 in `water.test.ts`). `tsc` is clean.
- **Build:** `vite build` succeeded into a scratch outDir (the known `dist/` EPERM issue).
- **Live check:** the running app serves 5 regions with replication shares, and the unit colours are unchanged.
- **Reproduce:** `analysis/scripts/validate_geology_official.py` (needs a separate venv with pyogrio), then `build_nasa_extras.py geology`, then `build_water_evidence.py`.
