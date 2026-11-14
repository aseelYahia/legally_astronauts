import L from "leaflet";
import { Fragment, useMemo, useState } from "react";
import { Marker, Polyline, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { LonLat, RouteResult } from "../../types";

/** Route drawing tuned for readability. Paths are drawn exactly as returned by the route API;
 *  only stroke widths, dashes, halos, chips and arrows change with zoom. */

export interface DrawnRoute {
  key: string;
  label: string;
  route: RouteResult;
  color: string;
  role: "selected" | "alternative" | "teamA" | "teamB" | "return";
  dash?: string;
}

/** Stroke width for the main line at a zoom level (thin when zoomed out, bolder up close). */
export function routeWeight(zoom: number) {
  return Math.max(2.6, Math.min(7.5, 3.6 + (zoom - 13) * 1.15));
}

const ALT_DASH: Record<string, string> = { fastest: "10 8", shortest: "1 7", lower_risk: "14 6 2 6", balanced: "6 6" };
const CHIP_TRY = [0.5, 0.3, 0.7, 0.18, 0.82, 0.4, 0.6, 0.1, 0.9];

function arrowIcon(deg: number, color: string) {
  return L.divIcon({
    className: "route-arrow",
    html: `<svg viewBox="0 0 16 16" width="16" height="16" style="transform:rotate(${deg}deg)"><path d="M4 3l7 5-7 5" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 3l7 5-7 5" fill="none" stroke="#131522" stroke-width="0.8" stroke-opacity="0.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function chipIcon(text: string, color: string, selected: boolean) {
  return L.divIcon({
    className: "route-chip-wrap",
    html: `<div class="route-chip${selected ? " sel" : ""}" style="--c:${color}">${text}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

/** Points along a path, every `spacing` screen pixels, with the on-screen heading of the path there. */
function arrowsAlong(map: L.Map, pts: LonLat[], spacing: number) {
  const out: { at: [number, number]; deg: number }[] = [];
  if (pts.length < 2) return out;
  const sp = pts.map(([x, y]) => map.latLngToLayerPoint([y, x]));
  let acc = spacing * 0.5;
  for (let i = 1; i < sp.length; i++) {
    const a = sp[i - 1];
    const b = sp[i];
    const seg = a.distanceTo(b);
    while (acc <= seg && seg > 0) {
      const t = acc / seg;
      const lon = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
      const lat = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
      out.push({ at: [lat, lon], deg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI });
      acc += spacing;
    }
    acc -= seg;
  }
  return out;
}

export function RouteLayer({ routes }: { routes: DrawnRoute[] }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const w = routeWeight(zoom);
  const ll = (r: RouteResult) => r.path_lonlat.map(([x, y]) => [y, x] as [number, number]);

  const arrows = useMemo(
    () =>
      routes
        .filter((r) => r.role === "selected" || r.role === "teamA" || r.role === "teamB")
        .flatMap((r) => arrowsAlong(map, r.route.path_lonlat, r.role === "selected" ? 120 : 140).map((a, i) => ({ ...a, key: `${r.key}-${i}`, color: r.color }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routes, zoom, map],
  );
  const alts = routes.filter((r) => r.role === "alternative");
  const sel = routes.find((r) => r.role === "selected");
  // Name chips: each at the first point along its own path that is clear of the chips already placed.
  const chips = useMemo(() => {
    if (!sel) return [];
    const placed: { x: number; y: number }[] = [];
    return [sel, ...alts].map((r) => {
      const pts = r.route.path_lonlat;
      let best = pts[Math.floor(pts.length / 2)];
      for (const f of CHIP_TRY) {
        const p = pts[Math.min(pts.length - 1, Math.floor(pts.length * f))];
        const sp = map.latLngToContainerPoint([p[1], p[0]]);
        if (placed.every((q) => Math.abs(q.x - sp.x) > 95 || Math.abs(q.y - sp.y) > 30)) {
          best = p;
          placed.push(sp);
          break;
        }
      }
      return { key: r.key, label: r.label, color: r.color, selected: r === sel, at: [best[1], best[0]] as [number, number] };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, zoom, map]);
  const team = routes.filter((r) => r.role === "teamA" || r.role === "teamB" || r.role === "return");

  return (
    <>
      {/* alternatives: thinner, distinct dash per option, casing for contrast */}
      {alts.map((a) => (
        <Fragment key={a.key}>
          <Polyline positions={ll(a.route)} pathOptions={{ color: "#131522", weight: w * 0.75 + 2.5, opacity: 0.35, interactive: false }} />
          <Polyline positions={ll(a.route)} pathOptions={{ color: a.color, weight: Math.max(2, w * 0.75), opacity: 0.95, dashArray: ALT_DASH[a.key] ?? "8 6", lineCap: a.key === "shortest" ? "round" : "butt" }}>
            <Tooltip sticky className="map-tip">{a.label} option · select it in Compare to make it the plan</Tooltip>
          </Polyline>
        </Fragment>
      ))}
      {/* selected: lavender halo + dark casing + solid core */}
      {sel && (
        <>
          <Polyline positions={ll(sel.route)} pathOptions={{ color: "#A99BDD", weight: w + 9, opacity: 0.28, interactive: false, lineCap: "round", lineJoin: "round" }} />
          <Polyline positions={ll(sel.route)} pathOptions={{ color: "#131522", weight: w + 3.5, opacity: 0.6, interactive: false, lineCap: "round", lineJoin: "round" }} />
          <Polyline positions={ll(sel.route)} pathOptions={{ color: sel.color, weight: w, opacity: 1, lineCap: "round", lineJoin: "round" }}>
            <Tooltip sticky className="map-tip">Selected route: {sel.label}</Tooltip>
          </Polyline>
        </>
      )}
      {/* two astronauts: A wider underneath, B narrower on top, so shared stretches show both colours */}
      {team
        .sort((a, b) => ({ return: 0, teamA: 1, teamB: 2 })[a.role as "return"] - ({ return: 0, teamA: 1, teamB: 2 })[b.role as "return"])
        .map((t) => (
          <Fragment key={t.key}>
            <Polyline positions={ll(t.route)} pathOptions={{ color: "#131522", weight: (t.role === "teamA" ? w + 2 : w) + 3, opacity: t.role === "return" ? 0.3 : 0.5, interactive: false, lineCap: "round", lineJoin: "round" }} />
            <Polyline
              positions={ll(t.route)}
              pathOptions={{ color: t.color, weight: t.role === "teamA" ? w + 2 : t.role === "teamB" ? Math.max(2.2, w - 1) : Math.max(2, w * 0.7), opacity: 1, dashArray: t.dash, lineCap: "round", lineJoin: "round" }}
            >
              <Tooltip sticky className="map-tip">{t.label}</Tooltip>
            </Polyline>
          </Fragment>
        ))}
      {/* direction arrows */}
      {arrows.map((a) => (
        <Marker key={a.key} position={a.at} icon={arrowIcon(a.deg, a.color)} interactive={false} keyboard={false} />
      ))}
      {/* name chips on each option so the three routes can be told apart without a legend */}
      {chips.map((c) => (
        <Marker key={`chip-${c.key}`} position={c.at} icon={chipIcon(c.label, c.color, c.selected)} interactive={false} keyboard={false} zIndexOffset={-100} />
      ))}
    </>
  );
}
