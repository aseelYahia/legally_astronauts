import { Icon } from "../ui";

/**
 * Future-feature explainer only. Nothing here runs, simulates or tracks anything; it is kept apart from the
 * working planner on purpose.
 */
export function FutureNavigation() {
  const steps = [
    { icon: "camera", title: "Cameras see the ground", text: "Helmet or rover cameras track rocks and edges as the explorer moves." },
    { icon: "route", title: "Motion sensors fill the gaps", text: "Accelerometers and gyroscopes measure each step and turn. Combined with the camera tracking this is called visual-inertial odometry." },
    { icon: "map", title: "Matched to orbital maps", text: "What the cameras see is compared with HiRISE and CTX maps like the ones in this app, to correct drift over a long walk." },
    { icon: "satellite", title: "Orbiters relay updates", text: "Relay orbiters could pass map updates and messages between Mars surface teams and Earth, with minutes of delay, not in real time." },
  ];
  return (
    <section className="future-nav" aria-labelledby="future-nav-title" data-testid="future-nav">
      <div className="future-nav-head">
        <span className="future-tag">Future concept · not built</span>
        <h3 id="future-nav-title">Future Navigation: knowing where you are on Mars</h3>
        <p>
          Mars has no GPS. Today PAWPRINT only plans routes on orbital maps; it does <b>not</b> know where anyone is. This is an idea for how a future version could help explorers follow a planned route.
        </p>
      </div>
      <ol className="future-steps">
        {steps.map((s, i) => (
          <li key={s.title}>
            <span className="future-num">{i + 1}</span>
            <span className="future-icon"><Icon name={s.icon} size={18} /></span>
            <div><b>{s.title}</b><p>{s.text}</p></div>
          </li>
        ))}
      </ol>
      <p className="fine muted">
        Nothing on this card is simulated or connected to the map. PAWPRINT has no live position tracking and makes no claims about real-time navigation.
      </p>
    </section>
  );
}
