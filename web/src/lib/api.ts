"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ev, Gate, World } from "./feed";
import type { Trace } from "./trace";
import { chips, closest, finished, HOSTED_NOTE, playedAudit, playedWo, reached, replayed, rewrite, roster, verdicts, type Played, type Recording } from "./replay";
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
    if (now.current.playing) return { error: "factory busy" };
    const text = String(body.text || "").trim();
    const known = [...Object.values(SNAP.states || {}).flatMap(s => s.work_orders || []),
      ...now.current.played.flatMap(p => (p.wo ? [{ id: p.wo, project: p.project, title: p.title }] : []))];
    const again = path === "run" ? known.find(w => w.id === body.wo) : undefined;
    if (path === "run" && !again) return { error: "unknown work order" };
    const project = again?.project || body.project || "";
    const kind = path === "whatif" || (path === "ask" && (body.skill === "simulate" || WHAT_IF.test(text))) ? "whatif" : "build";
    if (!["ask", "whatif", "run"].includes(path)) return { error: "Read-only snapshot. Run the factory locally to make changes." };
    const m = closest(recordings(project).filter(r => r.kind === kind), again?.title || text);
    if (!m) return { error: `No recorded ${kind === "build" ? "work order run" : "what-if"} for this project in the hosted demo.` };
    const data = await fetch(snapFile(`replay?id=${m.rec.id}`, "json")).then(r => (r.ok ? r.json() as Promise<{ events: Ev[] }> : null)).catch(() => null);
    if (!data?.events.length) return { error: "This recorded run is missing from the hosted snapshot." };
    const next = `WO-${Math.max(100, ...known.map(w => Number(w.id.slice(3)) || 0)) + 1}`;
    const started = Date.now() / 1000;
    const p: Played = {
      rec: m.rec, events: data.events, run: String(Math.floor(started)), project, started, actor, existing: !!again,
      wo: kind === "build" ? again?.id || next : null, title: (again?.title || text).slice(0, 120), note: m.matched ? null : HOSTED_NOTE,
    };
    setPlayed(prev => [...prev, p]);
    keep([...now.current.played, p]);
    setPlaying(p);
    now.current.playing = p;
    (async () => {
      const speed = Number(new URLSearchParams(location.search).get("speed")) || 1;
      let prev = 0;
      for (const e of data.events) {
        await sleep(Math.max(0, e.t - prev) * 1000 / speed);
        prev = e.t;
        setEvents(evs => [...evs, replayed(p, e)]);
      }
      setPlaying(null);
    })();
    return p.wo ? { started: p.wo, id: p.wo } : { started: "whatif" };
  }, []);

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
    if (base.current === null) return (await replayFile(path, ext)) ?? fetch(snapFile(path, ext), { cache: "no-store" }).catch(() => null);
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
    const s = live ? null : snapState(projectId);
    if (!s) return null;
    const status = { ...s.status!, hosted: true, ...(playing ? { busy: true, job: playing.wo ? "build" : "whatif", running: playing.wo, project: playing.project } : {}) };
    const mine = played.filter(p => p.project === s.project?.id);
    if (!mine.length) return { ...s, status };
    const pevs = allEvents.filter(e => e.project === s.project?.id);
    const wos = new Map((s.work_orders || []).map(w => [w.id, w]));
    for (const p of mine) if (p.wo) wos.set(p.wo, playedWo(p, pevs, snapWo(p.rec.project, p.rec.wo)));
    const audit = [...mine.flatMap(p => playedAudit(p, pevs, p.wo ? wos.get(p.wo) : undefined)), ...s.audit].sort((a, b) => b.ts - a.ts);
    return { ...s, status, work_orders: [...wos.values()], audit, agents: roster(pevs) };
  }, [live, projectId, played, playing, allEvents]);
  const state = (live ? states[projectId] : null) ?? hosted ?? snapState(projectId);
  return { state, events, live, post, text, getJSON, base: base.current };
}
