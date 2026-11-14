"use client";
import { useEffect, useState } from "react";
import {
  Activity, BookCheck, Bot, Info, Orbit, Boxes, Brain, FlaskConical, Home, ListChecks, Network, Package, Phone, Plus, Radar, Search, ShieldAlert, Timer, Users, Wallet,
} from "lucide-react";
import { useFactoryState, type MemoryItem, type MemoryView, type Member, type State } from "@/lib/api";
import { go, type Ctx } from "@/lib/ctx";
import { AuditTable } from "@/components/common";
import { HomePage } from "@/components/pages/Home";
import { WorldModel } from "@/components/pages/Simulations";
import { WorkOrderView, WorkOrders } from "@/components/pages/WorkOrders";
import { Traceability } from "@/components/trace/Traceability";
import { AgentPage, AgentTeam } from "@/components/Agents";
import { CertusMark } from "@/components/CertusMark";
import { UserMenu } from "@/components/auth/UserMenu";
import { Integrations } from "@/components/integrations/Integrations";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { WorldLoopPage } from "@/components/WorldLoop";
import { Automations, SourceOfRecord } from "@/components/Automations";
import { Incidents } from "@/components/Hotline";
import { Ago, Badge, Button, Field, LOCAL_ONLY, Modal, PageHead, Section, Table, Who, ago, inputCls } from "@/components/ui";
import { AllTowers, ControlTower } from "@/components/supply/ControlTower";
import { Finance } from "@/components/supply/Finance";
import { SupplyChain } from "@/components/supply/SupplyChain";

