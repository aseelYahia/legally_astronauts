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

# Official NASA Space Apps challenge resources integrated in the "NASA data verification" upgrade.
EXTRA_DATASETS = {
    "m2020_raw_images": {
        "title": "Perseverance raw images (Mars Ground View)",
        "challenge_resource": "Perseverance Raw Images Gallery",
        "url": "https://mars.nasa.gov/mars2020/multimedia/raw-images/",
        "api": "https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=<sol>",
        "instrument": "Mastcam-Z, Navcam, Hazcams, CacheCam (Mars 2020)",
        "producer": "NASA/JPL-Caltech (Mastcam-Z: NASA/JPL-Caltech/ASU)",
        "license": "NASA public release; credit as given per image",
        "dates": "Images from each sample's sealing sol (2021-2024); feed fetched by build_nasa_extras.py.",
        "kind": "real",
        "note": "Raw, unprocessed images. Geolocated only by exact match of the image's site/drive to a NASA localization.",
    },
    "usgs_sim3464": {
        "title": "Geologic Map of Jezero Crater and the Nili Planum Region, Mars (SIM 3464)",
        "challenge_resource": "USGS-NASA Geological Maps",
        "url": "https://pubs.usgs.gov/publication/sim3464",
        "service": "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer/8",
        "producer": "USGS Astrogeology Science Center; authors V.Z. Sun and K.M. Stack (NASA/JPL)",
        "citation": "Sun, V.Z., and Stack, K.M., 2020, Geologic map of Jezero crater and the Nili Planum region, Mars: "
        "U.S. Geological Survey Scientific Investigations Map 3464, pamphlet 14 p., 1 sheet, scale 1:75,000.",
        "doi": "https://doi.org/10.3133/sim3464",
        "scale": "1:75,000",
        "license": "Public domain (USGS)",
        "dates": "Published 2020.",
        "kind": "real",
        "note": "Mapped on a semi-controlled CTX mosaic; USGS states random offsets of about 100-200 m from the Mars 2020 "
        "controlled CTX mosaic. Boundaries are approximate here and are not used for routing.",
    },
    "crism_mtrdr": {
        "title": "MRO CRISM map-projected targeted reduced data records (MTRDR), refined summary parameters (SR)",
        "challenge_resource": "NASA PDS / Mars Orbital Data Explorer (Phase 3 requirement)",
        "url": "https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_4001/mtrdr/",
        "search": "https://ode.rsl.wustl.edu/mars/ (ODE REST product search, pt=MTRDR)",
        "instrument": "MRO Compact Reconnaissance Imaging Spectrometer for Mars (CRISM)",
        "producer": "JHU/APL CRISM team; PDS Geosciences Node (Washington University in St. Louis)",
        "citation": "Seelos, F.P., et al. (2016) CRISM MTRDR; Viviano-Beck, C.E., et al. (2014) Revised CRISM spectral "
        "parameters and summary products, JGR Planets 119, doi:10.1002/2014JE004627.",
        "resolution_m": 18.0,
        "license": "NASA PDS public data",
        "dates": "Observations 2007-02-26 (FRT000047A3), 2007-05-19 (FRT00005C5E), 2011-08-14 (FRT0001FB74).",
        "kind": "real-derived",
        "note": "Only the needed summary-parameter bands and AOI rows are read via HTTP range requests.",
    },
    "trek_hirise_ortho": {
        "title": "MRO HiRISE, Jezero Mosaic, Controlled (Mars 2020 TRN orthomosaic, 25 cm)",
        "challenge_resource": "NASA Mars Trek",
        "url": "https://trek.nasa.gov/mars/",
        "tiles": "https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/WMTSCapabilities.xml",
        "instrument": "MRO HiRISE",
        "producer": "USGS Astrogeology for NASA/JPL Mars 2020 TRN; served by NASA Solar System Treks (JPL)",
        "citation": "Fergason, R.L., et al. (2020). Mars 2020 Terrain Relative Navigation HiRISE orthorectified image mosaic. USGS Astrogeology.",
        "doi": "https://doi.org/10.5066/P9QJDP48",
        "resolution_m": 0.25,
        "license": "CC0 1.0 (USGS data release page)",
        "dates": "Product created 2020-08-03 (Mars Trek catalog).",
        "kind": "real",
        "note": "Fetched as Mars Trek WMTS tiles at zoom 15 (~1.3 m/px), i.e. downsampled from the 25 cm source.",
    },
}
