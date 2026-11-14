"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ev, Gate, World } from "./feed";
import type { Trace } from "./trace";
import { chips, closest, finished, noMatch, playedAudit, playedWo, reached, replayed, rewrite, roster, verdicts, type Played, type Recording } from "./replay";
import snapshot from "../../public/snapshot.json";

export type Member = { id: string; name: string; role: string; kind: "human" | "agent" };
export type Project = { id: string; name: string; device: string; repo: string; standard: string; world_model: string; created: number; owner: string };
export type Hazard = { id: string; title: string; severity?: string; dal?: string };
export type Requirement = { id: string; text: string; hazards: string[]; symbols?: string[]; test?: string; dal?: string; objectives?: string[] };
export type WorkOrder = {
  id: string; project: string; title: string; description: string; created: number; requested_by: string;
  status: "Draft" | "Running" | "Approved" | "Blocked" | "Stopped" | "Not run";
  gate?: Gate | null; world?: World | null;
  evidence?: { decision: string; headline: string } | null;
  commits: { sha: string; author: string; ts: string; subject: string }[];
};
export type Audit = { ts: number; actor: string; action: string; object: string; detail: string; asked?: string };
export type AgentLive = { id: string; done: number; blocked: number; msg: string; state: string; ts: number; wo: string | null };
export type MemoryItem = { id: string; kind: string; title: string; text: string; score?: number; project?: string; collection?: string; synthetic?: boolean };
/** kinds: per project (device id), "" = all projects. */
type Counts = { total: number; kinds: Record<string, Record<string, number>>; projects: Record<string, number> };
/** GET /api/memory: the project's memory, a live recall, and per-collection counts read from HydraDB. */
export type MemoryView = {
  backend: string; items: MemoryItem[]; hits: MemoryItem[]; project?: string | null;
  recall?: { backend: string; ms: number; collections?: string[] } | null;
  inventory?: { backend: string; ms: number; at: number; collections: Record<string, Counts> };
};
export type State = {
  team: Member[]; devices: Record<string, string>; projects: Project[]; project: Project | null;
  hazards?: Hazard[]; requirements?: Requirement[]; work_orders?: WorkOrder[]; audit: Audit[];
  /** Older runs and drafts of a request a later work order replaces (factory/store.py superseded): not listed, still open by id. */
  archived_work_orders?: (WorkOrder & { superseded_by: string })[];
  trace?: Trace;
  agents?: Record<string, AgentLive>; memory?: MemoryItem[];
  status?: {
    online: boolean; busy: boolean; job: string | null; running: string | null; project?: string | null; memory: string; composio: boolean; software_factory: boolean; replay?: boolean;
    /** Hosted site (no server): the composer plays recorded runs in the browser (web/src/lib/replay.ts). */
    hosted?: boolean;
    hydradb?: "connected" | "connecting" | "falling back" | "missing key";
    composio_status?: "connected" | "not connected" | "checking" | "error" | "missing key";
    elevenlabs?: "connected" | "no agent" | "missing key";
    /** gate/verdict.py status(): which engine decides verdicts and its parity with the Python reference on recorded runs. */
    gate?: { engine: "rust" | "python"; cases: number; same: number; source: string };
  };
};

/** Where the factory server may be: same origin, NEXT_PUBLIC_FACTORY_URL, or the default local port. A hosted page
 *  probes localhost only when opened with ?live: otherwise the browser asks every visitor for local-network access. */
export const BASES = () => ["", ...(process.env.NEXT_PUBLIC_FACTORY_URL ? [process.env.NEXT_PUBLIC_FACTORY_URL] : []),
  ...(["localhost", "127.0.0.1"].includes(location.hostname) || new URLSearchParams(location.search).has("live") ? ["http://localhost:8787"] : [])];
