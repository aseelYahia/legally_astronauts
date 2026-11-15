# Water Evidence Explorer

PAWPRINT MARS now has an **Ancient Water Evidence Map** for the Jezero prototype area (7.7 × 5.3 km). It is a project-defined index (0–1) of where orbital data and geologic mapping point to rocks that formed in, or were changed by, **ancient** water.

> **It is not a probability of finding water.** It says nothing about present-day water, ice or groundwater. The UI labels it ESTIMATE everywhere, and the weights are labelled ASSUMPTION.

## What it uses (no new downloads)

Every input was already processed and verified by PAWPRINT.

| Component | Dataset | Resolution / alignment | Weight |
|---|---|---|---|
| **M**: water-related minerals | MRO CRISM MTRDR "SR" summary parameters, 3 observations (FRT000047A3, FRT00005C5E, FRT0001FB74), PDS Geosciences | 18 m. Each observation is co-registered to the CTX ortho by R770 correlation (per-observation shift and r in `manifest.layers.minerals.products[].registration`). Measured coverage: 37.6 of 38.9 km² | 45% |
| **G**: geologic unit | USGS SIM 3464 (Sun & Stack 2020), 1:75,000 | Unit boundaries are 100–200 m off this basemap (USGS read-me). **Caveat:** the polygons come from the unattributed ArcGIS feature service `Jezero_FeatureServiceFromPro` (layer 8). They were **verified on 2026-11-15** against the official SIM 3464 database: identical units, IoU ≥ 0.9999, boundaries within 0.04 m (see [VALIDATION.md](VALIDATION.md)). | 40% |
| **L**: landform relief | Mars 2020 TRN CTX DTM (USGS) | 20 m and covers the whole area. The HiRISE DTM was not used, because it covers only the SE window and would create a resolution seam. | 15% |

## Formula (`analysis/pawprint/water.py`)

The area is gridded into ~90 m cells (60 × 82):

```
score    = Σ wᵢ·sᵢ / Σ wᵢ          over the components that have data in the cell
coverage = Σ wᵢ(available) / Σ wᵢ(all)
cell is scored only if coverage ≥ 0.5; otherwise it is "insufficient data" (drawn hatched, never as low)
```

The three components:

- **M** = min(1, (indicator share + 0.4 × weak-signal share) / 0.25), computed over the cell's measured CRISM pixels.
  - Signals that a second CRISM observation of the same spot contradicts (no signal within ±2 px) are **not counted**; this was added in the audit.
  - The indicator thresholds are the app's existing mineral-layer thresholds: MIN2295_2480 > 0.01, MIN2345_2537 > 0.01, D2300 > 0.015, BD2210_2 > 0.01, BD1900R2 > 0.015.
  - A "weak signal" is a value at or above 75% of the threshold.
  - Both use the same 4-of-8 neighbour coherence filter as the mineral layer.
  - Olivine and pyroxene are **not** counted, because they are igneous minerals.
  - M is missing (not zero) when CRISM measured less than half of the cell.
- **G** = the area-weighted prior of the SIM 3464 units. Each prior is justified by the USGS *Unit_Interpretation* text:

  | Unit | Name | Prior |
  |---|---|---|
  | NHjf2 | Deltaic fan | 1.0 |
  | Nle | Lower etched | 0.5 |
  | Njf | Floor | 0.4 |
  | Nue | Upper etched | 0.15 |
  | cr | Crater rim | 0.1 |
  | Aeb | Eolian bedforms | 0 |

- **L** = min(1, relief / 40 m), where relief is p95 − p5 of the CTX elevation over a 3 × 3-cell (~270 m) window. Relief marks scarps and ridges where layered rock is exposed; relief alone is not water evidence.
- **Bands:** Low < 0.2 ≤ Modest < 0.4 ≤ Moderate < 0.6 ≤ High < 0.8 ≤ Very high.
- **Confidence** comes from coverage and CRISM measurement: Higher, Moderate, Lower, or None.
- **Highlighted regions:** 8-connected clusters of **fully measured** cells (all three components present) with score ≥ 0.6 and at least 4 cells. Up to 6 are kept; there are currently 5.
  - Each region's destination is its highest-scoring cell whose median CTX slope is below 15°.
  - Names use the nearest sample site, for orientation only.

All weights, priors, thresholds and saturation values are **PAWPRINT assumptions**, chosen to be explainable rather than calibrated.

### What the data actually shows (honest result, after the 2026-11-15 audit)

CRISM finds very few water-related signals here, and most are not reproducible:
- 267 indicator pixels and 3,445 weak-signal pixels, out of 122,453 measured.
- 2,067 of those signals are contradicted by a second observation of the same spot and are dropped.
- 431 are replicated; 1,214 come from a single observation and cannot be checked.
- No carbonate passes the thresholds anywhere.

