"use client";
import { useMemo, useState } from "react";
import { ArrowUp, ListChecks, Play } from "lucide-react";
import type { Member, State } from "@/lib/api";
import type { Ev } from "@/lib/feed";
import { WorldChart } from "@/components/WorldChart";
import { Badge, Button, PageHead, Replayed, Section, Table, ago, inputCls } from "@/components/ui";

export type AgentCtx = {
  state: State; events: Ev[]; live: boolean; team: Record<string, Member>;
  post: (p: string, b: object) => Promise<{ error?: string; id?: string; started?: string }>;
};

export const AGENT_ICON: Record<string, string> = {
  planner: "◇", memory: "◎", safety: "△", "coder-claude": "</>", "coder-codex": "</>", gate: "✓", world: "∿", simulation: "?", evidence: "▤", reviewer: "⚖", actions: "↗",
};

/** What each agent can do, from factory/pipeline.py and gate/runner.py. */
const SKILLS: Record<string, string[]> = {
  planner: ["Turns a plain-English request into a work order", "Recalls similar past work orders and their verdicts from HydraDB", "Hands the plan, safety guidance and past fixes to the coding agent"],
  memory: ["Recalls org memory and the project's regulatory knowledge from HydraDB", "Saves a lesson to HydraDB after every verdict: failed requirements, hazards, the fix", "2 s timeout with a local fallback, so recall never stalls a run"],
  safety: ["Maps a change to hazards and safety requirements (ISO 14971, ARP4761)", "Checks past verdicts on similar changes before deciding", "Tells the coder how to implement it safely"],
  "coder-claude": ["Implements the change in its own git worktree", "Retries with the gate's findings (up to 3 attempts)", "Commits on the work order's wo/ branch"],
  "coder-codex": ["Parallel coder in its own worktree", "Not used by the current pipeline"],
  gate: ["Runs the unit test of every affected safety requirement", "Blocks edits to protected safety evidence", "Deterministic: no LLM in the verdict"],
  world: ["Runs the candidate firmware in 30 simulated patients (UVA/Padova)", "Compares every patient against main", "Blocks on new severe hypoglycemia"],
  simulation: ["Turns a what-if question into world-model scenarios", "Clamps every scenario to the simulator's valid range"],
  evidence: ["Writes the safety evidence pack", "Traces each requirement to its test and simulation result"],
  reviewer: ["Decides merge from checks only, never from an LLM", "Opens the pull request with the evidence"],
  actions: ["Files the evidence pack as a GitHub issue after every verdict", "Runs in the background so it never delays a run", "Needs COMPOSIO_API_KEY and a connected GitHub account"],
};

const tone = (s?: string) => s === "working" ? "run" : s === "blocked" ? "bad" : s === "done" || s === "pass" ? "ok" : "idle";
const word = (s?: string) => s === "working" ? "working" : s === "blocked" ? "blocked" : s === "done" || s === "pass" ? "done" : "idle";
const Dot = ({ s }: { s?: string }) => {
  const t = tone(s);
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t === "run" ? "pulse bg-run" : t === "bad" ? "bg-bad" : t === "ok" ? "bg-ok" : "bg-[#2a2f36]"}`} />;
};
const Icon = ({ id }: { id: string }) => (
  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/[.05] font-mono text-[11px] text-acc">{AGENT_ICON[id] || "◇"}</span>
);
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-dim">{children}</p>;
const at = (e: Ev) => Number(e.run) + e.t;

type Run = { id: string; evs: Ev[]; wo: string | null; title?: string };
/** Runs in the event feed, newest first. */
function toRuns(events: Ev[]): Run[] {
  const m = new Map<string, Ev[]>();
  for (const e of events) m.set(e.run, [...(m.get(e.run) || []), e]);
  return [...m.entries()].reverse().map(([id, evs]) => ({ id, evs, wo: evs.find(e => e.wo)?.wo || null, title: evs.find(e => e.title)?.title?.split("\n")[0] }));
}
const runName = (r: Run) => r.wo || "What-if";

function RunLink({ r, pid }: { r: Run; pid: string }) {
  return <a href={`#/p/${pid}/${r.wo ? `work-orders/${r.wo}` : "world-model"}`} className="whitespace-nowrap font-mono text-[12px] hover:underline">{runName(r)}</a>;
}

