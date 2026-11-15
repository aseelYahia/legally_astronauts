import type L from "leaflet";
import { breakdownAt, evidenceIndex, zoneWhy, type WaterBreakdown, type WaterFile, type WaterZone } from "../../lib/water";
import { formatLat, formatLon } from "../../lib/mars";
import { photosForPoi, sampleCheck, type Photo, type PhotosFile } from "../../lib/nasaExtras";
import { selectionKey, type MapSelection } from "../../lib/mapSelection";
import type { RouteHazard } from "../../lib/routeHazards";
import type { Poi, Stop, StopRole, TeamSlot } from "../../types";
import { Icon, KindBadge, Term } from "../ui";
import { WaterInfoBody } from "../water/WaterInfoBody";
import { GroupList, HazardDetails } from "./HazardLayer";
import { splitZoom } from "./PoiLayer";
import type { PanelContent } from "./MapInfoPanel";

/** Everything the information panel can show, built from the current selection.
 *  Pure rendering: actions are callbacks, nothing here touches the map's view. */

export interface SelectionCtx {
  pois: Poi[];
  planning: boolean;
  teamMode: boolean;
  stops: Stop[];
  water: WaterFile | null; // only when the water layer is on
  photos: PhotosFile | null;
  sites: { rmc: string; lon: number; lat: number; photos: Photo[] }[];
  hazards: RouteHazard[];
  map: L.Map | null;
  select: (s: MapSelection | null) => void;
  close: () => void;
  onPickRole?: (role: StopRole, lon: number, lat: number) => void;
  onPickSlot?: (slot: TeamSlot, lon: number, lat: number) => void;
  onPoiAction: (p: Poi, role: StopRole) => void;
  onTeamSlot?: (p: Poi, slot: TeamSlot) => void;
  onPlanTo: (p: Poi) => void;
  onOpenGroundView?: (poiId: string | null) => void;
  onWaterDestination?: (z: WaterZone) => void;
  /** Set a clicked water-evidence spot (not a highlighted region) as the route destination */
  onWaterPointDestination?: (lon: number, lat: number, b: WaterBreakdown) => void;
  onRemoveStop?: (id: string) => void;
}

/** Header fields shared by every clicked water-evidence spot. */
function waterHead(b: WaterBreakdown) {
  return {
    icon: "drop",
    tone: "sky" as const,
    kicker: "Ancient water evidence · ~90 m cell",
    title: b.index === null ? "Not enough data here" : `Evidence index ${b.index} / 100`,
    badges: <KindBadge kind="estimate" title="Exploration index from NASA/USGS data; weights are PAWPRINT assumptions. Not a probability of finding water." />,
  };
}

const coords = (lat: number, lon: number, digits = 4) => (
  <span className="mi-coords" title="Planetocentric latitude, east-positive longitude">
    <Icon name="target" size={13} />
    {formatLat(lat, digits)}, {formatLon(lon, digits)}
  </span>
);

/** NASA's own sample-table wording; the igneous/sedimentary qualifier is a campaign-geology summary. */
export function nasaType(t?: string) {
  if (!t) return "";
  if (t.startsWith("Rock core")) return "Rock Core";
  return t;
}

const short = (p: Poi) => `${p.number ? `#${p.number} ` : ""}${p.name}`;
const dotClass = (m: Poi) =>
  m.category === "landing" ? "landing" : m.type?.includes("igneous") ? "igneous" : m.type?.includes("Regolith") ? "regolith" : m.type === "Atmospheric" ? "atmo" : "sedimentary";

