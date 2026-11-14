# Mars Ground View: photo selection and gallery (v2)

This folder has before/after screenshots and notes on how Ground View picks, sorts and labels NASA Perseverance photos.

## What changed

| | Before | After |
|---|---|---|
| Photos | 64 (at most 3 per place: one mast, one Hazcam, one CacheCam frame) | 282 (up to 10 terrain photos plus 3 kept-aside frames per place) |
| Candidate pool | The sealing sol only | The sealing sol and the 3 sols before it. If that gives fewer than 6 terrain photos, the window goes back 4 more sols. Landing uses sols 13–16. There are 1,688 candidate frames in total. |
| First photo | Often the rover's turret or drill bits (e.g. Melyn) | A landscape or terrain view at all 24 places |
| Rover hardware, sample tubes, blank frames | Mixed into the main cards | In a collapsed "Rover hardware & sample tube" section (at most 3, with one CacheCam frame from the sealing sol) |
| Filters | None | Landscape · Rocks · Geological features · All photos, each with a count |
| Viewer | None (each card linked to the NASA page) | Large viewer with zoom (buttons, wheel, double-click, `+` `-` `0`), drag to pan, previous/next (buttons and `←` `→`), `Esc` to go back, and full NASA source details |
| Location | Geolocated / not geolocated | **At this site**, **Nearby · N m**, **Regional · N m**, or **Not geolocated**, all taken from NASA localizations only |

Screenshots:
- Before: `before-melyn.png`, `before-melyn-scrolled.png`, `before-kukaklek.png`, `before-mobile-melyn.png`
- After:
  - Gallery and filters: `after-melyn-gallery.png`, `after-melyn-landscape-filter.png`, `after-melyn-kept-aside.png`
  - Viewer: `after-viewer.png`, `after-viewer-next-zoomed.png`
  - Location badges: `after-kukaklek-places.png` (shows nearby and not-geolocated photos)
  - Sorting explanation: `after-howto.png`
  - Phone layout: `after-mobile-gallery.png`, `after-mobile-viewer.png`

## Locations (NASA metadata only)

Every NASA raw-image record carries the rover motion counter (`site`, `drive`). NASA's localization file is keyed by the same counter (RMC), and an image is placed only when its exact RMC has a non-interpolated NASA localization. This rule has not changed (`geolocate`). The new `place()` function compares that localization with the RMC the sample marker uses (`marker_rmc`, read from the marker's documented position method):

- **At this site**: the same RMC as the marker.
- **Nearby**: a different NASA localization within 150 m of the marker's localization.
- **Regional**: a different NASA localization 150–1,500 m from the marker's localization. Anything farther is not shown.
- **Not geolocated**: NASA has no localization for the image's site/drive. These images are listed but not placed on the map.

Distances are great-circle distances between the two NASA positions on a sphere of radius 3,396.19 km. No image position is interpolated or estimated. The position is always where the **rover** stood, not where the camera pointed.

Today 278 photos are at the site, 2 are nearby (Kukaklek, 77 m and 148 m), and 1 is not geolocated (Kukaklek). The landing site has 11 nearby photos, because the sols 14–16 positions are close to the sol-13 localization. All 23 sample markers are still corroborated by sealing-sol image metadata.

## Automatic categories (a heuristic, not NASA labels)

The code is `analysis/pawprint/photos.py` (`candidates`, `image_stats`, `repeated_pointings`, `classify`, `quality`, `select_for_poi`). The app shows these categories as "automatic".

1. **Metadata pre-filter.** A frame must be a full frame of at least 0.3 MP with a shorter side of at least 300 px. Allowed cameras: Mastcam-Z, Navcam, Front/Rear Hazcam, WATSON, SuperCam RMI and CacheCam.
   - Mast pointing more than 20° above horizontal (Sun or sky imaging) is dropped.
   - Left/right and ECM/EBY products of the same exposure are collapsed to one frame, preferring the left camera and the colour EBY product.
   - At most 3 differently pointed frames are kept per imaging sequence.
