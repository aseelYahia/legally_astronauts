import { fmtMin, type EvaPlan, type TeamEva } from "../../lib/eva";
import type { EvaSettings } from "../../types";
import { DogTip, Icon, KindBadge } from "../ui";
import { AlertItem } from "./SafetyList";

function Num({ label, value, onChange, step = 1, min = 0, suffix, placeholder, help }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: number; min?: number; suffix?: string; placeholder?: string; help?: string }) {
  return (
    <label className="eva-field">
      <span>{label}</span>
      <span className="eva-input">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          value={value ?? ""}
          placeholder={placeholder ?? "not set"}
          onChange={(e) => onChange(e.target.value === "" ? null : Math.max(min, parseFloat(e.target.value)))}
          aria-describedby={help ? undefined : undefined}
        />
        {suffix && <em>{suffix}</em>}
      </span>
    </label>
  );
}

function Gauge({ label, b, unit }: { label: string; b: { budget: number; used: number; remaining: number; remainingPct: number } | null; unit: string }) {
  if (!b) return <div className="gauge empty"><span>{label}</span><em>Enter a budget and a rate to estimate</em></div>;
  const pct = Math.max(0, Math.min(100, b.remainingPct));
  return (
    <div className={`gauge ${b.remaining < 0 ? "over" : ""}`}>
      <span>{label}</span>
      <div className="gauge-bar"><i style={{ width: `${pct}%` }} /></div>
      <em>
        {b.remaining < 0 ? "Over budget by " : "Est. remaining "}
        {Math.abs(b.remaining).toFixed(1)} {unit} ({Math.round(b.remainingPct)}%)
      </em>
    </div>
  );
}

function PersonCard({ who, plan, unit }: { who: "A" | "B"; plan: EvaPlan | null; unit: string }) {
  if (!plan)
    return (
      <div className={`team-card who-${who}`}>
        <b>Astronaut {who}</b>
        <span>No return route to the start could be planned, so this astronaut's EVA cannot be estimated.</span>
      </div>
    );
  return (
    <div className={`team-card eva-person who-${who}`}>
      <b>Astronaut {who} · total {fmtMin(plan.totalMin)}</b>
      <div className="eva-timeline" aria-label={`Astronaut ${who} EVA time breakdown`}>
        <i className="seg out" style={{ flex: plan.outboundMin }} />
        <i className="seg sci" style={{ flex: plan.scienceMin }} />
        <i className="seg wait" style={{ flex: plan.waitMin }} />
        <i className="seg back" style={{ flex: plan.returnMin }} />
      </div>
      <span>
        Out {fmtMin(plan.outboundMin)} · science {fmtMin(plan.scienceMin)} · wait {fmtMin(plan.waitMin)} · back {fmtMin(plan.returnMin)}
      </span>
      <span>
        Leave rendezvous by {plan.turnBackByMin !== null ? `T+${fmtMin(plan.turnBackByMin)}` : "—"} · time left {plan.slackMin !== null ? fmtMin(plan.slackMin) : "—"}
      </span>
      <Gauge label={`Oxygen (${unit})`} b={plan.o2} unit={unit} />
      <Gauge label="Power (Wh)" b={plan.power} unit="Wh" />
    </div>
  );
}

function TeamView({ team, unit }: { team: TeamEva; unit: string }) {
  return (
    <>
      <div className="eva-summary">
        <div className="mcard">
          <Icon name="walker" size={18} />
          <span>Mission length</span>
          <b>{team.missionMin !== null ? fmtMin(team.missionMin) : "—"}</b>
        </div>
        <div className="mcard">
          <Icon name="user" size={18} />
          <span>Astronaut-time</span>
          <b>{team.personMin !== null ? fmtMin(team.personMin) : "—"}</b>
        </div>
        <div className={`mcard ${team.o2 && team.o2.remaining < 0 ? "warn" : ""}`}>
          <Icon name="gauge" size={18} />
          <span>Team oxygen</span>
          <b>{team.o2 ? `${team.o2.used.toFixed(2)}` : "—"}</b>
        </div>
      </div>
      <div className="eva-legend">
        <span><i className="seg out" /> Walk out</span>
        <span><i className="seg sci" /> Science</span>
        <span><i className="seg wait" /> Wait at rendezvous</span>
        <span><i className="seg back" /> Walk back</span>
      </div>
      <PersonCard who="A" plan={team.A} unit={unit} />
      <PersonCard who="B" plan={team.B} unit={unit} />
      <div className="team-card who-meet">
        <b>Combined mission requirements</b>
        <Gauge label={`Oxygen, both suits (${unit})`} b={team.o2} unit={unit} />
        <Gauge label="Power, both batteries (Wh)" b={team.power} unit="Wh" />
      </div>
      {team.alerts.length > 0 && (
        <ul className="alert-list">
          {team.alerts.map((a) => (
            <AlertItem key={a.id} a={a} />
          ))}
        </ul>
      )}
    </>
  );
}

