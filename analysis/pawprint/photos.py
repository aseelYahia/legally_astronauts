"""Mars Ground View: select NASA Perseverance raw images and geolocate them ONLY from NASA metadata.

Source: NASA Mars 2020 raw-image feed
  https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=<sol>
Every record carries the rover motion counter (``site``, ``drive``) at acquisition time. NASA's
localization file (MMGIS ``M20_waypoints.json``) is keyed by the same counter (``RMC = "<site>_<drive>"``).
An image is placed on the map only when its exact RMC has a NASA localization; the position is the
ROVER's position, not the position of whatever the camera was looking at. Images without a matching
localization go to the non-geolocated gallery. Nothing is interpolated or guessed.
"""
from __future__ import annotations

# Cameras we show, in the order we prefer them for "what does this stop look like".
# Names are the feed's ``camera.instrument`` values.
CAMERA_INFO = {
    "MCZ_LEFT": ("Mastcam-Z (left)", "Mast-mounted zoomable colour camera, about 2 m above the ground."),
    "MCZ_RIGHT": ("Mastcam-Z (right)", "Mast-mounted zoomable colour camera, about 2 m above the ground."),
    "NAVCAM_LEFT": ("Navcam (left)", "Mast-mounted navigation camera, about 2 m above the ground."),
    "NAVCAM_RIGHT": ("Navcam (right)", "Mast-mounted navigation camera, about 2 m above the ground."),
    "FRONT_HAZCAM_LEFT_A": ("Front Hazcam (left)", "Body-mounted hazard camera looking at the arm workspace, about 1 m above the ground."),
    "FRONT_HAZCAM_RIGHT_A": ("Front Hazcam (right)", "Body-mounted hazard camera looking at the arm workspace, about 1 m above the ground."),
    "CACHECAM": ("CacheCam", "Camera inside the rover's sample-handling system that images each sample tube from above."),
    "SHERLOC_WATSON": ("SHERLOC WATSON", "Arm-mounted close-up camera."),
}

# One "view" per role: context (mast), workspace (hazcam) and the sample itself (CacheCam).
ROLES = (
    ("context", ("MCZ_LEFT", "NAVCAM_LEFT", "MCZ_RIGHT", "NAVCAM_RIGHT")),
    ("workspace", ("FRONT_HAZCAM_LEFT_A", "FRONT_HAZCAM_RIGHT_A")),
    ("sample", ("CACHECAM",)),
)


def _dims(img: dict) -> tuple[int, int]:
    d = (img.get("extended") or {}).get("dimension") or "(0,0)"
    try:
        w, h = (int(float(v)) for v in d.strip("()").split(","))
    except ValueError:
        return 0, 0
    return w, h


def rmc_of(img: dict) -> str | None:
    site, drive = img.get("site"), img.get("drive")
    if site is None or drive is None or str(site) == "" or str(drive) == "":
        return None
    return f"{int(site)}_{int(drive)}"


def select_images(images: list[dict]) -> list[tuple[str, dict]]:
    """Pick at most one full-frame image per role: the largest frame of the first preferred camera
    that has one. Thumbnails and sub-frames are skipped."""
    picked: list[tuple[str, dict]] = []
    for role, cams in ROLES:
        for cam in cams:
            cand = [
                i for i in images
                if i.get("camera", {}).get("instrument") == cam and i.get("sample_type") == "Full"
                and (i.get("image_files") or {}).get("medium")
            ]
            cand = [i for i in cand if min(_dims(i)) >= 600]  # skip sub-frames
            if cand:
                best = max(cand, key=lambda i: (_dims(i)[0] * _dims(i)[1], i.get("date_taken_utc", "")))
                picked.append((role, best))
                break
    return picked


