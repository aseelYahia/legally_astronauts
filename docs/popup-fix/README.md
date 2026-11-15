# Sample / destination popup: "shaking" and hard-to-click buttons

## Symptom
After clicking a sample marker, the popup jittered while the pointer moved over it, and its buttons
(Set as start, Add waypoint, Set destination, team slots, Ground View) were hard or impossible to hit.

## How it was measured
`measure_popup.py` drives headless Edge over CDP with **real mouse events** (`Input.dispatchMouseEvent`)
at 1440×900 (desktop), 768×1024 (tablet) and 390×844 (mobile), in the Mission Planner with #19 Melyn open.
It wraps Leaflet's `Popup.update`, `_updateLayout` and `_adjustPan` and `map.panBy`, and counts map `move` events,
`popupopen` and `popupclose`, plus DOM mutations in the popup pane. It also samples the popup's screen
rectangle after every move.

* **HOVER**: 90 pointer moves across the popup, which sits fully inside the map.
* **EDGE**: the user has dragged the map so the popup's top is near the map edge. Then 60 pointer moves
  with the hand resting on the popup.
* **CLICKS**: a human-like approach to each action button, then a real press and release. It records what
  was under the pointer.

## Results (from `before-event-counts.log` / `after-event-counts.log`)

| scenario | before | after |
|---|---|---|
| HOVER, desktop | 90 `popup.update()`, 90 re-layouts, 180 `_adjustPan`, 630 DOM mutations | **0 / 0 / 0 / 0** |
| EDGE, desktop | 55 updates → 14 auto-pans → 61 map moves; popup jumped between 9 positions (70 px) | **0 updates, 0 pans, 0 moves; 1 position** |
| EDGE, tablet | 60 updates → 40 auto-pans → 161 map moves; 10 positions (70 px) | **0 / 0 / 0; 1 position** |
| CLICKS, tablet | "Set destination" **missed** (the zoom control was under the pointer) | all 4 hit |
| CLICKS, mobile | n/a (the before run aborted) | all 4 hit, plus all 5 team-slot buttons |
| Popup over map controls | desktop: weather panel covered the popup's close ×; mobile: overlapped the hint chip | none |

There were no console errors in any run. Group popups (chooser → sample detail) re-layout 1–2 times when their
content changes size, and are otherwise quiet. A click inside the popup keeps it open, and a click on the empty
map closes it. Marker transforms are identical before and after opening and closing popups.

## Causes
1. **Popup re-layout and auto-pan on every mouse move (the shake).** The map's `mousemove` updates the
   cursor read-out in `App`. That re-renders `MapView`, which passes `PoiLayer` a new inline `body` closure.
   The memoized markers depended on `body`, so each move gave the open react-leaflet `<Popup>` new children.
   react-leaflet then calls `popup.update()`, and Leaflet re-measures the popup and runs `_adjustPan`. When the
   popup sat near the map edge, every move panned the map, so the popup slid under the pointer and the next
   move did it again.
2. **Buttons under map controls.** The popup pane is inside Leaflet's map pane (a z-index 400 stacking
   context), so the zoom column (z 800) and the floating map panels always draw above it. On narrow maps,
   such as tablet with the planner open, a 300 px popup could not satisfy the auto-pan padding. "Set
   destination" ended up under the zoom-in button. The fixed 90 px top padding also ignored the taller panel
   stack on desktop.

## Fix (UI only; coordinates and marker placement unchanged)
* `app/src/components/map/PoiLayer.tsx`
  * `createBodyStore` + `LiveBody`: popup content reads the latest `body` from a small store via
    `useSyncExternalStore`. The `<Popup>` children stay referentially stable, so no `popup.update()` and no
    auto-pan happen on re-render, while the content still updates in place.
  * A `ResizeObserver` on the open popup's content calls `popup.update()` only when its size really changes,
    for example group chooser → sample detail.
  * `measureInsets` + `popupFit`: when a popup opens, its `maxWidth`, `maxHeight` and auto-pan padding are
    fitted to the map size and to the controls actually on screen. The zoom column becomes a right strip, and
    the panels become top and bottom bands. Auto-pan, run once and animated, places the whole popup clear of
    them. On a short phone map the popup scrolls inside itself instead of spilling under controls.
* `app/src/components/MapView.tsx` (`Controller`): mouse moves over an open popup no longer update the
  cursor read-out, so moving inside a popup does not re-render the whole app on every pixel.
* `app/src/components/map/PoiLayer.test.ts` (new):
  * A regression test mounts a real `MapContainer` + `PoiLayer` and re-renders the parent 20× with fresh
    closures. It asserts there are 0 `popup.update()` / `_adjustPan` calls and that the content still updates.
    It fails with the old code (20 calls).
  * Unit tests for `createBodyStore`, `popupFit` and `measureInsets`.

## Screenshots
* `after_*_popup_open.png` / `after_*_popup_hovered.png`: the same frame before and after 90 hover moves.
* `after_*_edge_*_hover.png`: the edge scenario. The two images are identical; before the fix, the map was
  re-panned under the pointer.
* `extra_*_team.png`: the team-mode slot buttons.

No "before" screenshots were kept: the first run's capture helper was broken. A still image also cannot show
a jitter, so the event counts above are the before/after evidence.