/* ---------- the team: who is doing what, per run ---------- */
export function AgentTeam({ state, events, live, post, team }: AgentCtx) {
  const p = state.project!;
  const runs = useMemo(() => toRuns(events), [events]);
  const [sel, setSel] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const run = runs.find(r => r.id === sel) || runs[0];
  const agents = state.team.filter(m => m.kind === "agent");
  const busy = !!state.status?.busy;
  const wo = (id?: string | null) => state.work_orders?.find(w => w.id === id);
  const draft = [...(state.work_orders || [])].reverse().find(w => w.status === "Draft");
  const act = async (path: string, body: object) => {
    const r = await post(path, body);
    setErr(r.error || "");
    if (!r.error) { setText(""); setSel(""); }
  };
  const start = (e: React.FormEvent) => { e.preventDefault(); if (text.trim()) act("ask", { text, skill: "build", project: p.id }); };
  const last = (id: string) => run && [...run.evs].reverse().find(e => e.agent === id);

  return (
    <>
      <PageHead title="Agents" sub="The agent team. Each agent has one job; people approve, agents execute, and every step is recorded. Open an agent to see its log, output and history." />
      <form onSubmit={start} className="mb-3 flex flex-col gap-2 md:flex-row">
        <input value={text} onChange={e => setText(e.target.value)} className={inputCls + " md:flex-1"} aria-label="Give the team a work order"
          placeholder="Give the team a work order, e.g. Add an alarm when the extended bolus is interrupted" />
        <Button primary type="submit" disabled={!live || busy || !text.trim()}><ArrowUp size={14} /> Start work order</Button>
        {draft && <Button onClick={() => act("run", { wo: draft.id })} disabled={!live || busy}><Play size={14} /> Run draft {draft.id}</Button>}
      </form>
      {err && <p className="mb-3 text-[12px] text-bad">{err}</p>}
      <p className="mb-6 flex flex-wrap items-center gap-2 text-[12px] text-dim">
        {busy ? <>
          <Dot s="working" /> <span className="text-run">Working on {state.status?.running ? <a href={`#/p/${p.id}/work-orders/${state.status.running}`} className="underline">{state.status.running}</a> : "a what-if"}</span>
        </> : runs[0] ? <>
          <Dot /> Idle · last run <RunLink r={runs[0]} pid={p.id} /> {wo(runs[0].wo) && <Badge>{wo(runs[0].wo)!.status}</Badge>} {ago(at(runs[0].evs[runs[0].evs.length - 1]))}
        </> : <><Dot /> Idle · no runs yet. Start a work order above.</>}
        {runs[0] && <Replayed r={runs[0].evs.find(e => e.replay)?.replay} />}
      </p>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Section title={run ? `Team on ${runName(run)}${run.title ? ` · ${run.title}` : ""}` : "Team"}
          aside={runs.length > 1 ? (
            <select aria-label="Run" value={run?.id} onChange={e => setSel(e.target.value)} className="cursor-pointer bg-transparent text-[12px] text-mute outline-none">
              {runs.map((r, i) => <option key={r.id} value={r.id} className="bg-panel">{i === 0 ? "Latest: " : ""}{runName(r)} · {ago(Number(r.id))}</option>)}
            </select>) : undefined}>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {agents.map(a => {
              const e = last(a.id);
              const s = e?.state === "working" && !(busy && run === runs[0]) ? "stopped" : e?.state;
              return (
                <a key={a.id} href={`#/p/${p.id}/agents/${a.id}`}
                  className={`block rounded-lg border bg-panel p-3 hover:border-white/20 ${tone(s) === "run" ? "border-run/40" : "border-line"}`}>
                  <div className="flex items-center gap-2">
                    <Icon id={a.id} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{a.name}</span>
                      <span className="block truncate text-[11px] text-dim">{a.role}</span>
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-dim"><Dot s={s} /> {e ? (s === "stopped" ? "stopped" : word(s)) : "not in this run"}</span>
                  </div>
                  <p className={`mt-2 line-clamp-2 min-h-[2.6em] text-[12px] leading-snug ${tone(s) === "bad" ? "text-bad" : "text-mute"}`}>{e?.msg || "—"}</p>
                </a>
              );
            })}
          </div>
        </Section>
        <Section title="Team log" aside={run?.wo ? <a href={`#/p/${p.id}/work-orders/${run.wo}`} className="inline-flex items-center gap-1 hover:text-ink"><ListChecks size={12} /> Open {run.wo}</a> : undefined}>
          {run ? <Log evs={run.evs} team={team} pid={p.id} /> : <Empty>No runs yet. Start a work order above and the team log streams here.</Empty>}
        </Section>
      </div>
    </>
  );
}