def geolocate(img: dict, waypoints_by_rmc: dict[str, dict]) -> dict:
    """Return location info for an image using only an exact NASA RMC match."""
    rmc = rmc_of(img)
    wp = waypoints_by_rmc.get(rmc) if rmc else None
    if wp is None:
        return {"geolocated": False, "rmc": rmc, "reason": "No NASA localization exists for this site/drive."}
    if str(wp.get("Note", "")).lower().startswith("interpolated"):
        return {"geolocated": False, "rmc": rmc, "reason": "NASA marks this localization as interpolated."}
    return {
        "geolocated": True,
        "rmc": rmc,
        "lon": wp["lon"],
        "lat": wp["lat"],
        "localization_sol": wp["sol"],
        "localization_note": wp.get("Note"),
        "method": f"Rover position from NASA localization RMC {rmc} (sol {wp['sol']}); camera pointing not mapped.",
    }


def photo_record(role: str, img: dict, loc: dict, poi: dict | None) -> dict:
    cam = img.get("camera", {}).get("instrument", "")
    label, cam_note = CAMERA_INFO.get(cam, (cam, ""))
    files = img.get("image_files") or {}
    return {
        "id": img["imageid"],
        "role": role,
        "title": img.get("title"),
        "camera": cam,
        "camera_label": label,
        "camera_note": cam_note,
        "sol": int(img["sol"]),
        "date_taken_utc": img.get("date_taken_utc"),
        "date_taken_mars": img.get("date_taken_mars"),
        "credit": img.get("credit"),
        "caption": img.get("caption"),
        "nasa_page": img.get("link"),
        "json_link": img.get("json_link"),
        "img_small": files.get("small"),
        "img_medium": files.get("medium"),
        "img_large": files.get("large"),
        "img_full": files.get("full_res"),
        "site": img.get("site"),
        "drive": img.get("drive"),
        "location": loc,
        "poi_id": poi.get("id") if poi else None,
        "poi_name": poi.get("name") if poi else None,
        "context": (
            f"Taken on the sol {poi['name']} (sample {poi['number']}, {poi['campaign']}) was sealed."
            if poi and poi.get("number") else (f"Taken at {poi['name']}." if poi else "")
        ),
    }


# =============================================================================================== v2 selection
# Ground View v2: a wider, ranked selection per sample. Everything below is an AUTOMATIC heuristic built from
# NASA metadata (camera, frame size, pointing, sequence id) plus simple statistics of NASA's own 320 px browse
# thumbnail. It is shown in the app as "Automatic category", never as NASA metadata. Locations still come only
# from exact NASA localizations (``geolocate``); "nearby"/"regional" are distances between two NASA localizations.
import io
import math
import re

import numpy as np

CAMERA_INFO.update({
    "REAR_HAZCAM_LEFT": ("Rear Hazcam (left)", "Body-mounted hazard camera looking behind the rover, about 1 m above the ground."),
    "REAR_HAZCAM_RIGHT": ("Rear Hazcam (right)", "Body-mounted hazard camera looking behind the rover, about 1 m above the ground."),
    "SUPERCAM_RMI": ("SuperCam RMI", "Mast-mounted telescopic camera (Remote Micro-Imager) for close-ups of distant rock targets."),
})
CANDIDATE_CAMERAS = frozenset(CAMERA_INFO)

SOLS_BEFORE_SEALING = 3          # sampling campaigns park the rover for several sols before the tube is sealed
LANDING_SOLS = (13, 14, 15, 16)  # sol 13 is the first NASA localization
NEARBY_M = 150.0                 # another NASA localization within this distance of the sample marker = "nearby"
REGIONAL_M = 1500.0              # ... within this distance = "regional"; farther localizations are not shown
MARS_RADIUS_M = 3396190.0
MAX_TERRAIN = 10                 # per location: landscape / geological-feature / rock photos
MAX_OTHER = 3                    # per location: sample tube, rover hardware, blank frames (kept, but not in the main gallery)
MAX_PER_SEQUENCE = 2
TERRAIN_QUOTA = {"landscape": 4, "geology": 3, "rocks": 3}  # first-pass slots per category
MAX_PER_CAMERA = {"SHERLOC_WATSON": 2, "SUPERCAM_RMI": 2, "CACHECAM": 1}
MIN_TERRAIN = 6                  # fewer terrain photos than this: look further back ...
EXTRA_SOLS_BEFORE = 4            # ... up to this many more sols before the normal window
DUPLICATE_DIFF = 0.6             # mean |difference| of normalised 16x12 signatures below this: visually the same view

