import L from "leaflet";
import { useState } from "react";
import { Marker, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { LonLat } from "../../types";

export interface TeamPin {
  key: string;
  at: LonLat;
  label: string;
  who: "A" | "B" | "meet";
}

const MERGE_PX = 70;

function teamIcon(who: TeamPin["who"]) {
  return L.divIcon({ className: "", html: `<div class="stop-pin stop-team-${who}"><span>${who === "meet" ? "★" : who}</span></div>`, iconSize: [26, 34], iconAnchor: [13, 32] });
}

/** Group pins whose screen positions are closer than `px` (zoom-dependent). Pure, testable. */
export function mergeTeamLabels(pins: TeamPin[], toPx: (p: LonLat) => { x: number; y: number }, px = MERGE_PX) {
  const out: { owner: string; text: string }[] = [];
  const taken = new Set<string>();
  pins.forEach((p) => {
    if (taken.has(p.key)) return;
    const a = toPx(p.at);
    const near = pins.filter((o) => !taken.has(o.key) && Math.hypot(toPx(o.at).x - a.x, toPx(o.at).y - a.y) < px);
    near.forEach((o) => taken.add(o.key));
    out.push({ owner: p.key, text: near.map((o) => o.label).join(" / ") });
  });
  return out;
}

/** Two-astronaut pins. Every pin stays at its own coordinate; pins that sit close together on screen
 *  share one label so labels never hide each other. */
export function TeamPins({ pins }: { pins: TeamPin[] }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  void zoom;
  const labels = mergeTeamLabels(pins, ([lon, lat]) => map.latLngToLayerPoint([lat, lon]));
  return (
    <>
      {pins.map((t) => {
        const lab = labels.find((l) => l.owner === t.key);
        return (
          <Marker key={`${t.key}-${lab ? lab.text : ""}`} position={[t.at[1], t.at[0]]} icon={teamIcon(t.who)} zIndexOffset={1000} interactive={false}>
            {lab && (
              <Tooltip permanent direction="auto" offset={[0, -18]} className={`stop-label label-team-${t.who}`}>
                {lab.text}
              </Tooltip>
            )}
          </Marker>
        );
      })}
    </>
  );
}
