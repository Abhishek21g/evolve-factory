"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowUp, BookCheck, Bot, Check, ChevronsUpDown, Info, Orbit, Boxes, Brain, FileCheck2, FlaskConical, GitBranch, GitPullRequest, Home, ListChecks, Network, Phone, Plus, Play, Search, ShieldAlert, Timer, Users,
} from "lucide-react";
import { useFactoryState, type MemoryView, type Member, type State, type WorkOrder } from "@/lib/api";
import type { Ev } from "@/lib/feed";
import { WorldChart } from "@/components/WorldChart";
import { Traceability } from "@/components/trace/Traceability";
import { AgentIcon, AgentPage, AgentTeam } from "@/components/Agents";
import { CertusMark } from "@/components/CertusMark";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/kit/dropdown-menu";
import { LoopSummary, SimVsWorld, WorldLoopPage } from "@/components/WorldLoop";
import { Automations, SourceOfRecord } from "@/components/Automations";
import { CockpitCallouts } from "@/components/Callouts";
import { Incidents } from "@/components/Hotline";
import { Ago, Avatar, Badge, Button, Field, Modal, PageHead, Replayed, Section, Table, Who, ago, inputCls } from "@/components/ui";

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
  const { state, events, live, post, text, getJSON, base } = useFactoryState(route.project);
  const [me, setMe] = useState("abhishek");
  useEffect(() => { try { setMe(localStorage.getItem("actor") || "abhishek"); } catch { /* private mode */ } }, []);
  const switchMe = (id: string) => { setMe(id); try { localStorage.setItem("actor", id); } catch { /* ignore */ } };

  if (!state) return <div className="min-h-screen" />; // only until this project's state arrives (~20 ms on a live server)
  const team = Object.fromEntries(state.team.map(m => [m.id, m])) as Record<string, Member>;
  const p = route.project && state.project?.id === route.project ? state.project : null;
  const unknown = route.project && !state.projects.some(x => x.id === route.project);
  const ctx = { state, events, live: !!live, post: (path: string, body: object) => post(path, body, me), text, getJSON, team, me, base };

  return (
    <div className="flex min-h-screen">
      <Sidebar state={state} project={unknown ? undefined : route.project || undefined} page={route.page} me={me} setMe={switchMe} live={!!live} />
      <main className="min-w-0 flex-1 px-6 pb-24 pt-8 md:px-10">
        <div className="mx-auto max-w-[1360px]">
        {live === false && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-2.5 text-sm text-mute">
            <Info size={15} className="shrink-0 text-acc" />
            Read-only snapshot of a real run. Clone the repo and run <code className="font-mono text-ink">demo/go.sh</code> to create projects and run work orders.
          </div>
        )}
        {route.project && !p && !unknown ? null :
          !p ? <Projects {...ctx} /> :
          route.page === "requirements" ? <Requirements {...ctx} /> :
          route.page === "work-orders" && route.item ? <WorkOrderView {...ctx} id={route.item} /> :
          route.page === "work-orders" ? <WorkOrders {...ctx} /> :
          route.page === "world-model" ? <WorldModel {...ctx} /> :
          route.page === "world-loop" ? <WorldLoopPage {...ctx} id={route.item} /> :
          route.page === "traceability" ? <Traceability {...ctx} item={route.item} /> :
          route.page === "source-of-record" ? <SourceOfRecord {...ctx} /> :
          route.page === "automations" ? <Automations {...ctx} /> :
          route.page === "incidents" ? <Incidents {...ctx} id={route.item} /> :
          route.page === "audit" ? <AuditTrail {...ctx} /> :
          route.page === "team" ? <Team {...ctx} /> :
          route.page === "agents" && route.item ? <AgentPage {...ctx} id={route.item} /> :
          route.page === "agents" ? <AgentTeam {...ctx} /> :
          route.page === "memory" ? <Memory {...ctx} /> : <HomePage {...ctx} />}
        </div>
      </main>
    </div>
  );
}

type Ctx = { state: State; events: Ev[]; live: boolean; post: (p: string, b: object) => Promise<{ error?: string; id?: string; started?: string }>; text: (p: string) => Promise<string>; getJSON: <T>(p: string) => Promise<T | null>; team: Record<string, Member>; me: string; base: string | null };

