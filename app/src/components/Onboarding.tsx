import { useState } from "react";
import { Mascot } from "./ui";

const STEPS = [
  {
    title: "Welcome to PAWPRINT MARS!",
    body: "I'm your mission pup. Together we'll explore Jezero Crater, where Perseverance landed in 2021, using real NASA and USGS terrain data.",
  },
  {
    title: "Explore the crater",
    body: "In Explore, click anywhere on the map to see how high and how steep the ground is. Hover a marker to see which rock sample was collected there.",
  },
  {
    title: "Plan a Marswalk",
    body: "In Mission Planner, pick a start and a science destination, then press Plan Route. Our Python planner finds a lower-risk path over the real terrain, and you can review and save it.",
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
              <button className="btn btn-primary" onClick={() => setI(i + 1)}>Next</button>
            ) : (
              <button className="btn btn-primary" onClick={onDone}>Let's explore</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
