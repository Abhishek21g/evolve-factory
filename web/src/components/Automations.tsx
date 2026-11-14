"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Play, RefreshCw } from "lucide-react";
import type { State } from "@/lib/api";
import { Ago, Badge, Button, PageHead, Section } from "@/components/ui";
import { DiagnosisCard, type Diag } from "@/components/WorldLoop";

/* Types of factory/record.py resync() and factory/monitors.py view() / evidence() */
type Issue = { severity: "bad" | "warn"; kind: string; text: string };
type Row = {
  id: string; text: string; dal?: string; hazards: string[]; objectives: string[];
  code: { symbol: string; file?: string; line?: number; text?: string; missing?: boolean }[];
  test: { result: "PASS" | "FAIL" | "MISSING"; ms: number; log: string; cmd?: string };
  values: { symbol: string; spec: number; code: number | string | null; file: string; line: number; ok: boolean }[];
  sim: { covered: boolean; runs: number; violations: string[]; scenarios: string[]; ts: number | null; fresh: boolean };
  evidence: { wo: string; ts: number } | null; issues: Issue[]; status: "in-sync" | "stale" | "drift";
};
type Change = { ts: number; actor: string; added: string[]; resolved: string[]; drift: number; stale: number };
type Record_ = {
  project: string; synced_at: number; synced_by: string; standard: string; fingerprint: string; resyncing?: boolean;
  sim: { ts: number; verdict: string; runs: number; fresh: boolean } | null; rows: Row[];
  proposals: { kind: "hazard" | "requirement-gap"; source: string; text: string; hazards?: string[] }[]; history: Change[];
};
type RunStatus = "running" | "pass" | "warn" | "fail" | "error";
type Finding = { severity: "bad" | "warn" | "info"; text: string; req?: string; link?: "record" | "faults" };
type Run = { id: string; monitor: string; project: string; trigger: string; started: number; status: RunStatus; summary: string; findings: Finding[]; duration?: number; cached?: boolean | null };
type Monitor = { id: string; name: string; schedule: string; what: string; every: number; running: boolean; last: Run | null; next: number | null; runs: Run[] };
type Monitors = { monitors: Monitor[]; scheduler: "on" | "off" };
type Evidence = { md: string; diagnoses?: Diag[]; tests?: { id: string; result: string; ms: number }[] };
type Props = { state: State; live: boolean; getJSON: <T>(p: string) => Promise<T | null>; post: (p: string, b: object) => Promise<{ error?: string }> };