function Log({ evs, team, pid }: { evs: Ev[]; team?: Record<string, Member>; pid: string }) {
  return (
    <ol className="space-y-3 border-l border-line pl-4">
      {[...evs].reverse().map((e, i) => (
        <li key={i} className="relative text-[13px]">
          <span className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${tone(e.state) === "bad" ? "bg-bad" : tone(e.state) === "run" ? "bg-run" : "bg-ok"}`} />
          <div className="text-[11px] text-dim">
            <span className="font-mono">+{e.t.toFixed(0)}s</span>
            {team && <> · <a href={`#/p/${pid}/agents/${e.agent}`} className="hover:text-ink">{team[e.agent]?.name || e.agent}</a></>}
            {" · "}{word(e.state)}
          </div>
          <div className={tone(e.state) === "bad" ? "text-bad" : ""}>{e.msg}</div>
          {e.pr && <a href={e.pr} target="_blank" rel="noopener noreferrer" className="text-[12px] text-acc hover:underline">{e.pr}</a>}
        </li>
      ))}
    </ol>
  );
}

/* ---------- one agent: now, live log, output, skills, history ---------- */
export function AgentPage({ state, events, team, id }: AgentCtx & { id: string }) {
  const p = state.project!;
  const a = team[id];
  const mine = useMemo(() => toRuns(events).filter(r => r.evs.some(e => e.agent === id)), [events, id]);
  if (!a || a.kind !== "agent") return <p className="text-dim">Agent not found. <a href={`#/p/${p.id}/agents`} className="underline">All agents</a></p>;
  const run = mine[0];
  const evs = run ? run.evs.filter(e => e.agent === id) : [];
  const last = evs[evs.length - 1];
  const inRun = !!state.status?.busy && run?.id === events[events.length - 1]?.run;
  const active = inRun && last?.state === "working";
  const steps = (r: Run) => r.evs.filter(e => e.agent === id);

  return (
    <>
      <div className="mb-1 text-[12px] text-dim"><a href={`#/p/${p.id}/agents`} className="hover:text-ink">Agents</a> / {a.name}</div>
      <PageHead title={a.name} sub={<span className="inline-flex flex-wrap items-center gap-2">
        {active ? <Badge tone="Running">working</Badge> : <Badge tone={last?.state === "blocked" ? "Blocked" : "Draft"}>{inRun ? "waiting on the team" : "idle"}</Badge>}
        {a.role}
      </span>}>
        {run?.wo && <a href={`#/p/${p.id}/work-orders/${run.wo}`} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-3 py-1.5 text-[13px] font-medium hover:border-white/20"><ListChecks size={14} /> Open {run.wo}</a>}
      </PageHead>

      <div className={`mb-8 rounded-lg border bg-panel p-4 ${active ? "border-run/40" : "border-line"}`}>
        <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wider text-dim"><Dot s={active ? "working" : last?.state} /> {active ? "Now" : last ? "Last action" : "Status"}</div>
        {last ? <>
          <p className={`text-[14px] ${last.state === "blocked" ? "text-bad" : ""}`}>{last.msg}</p>
          <p className="mt-1 text-[12px] text-dim">
            {active ? "Working on " : `${inRun ? "Waiting on the team" : "Idle"} · ${word(last.state) === "working" ? "stopped" : word(last.state)} on `}<RunLink r={run} pid={p.id} />{run.title ? ` · ${run.title}` : ""} · {ago(at(last))}
          </p>
        </> : <p className="text-[13px] text-mute">Idle. {a.name} has not run yet{id === "actions" ? " (connect GitHub on Home)" : ""}.</p>}
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Section title={run ? `Log · ${runName(run)}` : "Log"} aside={active ? <span className="inline-flex items-center gap-1.5 text-run"><Dot s="working" /> live</span> : run ? `${ago(Number(run.id))}` : undefined}>
            {evs.length ? <Log evs={evs} pid={p.id} /> : <Empty>Nothing yet. Give the team a work order on Agents or Home and this log streams live.</Empty>}
          </Section>
          <Section title="Output">
            <Output evs={evs} />
            {run?.wo && <p className="mt-3 text-[12px] text-dim">Code change, requirement tests and evidence pack: <a href={`#/p/${p.id}/work-orders/${run.wo}`} className="underline hover:text-ink">{run.wo}</a></p>}
          </Section>
        </div>
        <div className="min-w-0">
          <Section title="Skills">
            <ul className="space-y-1.5 text-[13px] text-mute">{(SKILLS[id] || [a.role]).map(s => <li key={s} className="flex gap-2"><span className="text-acc">·</span>{s}</li>)}</ul>
          </Section>
          <Section title="History" aside={`${mine.length} run${mine.length === 1 ? "" : "s"}`}>
            <Table head={["Run", "Request", "Result", "When"]} empty="No runs yet."
              rows={mine.map(r => {
                const s = steps(r), e = s[s.length - 1];
                return [<RunLink key="r" r={r} pid={p.id} />, <span key="t" className="line-clamp-1 text-mute">{r.title || "—"}</span>,
                  <span key="x" className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]"><Dot s={e.state} /> {word(e.state)} · {s.length} step{s.length === 1 ? "" : "s"}</span>,
                  <span key="w" className="whitespace-nowrap text-mute">{ago(at(e))}</span>];
              })} />
          </Section>
        </div>
      </div>
    </>
  );
}

