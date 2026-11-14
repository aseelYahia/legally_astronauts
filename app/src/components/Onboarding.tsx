import { useState } from "react";
import { Mascot } from "./ui";

const STEPS = [
  {
    title: "Welcome to PAWPRINT MARS!",
    body: "I'm your mission pup. Together we'll explore Jezero Crater, where Perseverance landed in 2021, using real NASA and USGS terrain data.",
  },
  {
    title: "Toggle mission layers",
    body: "The left panel stacks CTX imagery, elevation, slope hazards, rover tracks and sample sites. Each one is labelled with where its data came from.",
  },
  {
    title: "Plan a moonwalk… er, Marswalk",
    body: "In Mission Planner, pick a start, add waypoints and choose a sample site. The Python engine runs terrain-aware A* over the real DTM and reports distance, climb and slope.",
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const s = STEPS[i];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="onb-title">
      <div className="modal onboarding">
        <Mascot pose="standing" size={150} className="bob" />
        <div>
          <div className="steps">{STEPS.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}</div>
          <h2 id="onb-title">{s.title}</h2>
          <p>{s.body}</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onDone}>Skip</button>
            {i < STEPS.length - 1 ? (
              <button className="btn btn-solid" onClick={() => setI(i + 1)}>Next</button>
            ) : (
              <button className="btn btn-solid" onClick={onDone}>Let's explore</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
