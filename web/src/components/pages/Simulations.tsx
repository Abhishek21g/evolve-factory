"use client";
import { FlaskConical } from "lucide-react";
import { blocked, type Ctx } from "@/lib/ctx";
import { CockpitCallouts } from "@/components/Callouts";
import { Composer } from "@/components/Composer";
import { WorldChart } from "@/components/WorldChart";
import { LoopSummary, SimVsWorld } from "@/components/WorldLoop";
import { Asked, PageHead, Replayed, Section, Table } from "@/components/ui";

const GATE: Record<string, { aside: string; rows: string[][] }> = {
  "flight-controls": {
    aside: "run on every work order · 6 aircraft configs each · 60 s",
    rows: [
      ["Sideslip stall", "Idle thrust, pilot pulls toward 16 deg AoA; a sideslip splits the two AoA vanes by 5.3 deg", "any flight newly above the 15 deg stall AoA"],
      ["Vane failure", "Left AoA vane fails at 22 deg in a climb", "any flight newly stalling or losing > 300 ft"],
      ["Turbulence", "Moderate vertical gusts at cruise", "any flight newly stalling or losing > 300 ft"],
    ],
  },
  "insulin-pump": {
    aside: "run on every work order · 10 virtual adults each · 12 h",
    rows: [
      ["Large meal", "120 g meal, user asks for the correct dose; extended bolus if the pump supports it", "any patient newly below 54 mg/dL"],
      ["Decimal slip", "15 g snack, dose typed 10x; user re-enters if the pump rejects it", "any patient newly below 54 mg/dL"],
    ],
  },
};

/** What-ifs for the selected project: ask, then the verdict, the runs, and the per-run table. */
export function WorldModel({ state, events, post, live, checking, getJSON }: Ctx) {
  const p = state.project!;
  const air = p.device === "flight-controls";
  const latestEv = [...events].reverse().find(e => e.world?.question && (e.world.kind === "aircraft") === air);
  const latest = latestEv?.world;
  const plan = events.find(e => e.run === latestEv?.run && e.agent === "simulation" && e.state === "done");
  const thinking = state.status?.job === "whatif" && state.status.project === p.id;
  const nowRun = [...events].reverse().find(e => e.agent === "simulation")?.run;
  const now = thinking ? [...events].reverse().find(e => e.run === nowRun && !e.wo) : undefined;
  const woSim = [...(state.work_orders || [])].reverse().find(w => w.world);
  const gate = GATE[p.device] || GATE["insulin-pump"];
  const ask = async (text: string) => {
    const r = await post("whatif", { text, project: p.id });
    return r.error ? (blocked(state, live) || r.error) : null;
  };
  return (
    <>
      <PageHead title="Simulations" sub={<>World model: {p.world_model}. Each simulation compiles the real code and puts it in the loop: it decides every action, step by step, in every simulated run.</>} />
      <div className="mb-8 max-w-3xl">
        <Composer project={p} modes={["simulate"]} onSubmit={ask} disabledReason={blocked(state, live)} />
      </div>
      {thinking && (
        <p className="mb-6 flex items-center gap-2 rounded-lg border border-run/30 bg-run/5 px-4 py-2.5 text-sm text-run">
          <span className="pulse size-1.5 rounded-full bg-run" />{now?.msg || "Simulation Agent is planning scenarios"}
        </p>
      )}
      <Section title={latest?.question ? <>What-if: “{latest.question}”<Asked title={latest.question} asked={latest.asked} /></> : "Latest what-if"} aside={latestEv?.replay ? <Replayed r={latestEv.replay} /> : latest ? "current code" : undefined}>
        {plan && <p className="mb-3 text-sm text-mute"><span className="text-dim">Simulation Agent plan:</span> {plan.msg}</p>}
        {latest ? <WorldChart world={latest} /> : (
          <div className="grid place-items-center rounded-xl border border-dashed border-line px-6 py-14 text-center">
            <FlaskConical size={26} className="mb-3 text-dim" />
            <p className="text-md font-medium">No what-ifs for {p.name} yet</p>
            <p className="mt-1 max-w-md text-sm text-mute">Ask a question above or pick a suggestion. The Simulation Agent turns it into scenarios and the world model runs them against the current code.</p>
          </div>
        )}
      </Section>
      <CockpitCallouts getJSON={getJSON} device={p.device} kind="whatif" wkey={p.id} tick={`${events.length}-${live}`} />
      <LoopSummary state={state} events={events} live={live} checking={checking} getJSON={getJSON} />
      <CockpitCallouts getJSON={getJSON} device={p.device} wkey={woSim?.id} tick={`${events.length}-${live}`} />
      {woSim?.world && (
        <Section title={`Latest work order: ${woSim.id} · ${woSim.title}`} aside={<a href={`#/p/${p.id}/work-orders/${woSim.id}`} className="hover:text-ink">Open work order</a>}>
          <WorldChart world={woSim.world} />
        </Section>
      )}
      <Section title="Gate scenarios" aside={gate.aside}>
        <Table head={["Scenario", "What happens", "Blocks when"]} rows={gate.rows.map(([a, b, c]) => [<span key="a" className="whitespace-nowrap font-medium">{a}</span>, <span key="b" className="text-mute">{b}</span>, c])} />
      </Section>
      <Section title="How it works"><SimVsWorld air={air} /></Section>
    </>
  );
}