/** factory/snapshot.py: one state per project (`states`), events stamped with their project, recorded runs to replay. */
const SNAP = snapshot as unknown as { state: State; states?: Record<string, State>; events: Ev[]; replays?: Recording[] };
const snapState = (pid: string) => SNAP.states?.[pid] ?? (!pid || SNAP.state.project?.id === pid ? SNAP.state : null);
/** factory/snapshot.py's copy of GET /api/<path>, read when there is no server. */
const snapFile = (path: string, ext: "json" | "txt") => `/snapshot/${decodeURIComponent(path).replace(/[^A-Za-z0-9.-]/g, "_")}.${ext}`;
const recordings = (pid: string) => (SNAP.replays || []).filter(r => r.project === pid);
/** The hosted composer's one-click requests for a project: its recorded prompts. */
export const recordedChips = (pid: string) => chips(recordings(pid));
const WHAT_IF = /^\s*what (if|happens)\b/i;
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
const snapWo = (pid: string, id: string | null) => SNAP.states?.[pid]?.work_orders?.find(w => w.id === id);

/* ---------- hosted site: an in-browser factory (projects, requirements, work orders you create are kept in this browser) ---------- */
type LocalAudit = Audit & { project: string };
export type Local = { projects: Project[]; base: Record<string, string>; wos: WorkOrder[]; reqs: Record<string, Requirement[]>; audit: LocalAudit[]; synced: Record<string, { at: number; by: string }> };
const LOCAL = "certus-local";
const EMPTY: Local = { projects: [], base: {}, wos: [], reqs: {}, audit: [], synced: {} };
const loadLocal = (): Local => { try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(LOCAL) || "{}") }; } catch { return EMPTY; } };
const saveLocal = (l: Local) => { try { localStorage.setItem(LOCAL, JSON.stringify(l)); } catch { /* private mode: lasts this page */ } };
/** The recorded project a browser-made project borrows its hazard log, world model and recorded runs from. */
const recProject = (l: Local, pid: string) => l.base[pid] || pid;
/** Snapshot state for a project with this browser's additions layered on top. */
function stateFor(pid: string, l: Local): State | null {
  const s0 = snapState(recProject(l, pid));
  if (!s0) return null;
  const mine = l.projects.find(p => p.id === pid);
  const projects = [...s0.projects.filter(p => !l.projects.some(x => x.id === p.id)), ...l.projects];
  if (!pid) return { ...s0, projects };
  const s: State = mine ? { ...s0, project: mine, work_orders: [], audit: [], agents: {} } : s0;
  const audit = [...l.audit.filter(a => a.project === pid), ...s.audit].sort((a, b) => b.ts - a.ts);
  return { ...s, projects, audit, requirements: [...(s.requirements || []), ...(l.reqs[pid] || [])],
    work_orders: [...(s.work_orders || []), ...l.wos.filter(w => w.project === pid)] };
}
/** Replays survive a reload of the tab (sessionStorage), shown finished. */
const KEPT = "certus-replays";
const keep = (ps: Played[]) => { try { sessionStorage.setItem(KEPT, JSON.stringify(ps)); } catch { /* full or private mode */ } };
const restore = (): Played[] => { try { return JSON.parse(sessionStorage.getItem(KEPT) || "[]"); } catch { return []; } };

/** Live factory state from the local server; falls back to a read-only snapshot (Vercel).
 *  The snapshot is bundled, so the first paint always shows the last-known state, never a loading screen.
 *  Everything returned belongs to `projectId`: state is kept per project and events are filtered by their project. */