/* ---------- sidebar ---------- */
function Sidebar({ state, project, page, me, setMe, live }: { state: State; project?: string; page: string; me: string; setMe: (id: string) => void; live: boolean }) {
  const nav = [
    ["overview", "Home", Home], ["agents", "Agents", Bot], ["memory", "Memory", Brain], null,
    ["requirements", "Requirements", ShieldAlert], ["work-orders", "Work Orders", ListChecks], ["world-loop", "World Model", Orbit], ["world-model", "Simulations", FlaskConical],
    ["traceability", "Traceability", Network], ["source-of-record", "Source of Record", BookCheck], ["automations", "Automations", Timer], ["incidents", "Incidents", Phone], null, ["audit", "Audit Trail", Activity], ["team", "Team", Users],
  ] as const;
  const humans = state.team.filter(m => m.kind === "human");
  const item = (active: boolean) => `group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors ${active ? "bg-white/[.07] text-ink" : "text-mute hover:bg-white/[.04] hover:text-ink"}`;
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-sidebar md:flex">
      <a href="#/" className="flex h-14 items-center gap-2.5 px-4">
        <CertusMark size={28} />
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold tracking-tight">Certus Factory</span>
          <span className="block truncate text-xs text-dim">Software factory for physical AI</span>
        </span>
      </a>
      {project && <ProjectSwitcher state={state} project={project} page={page} />}
      <nav aria-label="Main" className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        <a href="#/" aria-current={!project ? "page" : undefined} className={item(!project)}>
          <Boxes size={16} className="shrink-0" /> All projects
        </a>
        {project && <div className="my-2 h-px bg-line" />}
        {project && nav.map((n, i) => !n ? <div key={i} className="my-2 h-px bg-line" /> : (([k, l, Icon]) => (
          <a key={k} href={`#/p/${project}/${k}`} aria-current={page === k ? "page" : undefined} className={item(page === k)}>
            <Icon size={16} className={`shrink-0 ${page === k ? "text-acc" : ""}`} /> {l}
          </a>
        ))(n))}
      </nav>
      <div className="space-y-2 border-t border-line p-3">
        <div className="flex items-center gap-2 px-1 text-xs text-mute">
          <span className={`size-2 rounded-full ${live ? "bg-ok shadow-[0_0_8px] shadow-ok/60" : "bg-dim"}`} />
          {live ? "Factory online" : "Read-only snapshot"} <span className="text-dim">· memory {state.status?.memory || "local"}</span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Acting as" className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-white/[.04]">
            <Avatar m={humans.find(h => h.id === me)} size={26} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{humans.find(h => h.id === me)?.name}</span>
              <span className="block truncate text-xs text-dim">{humans.find(h => h.id === me)?.role}</span>
            </span>
            <ChevronsUpDown size={14} className="text-dim" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="text-xs text-dim">Acting as</DropdownMenuLabel>
            {humans.map(h => (
              <DropdownMenuItem key={h.id} onSelect={() => setMe(h.id)} className="gap-2.5">
                <Avatar m={h} /> <span className="flex-1">{h.name}</span> {h.id === me && <Check size={14} />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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
          <a key="n" href={`#/p/${p.id}/overview`} className="whitespace-nowrap font-medium hover:underline">{p.name}</a>,
          <span key="d" className="whitespace-nowrap">{state.devices[p.device] || p.device}</span>, <span key="s" className="text-mute">{p.standard}</span>,
          <span key="w" className="text-mute">{p.world_model}</span>, <Who key="o" m={team[p.owner]} />, <span key="c" className="whitespace-nowrap text-mute"><Ago ts={p.created} /></span>,
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
            {Object.entries(state.devices).map(([k, l]) => <option key={k} value={k}>{l} · world model</option>)}
            {soon.map(s => <option key={s} disabled>{s} · world model coming</option>)}
          </select>
        </Field>
        <p className="text-sm text-dim">The factory imports the repository&apos;s hazard log and safety requirements and connects the world model.</p>
        {err && <p className="text-sm text-bad">{err}</p>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button primary type="submit">Create project</Button></div>
      </form>
    </Modal>
  );
}

/* ---------- home: agent-first, like Software Factory ---------- */
const SUGGEST_BY_DEVICE: Record<string, readonly (readonly ["build" | "simulate", string])[]> = {
  "flight-controls": [
    ["build", "Add AoA disagree alert when the two sensors differ by more than 5 degrees"],
    ["simulate", "What if the left AoA vane fails at 30 degrees?"],
    ["simulate", "What if the pilot pulls to a stall in heavy turbulence?"],
  ],
};
const SUGGEST = [
  ["build", "Let adults take larger meal boluses"],
  ["build", "Add an alarm when the extended bolus is interrupted"],
  ["simulate", "What if a child eats 80 g and the parent types the dose 10x?"],
  ["simulate", "What if an adult eats 150 g of carbs?"],
] as const;

function HomePage({ state, post, team, me, live, base }: Ctx) {
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
  const st = state.status;
  const hydra = st?.hydradb || (st?.memory === "HydraDB" ? "connected" : "missing key");
  const comp = st?.composio_status || (st?.composio ? "connected" : "missing key");
  const connected: [string, "ok" | "warn" | "off", React.ReactNode][] = [
    ["Claude Code", "ok", "coding agent"],
    ["8090 Software Factory", st?.software_factory ? "ok" : "off", st?.software_factory ? "work orders via MCP" : "add key to connect"],
    ["HydraDB", hydra === "connected" ? "ok" : hydra === "missing key" ? "off" : "warn",
      { connected: "shared memory, live recall", connecting: "connecting…", "falling back": "unreachable: using local memory", "missing key": "add key to connect" }[hydra]],
    ["Composio", comp === "connected" ? "ok" : comp === "missing key" ? "off" : "warn",
      base === null ? "Connect on the live server"
        : comp === "not connected" ? <a href={`${base}/api/connect/composio`} target="_blank" rel="noopener" className="text-acc hover:underline">Connect GitHub</a>
        : { connected: "files evidence on GitHub", checking: "checking…", error: "unreachable: runs continue", "missing key": "add key to connect" }[comp]],
    ["Vercel", "ok", "hosting"],
  ];
  return (
    <>
      <div className="mx-auto mt-6 max-w-2xl md:mt-12">
        <h1 className="mb-1 text-center text-3xl font-semibold tracking-tight">{greet}, {team[me]?.name.split(" ")[0]}.</h1>
        <p className="mb-6 text-center text-base text-dim">{p.name} · your agent team is ready</p>
        <form onSubmit={submit} className="rounded-xl border border-line bg-panel focus-within:border-white/20">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2} aria-label="What should the factory work on?"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={mode === "build" ? "What should the factory build? Agents plan, code, test and simulate it." : "Ask the world model a what-if question."}
            className="block w-full resize-none bg-transparent px-4 pt-3.5 text-md outline-none placeholder:text-dim" />
          <div className="flex items-center gap-2 px-3 pb-3 pt-1">
            <div className="flex overflow-hidden rounded-md border border-line text-sm">
              {(["build", "simulate"] as const).map(m => (
                <button type="button" key={m} onClick={() => setMode(m)}
                  className={`px-2.5 py-1 ${mode === m ? "bg-white/[.08] text-ink" : "text-mute hover:text-ink"}`}>{m === "build" ? "Build" : "Simulate"}</button>
              ))}
            </div>
            <span className="text-xs text-dim">{mode === "build" ? "creates a work order and runs the agent team" : "Simulation Agent + world model"}</span>
            <button type="submit" disabled={!live || busy || !text.trim()} aria-label="Send"
              className="ml-auto grid h-7 w-7 place-items-center rounded-full bg-ink text-bg disabled:opacity-30"><ArrowUp size={15} /></button>
          </div>
        </form>
        {err && <p className="mt-2 text-sm text-bad">{err}</p>}
        {busy && <p className="mt-2 text-sm text-run">Agents are working on <a href={`#/p/${st?.project || p.id}/${st?.running ? `work-orders/${st.running}` : "world-model"}`} className="underline">{st?.running || "a simulation"}</a>{st?.project && st.project !== p.id ? ` in ${state.projects.find(x => x.id === st.project)?.name || st.project}` : ""}. <a href={`#/p/${st?.project || p.id}/agents`} className="underline">Watch the team</a></p>}
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {(SUGGEST_BY_DEVICE[p.device] || SUGGEST).map(([m, t]) => (
            <button key={t} onClick={() => { setMode(m); setText(t); }}
              className="rounded-full border border-line px-2.5 py-1 text-sm text-mute hover:border-white/20 hover:text-ink">{t}</button>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-14 max-w-5xl">
        <Section title="Your agent team" aside={<a href={`#/p/${p.id}/agents`} className="hover:text-ink">All agents</a>}>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {agents.map(a => {
              const l = live_[a.id];
              const st = l?.state === "working" && !busy ? "idle" : l?.state || "idle";
              const t = st === "working" ? "run" : st === "blocked" ? "bad" : l?.done ? "ok" : "idle";
              return (
                <a key={a.id} href={`#/p/${p.id}/agents/${a.id}`} className={`block rounded-lg border bg-panel p-3 hover:border-white/20 ${t === "run" ? "border-run/40" : "border-line"}`}>
                  <div className="flex items-center gap-2">
                    <AgentIcon id={a.id} size={24} />
                    <span className="truncate text-base font-medium">{a.name}</span>
                    <span className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${t === "run" ? "pulse bg-run" : t === "bad" ? "bg-bad" : t === "ok" ? "bg-ok" : "bg-[#2a2f36]"}`} />
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-[2.6em] text-sm leading-snug text-mute">{l?.msg || a.role}</p>
                  <div className="mt-1.5 text-xs text-dim">{l ? `${st === "working" ? "working" : "idle"} · ${l.done} step${l.done === 1 ? "" : "s"} done${l.wo ? ` · ${l.wo}` : ""}` : "idle · not run yet"}</div>
                </a>
              );
            })}
          </div>
        </Section>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Section title="Recent work orders" aside={<a href={`#/p/${p.id}/work-orders`} className="hover:text-ink">View all</a>}>
            <div className="divide-y divide-line rounded-lg border border-line">
              {wos.length ? wos.map(w => (
                <a key={w.id} href={`#/p/${p.id}/work-orders/${w.id}`} className="flex items-center gap-3 px-3 py-2.5 text-base hover:bg-white/[.02]">
                  <span className="font-mono text-sm text-dim">{w.id}</span>
                  <span className="min-w-0 flex-1 truncate">{w.title}</span>
                  <Badge>{w.status}</Badge>
                </a>
              )) : <p className="px-3 py-5 text-center text-base text-dim">Ask the factory to build something above.</p>}
            </div>
          </Section>
          <Section title="Connected">
            <ul className="space-y-2 text-base">
              {connected.map(([n, tone, what]) => (
                <li key={n} className="flex items-center gap-2.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-run" : "bg-[#2a2f36]"}`} />
                  <span className={tone === "off" ? "text-mute" : ""}>{n}</span>
                  <span className="ml-auto text-sm text-dim">{what}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}

/* ---------- memory (context layer) ---------- */
const COLLS: [string, string][] = [
  ["org_memory", "Tickets, meetings, chats, emails, reviews, code notes"],
  ["regulatory_kb", "Standards and the hazard log, per project"],
  ["factory_lessons", "One lesson per finished work order, written by the factory"],
];
const served = (r?: { backend: string; ms: number } | null) => r?.backend === "HydraDB" ? `HydraDB · ${r.ms} ms` : "local copy (HydraDB unreachable)";

function Memory({ state, post, getJSON, live }: Ctx) {
  const p = state.project!;
  const [data, setData] = useState<MemoryView | null>(null);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [kind, setKind] = useState("");
  const [adding, setAdding] = useState(false);
  const load = async (query = "", everyProject = all) => setData(await getJSON<MemoryView>(
    `memory?q=${encodeURIComponent(query)}${everyProject ? "" : `&project=${p.id}`}`) ||
    { backend: state.status?.memory || "local", items: (state.memory || []).filter(m => everyProject || !m.project || m.project === p.device), hits: [] });
  useEffect(() => { load(q, all); }, [live, all, p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = data?.hits.length ? data.hits : data?.items || [];
  const kinds = Object.entries(base.reduce<Record<string, number>>((m, it) => ({ ...m, [it.kind]: (m[it.kind] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const items = base.filter(m => !kind || m.kind === kind);
  const inv = data?.inventory;
  const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-sm ${on ? "border-white/30 bg-white/[.08] text-ink" : "border-line text-mute hover:text-ink"}`;
  return (
    <>
      <PageHead title="Memory" sub={<>The factory&apos;s context layer in HydraDB: org memory, the regulatory knowledge base and lessons from every finished work order, scoped by project. Agents recall it before every change and write back after every verdict. Backend: <b className="text-ink">{data?.backend === "HydraDB" ? "HydraDB" : state.status?.hydradb === "falling back" ? "local (HydraDB unreachable, retrying)" : "local (add HYDRADB_API_KEY for HydraDB)"}</b></>}>
        <Button primary onClick={() => setAdding(true)} disabled={!live}><Plus size={14} /> Add memory</Button>
      </PageHead>
      <div className="mb-2 grid gap-2.5 sm:grid-cols-3">
        {COLLS.map(([c, desc]) => {
          const n = inv?.collections[c];
          return (
            <div key={c} className="rounded-lg border border-line bg-panel p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm text-ink">{c}</span>
                <span className="text-lg font-semibold tabular-nums">{n ? (all ? n.total : n.projects[p.device] || 0) : "—"}</span>
              </div>
              <p className="mt-0.5 text-xs text-dim">{desc}</p>
              {n && <p className="mt-1.5 line-clamp-1 text-xs text-mute">{Object.entries(n.kinds[all ? "" : p.device] || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(" · ")}</p>}
            </div>
          );
        })}
      </div>
      <p className="mb-6 text-xs text-dim">{inv ? <>Counts {all ? "across all projects" : `for ${p.name}`} served by <b className="text-mute">{served(inv)}</b> · database default-tenant · {inv.backend === "HydraDB" ? `read ${ago(inv.at)}` : "HydraDB counts appear once it answers"}</> : null}</p>
      <form onSubmit={e => { e.preventDefault(); load(q); }} className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={p.device === "flight-controls" ? "Ask what the agents would recall, e.g. AoA disagree alert threshold" : "Ask what the agents would recall, e.g. bigger meal boluses for adults"}
            className={inputCls + " pl-8"} aria-label="Search memory" />
        </div>
        <Button type="submit" disabled={!live}>Recall</Button>
        {data?.hits.length ? <Button onClick={() => { setQ(""); load(""); }}>Clear</Button> : null}
      </form>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button className={chip(!all)} onClick={() => setAll(false)}>{p.name}</button>
        <button className={chip(all)} onClick={() => setAll(true)}>All projects</button>
        <span className="mx-1 h-4 border-l border-line" />
        <button className={chip(!kind)} onClick={() => setKind("")}>All types · {base.length}</button>
        {kinds.map(([k, n]) => <button key={k} className={chip(kind === k)} onClick={() => setKind(kind === k ? "" : k)}>{k.replace("_", " ")} · {n}</button>)}
      </div>
      {data?.hits.length ? <p className="mb-3 text-sm text-dim">Top {data.hits.length} items the agents would read for this request · recalled by <b className="text-ink">{served(data.recall)}</b> from {data.recall?.collections?.join(", ")}</p> : null}
      <div className="divide-y divide-line rounded-lg border border-line">
        {items.map(m => (
          <div key={m.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-white/[.05] px-1.5 py-0.5 font-mono text-2xs uppercase text-mute">{m.kind.replace("_", " ")}</span>
              <span className="text-base font-medium">{m.title}</span>
              {m.synthetic && <span className="rounded border border-line px-1.5 py-px text-2xs text-dim">synthetic</span>}
              <span className="ml-auto flex items-center gap-2 font-mono text-xs text-dim">
                {m.collection || "org_memory"}{m.score !== undefined && <> · relevance {m.score}</>}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-mute">{m.text}</p>
          </div>
        ))}
        {!items.length && <p className="px-4 py-6 text-center text-base text-dim">Nothing remembered yet.</p>}
      </div>
      {adding && <AddMemory post={post} project={p.id} onClose={() => { setAdding(false); setTimeout(() => load(), 300); }} />}
    </>
  );
}

function AddMemory({ post, project, onClose }: { post: Ctx["post"]; project: string; onClose: () => void }) {
  const [kind, setKind] = useState("meeting");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await post("memory", { kind, title, text, project });
    if (r.error) return setErr(r.error);
    onClose();
  };
  return (
    <Modal title="Add to memory" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Type">
          <select className={inputCls} value={kind} onChange={e => setKind(e.target.value)}>
            {["meeting", "chat", "email", "ticket", "review", "work_order", "code", "safety_finding"].map(k => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
          </select>
        </Field>
        <Field label="Title"><input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="Design review, Nov 14" /></Field>
        <Field label="Content"><textarea rows={5} className={inputCls} value={text} onChange={e => setText(e.target.value)} placeholder="Paste meeting notes, a Slack thread or an email." /></Field>
        {err && <p className="text-sm text-bad">{err}</p>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button primary type="submit" disabled={!text.trim()}>Save</Button></div>
      </form>
    </Modal>
  );
}

/* ---------- requirements ---------- */
function Requirements({ state }: Ctx) {
  const open = (id: string) => <a href={`#/p/${state.project!.id}/traceability/${id}`} className="font-mono text-sm font-semibold hover:underline">{id}</a>;
  const reqsFor = (h: string) => (state.requirements || []).filter(r => r.hazards.includes(h)).map(r => r.id).join(", ");
  return (
    <>
      <PageHead title="Requirements" sub={`Hazard log and the safety requirements that mitigate each hazard (${state.project?.standard || "ISO 14971"}). Imported from the repository; agents cannot edit them.`} />
      <Section title="Hazards">
        <Table head={["ID", "Hazard", "Severity", "Mitigated by"]} rows={(state.hazards || []).map(h => [
          <span key="i">{open(h.id)}</span>, h.title, <Badge key="s" tone={["S3", "Catastrophic", "Hazardous"].includes(h.severity || "") ? "FAIL" : "Stopped"}>{h.dal ? `${h.severity} · DAL ${h.dal}` : h.severity}</Badge>,
          <span key="m" className="font-mono text-sm text-mute">{reqsFor(h.id)}</span>])} />
      </Section>
      <Section title="Safety requirements">
        <Table head={["ID", "Requirement", "Hazards", "Code", "Verified by"]} rows={(state.requirements || []).map(r => [
          <span key="i">{open(r.id)}</span>, r.text, <span key="h" className="font-mono text-sm text-mute">{r.hazards.join(", ")}</span>,
          <span key="c" className="font-mono text-xs text-mute">{(r.symbols || []).slice(0, 2).join(", ")}</span>,
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
        <a key="i" href={`#/p/${pid}/work-orders/${w.id}`} className="font-mono text-sm hover:underline">{w.id}</a>,
        <a key="t" href={`#/p/${pid}/work-orders/${w.id}`} className="hover:underline">{w.title}</a>,
        <Badge key="s">{w.status}</Badge>, <Who key="r" m={team[w.requested_by]} />,
        <span key="x" className="text-sm text-mute">{w.evidence ? w.evidence.headline.split(";")[0] : "—"}</span>,
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
        {err && <p className="text-sm text-bad">{err}</p>}
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
  const past = [...run].reverse().find(e => e.lessons && e.agent === "planner");
  const busy = state.status?.busy;
  const start = async () => { const r = await post("run", { wo: id }); setErr(r.error || ""); };
  const open = async (kind: "evidence" | "diff", title: string) => setDoc({ title, body: await text(`${kind}?wo=${id}`) });

  return (
    <>
      <div className="mb-1 text-sm text-dim"><a href={`#/p/${w.project}/work-orders`} className="hover:text-ink">Work Orders</a> / {w.id}</div>
      <PageHead title={w.title} sub={<span className="inline-flex flex-wrap items-center gap-2"><Badge>{w.status}</Badge> requested by <Who m={team[w.requested_by]} /> · {ago(w.created)} <Replayed r={run.find(e => e.replay)?.replay} /></span>}>
        {w.evidence && <Button onClick={() => open("evidence", `Evidence pack · ${w.id}`)}><FileCheck2 size={14} /> Evidence</Button>}
        {w.commits.length > 0 && <Button onClick={() => open("diff", `Code change · ${w.id}`)}><GitBranch size={14} /> Code change</Button>}
        {w.world && <Button onClick={() => go(`/p/${w.project}/world-loop/${w.id}`)}><Orbit size={14} /> World model loop</Button>}
        {pr && <Button onClick={() => window.open(pr, "_blank", "noopener")}><GitPullRequest size={14} /> Pull request</Button>}
        <Button primary onClick={start} disabled={!live || busy || w.status === "Running"}><Play size={14} /> {w.status === "Draft" ? "Run" : "Run again"}</Button>
      </PageHead>
      {err && <p className="-mt-3 mb-4 text-sm text-bad">{err}</p>}
      {w.description && <p className="mb-6 max-w-3xl text-base text-mute">{w.description}</p>}

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
                    <a href={`#/p/${w.project}/agents/${agent}`} className={`text-base font-medium hover:underline ${t === "idle" ? "text-mute" : ""}`}>{label}</a>
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
          <Section title="Simulation: candidate firmware vs main" aside="world model">
            {w.world ? <WorldChart world={w.world} /> : step("gate")?.state === "working"
              ? <Empty>Simulating the candidate firmware in the world model…</Empty>
              : <Empty>Runs with the requirement tests: the candidate firmware is compiled into the world model and every simulated run is compared with main.</Empty>}
          </Section>
          <Section title="Requirement tests">
            {w.gate?.rows.length ? (
              <Table head={["Requirement", "Hazard", "Result"]} rows={w.gate.rows.map(r => [
                <span key="r"><b className="font-mono text-sm">{r.id}</b> <span className="text-mute">{r.text}</span></span>,
                <span key="h" className="text-mute">{r.hazards.map(h => `${h.id} ${h.title || ""}`).join("; ")}</span>, <Badge key="x">{r.result}</Badge>])} />
            ) : <Empty>Every requirement the change touches is traced to an executed test.</Empty>}
          </Section>
          <Section title="Activity">
            <AuditTable rows={state.audit.filter(a => a.object === id).slice(0, 12)} team={team} pid={w.project} />
          </Section>
        </div>
      </div>
      {doc && <Modal wide title={doc.title} onClose={() => setDoc(null)}>{doc.title.startsWith("Code") ? <Diff src={doc.body} /> : <Markdown src={doc.body} />}</Modal>}
    </>
  );
}

/* ---------- world model: simulations ---------- */
function WorldModel({ state, events, post, live, getJSON }: Ctx) {
  const p = state.project!;
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const air = p.device === "flight-controls";
  const latestEv = [...events].reverse().find(e => e.world?.question && (e.world.kind === "aircraft") === air);
  const latest = latestEv?.world;
  const plan = events.find(e => e.run === latestEv?.run && e.agent === "simulation" && e.state === "done");
  const thinking = state.status?.job === "whatif" && state.status.project === p.id;
  const nowRun = [...events].reverse().find(e => e.agent === "simulation")?.run;
  const now = thinking ? [...events].reverse().find(e => e.run === nowRun && !e.wo) : undefined;
  const woSim = [...(state.work_orders || [])].reverse().find(w => w.world);
  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    const r = await post("whatif", { text: q, project: p.id });
    setErr(r.error || ""); if (!r.error) setQ("");
  };
  return (
    <>
      <PageHead title="Simulations" sub={<>World model: {p.world_model}. Each simulation compiles the real firmware and puts it in the loop: it decides every action, step by step, in every simulated run.</>} />
      <SimVsWorld air={air} />
      <LoopSummary state={state} events={events} live={live} getJSON={getJSON} />
      <CockpitCallouts getJSON={getJSON} device={p.device} wkey={woSim?.id} tick={`${events.length}-${live}`} />
      <form onSubmit={ask} className="mb-8 flex flex-col gap-2 md:flex-row">
        <input value={q} onChange={e => setQ(e.target.value)} className={inputCls + " md:flex-1"} aria-label="Ask the world model"
          placeholder={air ? "Ask a what-if, e.g. What if the left AoA vane fails at 30 degrees?" : "Ask a what-if, e.g. What if a child eats 80 g and the parent types the dose 10x?"} />
        <Button primary type="submit" disabled={!live || state.status?.busy}><FlaskConical size={14} /> Simulate</Button>
      </form>
      {err && <p className="-mt-6 mb-6 text-sm text-bad">{err}</p>}
      {thinking && (
        <p className="-mt-4 mb-6 flex items-center gap-2 rounded-md border border-run/30 bg-run/5 px-3 py-2 text-sm text-run">
          <span className="pulse h-1.5 w-1.5 rounded-full bg-run" />{now?.msg || "Simulation Agent is planning scenarios"}
        </p>
      )}
      <Section title={latest?.question ? `What-if: “${latest.question}”` : "Latest what-if"} aside={latestEv?.replay ? <Replayed r={latestEv.replay} /> : latest ? "current firmware" : undefined}>
        {plan && <p className="mb-3 line-clamp-1 text-sm text-mute" title={plan.msg}><span className="text-dim">Simulation Agent plan:</span> {plan.msg}</p>}
        {latest ? <WorldChart world={latest} /> : <Empty>Ask a question: the Simulation Agent turns it into scenarios and the world model answers.</Empty>}
      </Section>
      <CockpitCallouts getJSON={getJSON} device={p.device} kind="whatif" wkey={p.id} tick={`${events.length}-${live}`} />
      {woSim?.world && (
        <Section title={`Latest work order: ${woSim.id} · ${woSim.title}`} aside={<a href={`#/p/${p.id}/work-orders/${woSim.id}`} className="hover:text-ink">Open work order</a>}>
          <WorldChart world={woSim.world} />
        </Section>
      )}
      {air ? (
        <Section title="Gate scenarios" aside="run on every work order · 6 aircraft configs each · 60 s">
          <Table head={["Scenario", "What happens", "Blocks when"]} rows={[
            ["Sideslip stall", "Idle thrust, pilot pulls toward 16 deg AoA; a sideslip splits the two AoA vanes by 5.3 deg", "any flight newly above the 15 deg stall AoA"],
            ["Vane failure", "Left AoA vane fails at 22 deg in a climb", "any flight newly stalling or losing > 300 ft"],
            ["Turbulence", "Moderate vertical gusts at cruise", "any flight newly stalling or losing > 300 ft"],
          ]} />
        </Section>
      ) : (
        <Section title="Gate scenarios" aside="run on every work order · 10 virtual adults each · 12 h">
          <Table head={["Scenario", "What happens", "Blocks when"]} rows={[
            ["Large meal", "120 g meal, user asks for the correct dose; extended bolus if the pump supports it", "any patient newly below 54 mg/dL"],
            ["Decimal slip", "15 g snack, dose typed 10x; user re-enters if the pump rejects it", "any patient newly below 54 mg/dL"],
          ]} />
        </Section>
      )}
    </>
  );
}

/* ---------- audit, team ---------- */
function AuditTable({ rows, team, pid }: { rows: State["audit"]; team: Record<string, Member>; pid: string }) {
  return (
    <Table head={["When", "Who", "Action", "Object", "Detail"]} empty="No activity yet."
      rows={rows.map(a => [
        <span key="t" className="whitespace-nowrap text-mute" title={new Date(a.ts * 1000).toLocaleString()}>{ago(a.ts)}</span>,
        team[a.actor]?.kind === "agent" ? <a key="w" href={`#/p/${pid}/agents/${a.actor}`} className="hover:underline"><Who m={team[a.actor]} /></a>
          : <Who key="w" m={team[a.actor] || { id: a.actor, name: a.actor, role: "", kind: "human" }} />,
        <span key="a" className="whitespace-nowrap">{a.action === "done" || a.action === "pass" ? "completed" : a.action}</span>,
        <span key="o" className="whitespace-nowrap font-mono text-sm">{a.object}</span>,
        <span key="d" className="line-clamp-2 text-sm text-mute">{a.detail}</span>])} />
  );
}

function AuditTrail({ state, team }: Ctx) {
  const [f, setF] = useState<"all" | "human" | "agent">("all");
  const rows = state.audit.filter(a => f === "all" || (team[a.actor]?.kind || "human") === f);
  return (
    <>
      <PageHead title="Audit Trail" sub={`Who did what, when: people, agents and code commits, in one record (${state.project!.standard.split(" · ")[0]} change control).`}>
        <div className="flex overflow-hidden rounded-md border border-line text-sm">
          {(["all", "human", "agent"] as const).map(k => (
            <button key={k} onClick={() => setF(k)} className={`px-3 py-1.5 capitalize ${f === k ? "bg-white/[.08] text-ink" : "text-mute hover:text-ink"}`}>{k === "all" ? "All" : k + "s"}</button>
          ))}
        </div>
      </PageHead>
      <AuditTable rows={rows} team={team} pid={state.project!.id} />
    </>
  );
}

function Team({ state }: Ctx) {
  const pid = state.project!.id;
  const part = (k: string) => state.team.filter(m => m.kind === k).map(m => [
    k === "agent" ? <a key="w" href={`#/p/${pid}/agents/${m.id}`} className="hover:underline"><Who m={m} /></a> : <Who key="w" m={m} />,
    <span key="r" className="text-mute">{m.role}</span>]);
  return (
    <>
      <PageHead title="Team" sub="People decide and approve. Agents do the work, and every action is attributed in the audit trail." />
      <Section title="People"><Table head={["Name", "Role"]} rows={part("human")} /></Section>
      <Section title="Agents" aside={<a href={`#/p/${pid}/agents`} className="hover:text-ink">Open the agent team</a>}><Table head={["Agent", "Responsibility"]} rows={part("agent")} /></Section>
    </>
  );
}

/* ---------- small renderers ---------- */
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-base text-dim">{children}</p>;

function Diff({ src }: { src: string }) {
  return (
    <pre className="scroll-thin overflow-x-auto rounded-md bg-bg p-3 font-mono text-xs leading-relaxed">
      {src.split("\n").map((l, i) => (
        <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "text-ok" : l.startsWith("-") && !l.startsWith("---") ? "text-bad" : l.startsWith("@@") ? "text-acc" : "text-mute"}>{l || " "}</div>
      ))}
    </pre>
  );
}

function Markdown({ src }: { src: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
    p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith("`") ? <code key={i} className="font-mono text-xs text-acc">{p.slice(1, -1)}</code> : p);
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
      out.push(<div key={i} className="my-3 overflow-x-auto"><table className="w-full text-sm"><tbody>
        {rows.map((r, j) => <tr key={j} className={j ? "border-t border-line" : "text-dim"}>{r.map((c, k) => <td key={k} className="py-1.5 pr-3 align-top">{inline(c)}</td>)}</tr>)}
      </tbody></table></div>);
    } else if (l.startsWith("# ")) out.push(<h1 key={i} className="mb-3 text-lg font-semibold">{l.slice(2)}</h1>);
    else if (l.startsWith("## ")) out.push(<h2 key={i} className="mb-1 mt-5 text-base font-semibold text-mute">{l.slice(3)}</h2>);
    else if (l.startsWith("- ")) out.push(<li key={i} className="ml-4 list-disc text-base">{inline(l.slice(2))}</li>);
    else if (l.trim()) out.push(<p key={i} className="my-1 text-base">{inline(l.replace(/^_|_$/g, ""))}</p>);
  }
  return <div>{out}</div>;
}
