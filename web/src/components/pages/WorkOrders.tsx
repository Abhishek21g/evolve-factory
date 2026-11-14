"use client";
import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink, FileCheck2, GitBranch, GitPullRequest, ListChecks, Orbit, Play, Plus, Search, XCircle } from "lucide-react";
import { cn } from "cn";
import type { Member, WorkOrder } from "@/lib/api";
import { blocked, go, type Ctx } from "@/lib/ctx";
import { deviceCopy } from "@/lib/device";
import { buttonVariants } from "@/components/kit/button";
import { WorldChart } from "@/components/WorldChart";
import { GateNote } from "@/components/GateNote";
import type { Api } from "@/components/trace/Viewer";
import { AuditTable, Diff, Empty, Markdown } from "@/components/common";
import { Ago, Badge, Button, Field, Modal, PageHead, Replayed, Section, Table, Who, ago, inputCls } from "@/components/ui";

const FILTERS = ["All", "Running", "Approved", "Blocked", "Draft", "Stopped", "Not run"] as const;
type Filter = (typeof FILTERS)[number];

export function WorkOrders({ state, post, team, live }: Ctx) {
  const p = state.project!;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Filter>("All");
  const [q, setQ] = useState("");
  const all = useMemo(() => [...(state.work_orders || [])].reverse(), [state.work_orders]);
  const count = (s: Filter) => s === "All" ? all.length : all.filter(w => w.status === s).length;
  const shown = all.filter(w => (f === "All" || w.status === f) &&
    (!q.trim() || `${w.id} ${w.title} ${w.description}`.toLowerCase().includes(q.trim().toLowerCase())));
  const st = state.status;
  return (
    <>
      <PageHead title="Work Orders" sub={`Each work order is built by the agent team for ${p.name} and must pass the deterministic gate and the world model before it can merge.`}>
        <Button primary onClick={() => setOpen(true)} disabled={!live} title={live ? undefined : "Read-only snapshot"}><Plus size={14} /> New work order</Button>
      </PageHead>
      {st?.busy && st.running && st.project === p.id && (
        <a href={`#/p/${p.id}/work-orders/${st.running}`} className="mb-4 flex items-center gap-2 rounded-lg border border-run/30 bg-run/5 px-4 py-2.5 text-sm text-run hover:bg-run/10">
          <span className="pulse size-1.5 rounded-full bg-run" /> Agents are working on {st.running}. Open it to watch the pipeline.
        </a>
      )}
      {all.length ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
              {FILTERS.filter(s => s === "All" || count(s)).map(s => (
                <button key={s} aria-pressed={f === s} onClick={() => setF(s)}
                  className={cn("h-8 rounded-md border px-2.5 text-sm transition-colors", f === s ? "border-line-strong bg-white/[.07] text-ink" : "border-transparent text-mute hover:bg-white/[.04] hover:text-ink")}>
                  {s} <span className="ml-0.5 tabular-nums text-dim">{count(s)}</span>
                </button>
              ))}
            </div>
            <div className="relative ml-auto w-full sm:w-72">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search work orders" aria-label="Search work orders" className={inputCls + " h-8 py-1 pl-8"} />
            </div>
          </div>
          <WOList wos={shown} team={team} pid={p.id} empty={<>No work orders match. <button className="text-acc hover:underline" onClick={() => { setF("All"); setQ(""); }}>Clear filters</button></>} />
        </>
      ) : (
        <div className="grid place-items-center rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <ListChecks size={28} className="mb-3 text-dim" />
          <p className="text-md font-medium">No work orders for {p.name} yet</p>
          <p className="mt-1 max-w-md text-sm text-mute">Describe a change. The agent team analyses hazards, writes the code, runs every requirement test and the world model, then files the evidence.</p>
          <div className="mt-5"><Button primary onClick={() => setOpen(true)} disabled={!live}><Plus size={14} /> New work order</Button></div>
        </div>
      )}
      {open && <NewWO ctx={{ state, post, live }} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Whole rows are links, so the list works with the keyboard and middle-click. */
export function WOList({ wos, team, pid, empty }: { wos: WorkOrder[]; team: Record<string, Member>; pid: string; empty?: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="hidden grid-cols-[88px_minmax(0,1fr)_110px_150px_90px] gap-4 border-b border-line px-4 py-2.5 text-sm font-medium text-mute md:grid">
        <span>ID</span><span>Title</span><span>Status</span><span>Requested by</span><span className="text-right">Created</span>
      </div>
      {wos.length ? wos.map(w => (
        <a key={w.id} href={`#/p/${pid}/work-orders/${w.id}`}
          className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 transition-colors last:border-0 hover:bg-white/[.03] focus-visible:bg-white/[.03] md:grid-cols-[88px_minmax(0,1fr)_110px_150px_90px]">
          <span className="font-mono text-sm text-mute">{w.id}</span>
          <span className="col-span-2 min-w-0 md:col-span-1">
            <span className="block truncate text-base font-medium text-ink">{w.title}</span>
            {w.evidence && <span className="block truncate text-sm text-dim">{w.evidence.headline.split(";")[0]}</span>}
          </span>
          <span className="row-start-1 justify-self-end md:row-auto md:justify-self-start"><Badge>{w.status}</Badge></span>
          <span className="hidden md:block"><Who m={team[w.requested_by]} /></span>
          <span className="hidden text-right text-sm text-mute md:block"><Ago ts={w.created} /></span>
        </a>
      )) : <p className="px-4 py-10 text-center text-base text-mute">{empty || "No work orders yet."}</p>}
    </div>
  );
}

function NewWO({ ctx: { state, post, live }, onClose }: { ctx: Pick<Ctx, "state" | "post" | "live">; onClose: () => void }) {
  const p = state.project!;
  const tpl = deviceCopy(p.device).template;
  const [title, setTitle] = useState(tpl.title);
  const [desc, setDesc] = useState(tpl.description);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const why = blocked(state, live);
  const create = async (run: boolean) => {
    if (!title.trim()) return setErr("Give the work order a title.");
    setSaving(true);
    const r = await post("workorders", { project: p.id, title, description: desc });
    if (r.error || !r.id) { setSaving(false); return setErr(r.error || "Could not create the work order."); }
    if (run) await post("run", { wo: r.id }); // if it fails, the work order page says why and offers Run
    go(`/p/${p.id}/work-orders/${r.id}`); onClose();
  };
  return (
    <Modal title={`New work order · ${p.name}`} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); create(!why); }} className="space-y-4">
        <Field label="Title"><input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} autoFocus /></Field>
        <Field label="Description"><textarea rows={4} className={inputCls} value={desc} onChange={e => setDesc(e.target.value)} /></Field>
        <p className="text-sm text-dim">Requirements and hazards are taken from {p.standard.split(" · ")[0]}. Agents cannot edit them.</p>
        {why && <p className="text-sm text-warn">{why} You can still save it as a draft.</p>}
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={() => create(false)} disabled={saving}>Save draft</Button>
          <Button primary type="submit" disabled={saving || !!why}><Play size={14} /> Create and run</Button>
        </div>
      </form>
    </Modal>
  );
}

