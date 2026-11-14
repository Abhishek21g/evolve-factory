"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowUp, Bot, Boxes, Brain, ChevronDown, FileCheck2, FlaskConical, GitBranch, GitPullRequest, Home, ListChecks, Network, Plus, Play, Search, ShieldAlert, Users,
} from "lucide-react";
import { useFactoryState, type MemoryItem, type Member, type State, type WorkOrder } from "@/lib/api";
import type { Ev } from "@/lib/feed";
import { WorldChart } from "@/components/WorldChart";
import { TraceGraph } from "@/components/TraceGraph";
import { Avatar, Badge, Button, Field, Modal, PageHead, Section, Table, Who, ago, inputCls } from "@/components/ui";

/* ---------- routing: #/p/<project>/<page>[/<wo>] ---------- */
function useRoute() {
  const [hash, setHash] = useState("");
  useEffect(() => {
    const f = () => setHash(location.hash.slice(1));
    f(); addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  const [, , project = "", page = "overview", item = ""] = (hash || "/").split("/");
  return { project: hash.startsWith("/p/") ? project : "", page, item };
}
const go = (h: string) => { location.hash = h; };

export default function App() {
  const route = useRoute();
  const { state, events, live, post, text, getJSON } = useFactoryState(route.project);
  const [me, setMe] = useState("abhishek");
  useEffect(() => { try { setMe(localStorage.getItem("actor") || "abhishek"); } catch { /* private mode */ } }, []);
  const switchMe = (id: string) => { setMe(id); try { localStorage.setItem("actor", id); } catch { /* ignore */ } };

  if (!state) return <div className="grid min-h-screen place-items-center text-[13px] text-dim">Connecting to the factory…</div>;
  const team = Object.fromEntries(state.team.map(m => [m.id, m])) as Record<string, Member>;
  const p = route.project ? state.project : null;
  const ctx = { state, events, live: !!live, post: (path: string, body: object) => post(path, body, me), text, getJSON, team, me };

  return (
    <div className="flex min-h-screen">
      <Sidebar state={state} project={p?.id} page={route.page} me={me} setMe={switchMe} live={!!live} />
      <main className="min-w-0 flex-1 px-5 pb-20 pt-6 md:px-10">
        {live === false && (
          <div className="mb-5 rounded-md border border-line bg-panel2 px-3 py-2 text-[12px] text-mute">
            Read-only snapshot of a real run. Clone the repo and run <code className="text-ink">factory/server.py</code> to create projects and run work orders.
          </div>
        )}
        {!p ? <Projects {...ctx} /> :
          route.page === "requirements" ? <Requirements {...ctx} /> :
          route.page === "work-orders" && route.item ? <WorkOrderView {...ctx} id={route.item} /> :
          route.page === "work-orders" ? <WorkOrders {...ctx} /> :
          route.page === "world-model" ? <WorldModel {...ctx} /> :
          route.page === "traceability" ? <Traceability {...ctx} /> :
          route.page === "audit" ? <AuditTrail {...ctx} /> :
          route.page === "team" ? <Team {...ctx} /> :
          route.page === "agents" ? <Agents {...ctx} /> :
          route.page === "memory" ? <Memory {...ctx} /> : <HomePage {...ctx} />}
      </main>
    </div>
  );
}

type Ctx = { state: State; events: Ev[]; live: boolean; post: (p: string, b: object) => Promise<{ error?: string; id?: string; started?: string }>; text: (p: string) => Promise<string>; getJSON: <T>(p: string) => Promise<T | null>; team: Record<string, Member>; me: string };

/* ---------- sidebar ---------- */
function Sidebar({ state, project, page, me, setMe, live }: { state: State; project?: string; page: string; me: string; setMe: (id: string) => void; live: boolean }) {
  const nav = [
    ["overview", "Home", Home], ["agents", "Agents", Bot], ["memory", "Memory", Brain], null,
    ["requirements", "Requirements", ShieldAlert], ["work-orders", "Work Orders", ListChecks], ["world-model", "World Model", FlaskConical],
    ["traceability", "Traceability", Network], null, ["audit", "Audit Trail", Activity], ["team", "Team", Users],
  ] as const;
  const humans = state.team.filter(m => m.kind === "human");
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-[#0c0d0f] lg:flex">
      <a href="#/" className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
        <div className="grid h-6 w-6 place-items-center rounded bg-ink font-mono text-[12px] font-bold text-bg">C</div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{state.project && project ? state.project.name : "Certus Factory"}</div>
          <div className="truncate text-[11px] text-dim">{project ? "Certus Factory" : "Software factory for physical AI"}</div>
        </div>
        <ChevronDown size={14} className="ml-auto text-dim" />
      </a>
      <nav className="flex-1 space-y-0.5 p-2 text-[13px]">
        <a href="#/" className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 ${!project ? "bg-white/[.06] text-ink" : "text-mute hover:bg-white/[.04] hover:text-ink"}`}>
          <Boxes size={15} /> Projects
        </a>
        {project && <div className="my-2 border-t border-line" />}
        {project && nav.map((n, i) => !n ? <div key={i} className="my-2 border-t border-line" /> : (([k, l, Icon]) => (
          <a key={k} href={`#/p/${project}/${k}`} className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 ${page === k ? "bg-white/[.06] text-ink" : "text-mute hover:bg-white/[.04] hover:text-ink"}`}>
            <Icon size={15} /> {l}
          </a>
        ))(n))}
      </nav>
      <div className="space-y-3 border-t border-line p-3 text-[12px]">
        <div className="flex items-center gap-2 text-dim">
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-ok" : "bg-dim"}`} />
          {live ? "Factory online" : "Snapshot"} · memory {state.status?.memory || "local"}{live && state.status?.replay ? " · replay" : ""}
        </div>
        <label className="flex items-center gap-2">
          <Avatar m={humans.find(h => h.id === me)} />
          <select aria-label="Acting as" value={me} onChange={e => setMe(e.target.value)}
            className="min-w-0 flex-1 cursor-pointer bg-transparent text-[13px] text-ink outline-none">
            {humans.map(h => <option key={h.id} value={h.id} className="bg-panel">{h.name}</option>)}
          </select>
        </label>
      </div>
    </aside>
  );
}