export function useFactoryState(projectId: string) {
  const [states, setStates] = useState<Record<string, State>>({});
  const [allEvents, setEvents] = useState<Ev[]>(SNAP.events);
  const [live, setLive] = useState<boolean | null>(null);
  const base = useRef<string | null>(null);
  const [probe] = useState(() => { let resolve = () => {}; const done = new Promise<void>(r => { resolve = r; }); return { done, resolve }; });
  const seen = useRef(0);
  const pid = useRef(projectId);
  pid.current = projectId;
  const [played, setPlayed] = useState<Played[]>([]);
  const [local, setLocalState] = useState<Local>(EMPTY);
  useEffect(() => { setLocalState(loadLocal()); }, []);
  const localRef = useRef(local);
  localRef.current = local;
  const setLocal = useCallback((f: (l: Local) => Local) => { const n = f(localRef.current); localRef.current = n; saveLocal(n); setLocalState(n); }, []);
  const [playing, setPlaying] = useState<Played | null>(null);
  const now = useRef({ played, playing, events: allEvents });
  now.current = { played, playing, events: allEvents };

  const refresh = useCallback(async () => {
    if (base.current === null) return;
    const p = pid.current;
    const r = await fetch(`${base.current}/api/state?project=${encodeURIComponent(p)}`, { cache: "no-store" });
    if (r.ok) {
      const s: State = await r.json();
      setStates(prev => ({ ...prev, [p]: s }));
    }
  }, []);

  useEffect(() => {
    let stop = false;
    (async () => {
      if (!new URLSearchParams(location.search).has("snapshot")) {
        for (const b of BASES()) {
          try {
            const r = await fetch(`${b}/api/state`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
            if (r.ok && (r.headers.get("content-type") || "").includes("json")) { base.current = b; break; }
          } catch { /* next */ }
        }
      }
      probe.resolve();
      if (base.current === null) {
        setLive(false);
        const kept = restore();  // runs replayed earlier in this tab, finished
        if (kept.length) {
          setPlayed(kept);
          setEvents(evs => [...evs, ...kept.flatMap(p => p.events.map(e => replayed(p, e)))]);
        }
        return;
      }
      setLive(true);
      while (!stop) {
        try {
          await refresh();
          const r = await (await fetch(`${base.current}/api/events?since=${seen.current}`, { cache: "no-store" })).json();
          if (r.total < seen.current) { seen.current = 0; setEvents([]); continue; }
          const first = seen.current === 0;
          seen.current = r.total;
          if (first) setEvents(r.events);
          else if (r.events.length) setEvents(prev => [...prev, ...r.events]);
        } catch { /* server restarting */ }
        await new Promise(res => setTimeout(res, 1200));
      }
    })();
    return () => { stop = true; };
  }, [refresh, probe]);

  useEffect(() => { refresh(); }, [projectId, refresh]);

  /** Hosted site: play the recorded run closest to the request, with its recorded timing (?speed=N plays it faster). */
  const replay = useCallback(async (path: string, body: Record<string, string>, actor: string) => {
    const l = localRef.current;
    const ts = Date.now() / 1000;
    const log = (project: string, action: string, object: string, detail = "") => ({ ts, actor, action, object, detail, project });
    if (path === "projects") {
      const name = String(body.name || "").trim();
      if (!name) return { error: "Give the project a name." };
      const base = Object.values(SNAP.states || {}).find(s => s.project?.device === body.device)?.project || SNAP.state.project;
      if (!base) return { error: "No world model for this device yet." };
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
      const taken = new Set([...SNAP.state.projects, ...l.projects].map(p => p.id));
      let id = slug; for (let i = 2; taken.has(id); i++) id = `${slug}-${i}`;
      const proj: Project = { ...base, id, name, created: ts, owner: actor };
      const hz = snapState(base.id);
      setLocal(x => ({ ...x, projects: [...x.projects, proj], base: { ...x.base, [id]: base.id },
        audit: [...x.audit, log(id, "created project", name, proj.standard),
          { ...log(id, "imported hazard log", name, `${hz?.hazards?.length || 0} hazards and ${hz?.requirements?.length || 0} safety requirements`), actor: "planner" }] }));
      return { id };
    }
    if (path === "workorders") {
      const title = String(body.title || "").trim();
      if (!title) return { error: "Give the work order a title." };
      const all = [...Object.values(SNAP.states || {}).flatMap(s => s.work_orders || []), ...l.wos, ...now.current.played.flatMap(p => p.wo ? [{ id: p.wo }] : [])];
      const id = `WO-${Math.max(100, ...all.map(w => Number(w.id.slice(3)) || 0)) + 1}`;
      const wo: WorkOrder = { id, project: body.project, title: title.slice(0, 120), description: String(body.description || ""), created: ts, requested_by: actor, status: "Draft", commits: [] };
      setLocal(x => ({ ...x, wos: [...x.wos, wo], audit: [...x.audit, log(body.project, "created work order", id, wo.title)] }));
      return { id };
    }
    if (path === "requirements") {
      const text = String(body.text || "").trim();
      if (!text) return { error: "Write the requirement." };
      const have = stateFor(body.project, l)?.requirements || [];
      const id = `SR-${Math.max(0, ...have.map(r => Number(r.id.replace(/\D/g, "")) || 0)) + 1}`;
      const hazards = String(body.hazards || "").split(/[,\s]+/).filter(Boolean);
      setLocal(x => ({ ...x, reqs: { ...x.reqs, [body.project]: [...(x.reqs[body.project] || []), { id, text, hazards }] },
        audit: [...x.audit, log(body.project, "added requirement", id, text)] }));
      return { id };
    }
    if (path === "record/resync") {
      await sleep(1200);  // the deterministic re-derivation, as the server would run it
      setLocal(x => ({ ...x, synced: { ...x.synced, [body.project]: { at: Date.now() / 1000, by: actor } },
        audit: [...x.audit, log(body.project, "resynced source of record", "requirements", "re-derived against code, tests and simulation evidence")] }));
      return {};
    }
    if (now.current.playing) return { error: "factory busy" };
    const text = String(body.text || "").trim();
    const recorded = Object.values(SNAP.states || {}).flatMap(s => [...(s.work_orders || []), ...(s.archived_work_orders || [])]);
    const known = [...recorded, ...l.wos,
      ...now.current.played.flatMap(p => (p.wo ? [{ id: p.wo, project: p.project, title: p.title }] : []))];
    const again = path === "run" ? known.find(w => w.id === body.wo) : undefined;
    if (path === "run" && !again) return { error: "unknown work order" };
    const project = again?.project || body.project || "";
    const kind = path === "whatif" || (path === "ask" && (body.skill === "simulate" || WHAT_IF.test(text))) ? "whatif" : "build";
    if (!["ask", "whatif", "run"].includes(path)) return { error: "Read-only snapshot. Run the factory locally to make changes." };
    const m = closest(recordings(recProject(l, project)).filter(r => r.kind === kind), again?.title || text);
    if (!m) return { error: `No recorded ${kind === "build" ? "work order run" : "what-if"} for this project in the hosted demo.` };
    // A recorded work order only replays its own request: another recording would show under its title.
    if (again && !m.matched && recorded.includes(again as WorkOrder)) return { error: `The hosted demo plays recorded runs only, and none is recorded for “${again.title.slice(0, 80)}”. Run the factory locally (demo/go.sh) to build it.` };
    const data = await fetch(snapFile(`replay?id=${m.rec.id}`, "json")).then(r => (r.ok ? r.json() as Promise<{ events: Ev[] }> : null)).catch(() => null);
    if (!data?.events.length) return { error: "This recorded run is missing from the hosted snapshot." };
    const next = `WO-${Math.max(100, ...known.map(w => Number(w.id.slice(3)) || 0)) + 1}`;
    const started = Date.now() / 1000;
    const note = m.matched ? null : noMatch(again?.title || text, m.rec.prompt);
    // No good match: say so first, then the closest recording plays.
    const events = note ? [{ run: data.events[0].run, t: 0, agent: kind === "build" ? "planner" : "simulation", state: "working", msg: note },
      ...data.events.map(e => ({ ...e, t: e.t + 2.5 }))] : data.events;
    const p: Played = {
      rec: m.rec, events, run: String(Math.floor(started)), project, started, actor, existing: !!again,
      wo: kind === "build" ? again?.id || next : null, title: (again?.title || text).slice(0, 120), note,
    };
    setPlayed(prev => [...prev, p]);
    keep([...now.current.played, p]);
    setPlaying(p);
    now.current.playing = p;
    (async () => {
      const speed = Number(new URLSearchParams(location.search).get("speed")) || 1;
      let prev = 0;
      for (const e of events) {
        await sleep(Math.max(0, e.t - prev) * 1000 / speed);
        prev = e.t;
        setEvents(evs => [...evs, replayed(p, e)]);
      }
      setPlaying(null);
    })();
    return p.wo ? { started: p.wo, id: p.wo } : { started: "whatif" };
  }, [setLocal]);

  const post = useCallback(async (path: string, body: object, actor: string) => {
    await probe.done;
    if (base.current === null) return replay(path, body as Record<string, string>, actor);
    const r = await fetch(`${base.current}/api/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Actor": actor }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    refresh();
    return r.ok ? j : { error: j.error || "Request failed" };
  }, [refresh, probe, replay]);

  /** Hosted site: a replayed run's files are the recorded work order's, shown once the replay reaches them. */
  const replayFile = useCallback(async (path: string, ext: "json" | "txt"): Promise<Response | null> => {
    const [kind, query = ""] = path.split("?");
    const q = new URLSearchParams(query);
    const { played: all, events: evs } = now.current;
    const p = [...all].reverse().find(x => q.get("wo") ? x.wo === q.get("wo") : kind === "callouts" && !x.wo && x.project === q.get("project"));
    if (!p) return null;
    const none = new Response(kind === "diff" ? "No code changes yet." : "null", { status: kind === "diff" ? 200 : 404 });
    if (!p.wo) return reached(p, evs, "world", "done") && p.rec.callouts ? fetch(snapFile(p.rec.callouts, "json")) : none;
    const ready = kind === "worldmodel" ? verdicts(p, evs) > 0 : kind === "callouts" ? finished(p, evs) : reached(p, evs, "evidence", "done");
    const src = ready ? await fetch(snapFile(`${kind}?wo=${p.rec.wo}`, ext)).catch(() => null) : null;
    if (!src?.ok) return none;
    const body = rewrite(p, await src.text());
    if (kind !== "worldmodel") return new Response(body);
    const loop = JSON.parse(body);
    const attempts = (loop.attempts || []).slice(0, verdicts(p, evs));
    const final = attempts.length ? attempts[attempts.length - 1].world_verdict : null;
    return new Response(JSON.stringify({ ...loop, title: p.title, replay: replayed(p, p.events[0]).replay, attempts, final }));
  }, []);

  /** GET /api/<path>, or its snapshot copy on the static site. Waits for the server probe, so a live server is
   *  never answered from the snapshot. */
  const fetchApi = useCallback(async (path: string, ext: "json" | "txt") => {
    await probe.done;
    if (base.current === null) {
      const l = localRef.current;
      const [kind, query = ""] = path.split("?");
      const pid = new URLSearchParams(query).get("project") || "";
      const own = recProject(l, pid);
      const r = (await replayFile(path, ext)) ?? await fetch(snapFile(own !== pid ? path.replace(`project=${pid}`, `project=${own}`) : path, ext), { cache: "no-store" }).catch(() => null);
      const sync = l.synced[pid];
      if (kind !== "record" || !sync || !r?.ok) return r;
      const rec = await r.json();
      return new Response(JSON.stringify({ ...rec, synced_at: sync.at, synced_by: sync.by, resyncing: false }));
    }
    return fetch(`${base.current}/api/${path}`, { cache: "no-store" }).catch(() => null);
  }, [probe, replayFile]);

  const text = useCallback(async (path: string) => {
    const r = await fetchApi(path, "txt");
    return r && r.ok ? r.text() : "Not found.";
  }, [fetchApi]);

  const getJSON = useCallback(async <T,>(path: string): Promise<T | null> => {
    const r = await fetchApi(path, "json");
    return r && r.ok ? r.json().catch(() => null) : null;
  }, [fetchApi]);

  // Live: this project's state once fetched (a project switch shows its snapshot, if any, for the ~20 ms until then).
  // Never another project's state: a page must not render one project's data under another's name.
  const events = useMemo(() => projectId ? allEvents.filter(e => e.project === projectId) : allEvents, [allEvents, projectId]);
  const hosted = useMemo(() => {
    const s = live ? null : stateFor(projectId, local);
    if (!s) return null;
    const status = { ...s.status!, hosted: true, ...(playing ? { busy: true, job: playing.wo ? "build" : "whatif", running: playing.wo, project: playing.project } : {}) };
    const mine = played.filter(p => p.project === s.project?.id);
    if (!mine.length) return { ...s, status };
    const pevs = allEvents.filter(e => e.project === s.project?.id);
    const wos = new Map((s.work_orders || []).map(w => [w.id, w]));
    for (const p of mine) if (p.wo) {
      const w = playedWo(p, pevs, snapWo(p.rec.project, p.rec.wo));
      wos.set(p.wo, p.existing ? { ...w, description: wos.get(p.wo)?.description || "" } : w);
    }
    const audit = [...mine.flatMap(p => playedAudit(p, pevs, p.wo ? wos.get(p.wo) : undefined)), ...s.audit].sort((a, b) => b.ts - a.ts);
    return { ...s, status, work_orders: [...wos.values()], audit, agents: roster(pevs) };
  }, [live, projectId, played, playing, allEvents, local]);
  const state = (live ? states[projectId] : null) ?? hosted ?? stateFor(projectId, local);
  return { state, events, live, post, text, getJSON, base: base.current };
}
