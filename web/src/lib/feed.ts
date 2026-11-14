"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type GateRow = { id: string; text: string; why: string[]; result: string; hazards: { id: string; title?: string; severity?: string }[] };
export type WorldRun = {
  scenario: string; patient: string; note: string; min: number; max: number; hypo: boolean;
  trace: number[]; base_trace: number[]; base_min: number; new_hypo: boolean; preexisting: boolean;
  tir?: number; hyper_min?: number; nadir_at?: number; bolus_u?: number; base_bolus_u?: number; base_note?: string; insulin?: number[];
};
export type Scenario = {
  id: string; label: string; cohort?: string; carbs?: number; eaten?: number; typo?: number; dose_u?: number;
  fallback?: string; meal_at?: number; minutes?: number;
};
export type World = {
  verdict: string; threshold: number; hyper?: number; step_min: number; meal_at: number; base: string; question?: string;
  scenarios?: Scenario[]; results: WorldRun[]; kind?: string;
  axis?: { unit: string; min: number; max: number; band: [number, number]; threshold_label: string; event_label: string; above?: boolean; time_unit: string; subject: string };
};
export type Hit = { kind: string; title: string; text: string; score?: number };
export type Ev = {
  run: string; t: number; agent: string; state: string; msg: string; wo?: string; title?: string;
  gate?: { verdict: string; rows: GateRow[] }; world?: World; memory?: Hit[];
  analysis?: { hazards?: string[]; requirements?: string[]; risk?: string; guidance?: string; new_hazard?: string };
  evidence?: { wo: string; decision: string; headline: string }; candidate?: string; pr?: string;
  replay?: { wo?: string | null; at: number };
};
export type Status = { online: boolean; busy: boolean; job: string | null; memory: string; composio: boolean; software_factory: boolean };
export type Mode = "connecting" | "live" | "replay";

const CANDIDATES = () => {
  const env = process.env.NEXT_PUBLIC_FACTORY_URL;
  return ["", ...(env ? [env] : []), "http://localhost:8787"];
};

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

/** Events of the latest run, from the local factory server if reachable, else a recorded replay. */
export function useFactory() {
  const [mode, setMode] = useState<Mode>("connecting");
  const [events, setEvents] = useState<Ev[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const base = useRef<string | null>(null);
  const seen = useRef(0);

  useEffect(() => {
    let stop = false;
    const forceReplay = new URLSearchParams(location.search).has("replay");

    const push = (evs: Ev[]) => setEvents(prev => {
      let cur = prev;
      for (const e of evs) cur = cur.length && cur[0].run !== e.run ? [e] : [...cur, e];
      return cur;
    });

    async function live() {
      for (const b of CANDIDATES()) {
        try { setStatus(await getJSON<Status>(b + "/api/status")); base.current = b; return true; } catch { /* next */ }
      }
      return false;
    }

    async function poll() {
      while (!stop) {
        try {
          const r = await getJSON<{ total: number; events: Ev[] }>(`${base.current}/api/events?since=${seen.current}`);
          if (r.total < seen.current) { seen.current = 0; continue; }
          seen.current = r.total;
          push(r.events);
          setStatus(await getJSON<Status>(base.current + "/api/status"));
        } catch { /* server restarting; keep trying */ }
        await new Promise(res => setTimeout(res, 900));
      }
    }

    async function replay() {
      setMode("replay");
      const txt = await (await fetch("/demo-run.jsonl")).text();
      const evs: Ev[] = txt.split("\n").filter(Boolean).map(l => JSON.parse(l));
      const speed = Number(new URLSearchParams(location.search).get("speed") || 2);
      while (!stop) {
        setEvents([]);
        for (let i = 0; i < evs.length && !stop; i++) {
          push([evs[i]]);
          const gap = i + 1 < evs.length ? evs[i + 1].t - evs[i].t : 8;
          await new Promise(res => setTimeout(res, Math.min(Math.max(gap, 0.8), 8) * 1000 / speed));
        }
      }
    }

    (async () => {
      if (!forceReplay && await live()) { setMode("live"); poll(); } else replay();
    })();
    return () => { stop = true; };
  }, []);

  const send = useCallback(async (kind: "build" | "whatif", text: string) => {
    if (base.current === null) return "Offline: start the local factory server to run jobs.";
    const r = await fetch(`${base.current}/api/${kind}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
    });
    if (r.status === 409) return "The factory is busy with another job.";
    return r.ok ? null : "Could not start the job.";
  }, []);

  const evidenceUrl = (wo: string) =>
    base.current === null ? `/evidence-${encodeURIComponent(wo)}.md` : `${base.current}/api/evidence?wo=${encodeURIComponent(wo)}`;

  return { mode, events, status, send, evidenceUrl };
}

/** Latest event per agent plus the richest payloads of the run. */
export function derive(events: Ev[]) {
  const by: Record<string, Ev> = {};
  let gate, world, memory, analysis, evidence, title, wo, scenarios;
  for (const e of events) {
    by[e.agent] = e;
    if (e.gate) gate = e.gate;
    if (e.world) world = e.world;
    if (e.memory) memory = e.memory;
    if (e.analysis) analysis = e.analysis;
    if (e.evidence) evidence = e.evidence;
    if (e.title) title = e.title;
    if (e.wo) wo = e.wo;
    if ((e as { scenarios?: unknown }).scenarios) scenarios = (e as { scenarios?: unknown }).scenarios;
  }
  return { by, gate, world, memory, analysis, evidence, title, wo, scenarios } as {
    by: Record<string, Ev>; gate?: Ev["gate"]; world?: World; memory?: Hit[]; analysis?: Ev["analysis"];
    evidence?: Ev["evidence"]; title?: string; wo?: string; scenarios?: unknown;
  };
}