/* ---------- projects ---------- */
function Projects({ state, post, team, live }: Ctx) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHead title="Projects" sub="Each project is a physical-AI product: its code, its hazard log, and a world model to test changes against.">
        <Button primary onClick={() => setOpen(true)} disabled={!live}><Plus size={14} /> New project</Button>
      </PageHead>
      <Table head={["Project", "Device", "Standard", "World model", "Owner", "Created"]}
        empty="No projects yet. Create one to import its hazard log and start work orders."
        rows={state.projects.map(p => [
          <a key="n" href={`#/p/${p.id}/overview`} className="font-medium hover:underline">{p.name}</a>,
          state.devices[p.device] || p.device, <span key="s" className="text-mute">{p.standard}</span>,
          <span key="w" className="text-mute">{p.world_model}</span>, <Who key="o" m={team[p.owner]} />, <span key="c" className="text-mute">{ago(p.created)}</span>,
        ])} />
      {open && <NewProject state={state} post={post} onClose={() => setOpen(false)} />}
    </>
  );
}

function NewProject({ state, post, onClose }: { state: State; post: Ctx["post"]; onClose: () => void }) {
  const [name, setName] = useState("Insulin Pump Firmware");
  const [device, setDevice] = useState(Object.keys(state.devices)[0]);
  const [err, setErr] = useState("");
  const soon = ["Ventilator", "Robot arm", "Vehicle ECU", "Drone flight controller"];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await post("projects", { name, device });
    if (r.error) return setErr(r.error);
    go(`/p/${r.id}/overview`); onClose();
  };
  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus /></Field>
        <Field label="Device and world model">
          <select className={inputCls} value={device} onChange={e => setDevice(e.target.value)}>
            {Object.entries(state.devices).map(([k, l]) => <option key={k} value={k}>{l} · simulated patients</option>)}
            {soon.map(s => <option key={s} disabled>{s} · world model coming</option>)}
          </select>
        </Field>
        <p className="text-[12px] text-dim">The factory imports the repository&apos;s hazard log and safety requirements and connects the world model.</p>
        {err && <p className="text-[12px] text-bad">{err}</p>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button primary type="submit">Create project</Button></div>
      </form>
    </Modal>
  );
}

/* ---------- home: agent-first, like Software Factory ---------- */
const AGENT_ICON: Record<string, string> = {
  planner: "◇", memory: "◎", safety: "△", "coder-claude": "</>", "coder-codex": "</>", gate: "✓", world: "∿", simulation: "?", evidence: "▤", reviewer: "⚖", actions: "↗",
};
const SUGGEST = [
  ["build", "Let adults take larger meal boluses"],
  ["build", "Add an alarm when the extended bolus is interrupted"],
  ["simulate", "What if a child eats 80 g and the parent types the dose 10x?"],
  ["simulate", "What if an adult eats 150 g of carbs?"],
] as const;