/* ---------- routing: #/p/<project>/<page>[/<wo>] ---------- */
function useRoute() {
  const [hash, setHash] = useState("");
  useEffect(() => {
    const f = () => {
      // Suppliers is part of Supply Chain now: old links (#/p/<id>/suppliers[/<supplier>]) land on the merged page.
      const old = location.hash.match(/^#\/p\/([^/]+)\/suppliers(?:\/([^/]+))?$/);
      if (old) history.replaceState(null, "", `#/p/${old[1]}/supply-chain/${old[2] || "suppliers"}`);
      setHash(location.hash.slice(1));
    };
    f(); addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  if (hash.startsWith("/settings/")) return { project: "", page: hash.split("/")[2], item: "" };
  const [, , project = "", page = "overview", item = ""] = (hash || "/").split("/");
  return { project: hash.startsWith("/p/") ? project : "", page: hash === "/control-tower" ? "control-tower" : page, item };
}

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
  const ctx = { state, events, live: !!live, checking: live === null, post: (path: string, body: object) => post(path, body, me), text, getJSON, team, me, base };

  return (
    <div className="flex min-h-screen">
      <Sidebar state={state} project={unknown ? undefined : route.project || undefined} page={route.page} me={me} setMe={switchMe} live={!!live} />
      <main className="min-w-0 flex-1 px-6 pb-24 pt-8 md:px-10">
        <div key={route.project} className="mx-auto max-w-[1360px]">
        {route.project && !p && !unknown ? null :
          route.page === "integrations" ? <Integrations {...ctx} /> :
          !p ? (route.page === "control-tower" ? <AllTowers {...ctx} /> : <Projects {...ctx} />) :
          route.page === "control-tower" ? <ControlTower {...ctx} /> :
          route.page === "supply-chain" ? <SupplyChain {...ctx} item={route.item} /> :
          route.page === "finance" ? <Finance {...ctx} /> :
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

/* ---------- sidebar ---------- */
function Sidebar({ state, project, page, me, setMe, live }: { state: State; project?: string; page: string; me: string; setMe: (id: string) => void; live: boolean }) {
  const nav = [
    ["control-tower", "Control Tower", Radar], ["overview", "Home", Home], ["agents", "Agents", Bot], ["memory", "Memory", Brain], null,
    ["requirements", "Requirements", ShieldAlert], ["work-orders", "Work Orders", ListChecks], ["world-loop", "World Model", Orbit], ["world-model", "Simulations", FlaskConical],
    ["traceability", "Traceability", Network], ["source-of-record", "Source of Record", BookCheck], ["automations", "Automations", Timer], ["incidents", "Incidents", Phone], null,
    ["supply-chain", "Supply Chain", Package], ["finance", "Finance", Wallet], null, ["audit", "Audit Trail", Activity], ["team", "Team", Users],
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
        <a href="#/" aria-current={!project && page !== "control-tower" ? "page" : undefined} className={item(!project && page !== "control-tower")}>
          <Boxes size={16} className="shrink-0" /> All projects
        </a>
        {!project && (
          <a href="#/control-tower" aria-current={page === "control-tower" ? "page" : undefined} className={item(page === "control-tower")}>
            <Radar size={16} className={`shrink-0 ${page === "control-tower" ? "text-acc" : ""}`} /> Control Tower
          </a>
        )}
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
          {live ? "Factory online" : "Demo workspace"} <span className="text-dim">· memory {state.status?.memory || "local"}</span>
        </div>
        <UserMenu humans={humans} me={me} setMe={setMe} team={state.team} active={page === "integrations"}
          integrations={project ? `#/p/${project}/integrations` : "#/settings/integrations"} />
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
        <Button primary onClick={() => setOpen(true)} disabled={!live && !state.status?.hosted}><Plus size={14} /> New project</Button>
      </PageHead>
      {state.projects.length ? (
        <div className="grid gap-3">
          {state.projects.map(p => {
            const air = p.device === "flight-controls";
            return (
              <a key={p.id} href={`#/p/${p.id}/overview`} aria-label={`Open ${p.name}`}
                className="group relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 overflow-hidden rounded-xl border border-line bg-panel px-5 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-acc/40 hover:bg-white/[.03] hover:shadow-[0_8px_30px_-12px] hover:shadow-acc/30 focus-visible:border-acc/60 focus-visible:outline-none">
                <span className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-acc opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                <span className="grid size-11 place-items-center rounded-lg border border-line bg-bg text-xl transition-colors group-hover:border-acc/40" aria-hidden>{air ? "✈" : "◉"}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-lg font-semibold tracking-tight">{p.name}</span>
                    <span className="rounded border border-line px-1.5 py-0.5 text-xs text-mute">{state.devices[p.device] || p.device}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-mute">{p.standard}</span>
                  <span className="mt-0.5 block truncate text-sm text-dim">{p.world_model}</span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="hidden text-right text-sm text-mute md:block"><Who m={team[p.owner]} /><span className="mt-1 block text-xs text-dim"><Ago ts={p.created} /></span></span>
                  <span className="grid size-8 place-items-center rounded-full border border-line text-mute transition-all duration-200 group-hover:translate-x-0.5 group-hover:border-acc/50 group-hover:bg-acc group-hover:text-bg" aria-hidden>→</span>
                </span>
              </a>
            );
          })}
        </div>
      ) : <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-mute">No projects yet. Create one to import its hazard log and start work orders.</p>}
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

/* ---------- memory (context layer) ---------- */
const COLLS: [string, string][] = [
  ["org_memory", "Tickets, meetings, chats, emails, reviews, code notes"],
  ["regulatory_kb", "Standards and the hazard log, per project"],
  ["factory_lessons", "One lesson per finished work order, written by the factory"],
];
/** Hosted (no factory server, so no HydraDB to ask): rank the exported items by how many words of the request they
 *  contain. The page says it is a keyword search over the snapshot. */
const keywordHits = (items: MemoryItem[], q: string) => {
  const words = q.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  const n = (m: MemoryItem) => words.filter(w => `${m.title} ${m.text}`.toLowerCase().includes(w)).length;
  return items.filter(n).sort((a, b) => n(b) - n(a)).slice(0, 8);
};
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
        <Button primary onClick={() => setAdding(true)} disabled={!live} title={live ? undefined : LOCAL_ONLY}><Plus size={14} /> Add memory</Button>
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
      <form onSubmit={e => { e.preventDefault(); if (live) load(q); else setData(d => d && { ...d, hits: keywordHits(d.items, q), recall: null }); }} className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={p.device === "flight-controls" ? "Ask what the agents would recall, e.g. AoA disagree alert threshold" : "Ask what the agents would recall, e.g. bigger meal boluses for adults"}
            className={inputCls + " pl-8"} aria-label="Search memory" />
        </div>
        <Button type="submit" disabled={!q.trim()}>Recall</Button>
        {data?.hits.length ? <Button onClick={() => { setQ(""); load(""); }}>Clear</Button> : null}
      </form>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button aria-pressed={!all} className={chip(!all)} onClick={() => setAll(false)}>{p.name}</button>
        <button aria-pressed={all} className={chip(all)} onClick={() => setAll(true)}>All projects</button>
        <span className="mx-1 h-4 border-l border-line" />
        <button aria-pressed={!kind} className={chip(!kind)} onClick={() => setKind("")}>All types · {base.length}</button>
        {kinds.map(([k, n]) => <button key={k} aria-pressed={kind === k} className={chip(kind === k)} onClick={() => setKind(kind === k ? "" : k)}>{k.replace("_", " ")} · {n}</button>)}
      </div>
      {data?.hits.length ? <p className="mb-3 text-sm text-dim">{live || data.recall ? <>Top {data.hits.length} items the agents would read for this request · recalled by <b className="text-ink">{served(data.recall)}</b> from {data.recall?.collections?.join(", ")}</>
        : <>{data.hits.length} snapshot items containing words of this request · keyword search in your browser; HydraDB recall runs on the local factory server</>}</p> : null}
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
function Requirements({ state, post, live }: Ctx) {
  const [adding, setAdding] = useState(false);
  const open = (id: string) => <a href={`#/p/${state.project!.id}/traceability/${id}`} className="whitespace-nowrap font-mono text-sm font-semibold hover:underline">{id}</a>;
  const reqs = state.requirements || [];
  const fixes = Object.fromEntries((state.trace?.hazards || []).map(h => [h.id, h.fixes || []]));
  const mitigatedBy = (h: string) => {
    const ids = reqs.filter(r => r.hazards.includes(h)).map(r => r.id);
    if (ids.length) return <span className="font-mono text-sm text-mute">{ids.join(", ")}</span>;
    return fixes[h]?.length
      ? <span className="text-sm text-mute">{fixes[h].map(w => <a key={w} href={`#/p/${state.project!.id}/work-orders/${w}`} className="font-mono hover:text-ink hover:underline">{w}</a>)} (approved fix, no requirement yet)</span>
      : <span className="text-sm text-bad">none</span>;
  };
  const dal = reqs.some(r => r.dal);
  const gh = state.trace?.github;
  const doc = (anchor: string, label: string) => gh?.repo
    ? <a key={anchor} href={`${gh.repo}/blob/${gh.sha}/docs/TRACEABILITY.md#${anchor}`} target="_blank" rel="noopener" className="text-acc hover:underline">{label}</a> : label;
  return (
    <>
      <PageHead title="Requirements" sub={<>Hazard log and the safety requirements that mitigate each hazard ({state.project?.standard || "ISO 14971"}). Imported from the repository; agents cannot edit them. People can propose new ones.
        {dal && <> How each level and objective maps to trace evidence: {doc("development-assurance-levels", "assurance levels")}, {doc("arp4754a-development-assurance-level-assignment", "ARP4754A")}, {doc("do-178c-annex-a-objectives", "DO-178C objectives")}, {doc("faa-stages-of-involvement-soi-1-4", "SOI 1-4")}, {doc("do-254-airborne-electronic-hardware", "DO-254")}.</>}</>}>
        <Button primary onClick={() => setAdding(true)} disabled={!live && !state.status?.hosted}><Plus size={14} /> New requirement</Button>
      </PageHead>
      <Section title="Hazards">
        <Table head={["ID", "Hazard", "Severity", "Mitigated by"]} rows={(state.hazards || []).map(h => [
          <span key="i">{open(h.id)}</span>, h.title, <Badge key="s" tone={["S3", "Catastrophic", "Hazardous"].includes(h.severity || "") ? "FAIL" : "Stopped"}>{h.dal ? `${h.severity} · DAL ${h.dal}` : h.severity}</Badge>,
          <span key="m">{mitigatedBy(h.id)}</span>])} />
      </Section>
      <Section title="Safety requirements">
        <Table head={["ID", "Requirement", "Hazards", ...(dal ? ["DAL", "DO-178C objectives"] : []), "Code", "Verified by"]} rows={reqs.map(r => [
          <span key="i">{open(r.id)}</span>, r.text, <span key="h" className="font-mono text-sm text-mute">{r.hazards.join(", ")}</span>,
          ...(dal ? [<span key="d" className="whitespace-nowrap text-sm">{r.dal ? `DAL ${r.dal}` : ""}</span>,
            <span key="o" className="text-sm text-mute">{(r.objectives || []).join(" · ")}</span>] : []),
          <span key="c" className="font-mono text-xs text-mute">{(r.symbols || []).slice(0, 2).join(", ")}</span>,
          <span key="t" className="text-mute">{(r as { proposed?: boolean }).proposed || !r.symbols ? <Badge tone="Stopped">proposed</Badge> : `unit test ${r.id} · world model`}</span>])} />
      </Section>
      {adding && <NewRequirement state={state} post={post} onClose={() => setAdding(false)} />}
    </>
  );
}

function NewRequirement({ state, post, onClose }: { state: State; post: Ctx["post"]; onClose: () => void }) {
  const p = state.project!;
  const [text, setText] = useState("");
  const [hz, setHz] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await post("requirements", { project: p.id, text, hazards: hz.join(",") });
    if (r.error) return setErr(r.error);
    onClose();
  };
  return (
    <Modal title={`New requirement · ${p.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Requirement"><textarea rows={3} className={inputCls} value={text} onChange={e => setText(e.target.value)} autoFocus
          placeholder="e.g. An extended bolus never delivers more than 10 U in any 60 minutes" /></Field>
        <Field label="Mitigates hazards">
          <div className="flex flex-wrap gap-1.5">
            {(state.hazards || []).map(h => {
              const on = hz.includes(h.id);
              return (
                <button type="button" key={h.id} onClick={() => setHz(on ? hz.filter(x => x !== h.id) : [...hz, h.id])} aria-pressed={on}
                  className={`rounded-md border px-2 py-1 text-sm ${on ? "border-acc/50 bg-acc/10 text-ink" : "border-line text-mute hover:text-ink"}`}>
                  <span className="font-mono">{h.id}</span> {h.title}
                </button>
              );
            })}
          </div>
        </Field>
        <p className="text-sm text-dim">Proposed requirements are traced and recorded in the audit trail. A person merges them into the source of record.</p>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button primary type="submit" disabled={!text.trim()}>Add requirement</Button></div>
      </form>
    </Modal>
  );
}

/* ---------- audit, team ---------- */
function AuditTrail({ state, team }: Ctx) {
  const [f, setF] = useState<"all" | "human" | "agent">("all");
  const rows = state.audit.filter(a => f === "all" || (team[a.actor]?.kind || "human") === f);
  return (
    <>
      <PageHead title="Audit Trail" sub={`Who did what, when: people, agents and code commits, in one record (${state.project!.standard.split(" · ")[0]} change control).`}>
        <div className="flex overflow-hidden rounded-md border border-line text-sm">
          {(["all", "human", "agent"] as const).map(k => (
            <button key={k} aria-pressed={f === k} onClick={() => setF(k)} className={`px-3 py-1.5 capitalize ${f === k ? "bg-white/[.08] text-ink" : "text-mute hover:text-ink"}`}>{k === "all" ? "All" : k + "s"}</button>
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
