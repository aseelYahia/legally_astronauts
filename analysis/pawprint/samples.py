"""Perseverance samples, transcribed from NASA's public sample table.

Source: https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/
(fetched 2026-11-14). Fields: sample number, name, sol sealed, date sealed,
NASA sample type, NASA location/campaign, core length (cm) where given.
Coordinates are NOT in the NASA table; see ``locate_samples``.
"""
from __future__ import annotations

SAMPLES = [
    (1, "Roubion", 164, "2021-08-06", "Atmospheric", "Polygon Valley", None),
    (2, "Montdenier", 194, "2021-09-06", "Rock core (igneous)", "Artuby Ridge", 5.98),
    (3, "Montagnac", 196, "2021-09-08", "Rock core (igneous)", "Artuby Ridge", 6.14),
    (4, "Salette", 262, "2021-11-15", "Rock core (igneous)", "South Séítah", 6.28),
    (5, "Coulettes", 271, "2021-11-24", "Rock core (igneous)", "South Séítah", 3.3),
    (6, "Robine", 298, "2021-12-22", "Rock core (igneous)", "South Séítah", 6.08),
    (7, "Malay", 337, "2022-01-31", "Rock core (igneous)", "South Séítah", 3.07),
    (8, "Ha'ahóni", 371, "2022-03-07", "Rock core (igneous)", "Octavia E. Butler Landing / Ch'ał", 6.5),
    (9, "Atsá", 377, "2022-03-13", "Rock core (igneous)", "Octavia E. Butler Landing / Ch'ał", 6.0),
    (10, "Swift Run", 490, "2022-07-07", "Rock core (sedimentary)", "Delta Front", 6.69),
    (11, "Skyland", 495, "2022-07-12", "Rock core (sedimentary)", "Delta Front", 5.85),
    (12, "Hazeltop", 509, "2022-07-27", "Rock core (sedimentary)", "Delta Front", 5.97),
    (13, "Bearwallow", 516, "2022-08-03", "Rock core (sedimentary)", "Delta Front", 6.24),
    (14, "Shuyak", 575, "2022-10-02", "Rock core (sedimentary)", "Delta Front", 5.55),
    (15, "Mageik", 619, "2022-11-16", "Rock core (sedimentary)", "Delta Front", 7.36),
    (16, "Kukaklek", 631, "2022-11-29", "Rock core (sedimentary)", "Delta Front", 4.97),
    (17, "Atmo Mountain", 634, "2022-12-02", "Regolith", "Delta Front", 5.3),
    (18, "Crosswind Lake", 639, "2022-12-07", "Regolith", "Delta Front", 5.3),
    (19, "Melyn", 749, "2023-03-30", "Rock core (sedimentary)", "Upper Fan", 6.04),
    (20, "Otis Peak", 832, "2023-06-23", "Rock core (sedimentary)", "Upper Fan", 5.77),
    (21, "Pilot Mountain", 913, "2023-09-15", "Rock core (sedimentary)", "Upper Fan", 6.0),
    (22, "Pelican Point", 923, "2023-09-25", "Rock core (sedimentary)", "Margin Unit", 6.1),
    (23, "Lefroy Bay", 949, "2023-10-21", "Rock core (sedimentary)", "Margin Unit", 4.7),
    (24, "Comet Geyser", 1088, "2024-03-12", "Rock core (silica-cemented carbonate)", "Margin Unit", 5.78),
    (25, "Sapphire Canyon", 1215, "2024-07-21", "Rock core (sedimentary)", "Neretva Vallis", 6.2),
]


def locate_samples(waypoints: list[dict]) -> list[dict]:
    """Attach an ESTIMATED position to each sample: the rover's last NASA
    localization at or before the sealing sol (the rover does not normally drive
    between coring and sealing). waypoints: MMGIS feature ``properties`` dicts."""
    wps = sorted(waypoints, key=lambda p: (p["sol"], p.get("dist_total_m", 0.0)))
    out = []
    for num, name, sol, date, kind, campaign, length in SAMPLES:
        prior = [w for w in wps if w["sol"] <= sol]
        if not prior:
            continue
        w = prior[-1]
        out.append(
            {
                "id": f"sample-{num}",
                "number": num,
                "name": name,
                "sol_sealed": sol,
                "date_sealed": date,
                "type": kind,
                "campaign": campaign,
                "core_length_cm": length,
                "lon": w["lon"],
                "lat": w["lat"],
                "elev_geoid_m": w.get("elev_geoid"),
                "position_quality": "estimated",
                "position_method": f"Rover localization RMC {w.get('RMC')} (sol {w['sol']}), last fix on/before sealing sol",
                "position_offset_sols": sol - w["sol"],
            }
        )
    return out