CATEGORIES = ("landscape", "geology", "rocks", "other")
CATEGORY_LABEL = {"landscape": "Landscape", "geology": "Geological feature", "rocks": "Rocks", "other": "Rover & sample"}
PLACES = ("at_site", "nearby", "regional", "not_geolocated")

_ID = re.compile(r"^(?P<cam>[A-Z0-9]{3}_|[A-Z0-9]{4})(?P<sol>\d{4})_(?P<sclk>\d{10})_(?P<ms>\d{3})(?P<prod>[A-Z]{3})[A-Z_]N\d{7}"
                 r"(?P<seq>[A-Z]{4}\d{5})_(?P<tail>\w+)$")


def family(instrument: str) -> str:
    """MCZ_LEFT -> MCZ, FRONT_HAZCAM_LEFT_A -> FRONT_HAZCAM, CACHECAM -> CACHECAM."""
    return re.sub(r"_(LEFT|RIGHT)(_A)?$", "", instrument)


def parse_id(imageid: str) -> dict:
    """Fields encoded in a Mars 2020 image id. ``focal_mm`` is Mastcam-Z's zoom (first 3 digits after the
    ZCAM sequence id, e.g. ``ZCAM05069_0340LMJ`` -> 34 mm); None for other cameras."""
    m = _ID.match(imageid)
    if not m:
        return {"sclk": None, "product": None, "sequence": None, "focal_mm": None}
    seq, tail = m["seq"], m["tail"]
    focal = int(tail[:3]) if seq.startswith("ZCAM") and tail[:3].isdigit() else None
    return {"sclk": int(m["sclk"]), "product": m["prod"], "sequence": seq, "focal_mm": focal}


def pointing(img: dict) -> tuple[float | None, float | None]:
    """NASA's mast azimuth / elevation in degrees (elevation > 0 = above horizontal), or None when 'UNK'."""
    ext = img.get("extended") or {}
    out = []
    for k in ("mastAz", "mastEl"):
        try:
            out.append(float(ext.get(k)))
        except (TypeError, ValueError):
            out.append(None)
    return out[0], out[1]


