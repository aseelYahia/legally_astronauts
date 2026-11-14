"""Registry of every external dataset PAWPRINT MARS uses, with provenance.

Nothing in this file is a measurement; it records where measurements came from.
"""
from __future__ import annotations

TRN_BASE = "https://planetarymaps.usgs.gov/mosaic/mars2020_trn"
MMGIS_BASE = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json"

# Prototype area of interest: Octavia E. Butler landing site -> Seitah -> delta front.
AOI = {"lon_min": 77.34, "lon_max": 77.47, "lat_min": 18.42, "lat_max": 18.51}
# High-resolution HiRISE window (subset of AOI) around the landing site / south Seitah.
HIRISE_WINDOW = {"lon_min": 77.42, "lon_max": 77.47, "lat_min": 18.42, "lat_max": 18.465}

DATASETS = {
    "ctx_dtm": {
        "dates": "Data release 2020 (DOI 10.5066/P906QQT8); server file dated 2022-11-10. Per-image CTX acquisition dates are in the USGS metadata (not parsed here).",
        "title": "Mars 2020 TRN CTX DTM mosaic",
        "file": "JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif",
        "url": f"{TRN_BASE}/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif",
        "instrument": "MRO Context Camera (CTX) stereo, SOCET SET",
        "resolution_m": 20.0,
        "vertical_datum": "Mars areoid (MOLA geoid), metres; tied to MOLA topography",
        "producer": "USGS Astrogeology Science Center for NASA/JPL Mars 2020 TRN",
        "citation": "Fergason, R.L., Galuszka, D.M., Hare, T.M., Mayer, D.P., Redding, B.L. (2020). "
        "Mars 2020 Terrain Relative Navigation CTX DTM Mosaic. USGS Astrogeology.",
        "doi": "https://doi.org/10.5066/P906QQT8",
        "license": "CC0 1.0 (USGS)",
        "kind": "real",
    },
    "ctx_ortho": {
        "dates": "Data release 2020 (DOI 10.5066/P9GV1ND3); server file dated 2022-11-10. Per-image acquisition dates in USGS metadata.",
        "title": "Mars 2020 TRN CTX orthoimage mosaic",
        "file": "JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif",
        "url": f"{TRN_BASE}/CTX/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif",
        "instrument": "MRO Context Camera (CTX)",
        "resolution_m": 6.0,
        "producer": "USGS Astrogeology Science Center for NASA/JPL Mars 2020 TRN",
        "citation": "Fergason, R.L., Galuszka, D.M., Hare, T.M., Mayer, D.P., Redding, B.L. (2020). "
        "Mars 2020 Terrain Relative Navigation Context Camera Orthorectified Image Mosaic. USGS Astrogeology.",
        "doi": "https://doi.org/10.5066/P9GV1ND3",
        "license": "CC0 1.0 (USGS)",
        "kind": "real",
    },
    "hirise_dtm": {
        "dates": "Data release 2020-07-24 (DOI 10.5066/P9REJ9JN); server file dated 2022-11-10. Window fetched 2026-11-14.",
        "title": "Mars 2020 TRN HiRISE DTM mosaic (windowed subset)",
        "file": "hirise_dtm_window_1m.tif",
        "url": f"{TRN_BASE}/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif",
        "instrument": "MRO HiRISE stereo, SOCET SET",
        "resolution_m": 1.0,
        "vertical_datum": "Mars areoid (MOLA geoid), metres",
        "producer": "USGS Astrogeology Science Center for NASA/JPL Mars 2020 TRN",
        "citation": "Fergason, R.L., Galuszka, D.M., Hare, T.M., Mayer, D.P., Redding, B.L. (2020). "
        "Mars 2020 Terrain Relative Navigation HiRISE DTM Mosaic. USGS Astrogeology.",
        "doi": "https://doi.org/10.5066/P9REJ9JN",
        "license": "CC0 1.0 (USGS)",
        "kind": "real",
    },
    "rover_traverse": {
        "dates": "Sols 14 onward; feed file last modified 2026-10-28; fetched 2026-11-14.",
        "title": "Perseverance traverse path",
        "file": "M20_traverse.json",
        "url": f"{MMGIS_BASE}/M20_traverse.json",
        "producer": "NASA/JPL-Caltech MMGIS (Mars 2020 localization team)",
        "license": "NASA public release",
        "kind": "real",
    },
    "rover_waypoints": {
        "dates": "Sols 13-2022; feed file last modified 2026-10-28; fetched 2026-11-14.",
        "title": "Perseverance end-of-drive localizations",
        "file": "M20_waypoints.json",
        "url": f"{MMGIS_BASE}/M20_waypoints.json",
        "producer": "NASA/JPL-Caltech MMGIS (Mars 2020 localization team)",
        "license": "NASA public release",
        "kind": "real",
    },
    "meda_weather": {
        "dates": "Sols 1127-1133 (Earth 2024-04-21 to 2024-04-27); fetched 2026-11-14.",
        "title": "MEDA daily weather summary (public feed)",
        "file": "m2020_weather.json",
        "url": "https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json",
        "instrument": "Mars Environmental Dynamics Analyzer (MEDA)",
        "producer": "NASA/JPL-Caltech / CAB (CSIC-INTA)",
        "license": "NASA public release",
        "kind": "real",
        "note": "The public feed stopped updating at sol 1133 (2024-04-27); some sols report no value.",
    },
    "samples": {
        "dates": "Sealing dates 2021-08-06 to 2024-07-21 (samples 1-25); page fetched 2026-11-14.",
        "title": "Perseverance rock & regolith samples",
        "url": "https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/",
        "producer": "NASA",
        "license": "NASA public release",
        "kind": "real",
        "note": "Names, sols and types transcribed from NASA's sample page. Marker POSITIONS are "
        "estimated as the rover's last NASA localization on or before the sealing sol.",
    },
}
