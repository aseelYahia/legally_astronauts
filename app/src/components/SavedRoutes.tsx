import { formatDistance } from "../lib/mars";
import type { SavedRoute } from "../types";
import { Icon, Mascot } from "./ui";

export function SavedRoutes({ routes, onLoad, onDelete, onClose }: { routes: SavedRoute[]; onLoad: (r: SavedRoute) => void; onDelete: (id: string) => void; onClose: () => void }) {
  return (
    <aside className="panel layers-panel">
      <header className="panel-head">
        <Icon name="files" />
        <h3>SAVED ROUTES</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close saved routes">
          <Icon name="chevronLeft" size={16} />
        </button>
      </header>
      {routes.length === 0 ? (
        <div className="empty tall">
          <Mascot pose="sitting" size={90} />
          <p>No saved routes yet. Plan an EVA in Mission Planner and press <b>Save Route</b>. Routes are stored in this browser only.</p>
        </div>
      ) : (
        <ul className="saved-list">
          {routes.map((r) => (
            <li key={r.id}>
              <button className="saved-item" onClick={() => onLoad(r)}>
                <b>{r.name}</b>
                <span>
                  {r.stops.length} stops · {r.summary ? `${formatDistance(r.summary.distance_m)} · +${Math.round(r.summary.elevation_gain_m)} m` : "not analyzed"}
                </span>
                <span className="muted">{new Date(r.savedAt).toLocaleString()}</span>
              </button>
              <button className="icon-btn" aria-label={`Delete ${r.name}`} onClick={() => onDelete(r.id)}>
                <Icon name="trash" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