export function EvaPanel({
  plan,
  team,
  teamMode,
  settings,
  setSettings,
  scienceStops,
}: {
  plan: EvaPlan | null;
  team?: TeamEva | null;
  teamMode?: boolean;
  settings: EvaSettings;
  setSettings: (s: EvaSettings) => void;
  scienceStops: number;
}) {
  const set = (patch: Partial<EvaSettings>) => setSettings({ ...settings, ...patch });
  return (
    <div className="eva">
      <div className="not-certified hypo" role="note">
        <Icon name="info" size={16} />
        <span>
          <b>Hypothetical planning estimates.</b> Not spacesuit telemetry and not a NASA-validated consumption model. Every budget and
          rate below is entered by you; PAWPRINT supplies none.
        </span>
      </div>

      {teamMode ? (
        team ? (
          <TeamView team={team} unit={settings.o2Unit} />
        ) : (
          <DogTip pose="sitting" title="Team EVA budget">Plan both routes first. I'll also plan each astronaut's walk back from the rendezvous to their own start.</DogTip>
        )
      ) : plan ? (
        <>
          <div className="eva-summary">
            <div className="mcard">
              <Icon name="walker" size={18} />
              <span>Total EVA</span>
              <b>{fmtMin(plan.totalMin)}</b>
            </div>
            <div className={`mcard ${plan.turnBackByMin !== null && plan.turnBackByMin < plan.outboundMin + plan.scienceMin ? "warn" : ""}`}>
              <Icon name="flag" size={18} />
              <span>Turn back by</span>
              <b>{plan.turnBackByMin !== null ? `T+${fmtMin(plan.turnBackByMin)}` : "—"}</b>
            </div>
            <div className={`mcard ${plan.slackMin !== null && plan.slackMin < 0 ? "warn" : ""}`}>
              <Icon name="sparkle" size={18} />
              <span>Time left</span>
              <b>{plan.slackMin !== null ? fmtMin(plan.slackMin) : "—"}</b>
            </div>
          </div>
          <div className="eva-timeline" aria-label="EVA time breakdown">
            <i className="seg out" style={{ flex: plan.outboundMin }} title={`Walk out ${fmtMin(plan.outboundMin)}`} />
            <i className="seg sci" style={{ flex: plan.scienceMin }} title={`Science ${fmtMin(plan.scienceMin)}`} />
            <i className="seg back" style={{ flex: plan.returnMin }} title={`Walk back ${fmtMin(plan.returnMin)}`} />
            {plan.availableMin !== null && plan.availableMin > plan.totalMin && <i className="seg free" style={{ flex: plan.availableMin - plan.totalMin }} />}
          </div>
          <div className="eva-legend">
            <span><i className="seg out" /> Walk out {fmtMin(plan.outboundMin)}</span>
            <span><i className="seg sci" /> Science {fmtMin(plan.scienceMin)}</span>
            <span><i className="seg back" /> Walk back {fmtMin(plan.returnMin)}</span>
          </div>
          <Gauge label={`Oxygen (${settings.o2Unit})`} b={plan.o2} unit={settings.o2Unit} />
          <Gauge label="Power (Wh)" b={plan.power} unit="Wh" />
          {plan.alerts.length > 0 && (
            <ul className="alert-list">
              {plan.alerts.map((a) => (
                <AlertItem key={a.id} a={a} />
              ))}
            </ul>
          )}
        </>
      ) : (
        <DogTip pose="sitting" title="EVA budget">Plan a route first. Then I'll estimate the total EVA time, including the walk back to base.</DogTip>
      )}

      <section className="eva-inputs">
        <div className="mini-title">Your planning inputs <KindBadge kind="assumption" title="Values you enter. Not NASA data." /></div>
        <div className="eva-grid">
          <Num label="Available EVA time" suffix="min" value={settings.availableMin} onChange={(v) => set({ availableMin: v })} step={5} />
          <Num label={teamMode ? "Science time at each destination" : `Science time per stop (${scienceStops})`} suffix="min" value={settings.scienceMinPerStop} onChange={(v) => set({ scienceMinPerStop: v ?? 0 })} step={5} placeholder="0" />
          <Num label="Reserve to keep" suffix="%" value={settings.reservePct} onChange={(v) => set({ reservePct: v ?? 0 })} step={5} placeholder="0" />
          <Num label="Pace factor" suffix="× time" value={settings.paceFactor} onChange={(v) => set({ paceFactor: v && v > 0 ? v : 1 })} step={0.1} min={0.1} placeholder="1" />
        </div>
        <details className="disclosure">
          <summary>Oxygen and power budgets</summary>
          <div className="eva-grid">
            <Num label="Oxygen budget" value={settings.o2Budget} onChange={(v) => set({ o2Budget: v })} step={0.1} />
            <label className="eva-field">
              <span>Oxygen unit</span>
              <span className="eva-input">
                <input type="text" value={settings.o2Unit} maxLength={12} onChange={(e) => set({ o2Unit: e.target.value || "units" })} />
              </span>
            </label>
            <Num label={`Oxygen use per hour`} suffix={`${settings.o2Unit}/h`} value={settings.o2RatePerHour} onChange={(v) => set({ o2RatePerHour: v })} step={0.01} />
            <Num label="Battery budget" suffix="Wh" value={settings.powerBudgetWh} onChange={(v) => set({ powerBudgetWh: v })} step={10} />
            <Num label="Average power draw" suffix="W" value={settings.powerDrawW} onChange={(v) => set({ powerDrawW: v })} step={5} />
          </div>
          <p className="fine muted">
            Use any consistent unit. {teamMode ? "Budgets and rates are per astronaut (each suit); the combined requirement adds both. " : ""}PAWPRINT does not provide real
            spacesuit consumption rates.
          </p>
        </details>
        {(teamMode ? team : plan) && (
          <details className="disclosure">
            <summary>Show the formulas</summary>
            <ul className="formula-list">
              {(teamMode ? team!.formulas : plan!.formulas).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <p className="fine muted">The walk back follows the same route reversed, so downhill sections become uphill. No rests or obstacles are modelled.</p>
          </details>
        )}
      </section>
    </div>
  );
}