def candidates(images: list[dict]) -> list[dict]:
    """Metadata pre-filter. Keeps full frames (>= 0.3 MP, shorter side >= 300 px) from the listed cameras,
    drops frames pointed > 20 deg above the horizon (Sun / sky imaging), collapses the same exposure delivered
    as left/right or ECM/EBY products to one (left camera and colour EBY product preferred), and keeps at most
    three differently-pointed frames per imaging sequence."""
    by_exposure: dict[tuple, dict] = {}
    for i in images:
        cam = (i.get("camera") or {}).get("instrument", "")
        files = i.get("image_files") or {}
        if cam not in CANDIDATE_CAMERAS or i.get("sample_type") != "Full" or not files.get("small") or not files.get("medium"):
            continue
        w, h = _dims(i)
        if w * h < 300_000 or min(w, h) < 300:
            continue
        _, el = pointing(i)
        if el is not None and el > 20 and family(cam) in ("MCZ", "NAVCAM", "SUPERCAM_RMI"):
            continue
        meta = parse_id(i["imageid"])
        key = (family(cam), meta["sclk"] if meta["sclk"] is not None else i["imageid"], i.get("sol"))
        rank = (meta["product"] == "EBY", "LEFT" in cam, w * h)
        if key not in by_exposure or rank > by_exposure[key][0]:
            by_exposure[key] = (rank, i)
    by_seq: dict[tuple, list[dict]] = {}
    for _, i in sorted(by_exposure.values(), key=lambda t: (t[1].get("date_taken_utc", ""), t[1]["imageid"])):
        seq = parse_id(i["imageid"])["sequence"] or i["imageid"]
        by_seq.setdefault((family(i["camera"]["instrument"]), seq, i.get("sol")), []).append(i)
    out = []
    for group in by_seq.values():
        seen, kept = set(), []
        for i in group:
            az, el = pointing(i)
            pk = (round(az / 10) if az is not None else None, round(el / 10) if el is not None else None)
            if pk in seen:
                continue
            seen.add(pk)
            kept.append(i)
        if len(kept) < 3 and len(group) > len(kept):  # fixed-pointing sequences (Hazcams): spread over time
            extra = [group[0], group[len(group) // 2], group[-1]]
            kept += [i for i in extra if i not in kept]
        out += kept[:3]
    return out


def image_stats(jpeg: bytes) -> dict:
    """Simple statistics of a NASA 320 px browse JPEG (values 0-255)."""
    from PIL import Image
    im = Image.open(io.BytesIO(jpeg)).convert("RGB")
    a = np.asarray(im, dtype=np.float32)[3:-3, 3:-3]  # NASA browse JPEGs carry a dark 1-2 px border
    g = a.mean(axis=2)
    h, w = g.shape
    gx = np.abs(np.diff(g, axis=1))[:-1, :]
    gy = np.abs(np.diff(g, axis=0))[:, :-1]
    grad = gx + gy
    chroma = a.max(axis=2) - a.min(axis=2)
    is_color = float(np.median(chroma)) > 4.0
    # sky: rows from the top whose texture is far below the texture of the lower half of the frame
    row = grad.mean(axis=1)
    row = np.convolve(row, np.ones(5) / 5, mode="same")
    ref = float(np.median(row[len(row) // 2:])) or 1.0
    n = 0
    while n < len(row) and row[n] < 0.3 * ref:
        n += 1
    # a sky band must also be at least as bright as the ground (excludes vignetted corners and dark shadows)
    if n and g[:n].mean() < 0.9 * g[n:].mean():
        n = 0
    sky_frac = n / h
    # smooth blocks below the sky line (painted / metal rover surfaces, blank frames, featureless sand)
    b = 16
    rows0 = int(math.ceil(n / b))
    sub = g[rows0 * b:, :]
    sub = sub[: sub.shape[0] // b * b, : w // b * b]
    blocks = sub.reshape(sub.shape[0] // b, b, -1, b).std(axis=(1, 3)) if sub.size else np.empty(0)
    flat_frac = float(np.mean(blocks < 2.5)) if blocks.size else 1.0
    sat = chroma / np.maximum(a.max(axis=2), 1.0)
    below = np.zeros_like(g, dtype=bool)
    below[n:, :] = True
    lit = (g > 40) & below
    # colour frames: lit pixels much less saturated than the scene (grey/white metal against reddish terrain)
    med_sat = float(np.median(sat[lit])) if lit.any() else 0.0
    gray_frac = float(((sat < 0.5 * med_sat) & lit).sum() / max(lit.sum(), 1)) if is_color else None
    return {
        "mean": round(float(g.mean()), 1),
        "std": round(float(g.std()), 1),
        "edge": round(float(grad.mean()), 2),
        "sky_frac": round(sky_frac, 3),
        "flat_frac": round(flat_frac, 3),
        "dark_frac": round(float((g < 12).mean()), 3),
        "bright_frac": round(float((g > 245).mean()), 3),
        "gray_frac": None if gray_frac is None else round(gray_frac, 3),
        "is_color": is_color,
        # 16 x 12 grey-level signature (mean removed) for near-duplicate detection
        "sig": [int(v) for v in (lambda t: t - t.mean())(np.asarray(Image.fromarray(g.astype(np.uint8)).resize((16, 12)),
                                                                       dtype=np.float32)).round().ravel()],
    }


# Thresholds for ``classify`` (tuned by eye on contact sheets of the 2021-2023 sample sols; see
# docs/ground-view/README.md for the measured hit rate). They are heuristics, not NASA labels.
BLANK_STD = 7.0          # grey-level standard deviation below this: almost uniform frame
BLANK_EDGE = 2.0         # mean neighbour difference below this: no detail (sky-only, defocused or flat-field frames)
DARK_FRAC = 0.55         # more than this share of near-black pixels: night / shadow / lens-cap frame
HARDWARE_GRAY = 0.04     # colour frames: share of lit pixels with < half the scene's saturation (grey/white metal)
HARDWARE_FLAT = 0.45     # share of smooth 16x16 blocks below the sky line (painted / machined surfaces)
SKY_LANDSCAPE = 0.06     # sky band of at least this share of the frame height: the horizon is in view
NEAR_FIELD_EL = -30.0    # mast pointed more steeply down than this: the ground a few metres from the rover


def pointing_keys(img: dict) -> list[tuple]:
    """Mast-camera pointing in the rover frame: a fine (2 deg) key, plus a coarse (6 deg) key for downward looks."""
    cam = family((img.get("camera") or {}).get("instrument", ""))
    az, el = pointing(img)
    if cam not in ("MCZ", "NAVCAM", "SUPERCAM_RMI") or az is None or el is None:
        return []
    keys = [(cam, 2, round(az / 2) % 180, round(el / 2))]
    if el < -15:
        keys.append((cam, 6, round(az / 6) % 60, round(el / 6)))
    return keys


def repeated_pointings(images: list[dict], min_places: int = 3) -> set[tuple]:
    """Pointings (rover frame) used at >= ``min_places`` different NASA site/drive positions. Terrain changes from
    place to place, so a camera aimed at the same rover-frame direction again and again is almost always looking at
    something fixed to the rover: the arm's turret in its inspection pose, drill bits, the deck, a calibration target.
    Downward looks (elevation < -15 deg), where the deck and calibration targets are, use a coarser 6 deg match.
    The same test is applied to Mastcam-Z sequence ids (e.g. the post-sampling drill-bit and turret checks)."""
    places: dict[tuple, set] = {}
    for i in images:
        keys = list(pointing_keys(i))
        seq = parse_id(i["imageid"])["sequence"]
        if seq and family((i.get("camera") or {}).get("instrument", "")) == "MCZ":
            keys.append(("sequence", seq))  # Mastcam-Z sequence ids reused at many stops: routine engineering imaging
        for k in keys:
            places.setdefault(k, set()).add(rmc_of(i))
    return {k for k, v in places.items() if len(v) >= min_places}


def classify(img: dict, st: dict, repeated: set[tuple] | frozenset = frozenset()) -> tuple[str, str]:
    """Automatic category for one image: (category, plain-language reason)."""
    cam = family((img.get("camera") or {}).get("instrument", ""))
    _, el = pointing(img)
    focal = parse_id(img["imageid"])["focal_mm"]
    if cam == "CACHECAM":
        return "other", "CacheCam frame of a sample tube (camera inside the rover)."
    if cam in ("FRONT_HAZCAM", "REAR_HAZCAM"):
        return "other", "Hazcam view of the rover's surroundings; the arm, wheels or body are usually in frame."
    if any(k in repeated for k in pointing_keys(img)) or ("sequence", parse_id(img["imageid"])["sequence"]) in repeated:
        return "other", "Camera aimed at a direction it used at many other stops: usually rover hardware or a calibration target."
    if st["std"] < BLANK_STD or st["edge"] < BLANK_EDGE or st["dark_frac"] > DARK_FRAC or st["bright_frac"] > 0.5:
        return "other", "Nearly uniform, very dark or saturated frame."
    gray = st.get("gray_frac") if cam != "SUPERCAM_RMI" else None  # RMI frames are near-greyscale by design
    if (gray is not None and gray > HARDWARE_GRAY) or st["flat_frac"] > HARDWARE_FLAT:
        return "other", "Large smooth or grey/white areas, typical of rover hardware or the calibration target."
    if cam in ("SHERLOC_WATSON", "SUPERCAM_RMI"):
        return "rocks", f"{CAMERA_INFO.get(img['camera']['instrument'], (cam,))[0]} close-up of a rock or soil target."
    if st["sky_frac"] >= SKY_LANDSCAPE:
        return "landscape", "Horizon and sky are in view."
    if el is not None and el > 10:
        return "other", "Camera pointed above the horizon but no ground detected (sky or atmosphere frame)."
    if el is not None and el < NEAR_FIELD_EL:
        return "rocks", f"Mast camera pointed {abs(el):.0f}° down at the ground near the rover."
    if focal is not None and focal >= 63:
        return "geology", f"Mastcam-Z zoomed to {focal} mm on terrain away from the rover."
    return "geology", "Mast camera view of outcrops and terrain at mid range (no horizon in frame)."


def quality(img: dict, st: dict, category: str) -> float:
    """Ranking score (higher first): texture and contrast of the thumbnail, colour, frame size, camera."""
    cam = family((img.get("camera") or {}).get("instrument", ""))
    w, h = _dims(img)
    q = min(st["edge"], 30) / 30 + min(st["std"], 60) / 60
    q += 0.4 if st.get("is_color") else 0.0
    q += 0.2 * min(w * h / 2_000_000, 1.0)
    q += {"MCZ": 0.5, "NAVCAM": 0.3, "SUPERCAM_RMI": 0.2, "SHERLOC_WATSON": 0.2}.get(cam, 0.0)
    if category == "landscape":
        q += 0.3 if 0.1 <= st["sky_frac"] <= 0.5 else 0.0
    q -= st["flat_frac"]
    q -= 4 * (st.get("gray_frac") or 0.0)  # grey/white metal in a colour frame sinks the frame in the ranking
    if cam == "MCZ" and img["imageid"][2:3] not in ("0", ""):
        q -= 0.6  # Mastcam-Z narrow-band science filter (filter digit 1-7 in the id): a grey, less familiar frame
    if cam == "SUPERCAM_RMI":
        q -= 0.8  # small round grey frames: informative for scientists, less so for a first look
    return round(q, 3)


def distance_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * MARS_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def marker_rmc(poi: dict) -> str | None:
    """The NASA localization (RMC) a PAWPRINT marker was placed at, read from its documented position method."""
    m = re.search(r"RMC (\d+_\d+)", f"{poi.get('position_method', '')} {poi.get('description', '')}")
    return m.group(1) if m else None


def place(loc: dict, marker: str | None, waypoints_by_rmc: dict[str, dict]) -> dict:
    """How an image's NASA localization relates to the selected sample marker.
    at_site: same RMC as the marker. nearby / regional: a different NASA localization whose position lies within
    NEARBY_M / REGIONAL_M of the marker's localization. far: farther away (not shown). not_geolocated: no NASA
    localization exists for the image's site/drive."""
    if not loc.get("geolocated"):
        return {"place": "not_geolocated", "distance_m": None}
    if marker and loc["rmc"] == marker:
        return {"place": "at_site", "distance_m": 0.0}
    wp = waypoints_by_rmc.get(marker) if marker else None
    if wp is None:
        return {"place": "regional", "distance_m": None}
    d = distance_m(loc["lon"], loc["lat"], wp["lon"], wp["lat"])
    kind = "nearby" if d <= NEARBY_M else "regional" if d <= REGIONAL_M else "far"
    return {"place": kind, "distance_m": round(d, 1)}


def select_for_poi(scored: list[dict]) -> list[dict]:
    """``scored`` items: {"img", "category", "quality", "place", ...}. Returns the shown photos in display order.
    Terrain slots are filled category by category up to TERRAIN_QUOTA (landscapes first, then geological features,
    then rocks), best location then best score first, at most MAX_PER_SEQUENCE frames per imaging sequence; unused
    slots are back-filled from the rest. Display order: location (at the sample site, nearby, regional, not
    geolocated), then category, then score. Up to MAX_OTHER rover/sample frames follow, a CacheCam frame first."""
    place_rank = {p: i for i, p in enumerate(PLACES)}
    cat_rank = {c: i for i, c in enumerate(CATEGORIES)}
    pool = sorted((s for s in scored if s["place"] in place_rank),
                  key=lambda s: (place_rank[s["place"]], -s["quality"], s["img"]["imageid"]))
    per_seq: dict[tuple, int] = {}
    chosen: list[dict] = []

    per_cam: dict[str, int] = {}
    shown: list[dict] = []

    def take(s: dict, into: list[dict] | None = None) -> bool:
        into = chosen if into is None else into
        cam = family(s["img"]["camera"]["instrument"])
        seq = (cam, parse_id(s["img"]["imageid"])["sequence"] or s["img"]["imageid"])
        if s in shown or per_seq.get(seq, 0) >= MAX_PER_SEQUENCE or per_cam.get(cam, 0) >= MAX_PER_CAMERA.get(cam, 99):
            return False
        if any(is_duplicate(s, t) for t in shown):
            return False
        per_seq[seq] = per_seq.get(seq, 0) + 1
        per_cam[cam] = per_cam.get(cam, 0) + 1
        shown.append(s)
        into.append(s)
        return True

    for cat, quota in TERRAIN_QUOTA.items():
        n = 0
        for s in pool:
            if n >= quota:
                break
            if s["category"] == cat and take(s):
                n += 1
    for s in pool:
        if len(chosen) >= MAX_TERRAIN:
            break
        if s["category"] != "other":
            take(s)
    terrain = sorted(chosen, key=lambda s: (place_rank[s["place"]], cat_rank[s["category"]], -s["quality"]))
    others = [s for s in pool if s["category"] == "other"]
    # CacheCam first, and its latest frame (the sealing sol closes the window), so the shown tube is the sealed sample
    others.sort(key=lambda s: (family(s["img"]["camera"]["instrument"]) != "CACHECAM", place_rank[s["place"]],
                               -int(s["img"].get("sol") or 0) if family(s["img"]["camera"]["instrument"]) == "CACHECAM" else 0,
                               -s["quality"]))
    other: list[dict] = []
    for s in others:
        if len(other) >= MAX_OTHER:
            break
        take(s, other)
    return terrain + other


def is_duplicate(a: dict, b: dict) -> bool:
    """Same camera, about the same pointing, and nearly the same contrast-normalised 16x12 thumbnail."""
    ia, ib = a["img"], b["img"]
    if family(ia["camera"]["instrument"]) != family(ib["camera"]["instrument"]):
        return False
    (aza, ela), (azb, elb) = pointing(ia), pointing(ib)
    if None not in (aza, ela, azb, elb):
        if abs((aza - azb + 180) % 360 - 180) > 15 or abs(ela - elb) > 10:
            return False
    sa, sb = a.get("sig"), b.get("sig")
    if not sa or not sb or len(sa) != len(sb):
        return False
    va, vb = np.asarray(sa, dtype=np.float32), np.asarray(sb, dtype=np.float32)
    va, vb = va / (va.std() + 1e-6), vb / (vb.std() + 1e-6)
    return float(np.mean(np.abs(va - vb))) < DUPLICATE_DIFF


def role_of(instrument: str) -> str:
    fam = family(instrument)
    return {"MCZ": "context", "NAVCAM": "context", "FRONT_HAZCAM": "workspace", "REAR_HAZCAM": "workspace",
            "CACHECAM": "sample"}.get(fam, "closeup")


def sols_for(poi: dict, extended: bool = False) -> list[int]:
    s = poi.get("sol_sealed")
    if not s:
        return list(LANDING_SOLS)
    first = s - SOLS_BEFORE_SEALING - (EXTRA_SOLS_BEFORE if extended else 0)
    return list(range(max(first, LANDING_SOLS[0]), s + 1))


def context_text(img: dict, poi: dict) -> str:
    sol, sealed = int(img["sol"]), poi.get("sol_sealed")
    if poi.get("number") and sealed:
        who = f"{poi['name']} (sample {poi['number']}, {poi['campaign']})"
        if sol == sealed:
            return f"Taken on the sol {who} was sealed."
        d = sealed - sol
        return f"Taken {d} sol{'s' if d != 1 else ''} before {who} was sealed."
    return f"Taken at {poi['name']} on sol {sol}."


SELECTION_DOC = {
    "summary": "Candidates are NASA raw images from the sealing sol and the three sols before it (seven when that gives "
               "fewer than six terrain photos; landing: sols 13-16). Near-duplicate frames are skipped. "
               "Each frame gets an AUTOMATIC category from NASA metadata (camera, pointing, frame size, image id) and "
               "simple statistics of NASA's 320 px browse image (contrast, texture, sky band, grey/smooth areas). "
               "Categories are heuristics and can be wrong; they are not NASA labels.",
    "categories": {
        "landscape": "A bright, smooth sky band at the top of the frame: the horizon is in view.",
        "geology": "Mast camera aimed at terrain away from the rover without the horizon: outcrops, layered rocks, ridges.",
        "rocks": "Mast camera aimed steeply down at the ground near the rover, or an arm/telescopic close-up (WATSON, SuperCam RMI).",
        "other": "Kept aside: CacheCam sample tubes, Hazcam views (arm/wheels in frame), rover-frame pointings or "
                 "Mastcam-Z sequences reused at 3+ stops (turret, drill bits, deck, calibration targets), grey/smooth "
                 "hardware-like frames, sky-only, blank or dark frames.",
    },
    "places": {
        "at_site": "The image's NASA site/drive localization is the same one the sample marker uses.",
        "nearby": f"A different NASA localization within {NEARBY_M:.0f} m of the marker's localization.",
        "regional": f"A different NASA localization {NEARBY_M:.0f}-{REGIONAL_M:.0f} m from the marker's localization.",
        "not_geolocated": "NASA has no (non-interpolated) localization for the image's site/drive; it is not placed on the map.",
    },
    "thresholds": {
        "sols_before_sealing": SOLS_BEFORE_SEALING, "nearby_m": NEARBY_M, "regional_m": REGIONAL_M,
        "max_terrain_per_location": MAX_TERRAIN, "max_other_per_location": MAX_OTHER,
    },
}


def build_selection(pois: list[dict], by_rmc: dict[str, dict], sol_images, stats_for) -> tuple[list[dict], dict]:
    """Rank and pick photos for every POI. ``sol_images(sol) -> list`` returns NASA feed records; ``stats_for(imgs)
    -> {imageid: image_stats}`` downloads/caches the 320 px browse images. Returns (records, counts)."""
    stats: dict[str, dict] = {}

    def pick(extended_ids: set[str]) -> tuple[dict, dict, set]:
        pools = {poi["id"]: candidates([i for sol in sols_for(poi, poi["id"] in extended_ids) for i in sol_images(sol)])
                 for poi in pois}
        every = {i["imageid"]: i for pool in pools.values() for i in pool}
        stats.update(stats_for([i for i in every.values() if i["imageid"] not in stats]))
        repeated = repeated_pointings(list(every.values()))
        chosen = {}
        for poi in pois:
            marker = marker_rmc(poi)
            scored = []
            for i in pools[poi["id"]]:
                loc = geolocate(i, by_rmc)
                pl = place(loc, marker, by_rmc)
                if pl["place"] == "far":
                    continue
                st = stats[i["imageid"]]
                cat, why = classify(i, st, repeated)
                scored.append({"img": i, "loc": loc, **pl, "category": cat, "category_reason": why,
                               "quality": quality(i, st, cat), "sig": st.get("sig")})
            chosen[poi["id"]] = select_for_poi(scored)
        return chosen, every, repeated

    chosen, every, repeated = pick(set())
    weak = {pid for pid, sel in chosen.items() if sum(s["category"] != "other" for s in sel) < MIN_TERRAIN}
    if weak:
        chosen, every, repeated = pick(weak)
    out: list[dict] = []
    counts = {"candidates": len(every), "extended_window": sorted(weak), "by_category": {c: 0 for c in CATEGORIES}}
    for i in every.values():
        counts["by_category"][classify(i, stats[i["imageid"]], repeated)[0]] += 1
    for poi in pois:
        marker = marker_rmc(poi)
        for rank, s in enumerate(chosen[poi["id"]]):
            i = s["img"]
            rec = photo_record(role_of(i["camera"]["instrument"]), i, s["loc"], poi)
            st = stats[i["imageid"]]
            az, el = pointing(i)
            rec.update({
                "context": context_text(i, poi),
                "category": s["category"],
                "category_label": CATEGORY_LABEL[s["category"]],
                "category_reason": s["category_reason"],
                "rank": rank,
                "quality": s["quality"],
                "place": s["place"],
                "distance_m": s["distance_m"],
                "marker_rmc": marker,
                "mast_az": az,
                "mast_el": el,
                "dimension": list(_dims(i)),
                "image_stats": {k: st[k] for k in ("std", "edge", "sky_frac", "flat_frac", "gray_frac")},
            })
            out.append(rec)
    return out, counts