There are 5 highlighted regions:
- W1, W2, W4 and W5 lie on the delta (fan) unit with clustered weak clay- or hydration-type signals. W2 is the most robust: all of its counted signal is replicated.
- W3 is an upper-etched cluster whose signal comes from a single observation.

Region-by-region reasons are in [VALIDATION.md](VALIDATION.md).

## Datasets investigated but not used

| Dataset | Decision | Why |
|---|---|---|
| **SHARAD** (MRO orbital radar) | Rejected | The footprint is ~3–6 km across-track (Fresnel zone; focusing cannot sharpen it) and 0.3–1 km along-track, while the whole area is ~7 × 5 km. Vertical resolution is 15 m in free space. Clutter from the rim and delta scarps would dominate, and there is no validated subsurface detection for this area. [PDS SHARAD docs](https://pds-geosciences.wustl.edu/mro/mro-m-sharad-5-radargram-v2/mrosh_2101/document/rgram_processing.htm) |
| **SWIM** (Subsurface Water Ice Mapping) | Rejected | It maps the likelihood of *present-day* buried ice at regional (km-scale) resolution. It covers 60°S–60°N, with the strongest signals poleward of ~40°; Jezero is at 18.4°N. It answers a different question. [swim.psi.edu](https://swim.psi.edu/) |
| **RIMFAX** (Mars 2020 GPR) | Not used yet | Real PDS data exist along Perseverance's traverse, so the area **is** covered, but only as 1-D radargrams under the wheels. A 2-D score from them would invent values between tracks. The data were not downloaded (large archive; ask first). A possible add-on: mark traverse segments that have RIMFAX coverage and link to the PDS browse radargrams. [PDS RIMFAX](https://pds-geosciences.wustl.edu/missions/mars2020/rimfax.htm) |
| **HiRISE DTM** for the landform term | Not used for scoring | It covers only the SE window, which would create a resolution seam. It is still used for routing. |

## How it connects to mission planning

1. **Mission Layers → Science & Geology → Ancient Water Evidence** gives:
   - a toggle, a legend (turquoise→lavender ramp, plus a hatched "insufficient data" swatch) and an opacity slider;
   - the highlighted regions, each with "Why it is interesting";
   - "How the score is calculated" and "Data we checked but did not use".
2. **Click the map** (planner) to open the popup. It shows the cell's score, band, confidence and coverage, plus each component's value, weight and plain-language reason, and the limitations. This also works in Explore.
3. **Set as destination** (from a region card or a zone marker popup) adds the stop "Water evidence W1 · …". **Generate Route** then runs the existing A* planner (Fastest / Shortest / Lower Risk), verified end to end. After the audit, Base Camp → new W1 gives Fastest/Shortest 4.0 km and Lower Risk 4.4 km on the CTX grid (`/api/compare`); before the audit, the old W1 route was 3.35 km.
4. The **Expedition Log** shows an observation prompt for that target. The existing notebook already has a *Water Evidence* category for recording what is actually seen.
5. **Science Data** has an "Ancient Water Evidence map" card (formula, grid stats, rejected datasets) and a separate **Future Navigation** card. That card is labelled *Future concept · not built*: it covers cameras plus motion sensors (visual-inertial odometry) matched to orbital maps, with relay orbiters passing updates. There is no simulation and no tracking.

## Files

- **Python:** `analysis/pawprint/water.py` (formula), `analysis/scripts/build_water_evidence.py` (build), `analysis/pawprint/sources.py` (`water_rejected`), `analysis/tests/test_water.py` (11 tests).
- **Data:** `app/public/data/water_evidence.{png,json}`, plus `layers.water_evidence` in `manifest.json`.
- **App:**
  - `app/src/lib/water.ts` and `water.test.ts` (9 tests);
  - `components/water/{WaterExplorer,WaterCellCard,WaterDataSection,FutureNavigation}.tsx` and `water.css`;
  - edits to `App.tsx`, `MapView.tsx`, `LayersPanel.tsx`, `ExplorePanel.tsx`, `ScienceView.tsx` and `ExpeditionLog.tsx`.
- **Rebuild:** `analysis/.venv/Scripts/python analysis/scripts/build_water_evidence.py`

## Verification (2026-11-15)

- pytest: 113 passed. vitest: 138 passed (after the audit). `tsc --noEmit` is clean.
- `vite build` succeeded into a scratch outDir. `dist/` is locked by another process, which is the known EPERM issue.
- Browser screenshots are in `screenshots/`: explorer panel, heatmap with zones, route to W1, cell popup, Expedition Log, Science Data, Future Navigation, mobile (375 px, no horizontal overflow).
- No console errors.
