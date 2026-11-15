import { createContext, useContext } from "react";
import type { MapSelection } from "../../lib/mapSelection";

/** The map's current selection, shared by MapView (which owns it and renders the information panel) and the
 *  marker layers inside MapContainer (which set it on click and highlight what is selected). */
export interface MapSelectionApi {
  sel: MapSelection | null;
  select: (s: MapSelection | null) => void;
}

export const MapSelectionContext = createContext<MapSelectionApi>({ sel: null, select: () => {} });

export const useMapSelection = () => useContext(MapSelectionContext);