const STEPS = (device: string) => [
  ["memory", "Context", "Recall related tickets, meetings, chats and code"],
  ["safety", "Hazard analysis", "Safety Analyst maps the change to hazards"],
  ["planner", "Plan", "Planner prepares the work for the coder"],
  ["coder-claude", "Implementation", "Claude Code writes the change in its own worktree"],
  ["gate", "Requirement tests", "Deterministic gate runs every affected requirement's test"],
  ["world", "World model", deviceCopy(device).worldStep],
  ["evidence", "Evidence pack", "Safety case generated for review"],
  ["reviewer", "Decision", "Merge decision from checks, never from an LLM"],
] as const;

export function WorkOrderView({ state, events, post, text, getJSON, team, id, live }: Ctx & { id: string }) {
  const p = state.project!;
  const w = state.work_orders?.find(x => x.id === id);
  const [doc, setDoc] = useState<{ title: string; body: string } | null>(null);
  const [err, setErr] = useState("");
  const gh = state.trace?.github;
  const api: Api = useMemo(() => ({ getJSON, text, post, live, pid: p.id, gh }), [getJSON, text, post, live, p.id, gh]);
  const mine = useMemo(() => events.filter(e => e.wo === id), [events, id]);
  if (!w) return (
    <div className="grid place-items-center rounded-xl border border-dashed border-line px-6 py-16 text-center">
      <p className="text-md font-medium">Work order {id} is not in {p.name}</p>
      <p className="mt-1 text-sm text-mute">It may belong to another project, or it was never created.</p>
      <a href={`#/p/${p.id}/work-orders`} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "mt-5 px-3")}><ArrowLeft size={14} /> All work orders</a>
    </div>
  );
  const lastRun = mine.length ? mine[mine.length - 1].run : null;
  const run = mine.filter(e => e.run === lastRun);
  const step = (agent: string) => [...run].reverse().find(e => e.agent === agent || (agent === "coder-claude" && e.agent.startsWith("coder")));
  const pr = [...run].reverse().find(e => e.pr)?.pr;
  const past = [...run].reverse().find(e => e.lessons && e.agent === "planner");
  const why = w.status === "Running" ? null : blocked(state, live);
  const start = async () => { const r = await post("run", { wo: id }); setErr(r.error === "factory busy" ? blocked(state, live) || "The factory is busy." : r.error || ""); };
  const open = async (kind: "evidence" | "diff", title: string) => setDoc({ title, body: await text(`${kind}?wo=${id}`) });
  const dev = deviceCopy(p.device);
  const ok = w.status === "Approved";

  return (
    <>
      <a href={`#/p/${p.id}/work-orders`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-mute hover:text-ink"><ArrowLeft size={14} /> Work Orders</a>
      <PageHead title={w.title} sub={<span className="inline-flex flex-wrap items-center gap-2"><span className="font-mono text-mute">{w.id}</span><Badge>{w.status}</Badge> requested by <Who m={team[w.requested_by]} /> · {ago(w.created)} <Replayed r={run.find(e => e.replay)?.replay} /></span>}>
        {w.evidence && <Button onClick={() => open("evidence", `Evidence pack · ${w.id}`)}><FileCheck2 size={14} /> Evidence</Button>}
        {w.commits.length > 0 && <Button onClick={() => open("diff", `Code change · ${w.id}`)}><GitBranch size={14} /> Code change</Button>}
        {w.world && <Button onClick={() => go(`/p/${p.id}/world-loop/${w.id}`)}><Orbit size={14} /> World model loop</Button>}
        {pr && <a href={pr} target="_blank" rel="noopener" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "px-3 font-medium")}><GitPullRequest size={14} /> Pull request <ExternalLink size={12} className="text-dim" /></a>}
        <Button primary onClick={start} disabled={!!why || w.status === "Running"} title={why || undefined}><Play size={14} /> {w.status === "Draft" ? "Run" : w.status === "Running" ? "Running…" : "Run again"}</Button>
      </PageHead>
      {why && live && <p className="-mt-5 mb-6 text-sm text-warn">{why}</p>}
      {err && <p role="alert" className="-mt-5 mb-6 text-sm text-bad">{err}</p>}
      {w.description && <p className="-mt-3 mb-6 max-w-3xl text-base text-mute">{w.description}</p>}
      {w.evidence && (
        <div className={cn("mb-8 flex items-start gap-3 rounded-xl border px-5 py-4", ok ? "border-ok/30 bg-ok/[.06]" : "border-bad/30 bg-bad/[.06]")}>
          {ok ? <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-ok" /> : <XCircle size={22} className="mt-0.5 shrink-0 text-bad" />}
          <div className="min-w-0">
            <p className={cn("text-md font-semibold", ok ? "text-ok" : "text-bad")}>{ok ? "Approved to merge" : "Blocked"}{w.evidence.decision && w.evidence.decision.toUpperCase() !== w.status.toUpperCase() ? ` · ${w.evidence.decision}` : ""}</p>
            <p className="mt-0.5 text-base text-ink/90">{w.evidence.headline}</p>
            {w.gate?.checker && <div className="mt-1.5"><GateNote checker={w.gate.checker} state={state} api={api} /></div>}
          </div>
        </div>
      )}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Section title="Pipeline">
          <ol className="relative space-y-0 border-l border-line pl-5">
            {STEPS(p.device).map(([agent, label, desc]) => {
              const e = step(agent);
              const t = !e ? "idle" : e.state === "working" ? "run" : e.state === "blocked" ? "bad" : "ok";
              return (
                <li key={agent} className="relative pb-4">
                  <span className={`absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 border-bg ${t === "run" ? "pulse bg-run" : t === "bad" ? "bg-bad" : t === "ok" ? "bg-ok" : "bg-line-strong"}`} />
                  <div className="flex items-baseline justify-between gap-2">
                    <a href={`#/p/${p.id}/agents/${agent}`} className={`text-base font-medium hover:underline ${t === "idle" ? "text-mute" : ""}`}>{label}</a>
                    {e && <span className="font-mono text-2xs text-dim">{e.t.toFixed(0)}s</span>}
                  </div>
                  {agent === "safety" && e?.analysis ? (
                    <div className="text-sm leading-snug text-dim">
                      <div className="font-mono text-xs text-mute">{[...(e.analysis.hazards || []), ...(e.analysis.requirements || [])].join(" ")}</div>
                      <div className="line-clamp-2" title={e.analysis.risk}>Risk: {e.analysis.risk}</div>
                    </div>
                  ) : <div className={`text-sm leading-snug ${t === "bad" ? "text-bad" : "text-dim"}`}>{e?.msg || desc}</div>}
                  {agent === "gate" && e && w.gate?.checker && <div className="mt-0.5 font-mono text-2xs text-mute">{w.gate.checker.label}</div>}
                  {agent === "planner" && past && past !== e && <div className="mt-1 line-clamp-3 text-xs leading-snug text-mute" title={past.msg}>Memory: {past.msg}</div>}
                </li>
              );
            })}
          </ol>
        </Section>
        <div className="min-w-0">
          <Section title={`World model: candidate vs main, ${dev.subject}`} aside="world model">
            {w.world ? <WorldChart world={w.world} /> : step("gate")?.state === "working"
              ? <Empty>Running the candidate in the world model…</Empty>
              : <Empty>Runs with the requirement tests: the candidate is compiled into the world model and every simulated run is compared with main.</Empty>}
          </Section>
          <Section title="Requirement tests">
            {w.gate?.rows.length ? (
              <Table head={["Requirement", "Hazard", "Result"]} rows={w.gate.rows.map(r => [
                <span key="r"><b className="font-mono text-sm">{r.id}</b> <span className="text-mute">{r.text}</span></span>,
                <span key="h" className="text-mute">{r.hazards.map(h => `${h.id} ${h.title || ""}`).join("; ")}</span>, <Badge key="x">{r.result}</Badge>])} />
            ) : <Empty>Every requirement the change touches is traced to an executed test.</Empty>}
          </Section>
          <Section title="Activity">
            <AuditTable rows={state.audit.filter(a => a.object === id).slice(0, 12)} team={team} pid={p.id} />
          </Section>
        </div>
      </div>
      {doc && <Modal wide title={doc.title} onClose={() => setDoc(null)}>{doc.title.startsWith("Code") ? <Diff src={doc.body} /> : <Markdown src={doc.body} />}</Modal>}
    </>
  );
}