/** "Set Destination / Set Start / Add Waypoint" for a clicked spot, or the five team slots. */
function pointActions(c: SelectionCtx, lon: number, lat: number) {
  const done = (f: () => void) => () => {
    f();
    c.close();
  };
  if (c.teamMode)
    return (
      <div className="mi-act-grid five">
        <button className="mi-btn primary" onClick={done(() => c.onPickSlot?.("aDest", lon, lat))}><Icon name="pin" size={16} />A destination</button>
        <button className="mi-btn" onClick={done(() => c.onPickSlot?.("bDest", lon, lat))}><Icon name="pin" size={16} />B destination</button>
        <button className="mi-btn" onClick={done(() => c.onPickSlot?.("meet", lon, lat))}><Icon name="target" size={16} />Rendezvous</button>
        <button className="mi-btn" onClick={done(() => c.onPickSlot?.("aStart", lon, lat))}><Icon name="flag" size={16} />A start</button>
        <button className="mi-btn" onClick={done(() => c.onPickSlot?.("bStart", lon, lat))}><Icon name="flag" size={16} />B start</button>
      </div>
    );
  return (
    <div className="mi-act-grid">
      <button className="mi-btn primary" onClick={done(() => c.onPickRole?.("destination", lon, lat))}><Icon name="pin" size={18} />Set Destination</button>
      <button className="mi-btn" onClick={done(() => c.onPickRole?.("start", lon, lat))}><Icon name="flag" size={18} />Set Start</button>
      <button className="mi-btn" onClick={done(() => c.onPickRole?.("waypoint", lon, lat))}><Icon name="route" size={18} />Add Waypoint</button>
    </div>
  );
}

function poiContent(c: SelectionCtx, p: Poi, groupIds?: string[]): PanelContent {
  const done = (f: () => void) => () => {
    f();
    c.close();
  };
  const nPhotos = photosForPoi(c.photos, p.id).length;
  const back = groupIds && groupIds.length > 1 ? groupIds : null;
  const members = back ? c.pois.filter((m) => back.includes(m.id)) : [];
  return {
    key: `poi:${p.id}`,
    icon: p.category === "landing" ? "flag" : "crystal",
    tone: p.category === "landing" ? "turq" : "rose",
    kicker: p.category === "landing" ? "Landing site" : p.number ? `NASA sample #${p.number}` : "NASA sample",
    title: p.name,
    sub: coords(p.lat, p.lon),
    anchor: { lat: p.lat, lon: p.lon },
    badges: (
      <>
        <KindBadge kind="real" title="Name, sol and type from NASA" />
        {p.position_quality === "estimated" && <KindBadge kind="estimated" title={p.position_method} />}
      </>
    ),
    body: (
      <div className="popup mi-poi">
        {back && (
          <button
            className="link-btn back-link"
            onClick={() => {
              const lat = members.reduce((a, m) => a + m.lat, 0) / members.length;
              const lon = members.reduce((a, m) => a + m.lon, 0) / members.length;
              c.select({ kind: "poi-group", ids: back, lat, lon, identical: members.every((m) => m.lat === members[0].lat && m.lon === members[0].lon) });
            }}
          >
            ← {back.length} samples here
          </button>
        )}
        {p.category === "sample" ? (
          <dl>
            <dt>Type</dt><dd>{p.type}<span className="dd-note">NASA's table: {nasaType(p.type)}</span></dd>
            <dt>Campaign</dt><dd>{p.campaign}</dd>
            <dt>Sealed</dt><dd><Term k="sol">Sol</Term> {p.sol_sealed} · {p.date_sealed}</dd>
            {p.core_length_cm ? (<><dt>Core length</dt><dd>{p.core_length_cm} cm</dd></>) : null}
          </dl>
        ) : (
          <p className="popup-desc">{p.description}</p>
        )}
        {p.position_method && (
          <p className="popup-note">
            {p.position_method}
            {sampleCheck(c.photos, p.id)?.corroborated ? ". NASA images from the sealing sol were taken at this same localization." : ""}
          </p>
        )}
      </div>
    ),
    actions: (
      <>
        {c.planning && c.teamMode ? (
          <>
            <div className="mi-q">Use this spot for the team:</div>
            <div className="mi-act-row">
              <button className="btn-mini teal" onClick={done(() => c.onTeamSlot?.(p, "aDest"))}>A destination</button>
              <button className="btn-mini lav" onClick={done(() => c.onTeamSlot?.(p, "bDest"))}>B destination</button>
              <button className="btn-mini rose" onClick={done(() => c.onTeamSlot?.(p, "meet"))}>Rendezvous</button>
              <button className="btn-mini teal" onClick={done(() => c.onTeamSlot?.(p, "aStart"))}>A start</button>
              <button className="btn-mini lav" onClick={done(() => c.onTeamSlot?.(p, "bStart"))}>B start</button>
            </div>
          </>
        ) : c.planning ? (
          <>
            <div className="mi-q">Use this spot in your Marswalk:</div>
            <div className="mi-act-row">
              <button className="btn-mini rose" onClick={done(() => c.onPoiAction(p, "destination"))}>Set destination</button>
              <button className="btn-mini teal" onClick={done(() => c.onPoiAction(p, "start"))}>Set as start</button>
              <button className="btn-mini lav" onClick={done(() => c.onPoiAction(p, "waypoint"))}>Add waypoint</button>
            </div>
          </>
        ) : (
          <div className="mi-act-row">
            <button className="btn-mini rose" onClick={done(() => c.onPlanTo(p))}>
              <Icon name="route" size={13} /> Plan a walk here
            </button>
          </div>
        )}
        {nPhotos > 0 && c.onOpenGroundView && (
          <button className="btn-mini lav gv-open" onClick={done(() => c.onOpenGroundView?.(p.id))}>
            <Icon name="camera" size={13} /> Ground View · {nPhotos} NASA photos
          </button>
        )}
      </>
    ),
  };
}