/** Server data, or the snapshot copy (web/public) when there is no server; polled fast while something runs. */
function usePolled<T>(getJSON: Props["getJSON"], path: string, file: string, fast: (t: T) => boolean) {
  const [data, setData] = useState<T | null | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  const load = useCallback(async () => {
    const d = (await getJSON<T>(path)) ?? await fetch(`/${file}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    setData(d);
    return d;
  }, [getJSON, path, file]);
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const d = await load();
      if (!stop) timer = setTimeout(tick, d && fast(d) ? 1000 : 8000);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [load, nonce, fast]);
  return [data, () => setNonce(n => n + 1)] as const;
}

function runTone(s: RunStatus): [string, string] {
  switch (s) {
    case "running": return ["Running", "Running"];
    case "pass": return ["PASS", "PASS"];
    case "warn": return ["Stopped", "WARN"];
    case "fail": return ["FAIL", "FAIL"];
    case "error": return ["BLOCKED", "ERROR"];
    default: { const never: never = s; return [never, never]; }
  }
}
const RunBadge = ({ s }: { s: RunStatus }) => { const [tone, label] = runTone(s); return <Badge tone={tone}>{label}</Badge>; };

function rowTone(s: Row["status"]): [string, string] {
  switch (s) {
    case "in-sync": return ["PASS", "in sync"];
    case "stale": return ["Stopped", "stale"];
    case "drift": return ["FAIL", "drift"];
    default: { const never: never = s; return [never, never]; }
  }
}

const sevCls = (s: Finding["severity"]) => (s === "bad" ? "text-bad" : s === "warn" ? "text-warn" : "text-mute");
const dur = (s?: number) => (s === undefined ? "—" : s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(1)} s`);
const short = (path: string) => path.split("/").slice(-1)[0];

/* ---------- Source of Record ---------- */
export function SourceOfRecord({ state, live, getJSON, post }: Props) {
  const pid = state.project!.id;
  const fast = useCallback((r: Record_) => !!r.resyncing, []);
  const [rec, reload] = usePolled<Record_>(getJSON, `record?project=${pid}`, `record-${pid}.json`, fast);
  const [err, setErr] = useState("");
  const resync = async () => {
    setErr("");
    const r = await post("record/resync", { project: pid });
    if (r.error) setErr(r.error);
    reload();
  };
  if (rec === undefined) return null;
  if (!rec) return <><PageHead title="Source of Record" /><p className="text-[13px] text-mute">Not synced yet. Run the factory locally to resync.</p></>;
  const n = (s: Row["status"]) => rec.rows.filter(r => r.status === s).length;
  const ch = rec.history[0];
  return (
    <>
      <PageHead title="Source of Record"
        sub={<>The requirements in <code className="text-ink">safety.json</code> are the single source of truth. Every resync re-derives each one against the code, its requirement test, trace links and fresh simulation evidence, and flags drift. Deterministic: no LLM.</>}>
        <span className="text-[12px] text-dim">synced <Ago ts={rec.synced_at} /> by {rec.synced_by}</span>
        <Button primary onClick={resync} disabled={!live || rec.resyncing}><RefreshCw size={14} className={rec.resyncing ? "animate-spin" : ""} /> {rec.resyncing ? "Resyncing" : "Resync"}</Button>
      </PageHead>
      {err && <p className="mb-4 text-[12px] text-bad">{err}</p>}
      <div className="mb-6 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="In sync" value={`${n("in-sync")}/${rec.rows.length}`} tone="text-ok" />
        <Stat label="Drift" value={String(n("drift"))} tone={n("drift") ? "text-bad" : "text-ink"} sub="code, test, links or simulation disagree with the requirement" />
        <Stat label="Stale" value={String(n("stale"))} tone={n("stale") ? "text-warn" : "text-ink"} sub="needs re-verification" />
        <Stat label="Simulation evidence" value={rec.sim ? `${rec.sim.runs} runs · ${rec.sim.verdict}` : "none"} tone={rec.sim?.fresh ? "text-ink" : "text-warn"}
          sub={rec.sim ? <>{rec.sim.fresh ? "matches the current code" : "older than the code"} · <Ago ts={rec.sim.ts} /></> : "Reliability monitor has not run"} />
      </div>

      <Section title="Requirements" aside={<>{rec.standard} · code fingerprint <code>{rec.fingerprint}</code></>}>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[980px] text-left text-[12.5px]">
            <thead className="border-b border-line bg-panel2 text-[11px] uppercase tracking-wider text-dim">
              <tr>{["Requirement", "Status", "Test", "Spec ↔ code", "Simulation", "Code", "Evidence"].map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rec.rows.map(r => {
                const [tone, label] = rowTone(r.status);
                return (
                  <tr key={r.id} className="align-top">
                    <td className="max-w-[300px] px-3 py-2.5">
                      <a href={`#/p/${pid}/traceability/${r.id}`} className="font-mono text-[12px] font-semibold hover:underline">{r.id}</a>
                      {r.dal && <span className="ml-1.5 rounded bg-white/[.06] px-1.5 text-[10.5px] text-mute">DAL {r.dal}</span>}
                      <p className="mt-0.5 text-mute">{r.text}</p>
                      {r.issues.map((i, k) => <p key={k} className={`mt-1 text-[11.5px] ${i.severity === "bad" ? "text-bad" : "text-warn"}`}>● {i.text}</p>)}
                    </td>
                    <td className="px-3 py-2.5"><Badge tone={tone}>{label}</Badge></td>
                    <td className="px-3 py-2.5">
                      <Badge tone={r.test.result === "MISSING" ? "Not run" : r.test.result}>{r.test.result === "MISSING" ? "no test" : r.test.result}</Badge>
                      {r.test.result !== "MISSING" && <div className="mt-1 font-mono text-[10.5px] text-dim">{r.test.ms} ms</div>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11.5px]">
                      {r.values.length ? r.values.map(v => (
                        <div key={v.symbol} className={v.ok ? "text-mute" : "text-bad"} title={`${v.file}:${v.line}`}>
                          {v.symbol} <span className={v.ok ? "text-ok" : "text-bad"}>{v.ok ? "=" : "≠"}</span> {String(v.code)}{!v.ok && <span className="text-dim"> (spec {v.spec})</span>}
                        </div>
                      )) : <span className="text-dim">no numeric limit</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[11.5px]">
                      {!r.sim.covered ? <span className="text-dim">not simulated</span> : (
                        <>
                          <div className={r.sim.violations.length ? "text-bad" : "text-mute"}>{r.sim.runs} runs · {r.sim.violations.length ? `${r.sim.violations.length} violated` : "0 violations"}</div>
                          <div className="text-dim">{r.sim.scenarios.join(", ")}{r.sim.ts ? <> · {r.sim.fresh ? "fresh" : "stale"}</> : null}</div>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-mute">
                      {r.code.map(c => <div key={c.symbol} className={c.missing ? "text-bad" : ""} title={c.text}>{c.missing ? `${c.symbol} missing` : `${short(c.file!)}:${c.line} ${c.symbol}`}</div>)}
                    </td>
                    <td className="px-3 py-2.5 text-[11.5px]">
                      {r.evidence ? <a href={`#/p/${pid}/work-orders/${r.evidence.wo}`} className="font-mono text-acc hover:underline">{r.evidence.wo}</a> : <span className="text-dim">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Proposed changes to the record" aside={`${rec.proposals.length} open`}>
          {rec.proposals.length ? (
            <div className="space-y-2">
              {rec.proposals.map((p, i) => (
                <div key={i} className={`rounded-lg border p-3 text-[12.5px] ${p.kind === "hazard" ? "border-warn/30 bg-warn/[.03]" : "border-acc/25 bg-acc/[.03]"}`}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={`font-semibold uppercase tracking-wide ${p.kind === "hazard" ? "text-warn" : "text-acc"}`}>{p.kind === "hazard" ? "New hazard" : "Requirement gap"}</span>
                    <span className="text-dim">from</span>
                    {p.source.startsWith("WO-") ? <a href={`#/p/${pid}/work-orders/${p.source}`} className="font-mono text-mute hover:underline">{p.source} Safety Analyst</a>
                      : <a href={`#/p/${pid}/automations`} className="text-mute hover:underline">{p.source}</a>}
                    {p.hazards?.map(h => <span key={h} className="rounded border border-line px-1 font-mono text-dim">{h}</span>)}
                  </div>
                  <p className="text-mute">{p.text}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-[12.5px] text-dim">Nothing proposed.</p>}
        </Section>
        <Section title="Sync history" aside={ch ? <>last change: {ch.added.length} new, {ch.resolved.length} resolved</> : undefined}>
          <div className="divide-y divide-line rounded-lg border border-line">
            {rec.history.slice(0, 12).map((h, i) => (
              <div key={i} className="px-3 py-2 text-[12px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-mute"><Ago ts={h.ts} /></span><span className="text-dim">by {h.actor}</span>
                  <span className="ml-auto font-mono text-[11px]">
                    <span className={h.drift ? "text-bad" : "text-dim"}>{h.drift} drift</span> · <span className={h.stale ? "text-warn" : "text-dim"}>{h.stale} stale</span>
                  </span>
                </div>
                {h.added.map(a => <div key={a} className="mt-0.5 text-[11.5px] text-bad">+ {a}</div>)}
                {h.resolved.map(a => <div key={a} className="mt-0.5 text-[11.5px] text-ok">✓ {a}</div>)}
                {!h.added.length && !h.resolved.length && <div className="mt-0.5 text-[11.5px] text-dim">no change</div>}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="text-[11px] uppercase tracking-wider text-dim">{label}</div>
      <div className={`mt-0.5 text-[18px] font-semibold ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-dim">{sub}</div>}
    </div>
  );
}

/* ---------- Automations: monitoring agents ---------- */
export function Automations({ state, live, getJSON, post }: Props) {
  const pid = state.project!.id;
  const air = state.project!.device === "flight-controls";
  const fast = useCallback((m: Monitors) => m.monitors.some(x => x.running), []);
  const [view, reload] = usePolled<Monitors>(getJSON, `monitors?project=${pid}`, `monitors-${pid}.json`, fast);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const run = async (id: string) => {
    setErr("");
    const r = await post("monitors/run", { id, project: pid });
    if (r.error) setErr(r.error);
    reload();
  };
  if (view === undefined) return null;
  if (!view) return <><PageHead title="Automations" /><p className="text-[13px] text-mute">No monitor runs yet. Run the factory locally to start the monitoring agents.</p></>;
  const runs = view.monitors.flatMap(m => m.runs.map(r => ({ ...r, name: m.name }))).sort((a, b) => b.started - a.started);
  return (
    <>
      <PageHead title="Automations"
        sub="Monitoring agents that watch main on a schedule and on demand: they re-run the simulations and requirement tests, resync the source of record, and fly adversarial world-model scenarios. They never block the factory: cached per code fingerprint, one run at a time, paused while a work order runs.">
        <span className="text-[12px] text-dim">scheduler {view.scheduler}</span>
      </PageHead>
      {err && <p className="mb-4 text-[12px] text-bad">{err}</p>}
      <div className="mb-8 grid gap-3 lg:grid-cols-3">
        {view.monitors.map(m => (
          <div key={m.id} className="flex flex-col rounded-lg border border-line bg-panel p-4">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[13px] font-semibold">{m.name}</span>
              <span className="ml-auto">{m.running ? <RunBadge s="running" /> : m.last ? <RunBadge s={m.last.status} /> : <Badge tone="Draft">never run</Badge>}</span>
            </div>
            <div className="mb-2 text-[11.5px] text-dim">{m.schedule}{m.next && !m.running ? <> · next <Until ts={m.next} /></> : null}</div>
            <p className="mb-3 text-[12px] leading-relaxed text-mute">{m.what}</p>
            {m.last && <p className="mb-3 text-[12px] text-ink">{m.last.summary} <span className="text-dim">· <Ago ts={m.last.started} /></span></p>}
            <div className="mt-auto"><Button onClick={() => run(m.id)} disabled={!live || m.running}><Play size={13} /> Run now</Button></div>
          </div>
        ))}
      </div>
      <Section title="Run history" aside={`${runs.length} runs`}>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[860px] text-left text-[12.5px]">
            <thead className="border-b border-line bg-panel2 text-[11px] uppercase tracking-wider text-dim">
              <tr>{["Monitor", "Status", "Started", "Duration", "Findings", ""].map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.slice(0, 40).map(r => (
                <RunRow key={r.id} r={r} name={r.name} pid={pid} air={air} open={open === r.id} toggle={() => setOpen(open === r.id ? null : r.id)} getJSON={getJSON} />
              ))}
            </tbody>
          </table>
          {!runs.length && <p className="px-3 py-6 text-center text-[12.5px] text-dim">No runs yet: the first scheduled runs start shortly after the server starts, or press Run now.</p>}
        </div>
      </Section>
    </>
  );
}

function RunRow({ r, name, pid, air, open, toggle, getJSON }: { r: Run; name: string; pid: string; air: boolean; open: boolean; toggle: () => void; getJSON: Props["getJSON"] }) {
  const [ev, setEv] = useState<Evidence | null | undefined>(undefined);
  useEffect(() => {
    if (!open || ev !== undefined || r.status === "running") return;
    (async () => setEv((await getJSON<Evidence>(`monitors/evidence?run=${encodeURIComponent(r.id)}`))
      ?? await fetch(`/monitor-${r.id}.json`).then(x => (x.ok ? x.json() : null)).catch(() => null)))();
  }, [open, ev, r.id, r.status, getJSON]);
  const bad = r.findings.filter(f => f.severity !== "info");
  return (
    <>
      <tr className="align-top">
        <td className="px-3 py-2.5"><div className="font-medium">{name}</div><div className="text-[11px] text-dim">{r.trigger === "schedule" ? "scheduled" : r.trigger === "manual" ? "run now" : r.trigger}{r.cached ? " · cached" : ""}</div></td>
        <td className="px-3 py-2.5"><RunBadge s={r.status} /></td>
        <td className="px-3 py-2.5 text-mute"><Ago ts={r.started} /></td>
        <td className="px-3 py-2.5 font-mono text-[11.5px] text-mute">{dur(r.duration)}</td>
        <td className="max-w-[460px] px-3 py-2.5">
          <div className="text-mute">{r.summary || "…"}</div>
          {bad.slice(0, 2).map((f, i) => <div key={i} className={`mt-0.5 truncate text-[11.5px] ${sevCls(f.severity)}`} title={f.text}>● {f.text}</div>)}
          {bad.length > 2 && <div className="text-[11px] text-dim">+{bad.length - 2} more</div>}
        </td>
        <td className="px-3 py-2.5 text-right">
          {r.status !== "running" && <button onClick={toggle} className="text-[12px] text-acc hover:underline">{open ? "Hide" : "Evidence"}</button>}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="bg-bg/60 px-3 py-4">
            {ev === undefined ? null : !ev ? <p className="text-[12px] text-dim">No evidence stored for this run.</p> : (
              <div className="space-y-4">
                {r.findings.length > 0 && (
                  <div className="space-y-1">
                    {r.findings.map((f, i) => (
                      <p key={i} className={`text-[12px] ${sevCls(f.severity)}`}>● {f.text}
                        {f.link === "record" && <a href={`#/p/${pid}/source-of-record`} className="ml-2 text-acc hover:underline">source of record</a>}
                      </p>
                    ))}
                  </div>
                )}
                {ev.diagnoses?.map((d, i) => <DiagnosisCard key={i} d={d} air={air} />)}
                <details>
                  <summary className="cursor-pointer text-[12px] text-dim hover:text-ink">Full report (markdown)</summary>
                  <pre className="scroll-thin mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-mute">{ev.md}</pre>
                </details>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Until({ ts }: { ts: number }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 15000); return () => clearInterval(t); }, []);
  const s = Math.max(0, ts - now);
  return <>{s < 60 ? "in under a minute" : s < 3600 ? `in ${Math.round(s / 60)} min` : `in ${Math.round(s / 3600)} h`}</>;
}
