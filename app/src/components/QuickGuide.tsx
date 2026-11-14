import { Icon } from "./ui";

export type GuideStep = 1 | 2 | 3;

const STEPS: { n: GuideStep; title: string; sub: string }[] = [
  { n: 1, title: "Explore an area", sub: "Click the map to inspect Jezero's terrain" },
  { n: 2, title: "Add stops", sub: "Pick a start and science destinations" },
  { n: 3, title: "Plan & review", sub: "Check distance, slopes and risk, then save" },
];

/** Three-step orientation bar. Each step is a button that takes you there. */
export function QuickGuide({ current, onStep, onClose }: { current: GuideStep; onStep: (s: GuideStep) => void; onClose: () => void }) {
  return (
    <section className="quick-guide" aria-label="Quick guide">
      <div className="qg-intro">
        <Icon name="sparkle" size={22} />
        <div>
          <b>Quick Guide</b>
          <span>Plan a safe, meaningful walk on Mars in three steps.</span>
        </div>
      </div>
      <ol className="qg-steps">
        {STEPS.map((s, i) => (
          <li key={s.n}>
            <button className={`qg-step ${current === s.n ? "current" : current > s.n ? "done" : ""}`} onClick={() => onStep(s.n)}>
              <span className="qg-num">{current > s.n ? <Icon name="check" size={15} /> : s.n}</span>
              <span className="qg-text">
                <b>{s.title}</b>
                <span>{s.sub}</span>
              </span>
            </button>
            {i < STEPS.length - 1 && <Icon name="chevron" size={16} />}
          </li>
        ))}
      </ol>
      <span className="qg-planet" aria-hidden="true" />
      <button className="icon-btn qg-close" onClick={onClose} aria-label="Hide quick guide">
        <Icon name="close" size={15} />
      </button>
    </section>
  );
}