2. **Thumbnail statistics.** These come from NASA's own 320 px browse JPEG:
   - grey-level spread and texture (mean neighbour difference)
   - a "sky band": the top rows have far less texture than the lower half and are at least as bright
   - the share of smooth 16×16 blocks
   - in colour frames, the share of lit pixels with less than half the scene's saturation (grey or white metal against reddish terrain)
   - a 16×12 signature used to find near-duplicates
3. **Kept aside ("Rover & sample")** when any of these holds:
   - the frame is a CacheCam frame or a Hazcam frame (the arm and wheels are usually in view)
   - the camera pointing (rover frame, 2° buckets, or 6° buckets below −15°) or a Mastcam-Z sequence id was used at 3 or more different NASA positions. Terrain changes from stop to stop, so this catches the turret, drill-bit checks, the deck and the calibration targets.
   - the frame is nearly uniform, dark, saturated, too grey or smooth, or points upward with no ground in view
4. **Terrain categories.**
   - **Landscape**: a sky band covers at least 6% of the frame height.
   - **Rocks**: a WATSON or RMI close-up, or a mast camera pointed more than 30° down.
   - **Geological feature**: any other mast-camera terrain view (outcrops, layers and ridges at mid range, including Mastcam-Z zoomed to 63 mm or more).
5. **Ranking and selection.**
   - The score combines texture, contrast, colour, frame size and camera, minus penalties for smooth or grey areas, Mastcam-Z narrow-band filters and SuperCam RMI.
   - Slots are filled with quotas (4 landscape, 3 geology, 3 rocks, then back-filled), with at most 2 frames per sequence and at most 2 WATSON and 2 RMI frames. Near-duplicates are skipped (same camera, pointing within 15°/10°, similar signature).
   - The display order is location (at the site → nearby → regional → not geolocated), then category, then score.

### Measured hit rate (visual audit of every selected photo, 2026-11-14)

- **24 of 24** galleries open on a real landscape or terrain photo.
- About **211 of 228** terrain slots (≈ 92%) show terrain. The 17 misses are mostly frames of the turret or drill bits, the rover deck seen by Navcam, a sample tube standing in the foreground, two blurry frames, and one banded grey Mastcam-Z narrow-band frame (Melyn).
- Some good terrain frames end up in the kept-aside section, which errs on the safe side. They can still be opened there.

## Original data kept as published

- Thumbnails are NASA's 320 px browse JPEGs, copied byte for byte. They take 4.3 MB for 282 files.
- The viewer loads NASA's 1200 px image, falling back to the 800 px image and then the thumbnail. It links to NASA's full-resolution PNG and the NASA image page.
- Camera names, sol, local solar time, UTC date, credit, image id and the rover coordinates come straight from the NASA records and localization file.

## Rebuild

```
analysis/.venv/Scripts/python analysis/scripts/build_nasa_extras.py photos
```

Feeds are cached in `data/raw/extras/raw_images/` and browse images in `data/raw/extras/raw_thumbs/` (about 20 MB, not shipped). The step rewrites `app/public/data/photos.json` and `app/public/data/photos/`, deletes thumbnails that are no longer selected, and updates only the `photos` layer in `manifest.json`.

## Remaining issues

- The categories are heuristics, and about 8% of terrain slots are still hardware or blurry frames (see above). A trained classifier or a hand-checked review list would do better. Any such list would have to be labelled as curated by PAWPRINT, not presented as NASA metadata.
- Thresholds were tuned by eye on these 24 places (2021–2023). New sample sites may behave differently.
- Some places have few terrain candidates even with the longer window: Otis Peak has 4 terrain photos, Atsá and Skyland have 6.
- The "nearby" and "regional" distances measure between rover positions only. Nothing tells you what a photo is looking at or how far away it is.
- `NASA_RESOURCES_INTEGRATION.md` and `DATA_VERIFICATION.md` still describe the earlier 64-photo version (owned by the docs session). Update them if they quote photo counts.
