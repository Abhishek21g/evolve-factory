"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ev, Gate, World } from "./feed";
import type { Trace } from "./trace";
import snapshot from "../../public/snapshot.json";

export type Member = { id: string; name: string; role: string; kind: "human" | "agent" };
export type Project = { id: string; name: string; device: string; repo: string; standard: string; world_model: string; created: number; owner: string };
export type Hazard = { id: string; title: string; severity?: string; dal?: string };
export type Requirement = { id: string; text: string; hazards: string[]; symbols?: string[]; test?: string };
export type WorkOrder = {
  id: string; project: string; title: string; description: string; created: number; requested_by: string;
  status: "Draft" | "Running" | "Approved" | "Blocked" | "Stopped" | "Not run";
  gate?: Gate | null; world?: World | null;
  evidence?: { decision: string; headline: string } | null;
  commits: { sha: string; author: string; ts: string; subject: string }[];
};
export type Audit = { ts: number; actor: string; action: string; object: string; detail: string };
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
    hydradb?: "connected" | "connecting" | "falling back" | "missing key";
    composio_status?: "connected" | "not connected" | "checking" | "error" | "missing key";
  };
};

/** Where the factory server may be: same origin, NEXT_PUBLIC_FACTORY_URL, or the default local port. A hosted page
 *  probes localhost only when opened with ?live: otherwise the browser asks every visitor for local-network access. */
const BASES = () => ["", ...(process.env.NEXT_PUBLIC_FACTORY_URL ? [process.env.NEXT_PUBLIC_FACTORY_URL] : []),
  ...(["localhost", "127.0.0.1"].includes(location.hostname) || new URLSearchParams(location.search).has("live") ? ["http://localhost:8787"] : [])];
/** factory/snapshot.py: one state per project (`states`), events stamped with their project. */
const SNAP = snapshot as unknown as { state: State; states?: Record<string, State>; events: Ev[] };
const snapState = (pid: string) => SNAP.states?.[pid] ?? (!pid || SNAP.state.project?.id === pid ? SNAP.state : null);

/** Live factory state from the local server; falls back to a read-only snapshot (Vercel).
 *  The snapshot is bundled, so the first paint always shows the last-known state, never a loading screen.
 *  Everything returned belongs to `projectId`: state is kept per project and events are filtered by their project. */
export function useFactoryState(projectId: string) {
  const [states, setStates] = useState<Record<string, State>>({});
  const [allEvents, setEvents] = useState<Ev[]>(SNAP.events);
  const [live, setLive] = useState<boolean | null>(null);
  const base = useRef<string | null>(null);
  const seen = useRef(0);
  const pid = useRef(projectId);
  pid.current = projectId;

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
      if (base.current === null) { setLive(false); return; }
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
  }, [refresh]);

  useEffect(() => { refresh(); }, [projectId, refresh]);

  const post = useCallback(async (path: string, body: object, actor: string) => {
    if (base.current === null) return { error: "Read-only snapshot. Run the factory locally to make changes." };
    const r = await fetch(`${base.current}/api/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Actor": actor }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    refresh();
    return r.ok ? j : { error: j.error || "Request failed" };
  }, [refresh]);

  const text = useCallback(async (path: string) => {
    if (base.current === null) {
      const m = path.match(/(evidence|diff)\?wo=(.+)$/);
      const r = m ? await fetch(`/${m[1]}-${m[2]}.${m[1] === "evidence" ? "md" : "txt"}`) : null;
      return r && r.ok ? r.text() : "Not available in the read-only snapshot.";
    }
    const r = await fetch(`${base.current}/api/${path}`, { cache: "no-store" });
    return r.ok ? r.text() : "Not found.";
  }, []);

  const getJSON = useCallback(async <T,>(path: string): Promise<T | null> => {
    if (base.current === null) return null;
    const r = await fetch(`${base.current}/api/${path}`, { cache: "no-store" });
    return r.ok ? r.json() : null;
  }, []);

  // Live: this project's state once fetched (a project switch shows its snapshot, if any, for the ~20 ms until then).
  // Never another project's state: a page must not render one project's data under another's name.
  const state = (live ? states[projectId] : null) ?? snapState(projectId);
  const events = useMemo(() => projectId ? allEvents.filter(e => e.project === projectId) : allEvents, [allEvents, projectId]);
  return { state, events, live, post, text, getJSON, base: base.current };
}
