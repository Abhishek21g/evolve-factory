import type { AgentLive, Audit, WorkOrder } from "./api";
import type { Ev } from "./feed";
import type { Suggestion } from "./device";

/** A recorded run the hosted site plays in the browser (factory/snapshot.py exports them; no server, no LLM).
 *  `wo`: the recorded work order whose exported evidence, diff, world-model loop and callouts the replay shows.
 *  `callouts`: the snapshot file with a what-if's callouts (null: the device's beat in /callouts.json is this run's). */
export type Recording = {
  id: string; project: string; kind: "build" | "whatif"; prompt: string; wo: string | null; at: number; callouts: string | null;
};

/** One replay in this browser: a work order run (build) or a what-if. */
export type Played = {
  rec: Recording; events: Ev[]; run: string; project: string; started: number; actor: string;
  /** The work order it runs as (null for a what-if); `existing` when an existing work order is run again. */
  wo: string | null; existing: boolean; title: string;
  /** Set when nothing typed matched a recording, so the closest one plays. */
  note: string | null;
};

/** Said before the closest recording plays when nothing recorded matches the request. */
export const noMatch = (asked: string, prompt: string) => `No recording of “${asked.slice(0, 80)}”, so this plays the closest recorded run: “${prompt}”`;

const STOP = new Set(["the", "and", "for", "with", "what", "when", "than", "that", "this", "from", "into", "more", "does", "happens",
  "should", "would", "could", "can", "are", "was", "our", "its", "two", "has", "have", "they", "their", "there"]);
/** Words that mean the same thing to the world model. */
const SAME: Record<string, string> = {
  kid: "child", kids: "child", children: "child", toddler: "child", teen: "adolescent", teens: "adolescent", teenager: "adolescent",
  adults: "adult", grams: "g", gram: "g", carb: "carbs", carbohydrates: "carbs", eat: "eats", ate: "eats", eating: "eats", meal: "eats",
  degree: "degrees", deg: "degrees", vanes: "vane", sensors: "sensor", fail: "fails", failed: "fails", failure: "fails", stuck: "fails",
  gust: "turbulence", gusts: "turbulence", turbulent: "turbulence", stalls: "stall", boluses: "bolus", doses: "dose", ten: "10",
};
/** Who or what is simulated: two requests about different cohorts are different questions. */
const COHORT = new Set(["adult", "adolescent", "child"]);
const terms = (s: string) => (s.toLowerCase().match(/\d+(?:\.\d+)?|[a-z]+/g) || []).map(w => SAME[w] || w)
  .filter(w => /\d/.test(w) || (!STOP.has(w) && w.length > 2));

/** How well a recorded prompt answers the typed text: shared words (numbers count double), and what contradicts it
 *  (another cohort, or numbers where none agree, e.g. 150 g vs 80 g). */
function fit(text: string, prompt: string) {
  const a = new Set(terms(text)), b = new Set(terms(prompt));
  const shared = [...a].filter(w => b.has(w));
  const nums = (s: Set<string>) => [...s].filter(w => /\d/.test(w));
  const cohort = (s: Set<string>) => [...s].filter(w => COHORT.has(w));
  const clash = (x: string[], y: string[]) => x.length > 0 && y.length > 0 && !x.some(w => y.includes(w));
  const conflicts = 2 * Number(clash(cohort(a), cohort(b))) + Number(clash(nums(a), nums(b)));  // another cohort is another question
  const score = shared.reduce((k, w) => k + (/\d/.test(w) ? 2 : 1), 0);
  return { score, conflicts, rank: score / Math.sqrt(Math.max(1, a.size * b.size)) - conflicts };
}

/** The recording closest in meaning to the typed text. `matched`: a good match (two or more shared terms, a number
 *  counting as two, and nothing contradicting); otherwise the closest one plays and the replay says so. */
export function closest(recs: Recording[], text: string): { rec: Recording; matched: boolean } | null {
  let best: { rec: Recording; f: ReturnType<typeof fit> } | null = null;
  for (const rec of recs) {
    const f = fit(text, rec.prompt);
    if (!best || f.rank > best.f.rank) best = { rec, f };
  }
  return best && { rec: best.rec, matched: best.f.score >= 2 && !best.f.conflicts };
}

/** The composer's one-click requests on the hosted site: exactly the recorded prompts. */
export function chips(recs: Recording[]): Suggestion[] {
  return recs.map(r => {
    switch (r.kind) {
      case "build": return ["build", r.prompt] as const;
      case "whatif": return ["simulate", r.prompt] as const;
      default: { const never: never = r.kind; throw new Error(`unknown recording kind ${never}`); }
    }
  });
}