/** The richest artifact this agent produced in its latest run. */
function Output({ evs }: { evs: Ev[] }) {
  const find = <K extends keyof Ev>(k: K) => [...evs].reverse().find(e => e[k])?.[k];
  const mem = find("memory"), an = find("analysis"), gate = find("gate"), world = find("world"), ev = find("evidence"), pr = find("pr");
  const memEv = [...evs].reverse().find(e => e.memory), lesEv = [...evs].reverse().find(e => e.lessons), saved = [...evs].reverse().find(e => e.lesson);
  const sc = ([...evs].reverse().find(e => (e as { scenarios?: unknown }).scenarios) as { scenarios?: { id: string; label: string; carbs: number; cohort: string }[] } | undefined)?.scenarios;
  if (!mem && !lesEv && !saved && !an && !gate && !world && !ev && !pr && !sc) return <Empty>No artifact from this step; its log above is the output.</Empty>;
  const via = (r?: Ev["recall"]) => r ? (r.backend === "HydraDB" ? `HydraDB · ${r.ms} ms` : "local memory (HydraDB unreachable)") : "";
  const tag = (k: string) => <span className="mr-2 rounded bg-white/[.05] px-1.5 py-0.5 font-mono text-[10px] uppercase text-mute">{k.replace("_", " ")}</span>;
  return (
    <div className="space-y-4 text-[13px]">
      {saved?.lesson && <div className="rounded-lg border border-line px-3 py-2">
        <div className="text-[11px] text-dim">Lesson saved to {via(saved.recall)} · {saved.lesson.source.split(" · ")[1]}</div>
        <div className="mt-0.5 font-medium">{saved.lesson.title}</div>
        <p className="mt-0.5 text-[12.5px] text-mute">{saved.lesson.summary}</p>
      </div>}
      {lesEv && <div>
        <div className="mb-1.5 text-[11px] text-dim">Similar past work orders recalled from {via(lesEv.recall)} · factory_lessons</div>
        {lesEv.lessons!.length ? <ul className="divide-y divide-line rounded-lg border border-line">{lesEv.lessons!.map((h, i) => (
          <li key={i} className="px-3 py-2">{tag("lesson")}<span className="font-medium">{h.title}</span>
            <p className="mt-0.5 text-[12.5px] text-mute">{h.summary}</p></li>))}</ul>
          : <Empty>No similar past work order yet. This run&apos;s lesson is saved for the next one.</Empty>}
      </div>}
      {mem && <div>
        {memEv?.recall && <div className="mb-1.5 text-[11px] text-dim">Recalled from {via(memEv.recall)} · {memEv.recall.collections?.join(", ")}</div>}
        <ul className="divide-y divide-line rounded-lg border border-line">{mem.map((h, i) => (
          <li key={i} className="flex items-baseline gap-2 px-3 py-2"><span className="min-w-0">{tag(h.kind)}{h.title}</span>
            {h.collection && <span className="ml-auto shrink-0 font-mono text-[10.5px] text-dim">{h.collection}</span>}</li>))}</ul>
      </div>}
      {an && <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        {([["Hazards", an.hazards?.join(", ")], ["Requirements", an.requirements?.join(", ")], ["Risk", an.risk], ["Guidance", an.guidance], ["New hazard", an.new_hazard]] as const)
          .filter(([, v]) => v).flatMap(([k, v]) => [<dt key={k} className="text-dim">{k}</dt>, <dd key={k + "v"} className="text-mute">{v}</dd>])}
      </dl>}
      {gate && <Table head={["Requirement", "Result"]} rows={gate.rows.map(r => [<span key="r"><b className="font-mono text-[12px]">{r.id}</b> <span className="text-mute">{r.text}</span></span>, <Badge key="x">{r.result}</Badge>])} />}
      {world && world.results.length > 0 && <WorldChart world={world} />}
      {sc && <ul className="space-y-1 text-mute">{sc.map(s => <li key={s.id}>{s.label || s.id} · {s.carbs} g · {s.cohort}</li>)}</ul>}
      {ev && <p><Badge>{ev.decision}</Badge> <span className="text-mute">{ev.headline}</span></p>}
      {pr && <a href={pr} target="_blank" rel="noopener noreferrer" className="text-acc hover:underline">{pr}</a>}
    </div>
  );
}