export function buildPanelContent(sel: MapSelection | null, c: SelectionCtx): PanelContent | null {
  if (!sel) return null;
  const key = selectionKey(sel);
  switch (sel.kind) {
    case "point": {
      const b = c.water ? breakdownAt(c.water, sel.lon, sel.lat) : null;
      if (b)
        return {
          key,
          ...waterHead(b),
          sub: coords(sel.lat, sel.lon),
          anchor: { lat: sel.lat, lon: sel.lon },
          body: <WaterInfoBody b={b} />,
          actions: pointActions(c, sel.lon, sel.lat),
        };
      return {
        key,
        icon: "pin",
        tone: "rose",
        kicker: "Map location",
        title: "Selected location",
        sub: coords(sel.lat, sel.lon),
        anchor: { lat: sel.lat, lon: sel.lon },
        body: (
          <>
            <p className="mi-lead">{c.teamMode ? "Use this spot for one of the team's stops." : "Choose how this spot fits into your Marswalk."}</p>
          </>
        ),
        actions: pointActions(c, sel.lon, sel.lat),
      };
    }
    case "poi": {
      const p = c.pois.find((x) => x.id === sel.id);
      return p ? { ...poiContent(c, p, sel.groupIds), key } : null;
    }
    case "poi-group": {
      const members = c.pois.filter((m) => sel.ids.includes(m.id)).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
      if (members.length === 0) return null;
      const sz = splitZoom({ key: "", members, lat: sel.lat, lon: sel.lon, identical: sel.identical });
      return {
        key,
        icon: "layers",
        tone: "lav",
        kicker: members[0].campaign ? `${members[0].campaign} campaign` : "NASA samples",
        title: `${members.length} samples here`,
        sub: coords(sel.lat, sel.lon),
        anchor: { lat: sel.lat, lon: sel.lon },
        badges: <KindBadge kind="real" title="Names, sols and types from NASA" />,
        body: (
          <div className="popup group-popup">
            <p className="mi-lead">
              {sel.identical
                ? "These samples share one estimated position (the rover's NASA localization), so they cannot be separated by zooming."
                : "These samples are close together. Pick one below, or zoom in to separate them."}
            </p>
            <ul className="group-list">
              {members.map((m) => (
                <li key={m.id}>
                  <button className="group-item" onClick={() => c.select({ kind: "poi", id: m.id, groupIds: sel.ids })}>
                    <i className={`poi-dot ${dotClass(m)}`} />
                    <span className="gi-name">{short(m)}</span>
                    <span className="gi-meta">{m.category === "landing" ? "Landing site" : `${m.campaign} · sol ${m.sol_sealed}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ),
        // Zooming is the one thing here that moves the map, and only because the user pressed it.
        actions: Number.isFinite(sz) && c.map ? (
          <button className="btn-mini lav" onClick={() => c.map?.flyTo([sel.lat, sel.lon], Math.min(17, sz), { duration: 0.6 })}>
            <Icon name="plus" size={13} /> Zoom in to separate
          </button>
        ) : undefined,
      };
    }
    case "water-cell": {
      const b = c.water ? breakdownAt(c.water, sel.lon, sel.lat) : null;
      if (!b) return null;
      return {
        key,
        ...waterHead(b),
        sub: coords(sel.lat, sel.lon),
        anchor: { lat: sel.lat, lon: sel.lon },
        body: <WaterInfoBody b={b} />,
        actions:
          c.onWaterPointDestination && b.index !== null ? (
            <button className="mi-btn primary wide" onClick={() => { c.onWaterPointDestination!(sel.lon, sel.lat, b); c.close(); }}>
              <Icon name="pin" size={16} />Set as Destination
            </button>
          ) : undefined,
      };
    }
    case "water": {
      const z = c.water?.zones.find((x) => x.id === sel.id);
      if (!z || !c.water) return null;
      return {
        key,
        icon: "drop",
        tone: "sky",
        kicker: `Ancient water evidence · region ${z.id}`,
        title: z.name,
        sub: coords(z.target[1], z.target[0]),
        anchor: { lat: z.target[1], lon: z.target[0] },
        badges: <KindBadge kind="estimate" title="Project-defined index from NASA/USGS data. Weights are PAWPRINT assumptions. Not a probability of finding water." />,
        body: (
          <div className="water-zone-pop mi-water" data-testid="water-zone-popup">
            <dl className="mi-facts">
              <dt>Mean evidence index</dt>
              <dd><b>{evidenceIndex(z.score_mean)}</b> / 100 <em>(not a probability)</em></dd>
              <dt>Area</dt>
              <dd>{z.area_km2} km²</dd>
              <dt>Nearest sample</dt>
              <dd>{z.nearest_poi.name} · {z.nearest_poi.distance_m < 1000 ? `${Math.round(z.nearest_poi.distance_m)} m` : `${(z.nearest_poi.distance_m / 1000).toFixed(1)} km`}</dd>
            </dl>
            <div className="mi-sec">
              <span>Why this region stands out</span>
              <ul>{zoneWhy(c.water, z).map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          </div>
        ),
        actions: c.onWaterDestination ? (
          <button className="mi-btn primary wide" onClick={() => { c.onWaterDestination!(z); c.close(); }}>
            <Icon name="pin" size={16} />{c.planning ? "Set as destination" : "Plan a route here"}
          </button>
        ) : undefined,
      };
    }
    case "photos": {
      const s = c.sites.find((x) => x.rmc === sel.rmc);
      if (!s) return null;
      const sols = [...new Set(s.photos.map((p) => p.sol))].sort((a, b) => a - b);
      const poiId = s.photos.find((p) => p.poi_id)?.poi_id ?? s.photos[0].poi_id;
      const poiName = s.photos.find((p) => p.poi_name)?.poi_name;
      return {
        key,
        icon: "camera",
        tone: "sand",
        kicker: "Rover photo site",
        title: `${s.photos.length} NASA photo${s.photos.length > 1 ? "s" : ""} taken here`,
        sub: coords(s.lat, s.lon),
        anchor: { lat: s.lat, lon: s.lon },
        badges: <KindBadge kind="real" title="Photos and rover localization from NASA's Mars 2020 raw-image records" />,
        body: (
          <dl className="mi-facts">
            <dt>Rover localization</dt>
            <dd>{s.rmc}</dd>
            <dt><Term k="sol">Sols</Term></dt>
            <dd>{sols.length > 1 ? `${sols[0]}–${sols[sols.length - 1]}` : sols[0]}</dd>
            {poiName && (<><dt>Near</dt><dd>{poiName}</dd></>)}
            <dt>Cameras</dt>
            <dd>{[...new Set(s.photos.map((p) => p.camera_label))].join(", ")}</dd>
          </dl>
        ),
        actions: c.onOpenGroundView ? (
          <button className="mi-btn primary wide" onClick={() => { c.onOpenGroundView?.(poiId); c.close(); }}>
            <Icon name="camera" size={16} />Open Ground View
          </button>
        ) : undefined,
      };
    }
    case "rover": {
      return {
        key,
        icon: "rover",
        tone: "lav",
        kicker: "Perseverance traverse",
        title: `Drive on sol ${sel.sol}`,
        sub: coords(sel.lat, sel.lon),
        anchor: { lat: sel.lat, lon: sel.lon },
        badges: <KindBadge kind="real" title="Rover path published by NASA/JPL-Caltech" />,
        body: (
          <>
            <p className="mi-lead">
              The dotted line is the path NASA reports Perseverance drove. This part was driven on <Term k="sol">sol</Term> {sel.sol}
              {sel.length_m ? `, about ${Math.round(sel.length_m).toLocaleString("en-US")} m that sol` : ""}. The coordinates above are where you clicked on it.
            </p>
            {c.planning && <div className="mi-q">Use this spot in your Marswalk:</div>}
          </>
        ),
        actions: c.planning ? pointActions(c, sel.lon, sel.lat) : undefined,
      };
    }
    case "stop": {
      const ordered = [...c.stops.filter((s) => s.role === "start"), ...c.stops.filter((s) => s.role === "waypoint"), ...c.stops.filter((s) => s.role === "destination")];
      const i = ordered.findIndex((s) => s.id === sel.id);
      if (i < 0) return null;
      const s = ordered[i];
      const poi = s.poiId ? c.pois.find((p) => p.id === s.poiId) : undefined;
      const zone = s.poiId?.startsWith("water:") ? c.water?.zones.find((z) => `water:${z.id}` === s.poiId) : undefined;
      const roleLabel = s.role === "start" ? "Start" : s.role === "waypoint" ? "Waypoint" : "Destination";
      return {
        key,
        icon: s.role === "start" ? "flag" : s.role === "waypoint" ? "route" : "pin",
        tone: s.role === "start" ? "turq" : s.role === "waypoint" ? "lav" : "rose",
        kicker: `Route stop${ordered.length > 1 ? ` ${i + 1} of ${ordered.length}` : ""} · ${roleLabel}`,
        title: s.name,
        sub: coords(s.lat, s.lon),
        anchor: { lat: s.lat, lon: s.lon },
        body: (
          <p className="mi-lead">
            {s.role === "start" ? "Your Marswalk begins here." : s.role === "destination" ? "Your Marswalk ends here." : "Your Marswalk passes through here."} Change the order and plan the
            route in the Mission Planner below the map.
          </p>
        ),
        actions: (
          <div className="mi-act-row">
            {poi && (
              <button className="btn-mini lav" onClick={() => c.select({ kind: "poi", id: poi.id })}>
                <Icon name="info" size={13} /> {poi.category === "landing" ? "Landing site details" : "Sample details"}
              </button>
            )}
            {zone && (
              <button className="btn-mini lav" onClick={() => c.select({ kind: "water", id: zone.id })}>
                <Icon name="drop" size={13} /> Water region details
              </button>
            )}
            {c.onRemoveStop && (
              <button className="btn-mini rose" onClick={() => { c.onRemoveStop!(s.id); c.close(); }}>
                <Icon name="trash" size={13} /> Remove stop
              </button>
            )}
          </div>
        ),
      };
    }
    case "hazard": {
      const h = c.hazards.find((x) => x.id === sel.id);
      if (!h) return null;
      return {
        key,
        icon: "warn",
        tone: h.severity === "warning" ? "rose" : "peach",
        kicker: `Route ${h.severity === "warning" ? "warning" : "caution"}`,
        title: h.title.replace(/^Astronaut [AB]: /, ""),
        sub: coords(h.at[1], h.at[0], 5),
        anchor: { lat: h.at[1], lon: h.at[0] },
        body: <HazardDetails h={h} inPanel />,
      };
    }
    case "hazard-group": {
      const live = sel.members.map((m) => c.hazards.find((h) => h.id === m.id)).filter(Boolean) as RouteHazard[];
      if (live.length === 0) return null;
      const g = { key: sel.key, members: live, at: live[0].at, severity: live.some((m) => m.severity === "warning") ? "warning" : "caution" } as unknown as Parameters<typeof GroupList>[0]["g"];
      return {
        key,
        icon: "warn",
        tone: "peach",
        kicker: "Route warnings",
        title: `${live.length} warnings close together`,
        sub: coords(live[0].at[1], live[0].at[0], 5),
        anchor: { lat: live[0].at[1], lon: live[0].at[0] },
        body: <GroupList g={g} onPick={(h) => c.select({ kind: "hazard", id: h.id })} />,
      };
    }
  }
}
