import React from "react";
import ReactDOM from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import "./features.css";
import App from "./App";
import { TooltipLayer } from "./components/ui";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipLayer>
      <App />
    </TooltipLayer>
  </React.StrictMode>,
);
