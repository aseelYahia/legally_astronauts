# Map selections: popups replaced by an information panel

Clicking anything on the map used to open a Leaflet popup. The popups shifted the map, jumped about, and on
small screens ran off the edge. Every popup is now gone. A selection shows in one **map information panel**:

* **Desktop and tablet** (map at least 600 px wide): a fixed panel on the right of the map.
* **Phones**: a bottom sheet that sits above the navigation rail.

Selecting something never pans, zooms or animates the map.

## Root cause of the movement

The baseline was measured on the old code with `measure_selection.py` (real CDP mouse input, headless Edge,
1440×900, Mission Planner). Results are in `before/before_desktop_results.json`.

| Click | Map moved | Leaflet `move` events |
|---|---|---|
| Empty ground near the left edge | 175 px | 24 |
| Empty ground near the right edge | 162 px | 33 |
| Empty ground near the top edge | 136 px | 31 |
| Sample marker near the right edge | 122 px | 33 |
| 4 markers clicked 120 ms apart | 96 px | 12 |
| Longest science description | 100 px | 23 |

The movement had five causes.

1. **Leaflet `autoPan`, built into every popup.** A Leaflet popup lives inside the map's own panes. When it
   opens, `_adjustPan` pans the map until the popup fits inside the padding. Near any edge that means a
   100–175 px animated pan on every click. A popup taller than the map can never fit, so auto-pan pushes
   it to the top and the rest runs off-screen. This is how popups work, not a tuning problem. The earlier
   `popup-fix` work (fitting `maxWidth`, padding and insets) could only make the pan smaller.
2. **The pick popup was re-keyed on every click.** `App` stored `pick = { lon, lat, key: Date.now() }` and
   `PickPopup` used `key={pick.key}`. Each click therefore unmounted the old popup and mounted a new one,
   which auto-panned again. Unmounting the old popup also fired its `remove` handler, which called
   `onPickClose()` and then `setPick(null)` during the same commit that set the new pick. The pick popup also
   had `autoClose={false}`, so it stayed open next to a sample popup (visible in
   `before/before_desktop_sample_right_edge.png`).
3. **Repeated state updates calling `popup.update()`.** `App` re-renders on every mouse move (the cursor
   read-out). Any popup whose React children changed re-measured itself and auto-panned again. `popup-fix`
   worked around this for samples with a body store; a `ResizeObserver` still called `popup.update()` when
   content changed size (group list to sample, water card expanding).
4. **Map moves that followed a selection.**
   * `setWaterDestination` always called `fly()` (`flyTo`), so pressing "Set as destination" in a water
     region popup flew the map.
   * The Controller's `ResizeObserver` called `invalidateSize()` with Leaflet's default (keep the centre),
     so any height change of the dock or a sheet shifted the terrain by half the change.
   * While the map was still "untouched", a resize snapped it back to the default framing. A mouse click
     did not count as touching the map.
5. **Page scroll on route warnings.** Picking a warning marker selected the matching card on the Warnings
   board, and the board called `scrollIntoView()`. The planner page is itself the scroll container, so the
   whole page scrolled down to the board and the map left the screen.

On phones a sixth effect showed up in testing: Leaflet turns **any** two taps within 200 ms into a double-tap
zoom, even taps on two different markers. Switching quickly between markers zoomed the map.

## Fix (prevention, not hiding)

* **No popups.** `components/map/MapInfoPanel.tsx` is a plain DOM element next to the Leaflet container, not
  a Leaflet layer. Opening it, switching what it shows, or re-rendering it never calls into Leaflet.
* **One selection model.** `lib/mapSelection.ts` defines `MapSelection`: point, sample, sample group, water
  region, photo site, rover drive, stop, warning, warning group. MapView owns the selection and shares it
  with the marker layers through `MapSelectionContext`. Layers call `select(...)` on click and read the
  selection to highlight their marker.
* **No re-keying.** `pick` is `{ lon, lat }`. The panel keeps the same element while the selection changes;
  only a new selection resets its scroll position.
* **No stale callbacks.** MapView reads App's callbacks through a ref (`live`), so the panel's buttons always
  call the latest handler without rebuilding anything on mouse moves.
* **No follow-on moves.** The water-region "Set as destination" button in the panel passes `flyThere = false`;
  the layers list still flies there, because there the region may be off-screen. `invalidateSize` now uses
  `{ pan: false }`, which keeps the top-left of the map fixed. A click marks the map as touched, so a later
  resize keeps the user's view.
* **Board scroll stays in the board.** `WarningsBoard` scrolls only its own scroll area, and never any
  container that also holds the map.
* **Double-tap guard.** A tap that selects a marker pauses double-click zoom for 450 ms. Double-tapping the
  ground still zooms.

These moves are **kept on purpose**, because each one is something the user explicitly asked for:

* search, list and "Show on map" buttons (`flyTarget`);
* the Warnings board's "Show on map";
* framing a newly generated route;
* the panel's **Zoom in to separate** button (sample groups);
* the panel's **Show it** link. When the selected spot is hidden behind the panel, the panel says so and
  offers this link. Nothing moves until the user presses it.

## What each click shows