function HomePage({ state, post, team, me, live }: Ctx) {
  const p = state.project!;
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"build" | "simulate">("build");
  const [err, setErr] = useState("");
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const agents = state.team.filter(m => m.kind === "agent" && m.id !== "coder-codex");
  const live_ = state.agents || {};
  const busy = state.status?.busy;
  const wos = [...(state.work_orders || [])].reverse().slice(0, 5);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    const r = await post("ask", { text, skill: mode, project: p.id });
    if (r.error) return setErr(r.error);
    setErr(""); setText("");
    go(r.id ? `/p/${p.id}/work-orders/${r.id}` : `/p/${p.id}/world-model`);
  };
  const connected: [string, boolean, string][] = [
    ["Claude Code", true, "coding agent"], ["8090 Software Factory", !!state.status?.software_factory, "work orders via MCP"],
    ["HydraDB", state.status?.memory === "HydraDB", "shared memory"], ["Composio", !!state.status?.composio, "GitHub + Slack actions"],
    ["Vercel", true, "hosting"],
  ];
  return (
    <>
      <div className="mx-auto mt-6 max-w-2xl md:mt-12">
        <h1 className="mb-1 text-center text-[26px] font-semibold tracking-tight">{greet}, {team[me]?.name.split(" ")[0]}.</h1>
        <p className="mb-6 text-center text-[13px] text-dim">{p.name} · your agent team is ready</p>
        <form onSubmit={submit} className="rounded-xl border border-line bg-panel focus-within:border-white/20">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2} aria-label="What should the factory work on?"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={mode === "build" ? "What should the factory build? Agents plan, code, test and simulate it." : "Ask the world model a what-if question."}
            className="block w-full resize-none bg-transparent px-4 pt-3.5 text-[14px] outline-none placeholder:text-dim" />
          <div className="flex items-center gap-2 px-3 pb-3 pt-1">
            <div className="flex overflow-hidden rounded-md border border-line text-[12px]">
              {(["build", "simulate"] as const).map(m => (
                <button type="button" key={m} onClick={() => setMode(m)}
                  className={`px-2.5 py-1 ${mode === m ? "bg-white/[.08] text-ink" : "text-mute hover:text-ink"}`}>{m === "build" ? "Build" : "Simulate"}</button>
              ))}
            </div>
            <span className="text-[11px] text-dim">{mode === "build" ? "creates a work order and runs the agent team" : "Simulation Agent + world model"}</span>
            <button type="submit" disabled={!live || busy || !text.trim()} aria-label="Send"
              className="ml-auto grid h-7 w-7 place-items-center rounded-full bg-ink text-bg disabled:opacity-30"><ArrowUp size={15} /></button>
          </div>
        </form>
        {err && <p className="mt-2 text-[12px] text-bad">{err}</p>}
        {busy && <p className="mt-2 text-[12px] text-run">Agents are working on {state.status?.running || "a simulation"}…</p>}
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {SUGGEST.map(([m, t]) => (
            <button key={t} onClick={() => { setMode(m); setText(t); }}
              className="rounded-full border border-line px-2.5 py-1 text-[12px] text-mute hover:border-white/20 hover:text-ink">{t}</button>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-14 max-w-5xl">
        <Section title="Your agent team" aside={<a href={`#/p/${p.id}/agents`} className="hover:text-ink">All agents</a>}>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {agents.map(a => {
              const l = live_[a.id];
              const st = l?.state || "idle";
              const t = st === "working" ? "run" : st === "blocked" ? "bad" : l?.done ? "ok" : "idle";
              return (
                <div key={a.id} className={`rounded-lg border bg-panel p-3 ${t === "run" ? "border-run/40" : "border-line"}`}>
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-white/[.05] font-mono text-[11px] text-acc">{AGENT_ICON[a.id] || "◇"}</span>
                    <span className="truncate text-[13px] font-medium">{a.name}</span>
                    <span className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${t === "run" ? "pulse bg-run" : t === "bad" ? "bg-bad" : t === "ok" ? "bg-ok" : "bg-[#2a2f36]"}`} />
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-[2.6em] text-[12px] leading-snug text-mute">{st === "working" ? l?.msg : l?.msg || a.role}</p>
                  <div className="mt-1.5 text-[11px] text-dim">{l ? `${l.done} steps done${l.wo ? ` · ${l.wo}` : ""}` : a.role}</div>
                </div>
              );
            })}
          </div>
        </Section>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Section title="Recent work orders" aside={<a href={`#/p/${p.id}/work-orders`} className="hover:text-ink">View all</a>}>
            <div className="divide-y divide-line rounded-lg border border-line">
              {wos.length ? wos.map(w => (
                <a key={w.id} href={`#/p/${p.id}/work-orders/${w.id}`} className="flex items-center gap-3 px-3 py-2.5 text-[13px] hover:bg-white/[.02]">
                  <span className="font-mono text-[12px] text-dim">{w.id}</span>
                  <span className="min-w-0 flex-1 truncate">{w.title}</span>
                  <Badge>{w.status}</Badge>
                </a>
              )) : <p className="px-3 py-5 text-center text-[13px] text-dim">Ask the factory to build something above.</p>}
            </div>
          </Section>
          <Section title="Connected">
            <ul className="space-y-2 text-[13px]">
              {connected.map(([n, on, what]) => (
                <li key={n} className="flex items-center gap-2.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-ok" : "bg-[#2a2f36]"}`} />
                  <span className={on ? "" : "text-mute"}>{n}</span>
                  <span className="ml-auto text-[12px] text-dim">{on ? what : "add key to connect"}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}

/* ---------- agents ---------- */
function Agents({ state, events, team }: Ctx) {
  const live_ = state.agents || {};
  const agents = state.team.filter(m => m.kind === "agent");
  const [sel, setSel] = useState(agents[0]?.id);
  const steps = [...events].reverse().filter(e => e.agent === sel || (sel === "coder-claude" && e.agent === "coder-claude")).slice(0, 25);
  return (
    <>
      <PageHead title="Agents" sub="The team that does the work. Each agent has one job; people approve, agents execute, and every step is recorded." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <ul className="space-y-1">
          {agents.map(a => {
            const l = live_[a.id];
            return (
              <li key={a.id}>
                <button onClick={() => setSel(a.id)} className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left ${sel === a.id ? "bg-white/[.06]" : "hover:bg-white/[.03]"}`}>
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/[.05] font-mono text-[11px] text-acc">{AGENT_ICON[a.id] || "◇"}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{a.name}</span>
                    <span className="block truncate text-[11px] text-dim">{a.role}</span>
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-dim">{l?.state === "working" ? <span className="text-run">working</span> : l ? `${l.done} done` : "idle"}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <Section title={`${team[sel || ""]?.name || ""} · activity`}>
          {steps.length ? (
            <ol className="space-y-3 border-l border-line pl-4">
              {steps.map((e, i) => (
                <li key={i} className="relative text-[13px]">
                  <span className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${e.state === "blocked" ? "bg-bad" : e.state === "working" ? "bg-run" : "bg-ok"}`} />
                  <div className="text-[11px] text-dim">{e.wo || "world model"} · {ago(Number(e.run) + e.t)}</div>
                  <div className={e.state === "blocked" ? "text-bad" : ""}>{e.msg}</div>
                </li>
              ))}
            </ol>
          ) : <Empty>This agent has not worked yet. Ask the factory to build something on Home.</Empty>}
        </Section>
      </div>
    </>
  );
}

/* ---------- memory (context layer) ---------- */
function Memory({ state, post, getJSON, live }: Ctx) {
  const [data, setData] = useState<{ backend: string; items: MemoryItem[]; hits: MemoryItem[] } | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const load = async (query = "") => setData((await getJSON(`memory?q=${encodeURIComponent(query)}`)) ||
    { backend: state.status?.memory || "local", items: state.memory || [], hits: [] });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const items = data?.hits.length ? data.hits : data?.items || [];
  return (
    <>
      <PageHead title="Memory" sub={<>The organization&apos;s context layer: tickets, meeting notes, chats, emails, code notes and past runs. Agents recall it before every change. Backend: <b className="text-ink">{data?.backend === "HydraDB" ? "HydraDB" : "local (add HYDRADB_API_KEY for HydraDB)"}</b></>}>
        <Button primary onClick={() => setAdding(true)} disabled={!live}><Plus size={14} /> Add memory</Button>
      </PageHead>
      <form onSubmit={e => { e.preventDefault(); load(q); }} className="mb-6 flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ask what the agents would recall, e.g. bigger meal boluses for adults"
            className={inputCls + " pl-8"} aria-label="Search memory" />
        </div>
        <Button type="submit" disabled={!live}>Recall</Button>
      </form>
      {data?.hits.length ? <p className="-mt-3 mb-3 text-[12px] text-dim">Top {data.hits.length} items the agents would read for this request.</p> : null}
      <div className="divide-y divide-line rounded-lg border border-line">
        {items.map(m => (
          <div key={m.id} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="rounded bg-white/[.05] px-1.5 py-0.5 font-mono text-[10px] uppercase text-mute">{m.kind.replace("_", " ")}</span>
              <span className="text-[13px] font-medium">{m.title}</span>
              {m.score !== undefined && <span className="ml-auto font-mono text-[11px] text-dim">relevance {m.score}</span>}
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-mute">{m.text}</p>
          </div>
        ))}
        {!items.length && <p className="px-4 py-6 text-center text-[13px] text-dim">Nothing remembered yet.</p>}
      </div>
      {adding && <AddMemory post={post} onClose={() => { setAdding(false); load(); }} />}
    </>
  );
}

function AddMemory({ post, onClose }: { post: Ctx["post"]; onClose: () => void }) {
  const [kind, setKind] = useState("meeting");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const submit = async (e: React.FormEvent) => { e.preventDefault(); await post("memory", { kind, title, text }); onClose(); };
  return (
    <Modal title="Add to memory" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Type">
          <select className={inputCls} value={kind} onChange={e => setKind(e.target.value)}>
            {["meeting", "chat", "email", "work_order", "code", "safety_finding"].map(k => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
          </select>
        </Field>
        <Field label="Title"><input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="Design review, Nov 14" /></Field>
        <Field label="Content"><textarea rows={5} className={inputCls} value={text} onChange={e => setText(e.target.value)} placeholder="Paste meeting notes, a Slack thread or an email." /></Field>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button primary type="submit">Save</Button></div>
      </form>
    </Modal>
  );
}

/* ---------- requirements ---------- */
function Requirements({ state }: Ctx) {
  const reqsFor = (h: string) => (state.requirements || []).filter(r => r.hazards.includes(h)).map(r => r.id).join(", ");
  return (
    <>
      <PageHead title="Requirements" sub="Hazard log (ISO 14971) and the safety requirements that mitigate each hazard. Imported from the repository; agents cannot edit them." />
      <Section title="Hazards">
        <Table head={["ID", "Hazard", "Severity", "Mitigated by"]} rows={(state.hazards || []).map(h => [
          <b key="i" className="font-mono text-[12px]">{h.id}</b>, h.title, <Badge key="s" tone={h.severity === "S3" ? "FAIL" : "Stopped"}>{h.severity}</Badge>,
          <span key="m" className="font-mono text-[12px] text-mute">{reqsFor(h.id)}</span>])} />
      </Section>
      <Section title="Safety requirements">
        <Table head={["ID", "Requirement", "Hazards", "Code", "Verified by"]} rows={(state.requirements || []).map(r => [
          <b key="i" className="font-mono text-[12px]">{r.id}</b>, r.text, <span key="h" className="font-mono text-[12px] text-mute">{r.hazards.join(", ")}</span>,
          <span key="c" className="font-mono text-[11px] text-mute">{(r.symbols || []).slice(0, 2).join(", ")}</span>,
          <span key="t" className="text-mute">unit test {r.id} · world model</span>])} />
      </Section>
    </>
  );
}

/* ---------- work orders ---------- */
function WOTable({ wos, team, pid }: { wos: WorkOrder[]; team: Record<string, Member>; pid: string }) {
  return (
    <Table head={["ID", "Title", "Status", "Requested by", "Result", "Created"]} empty="No work orders yet."
      rows={wos.map(w => [
        <a key="i" href={`#/p/${pid}/work-orders/${w.id}`} className="font-mono text-[12px] hover:underline">{w.id}</a>,
        <a key="t" href={`#/p/${pid}/work-orders/${w.id}`} className="hover:underline">{w.title}</a>,
        <Badge key="s">{w.status}</Badge>, <Who key="r" m={team[w.requested_by]} />,
        <span key="x" className="text-[12px] text-mute">{w.evidence ? w.evidence.headline.split(";")[0] : "—"}</span>,
        <span key="c" className="text-mute">{ago(w.created)}</span>])} />
  );
}

function WorkOrders({ state, post, team, live }: Ctx) {
  const [open, setOpen] = useState(false);
  const p = state.project!;
  return (
    <>
      <PageHead title="Work Orders" sub="Each work order is built by the agent team and must pass the deterministic gate and the world model before it can merge.">
        <Button primary onClick={() => setOpen(true)} disabled={!live}><Plus size={14} /> New work order</Button>
      </PageHead>
      <WOTable wos={[...(state.work_orders || [])].reverse()} team={team} pid={p.id} />
      {open && <NewWO pid={p.id} post={post} onClose={() => setOpen(false)} />}
    </>
  );
}

function NewWO({ pid, post, onClose }: { pid: string; post: Ctx["post"]; onClose: () => void }) {
  const [title, setTitle] = useState("Let adults take larger meal boluses");
  const [desc, setDesc] = useState("Adults with high insulin needs (carb ratio around 5) cannot cover a large meal with one 10 U bolus.");
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await post("workorders", { project: pid, title, description: desc });
    if (r.error) return setErr(r.error);
    go(`/p/${pid}/work-orders/${r.id}`); onClose();
  };
  return (
    <Modal title="New work order" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Title"><input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} autoFocus /></Field>
        <Field label="Description"><textarea rows={4} className={inputCls} value={desc} onChange={e => setDesc(e.target.value)} /></Field>
        {err && <p className="text-[12px] text-bad">{err}</p>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button primary type="submit">Create</Button></div>
      </form>
    </Modal>
  );
}

const STEPS = [
  ["memory", "Context", "Recall related tickets, meetings, chats and code"],
  ["safety", "Hazard analysis", "Safety Analyst maps the change to hazards"],
  ["planner", "Plan", "Planner prepares the work for the coder"],
  ["coder-claude", "Implementation", "Claude Code writes the change in its own worktree"],
  ["gate", "Requirement tests", "Deterministic gate runs every affected requirement's test"],
  ["world", "World model", "Firmware runs in simulated patients against main"],
  ["evidence", "Evidence pack", "Safety case generated for review"],
  ["reviewer", "Decision", "Merge decision from checks, never from an LLM"],
] as const;

function WorkOrderView({ state, events, post, text, team, id, live }: Ctx & { id: string }) {
  const w = state.work_orders?.find(x => x.id === id);
  const [doc, setDoc] = useState<{ title: string; body: string } | null>(null);
  const [err, setErr] = useState("");
  const mine = useMemo(() => events.filter(e => e.wo === id), [events, id]);
  if (!w) return <p className="text-dim">Work order not found.</p>;
  const lastRun = mine.length ? mine[mine.length - 1].run : null;
  const run = mine.filter(e => e.run === lastRun);
  const step = (agent: string) => [...run].reverse().find(e => e.agent === agent || (agent === "coder-claude" && e.agent.startsWith("coder")));
  const pr = [...run].reverse().find(e => e.pr)?.pr;
  const busy = state.status?.busy;
  const start = async () => { const r = await post("run", { wo: id }); setErr(r.error || ""); };
  const open = async (kind: "evidence" | "diff", title: string) => setDoc({ title, body: await text(`${kind}?wo=${id}`) });

  return (
    <>
      <div className="mb-1 text-[12px] text-dim"><a href={`#/p/${w.project}/work-orders`} className="hover:text-ink">Work Orders</a> / {w.id}</div>
      <PageHead title={w.title} sub={<span className="inline-flex flex-wrap items-center gap-2"><Badge>{w.status}</Badge> requested by <Who m={team[w.requested_by]} /> · {ago(w.created)}</span>}>
        {w.evidence && <Button onClick={() => open("evidence", `Evidence pack · ${w.id}`)}><FileCheck2 size={14} /> Evidence</Button>}
        {w.commits.length > 0 && <Button onClick={() => open("diff", `Code change · ${w.id}`)}><GitBranch size={14} /> Code change</Button>}
        {pr && <Button onClick={() => window.open(pr, "_blank", "noopener")}><GitPullRequest size={14} /> Pull request</Button>}
        <Button primary onClick={start} disabled={!live || busy || w.status === "Running"}><Play size={14} /> {w.status === "Draft" ? "Run" : "Run again"}</Button>
      </PageHead>
      {err && <p className="-mt-3 mb-4 text-[12px] text-bad">{err}</p>}
      {w.description && <p className="mb-6 max-w-3xl text-[13px] text-mute">{w.description}</p>}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Section title="Pipeline">
          <ol className="relative space-y-0 border-l border-line pl-5">
            {STEPS.map(([agent, label, desc]) => {
              const e = step(agent);
              const t = !e ? "idle" : e.state === "working" ? "run" : e.state === "blocked" ? "bad" : "ok";
              return (
                <li key={agent} className="relative pb-4">
                  <span className={`absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 border-bg ${t === "run" ? "pulse bg-run" : t === "bad" ? "bg-bad" : t === "ok" ? "bg-ok" : "bg-[#2a2f36]"}`} />
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-[13px] font-medium ${t === "idle" ? "text-mute" : ""}`}>{label}</span>
                    {e && <span className="font-mono text-[10px] text-dim">{e.t.toFixed(0)}s</span>}
                  </div>
                  <div className={`text-[12px] leading-snug ${t === "bad" ? "text-bad" : "text-dim"}`}>{e?.msg || desc}</div>
                </li>
              );
            })}
          </ol>
        </Section>
        <div className="min-w-0">
          <Section title="World model" aside={w.world ? `${w.world.results.length} simulated patients · grey = main` : undefined}>
            {w.world ? <WorldChart world={w.world} /> : <Empty>Runs after the requirement tests: the candidate firmware drives simulated patients.</Empty>}
          </Section>
          <Section title="Requirement tests">
            {w.gate?.rows.length ? (
              <Table head={["Requirement", "Hazard", "Result"]} rows={w.gate.rows.map(r => [
                <span key="r"><b className="font-mono text-[12px]">{r.id}</b> <span className="text-mute">{r.text}</span></span>,
                <span key="h" className="text-mute">{r.hazards.map(h => `${h.id} ${h.title || ""}`).join("; ")}</span>, <Badge key="x">{r.result}</Badge>])} />
            ) : <Empty>Every requirement the change touches is traced to an executed test.</Empty>}
          </Section>
          <Section title="Activity">
            <AuditTable rows={state.audit.filter(a => a.object === id).slice(0, 12)} team={team} />
          </Section>
        </div>
      </div>
      {doc && <Modal wide title={doc.title} onClose={() => setDoc(null)}>{doc.title.startsWith("Code") ? <Diff src={doc.body} /> : <Markdown src={doc.body} />}</Modal>}
    </>
  );
}

/* ---------- world model ---------- */
function WorldModel({ state, events, post, live }: Ctx) {
  const p = state.project!;
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const latest = [...events].reverse().find(e => e.world?.question)?.world;
  const thinking = state.status?.job === "whatif";
  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    const r = await post("whatif", { text: q });
    setErr(r.error || ""); if (!r.error) setQ("");
  };
  return (
    <>
      <PageHead title="World Model" sub={<>{p.world_model}. The real firmware is compiled and put in the loop: it decides every dose.</>} />
      <form onSubmit={ask} className="mb-8 flex flex-col gap-2 md:flex-row">
        <input value={q} onChange={e => setQ(e.target.value)} className={inputCls + " md:flex-1"} aria-label="Ask the world model"
          placeholder="Ask a what-if, e.g. What if a child eats 80 g and the parent types the dose 10x?" />
        <Button primary type="submit" disabled={!live || state.status?.busy}><FlaskConical size={14} /> Simulate</Button>
      </form>
      {err && <p className="-mt-6 mb-6 text-[12px] text-bad">{err}</p>}
      <Section title={latest?.question ? `“${latest.question}”` : "Latest what-if"} aside={thinking ? "Simulation Agent is building scenarios…" : latest ? "current firmware" : undefined}>
        {latest ? <WorldChart world={latest} /> : <Empty>Ask a question: the Simulation Agent turns it into scenarios and the world model answers.</Empty>}
      </Section>
      <Section title="Gate scenarios" aside="run on every work order">
        <Table head={["Scenario", "What happens", "Blocks when"]} rows={[
          ["Large meal", "120 g meal, user asks for the correct dose; extended bolus if the pump supports it", "any patient newly below 54 mg/dL"],
          ["Decimal slip", "15 g snack, dose typed 10x; user re-enters if the pump rejects it", "any patient newly below 54 mg/dL"],
        ]} />
      </Section>
    </>
  );
}

/* ---------- traceability, audit, team ---------- */
function Traceability({ state }: Ctx) {
  return (
    <>
      <PageHead title="Traceability" sub="Every hazard traced through its safety requirement, the code that implements it and the test that verifies it, to the work orders that changed it and their simulation evidence. Click a node to follow its chain." />
      {state.trace ? <TraceGraph nodes={state.trace.nodes} edges={state.trace.edges} /> : null}
    </>
  );
}

function AuditTable({ rows, team }: { rows: State["audit"]; team: Record<string, Member> }) {
  return (
    <Table head={["When", "Who", "Action", "Object", "Detail"]} empty="No activity yet."
      rows={rows.map(a => [
        <span key="t" className="whitespace-nowrap text-mute" title={new Date(a.ts * 1000).toLocaleString()}>{ago(a.ts)}</span>,
        <Who key="w" m={team[a.actor] || { id: a.actor, name: a.actor, role: "", kind: "human" }} />,
        <span key="a" className="whitespace-nowrap">{a.action === "done" || a.action === "pass" ? "completed" : a.action}</span>,
        <span key="o" className="whitespace-nowrap font-mono text-[12px]">{a.object}</span>,
        <span key="d" className="line-clamp-2 text-[12px] text-mute">{a.detail}</span>])} />
  );
}

function AuditTrail({ state, team }: Ctx) {
  const [f, setF] = useState<"all" | "human" | "agent">("all");
  const rows = state.audit.filter(a => f === "all" || (team[a.actor]?.kind || "human") === f);
  return (
    <>
      <PageHead title="Audit Trail" sub="Who did what, when: people, agents and code commits, in one record (IEC 62304 change control).">
        <div className="flex overflow-hidden rounded-md border border-line text-[12px]">
          {(["all", "human", "agent"] as const).map(k => (
            <button key={k} onClick={() => setF(k)} className={`px-3 py-1.5 capitalize ${f === k ? "bg-white/[.08] text-ink" : "text-mute hover:text-ink"}`}>{k === "all" ? "All" : k + "s"}</button>
          ))}
        </div>
      </PageHead>
      <AuditTable rows={rows} team={team} />
    </>
  );
}

function Team({ state }: Ctx) {
  const part = (k: string) => state.team.filter(m => m.kind === k).map(m => [<Who key="w" m={m} />, <span key="r" className="text-mute">{m.role}</span>]);
  return (
    <>
      <PageHead title="Team" sub="People decide and approve. Agents do the work, and every action is attributed in the audit trail." />
      <Section title="People"><Table head={["Name", "Role"]} rows={part("human")} /></Section>
      <Section title="Agents"><Table head={["Agent", "Responsibility"]} rows={part("agent")} /></Section>
    </>
  );
}

/* ---------- small renderers ---------- */
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-dim">{children}</p>;

function Diff({ src }: { src: string }) {
  return (
    <pre className="scroll-thin overflow-x-auto rounded-md bg-bg p-3 font-mono text-[11.5px] leading-relaxed">
      {src.split("\n").map((l, i) => (
        <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "text-ok" : l.startsWith("-") && !l.startsWith("---") ? "text-bad" : l.startsWith("@@") ? "text-acc" : "text-mute"}>{l || " "}</div>
      ))}
    </pre>
  );
}

function Markdown({ src }: { src: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
    p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith("`") ? <code key={i} className="font-mono text-[11px] text-acc">{p.slice(1, -1)}</code> : p);
  const out: React.ReactNode[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[-|\s]+\|$/.test(lines[i])) rows.push(lines[i].slice(1, -1).split("|").map(c => c.trim()));
        i++;
      }
      i--;
      out.push(<div key={i} className="my-3 overflow-x-auto"><table className="w-full text-[12px]"><tbody>
        {rows.map((r, j) => <tr key={j} className={j ? "border-t border-line" : "text-dim"}>{r.map((c, k) => <td key={k} className="py-1.5 pr-3 align-top">{inline(c)}</td>)}</tr>)}
      </tbody></table></div>);
    } else if (l.startsWith("# ")) out.push(<h1 key={i} className="mb-3 text-lg font-semibold">{l.slice(2)}</h1>);
    else if (l.startsWith("## ")) out.push(<h2 key={i} className="mb-1 mt-5 text-[13px] font-semibold text-mute">{l.slice(3)}</h2>);
    else if (l.startsWith("- ")) out.push(<li key={i} className="ml-4 list-disc text-[13px]">{inline(l.slice(2))}</li>);
    else if (l.trim()) out.push(<p key={i} className="my-1 text-[13px]">{inline(l.replace(/^_|_$/g, ""))}</p>);
  }
  return <div>{out}</div>;
}