const subFor = (p: Played) => (s: string) => p.rec.wo && p.wo ? s.replace(new RegExp(`\\b${p.rec.wo}\\b`, "g"), p.wo) : s;

/** A recorded event as this replay emits it: its run, project and work order, labelled as a recorded run. */
export function replayed(p: Played, e: Ev): Ev {
  const sub = subFor(p);
  return {
    ...e, run: p.run, project: p.project, msg: sub(e.msg), ...(p.wo ? { wo: p.wo } : {}),
    ...(e.evidence && p.wo ? { evidence: { ...e.evidence, wo: p.wo } } : {}),
    replay: { wo: p.rec.wo, at: p.rec.at, hosted: true, note: p.note },
  };
}

/** Replay-time copy of a recorded work order's exported file: ids rewritten to the replay's work order. */
export const rewrite = (p: Played, body: string) => subFor(p)(body);

const mineOf = (p: Played, evs: Ev[]) => evs.filter(e => e.run === p.run);
/** Gate verdicts emitted so far (one per attempt). */
export const verdicts = (p: Played, evs: Ev[]) => mineOf(p, evs).filter(e => e.agent === "gate" && e.gate).length;
export const finished = (p: Played, evs: Ev[]) => mineOf(p, evs).length >= p.events.length;
export const reached = (p: Played, evs: Ev[], agent: string, state: string) => mineOf(p, evs).some(e => e.agent === agent && e.state === state);

/** The work order as the replay has reached it (factory/store.py wo_status, from the emitted events). */
export function playedWo(p: Played, evs: Ev[], src?: WorkOrder): WorkOrder {
  const mine = mineOf(p, evs);
  const last = <K extends keyof Ev>(k: K) => [...mine].reverse().find(e => e[k])?.[k];
  const verdict = [...mine].reverse().find(e => e.agent === "reviewer" && e.state !== "working");
  const shown = reached(p, evs, "evidence", "done") ? Infinity : mine.filter(e => e.agent.startsWith("coder") && e.msg.endsWith("committed")).length;
  const commits = src?.commits || [];  // newest first; each attempt's commit appears with its "committed" event
  const sub = subFor(p);
  return {
    id: p.wo!, project: p.project, title: p.title, created: p.started, requested_by: p.actor,
    description: p.note ? `${p.note}.` : "",
    status: verdict ? (verdict.state === "done" ? "Approved" : "Blocked") : "Running",
    gate: last("gate") || null, world: last("world") || null, evidence: last("evidence") || null,
    commits: commits.slice(Math.max(0, commits.length - shown)).map(c => ({ ...c, subject: sub(c.subject) })),
  };
}

/** Audit trail lines of a replay: the person's action, every finished agent step, the commits shown (factory/store.py state). */
export function playedAudit(p: Played, evs: Ev[], w?: WorkOrder): Audit[] {
  const human: Audit[] = p.wo
    ? [...(p.existing ? [] : [{ ts: p.started, actor: p.actor, action: "created work order", object: p.wo, detail: p.title }]),
      { ts: p.started + 0.001, actor: p.actor, action: "started run", object: p.wo, detail: p.title }]
    : [{ ts: p.started, actor: p.actor, action: "asked the world model", object: "world model", detail: p.title }];
  const steps = mineOf(p, evs).filter(e => ["done", "pass", "blocked"].includes(e.state))
    .map(e => ({ ts: Number(p.run) + e.t, actor: e.agent, action: e.state, object: p.wo || "world model", detail: e.msg }));
  const commits = (w?.commits || []).map(c => ({ ts: Number(c.ts), actor: "coder-claude", action: "committed code", object: p.wo!, detail: `${c.sha.slice(0, 7)} ${c.subject}` }));
  return [...human, ...steps, ...commits];
}

/** Per agent: what it is doing in the latest run, steps finished, last action (factory/store.py agent_roster). */
export function roster(evs: Ev[]): Record<string, AgentLive> {
  const lastRun = evs.length ? evs[evs.length - 1].run : null;
  const out: Record<string, AgentLive> = {};
  for (const e of evs) {
    const a = out[e.agent] ??= { id: e.agent, done: 0, blocked: 0, msg: "", state: "idle", ts: 0, wo: null };
    a.done += Number(e.state === "done" || e.state === "pass");
    a.blocked += Number(e.state === "blocked");
    a.msg = e.msg; a.ts = Number(e.run) + e.t; a.wo = e.wo || null;
    a.state = e.run === lastRun ? e.state : "idle";
  }
  return out;
}