| Click target | Panel content | Actions (all kept from the popups) |
|---|---|---|
| Empty ground (planner) | Coordinates, Ancient Water cell breakdown when that layer is on | Set Destination / Set Start / Add Waypoint, or the five team slots |
| Empty ground (Explore) | No panel: the Explore side panel shows the terrain read-out, and a ring marks the spot | — |
| NASA sample / landing site | NASA facts, KindBadges, position note | Set destination / start / waypoint, team slots, or Plan a walk here; Ground View |
| "N samples here" group | Member list; picking one shows it with "← N samples here" | Zoom in to separate |
| Water region W1–W5 | Mean index (0–1, not a probability), area, nearest sample, why it stands out, ESTIMATE badge | Set as destination / Plan a route here |
| Photo site (camera) | Photo count, rover localization, sols, cameras, NASA DATA badge | Open Ground View |
| Rover track (new) | Sol, that sol's drive length, clicked coordinates; the sol's drive drawn solid | Planner: Set Destination / Start / Waypoint here |
| Route stop (new) | Role, order, coordinates | Sample or water-region details, Remove stop |
| Route warning / group | The full hazard explanation, with DERIVED and ASSUMPTION source badges | Pick a warning from a group |

The selected marker stays highlighted while its panel is open:

* samples and groups: existing `is-selected` style;
* warnings: existing pulse ring;
* water regions: larger dot;
* camera pins and stops: a glow;
* clicked spots, rover points and water regions: a breathing ring.

The rover track got an invisible 14 px hit line, because the 2 px dotted line was nearly impossible to click
or tap.

**Panel behaviour**

* Header (icon, kicker, title, coordinates), a close button (44 px), and a body that is the only scroll area.
* Actions are pinned under the body, so they stay reachable when long content scrolls.
* Escape closes the panel, except while typing in a field or when a modal dialog is open.
* Focus moves to the panel without scrolling the page.
* On the sheet you can drag the handle down to close, drag it up to expand, or tap the handle (also works
  from the keyboard) to toggle between the two sizes.
* Reduced motion is respected.
* The zoom column, scale bar and route-warning toggle slide left of the side panel so it never covers them.

## Verification

All runs use headless Edge with real CDP mouse or touch input. Scripts are in this folder; JSON, logs and
screenshots are in `after/`.

* `measure_selection.py` at 1440×900, 768×1024 and 390×844 (touch). It covers clicks near all four edges,
  a sample near the right edge, rapid switching between markers, and the longest description.
  **21 of 21 selections: 0 px drift, 0 `move` events.** The panel stays inside the viewport every time.
  Escape closes it at all three sizes.
* `features_tour.py` at the same three sizes. It covers:
  * a water region;
  * a water cell, expanded with "Why this score?" and scrolled to the end;
  * the rover track and a photo site;
  * clicked spot → Set Destination → Generate Route;
  * a route warning and a route stop;
  * rapid switching across marker kinds 90 ms apart;
  * on the phone, dragging the sheet down to close.

  **30 of 30 selections: 0 px drift, 0 `move` events.** In every run: no nested scroll areas, actions always
  visible, the destination was set, the sheet drag closed the sheet, and there were no console errors.
* Explore view, checked in the browser pane: a sample selects with "Plan a walk here" and Ground View; a
  ground click closes the panel and rings the probed spot; the map does not move.
* `vitest`: 15 files, 138 tests pass. New or rewritten:
  * `PoiLayer.test.ts`: a click selects and creates no popup; 21 re-renders while switching selections
    cause 0 `move`, `panBy`, `flyTo` or `setView` calls; highlighting works for single pins and groups;
    the `__pawprintMap.openPoi` hook still works.
  * `MapInfoPanel.test.ts`: close button, Escape and text fields, focus, scroll reset, sheet handle.
  * `lib/mapSelection.test.ts`.
* `tsc --noEmit` is clean. `vite build` succeeds. `npm run build` itself hit the known EPERM on the locked
  `dist/mascot` file, so the build was written to a scratch `--outDir`.

## Files

* New:
  * `app/src/lib/mapSelection.ts` (+ test)
  * `app/src/components/map/MapSelectionContext.tsx`
  * `app/src/components/map/MapInfoPanel.tsx` (+ test)
  * `app/src/components/map/selectionContent.tsx`
  * `app/src/mapInfo.css`
* Changed:
  * `MapView.tsx`: popups removed; selection state, ring, rover hit line, clickable stops, `invalidateSize`.
    `nasaType` moved to `selectionContent.tsx` and is re-exported from here.
  * `map/PoiLayer.tsx` and its test: click selects. `createBodyStore`, `popupFit` and `measureInsets` were
    removed, because there are no popups left to fit.
  * `map/HazardLayer.tsx`: the selection lives in the shared context, the popup is gone, board sync is kept.
  * `planner/WarningsBoard.tsx`: scroll stays inside the board.
  * `App.tsx`: no `Date.now()` key, no fly for map-initiated water destinations, passes `onRemoveStop`.

## Notes

* Old scripts that look for `.leaflet-popup`, such as `docs/popup-fix/measure_popup.py`, no longer apply.
  The automation hook `window.__pawprintMap.openPoi(name)` still works and now selects into the panel
  (`[data-testid=map-info]`).
* There were no Expedition Log links inside the old map popups. The Log links elsewhere are unchanged.
* Team-mode pins (A, B, rendezvous) are still display-only, as before.
* The CSS rules for `.pick-popup` and `.hz-popup` in `plannerPage.css` and `hazards.css` are now unused. They
  were left in place.
