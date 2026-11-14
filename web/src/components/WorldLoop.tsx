"use client";
import { useEffect, useState } from "react";
import type { State } from "@/lib/api";
import type { Ev } from "@/lib/feed";
import { Badge, PageHead, Replayed, Section } from "@/components/ui";

/* Types of factory/worldmodel.py loop() */
type Step = { t: number; kind: "scenario" | "code" | "sim" | "violation"; text: string };
type Changed = { symbol: string; base: string | null; cand: string; file: string; line: number; text: string };
type Diag = {
  failing: number; total: number; headline: string; explain: string; handoff: string; uncovered: boolean;
  scenarios: { scenario: string; label: string; failing: number; total: number; run: string; moment: { t: number; label: string; value: number };
    facts: { protect?: number; stall?: number; t_stall?: number | null }; violations: { req: string; at: number; evidence: string }[]; chain: Step[] }[];
  requirements: { id: string; text: string; dal?: string; objectives: string[]; hazards: string[]; monitor: boolean; unit_test: string | null }[];
  hazards: { id: string; title: string; severity?: string; dal?: string }[];
  changed: Changed[]; code: { file: string; snippet: { line: number; text: string; hot: boolean }[] }[];
};
type Series = { run: string; scenario: string; dt: number; trace: number[]; base_trace: number[] | null; note: string; bad: boolean; trim?: number[]; insulin?: number[] };
type Attempt = {
  n: number; commit: string | null; world_verdict?: string; gate_verdict?: string; tests: { id: string; result: string }[];
  failing: number; total: number; diagnosis: Diag | null; series: Series | null; fix?: { changed: Changed[]; diff: string };
  resim?: { scenario: string; run: string; note: string; inside: boolean; peak: number };
};
export type Loop = {
  wo: string; title: string; project: string; device: string; repo: string; threshold: number | null;
  axis: { unit: string; min: number; max: number } | null; replay?: { wo?: string | null; at: number } | null; attempts: Attempt[]; final?: string;
};
type Props = { state: State; events: Ev[]; live: boolean; getJSON: <T>(p: string) => Promise<T | null> };

/** The loop of one work order from the factory server; refetched as new agent events arrive, so it fills in live. */
export function useLoop(getJSON: Props["getJSON"], wo: string | undefined, tick: string) {
  const [loop, setLoop] = useState<Loop | null | undefined>(undefined);
  useEffect(() => {
    if (!wo) return;
    let stop = false;
    (async () => {
      const l = (await getJSON<Loop>(`worldmodel?wo=${encodeURIComponent(wo)}`))
        ?? await fetch(`/worldmodel-${wo}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (!stop) setLoop(l);
    })();
    return () => { stop = true; };
  }, [getJSON, wo, tick]);
  return loop === undefined ? undefined : loop?.wo === wo ? loop : null;
}

/* ---------- the distinction, in one strip ---------- */
export function SimVsWorld({ air }: { air: boolean }) {
  return (
    <div className="mb-6 grid gap-2.5 md:grid-cols-2">
      <div className="rounded-lg border border-line bg-panel p-3">
        <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold"><span className="font-mono text-acc">∿</span> Simulation <span className="font-normal text-dim">the physics</span></div>
        <p className="text-[12px] leading-relaxed text-mute">
          {air ? <>A 737-class flight model (<code className="text-ink">sim/flight.py</code>) flies the real <code className="text-ink">fcc.c</code> at 50 Hz: AoA, pitch, altitude and the trim the code commands, for every scenario and weight/CG config.</>
            : <>UVA/Padova virtual patients (<code className="text-ink">sim/world.py</code>, simglucose) run the real <code className="text-ink">pump.c</code> minute by minute: glucose and the insulin the code delivers.</>}
        </p>
      </div>
      <div className="rounded-lg border border-acc/25 bg-acc/[.03] p-3">
        <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold"><span className="font-mono text-acc">◈</span> World model <span className="font-normal text-dim">scenarios, diagnosis, the fix loop</span></div>
        <p className="text-[12px] leading-relaxed text-mute">
          Generates adversarial scenarios ({air ? "sensor failures, sideslip, gusts, weights" : "meals, dose typos, cohorts"}), runs them through the simulation, finds the moment a run leaves the safe envelope,
          and diagnoses it: which requirement and hazard, when, why, and which code lines. Claude Code gets that report, fixes the code, and the loop re-runs until PASS. Facts come from code; no LLM decides.
        </p>
      </div>
    </div>
  );
}

/* ---------- chart: one simulated run, failure moment marked ---------- */
const W = 640, H = 230, PL = 40, PR = 92, PT = 12, PB = 26, SH = 58;

function LoopChart({ s, air, threshold, diag, label }: { s: Series; air: boolean; threshold: number; diag?: Diag["scenarios"][number]; label: string }) {
  const total = (s.trace.length - 1) * s.dt;
  const vals = [...s.trace, ...(s.base_trace || [])];
  const lo = air ? Math.min(-5, Math.floor(Math.min(...vals))) : 0;
  const hi = air ? Math.max(25, Math.ceil(Math.max(...vals) / 5) * 5) : Math.max(300, Math.ceil(Math.max(...vals) / 50) * 50);
  const x = (t: number) => PL + (t / total) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const pts = (tr: number[]) => tr.map((v, i) => `${x(i * s.dt).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const strip = air ? s.trim : s.insulin;
  const stripMax = air ? Math.max(3, ...(strip || [0])) : Math.max(0.5, ...(strip || [0]));
  const lines: [number, string, string][] = air
    ? [[threshold, "#f87171", `stall ${threshold}°`], [diag?.facts.protect ?? 12, "#fbbf24", `protect ${diag?.facts.protect ?? 12}°`]]
    : [[threshold, "#f87171", `severe hypo ${threshold}`], [70, "#34d399", "70"]];
  const step = air ? (total > 40 ? 10 : 5) : 120;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  const yStep = air ? 5 : 50;
  const yTicks = Array.from({ length: Math.floor((hi - lo) / yStep) + 1 }, (_, i) => Math.ceil(lo / yStep) * yStep + i * yStep).filter(v => v <= hi);
  const m = diag?.moment;
  const v0 = diag?.violations[0];
  const col = s.bad ? "#f87171" : "#34d399";
  const ext = (tr: number[]) => (air ? Math.max(...tr) : Math.min(...tr));
  const facts: [string, string, string?][] = [
    [air ? "Peak AoA" : "Lowest glucose", `${ext(s.trace).toFixed(air ? 1 : 0)}${air ? "°" : " mg/dL"}`, s.bad ? "text-bad" : "text-ok"],
    ...(s.base_trace ? [[`Same run on main`, `${ext(s.base_trace).toFixed(air ? 1 : 0)}${air ? "°" : " mg/dL"}`] as [string, string]] : []),
    ...(m ? [["Failure moment", `${m.label} · t=${air ? `${m.t} s` : `${(m.t / 60).toFixed(1)} h`}`, "text-bad"] as [string, string, string]] : []),
    ...(v0 ? [[`${v0.req} violated`, `t=${v0.at}${air ? " s" : " min"}`, "text-warn"] as [string, string, string]] : []),
    ...(air && s.trim ? [["Protection trim max", `${Math.max(...s.trim).toFixed(1)}° nose down`, Math.max(...s.trim) > 0 ? "text-ok" : "text-bad"] as [string, string, string]] : []),
    ...(!air && s.insulin ? [["Insulin from pump.c", `${s.insulin.reduce((a, u) => a + u, 0).toFixed(1)} U`] as [string, string]] : []),
  ];
  return (
    <figure className="@container rounded-lg border border-line bg-bg/60 p-3">
      <figcaption className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-[12px]">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-[11px] text-dim">{s.run}</span>
      </figcaption>
      <div className="grid gap-4 @3xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)]">
      <div>
      <svg viewBox={`0 0 ${W} ${H + (strip ? SH : 0)}`} className="block h-auto w-full" role="img" aria-label={label}>
        {yTicks.map(v => (
          <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#1a1d22" /><text x={PL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#5b616a">{v}</text></g>
        ))}
        {lines.map(([v, c, l]) => (
          <g key={l}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke={c} strokeDasharray="4 3" opacity=".75" /><text x={W - PR + 4} y={y(v) + 3} fontSize="9.5" fill={c}>{l}</text></g>
        ))}
        {ticks.map(t => (
          <g key={t}><line x1={x(t)} x2={x(t)} y1={H - PB} y2={H - PB + 4} stroke="#5b616a" /><text x={x(t)} y={H - PB + 14} textAnchor="middle" fontSize="10" fill="#5b616a">{air ? t : t / 60}</text></g>
        ))}
        <text x={(PL + W - PR) / 2} y={H - 1} textAnchor="middle" fontSize="10" fill="#8a9099">time ({air ? "s" : "hours"})</text>
        <text transform={`translate(10 ${(PT + H - PB) / 2}) rotate(-90)`} textAnchor="middle" fontSize="10" fill="#8a9099">{air ? "angle of attack (°)" : "glucose (mg/dL)"}</text>
        {s.base_trace && <polyline points={pts(s.base_trace)} fill="none" stroke="#6b7280" strokeWidth="1.2" strokeDasharray="3 3" opacity=".7"><title>same run on main</title></polyline>}
        <polyline points={pts(s.trace)} fill="none" stroke={col} strokeWidth="2" pathLength={1} strokeDasharray="1">
          <animate attributeName="stroke-dashoffset" from="1" to="0" dur="1.4s" fill="freeze" />
        </polyline>
        {v0 && (
          <g>
            <line x1={x(v0.at)} x2={x(v0.at)} y1={PT} y2={H - PB} stroke="#fbbf24" strokeDasharray="2 3" />
            <text x={x(v0.at) - 4} y={PT + 9} textAnchor="end" fontSize="10" fill="#fbbf24">{v0.req} violated · t={v0.at}s</text>
          </g>
        )}
        {m && (
          <g>
            <line x1={x(m.t)} x2={x(m.t)} y1={PT} y2={H - PB} stroke="#f87171" strokeWidth="1.5" />
            <circle cx={x(m.t)} cy={y(air ? threshold : s.trace[Math.round(m.t / s.dt)] ?? threshold)} r="4" fill="#f87171" />
            <text x={x(m.t) + 5} y={PT + 22} fontSize="10" fill="#f87171">{m.label} · t={air ? `${m.t}s` : `${(m.t / 60).toFixed(1)}h`}</text>
          </g>
        )}
        {strip && (
          <g transform={`translate(0 ${H})`}>
            <text x={PL} y={12} fontSize="10" fill="#8a9099">{air ? "stall-protection trim the code commanded (° nose down)" : "insulin pump.c delivered (U per 5 min)"}</text>
            <line x1={PL} x2={W - PR} y1={SH - 6} y2={SH - 6} stroke="#5b616a" />
            <text x={PL - 6} y={22} textAnchor="end" fontSize="9" fill="#5b616a">{stripMax.toFixed(1)}</text>
            <text x={PL - 6} y={SH - 6} textAnchor="end" fontSize="9" fill="#5b616a">0</text>
            {air
              ? <polyline points={strip.map((v, i) => `${x(i * s.dt).toFixed(1)},${(SH - 6 - (v / stripMax) * (SH - 26)).toFixed(1)}`).join(" ")} fill="none" stroke="#60a5fa" strokeWidth="1.6" />
              : strip.map((u, i) => u > 0 && <rect key={i} x={x(i * s.dt)} y={SH - 6 - (u / stripMax) * (SH - 26)} width={Math.max(1, (W - PL - PR) / strip.length - 0.5)} height={(u / stripMax) * (SH - 26)} fill="#60a5fa" />)}
          </g>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-mute">
        <span className="inline-flex items-center gap-1.5"><svg width="18" height="6"><line x1="0" x2="18" y1="3" y2="3" stroke={col} strokeWidth="2" /></svg>candidate code</span>
        {s.base_trace && <span className="inline-flex items-center gap-1.5"><svg width="18" height="6"><line x1="0" x2="18" y1="3" y2="3" stroke="#6b7280" strokeWidth="1.5" strokeDasharray="3 3" /></svg>same run on main</span>}
      </div>
      </div>
      <div className="min-w-0 space-y-3">
        <dl className="grid gap-y-1.5 text-[12px]">
          {facts.map(([k, v, cls]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-line/60 pb-1.5"><dt className="text-dim">{k}</dt><dd className={`text-right font-mono ${cls || "text-ink"}`}>{v}</dd></div>
          ))}
        </dl>
        <p className="rounded-md bg-white/[.03] p-2 text-[11.5px] leading-relaxed text-mute">{s.note}</p>
      </div>
      </div>
    </figure>
  );
}

/* ---------- diagnosis card ---------- */
const KIND: Record<Step["kind"], [string, string]> = {
  scenario: ["text-acc", "scenario"], code: ["text-warn", "code"], sim: ["text-run", "simulation"], violation: ["text-bad", "violation"],
};

function DiagnosisCard({ d, air }: { d: Diag; air: boolean }) {
  const sc = d.scenarios[0];
  return (
    <div className="rounded-lg border border-bad/30 bg-bad/[.03] p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">Diagnosis</span>
        <span className="rounded border border-line px-1.5 py-px text-[10.5px] text-dim">deterministic: sim trace + code + safety.json · no LLM</span>
        <span className="ml-auto text-[12px] text-mute">{d.failing} of {d.total} simulated {air ? "flights" : "patients"} failed</span>
      </div>
      <p className="mb-4 font-mono text-[13px] leading-relaxed text-ink">{d.headline}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-dim">{d.uncovered ? "Requirement gap" : "Requirement violated"}</div>
          {d.requirements.map(r => (
            <div key={r.id} className="rounded-md border border-line bg-panel p-3 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2">
                <b className="font-mono">{r.id}</b>{r.dal && <span className="rounded bg-white/[.06] px-1.5 text-[10.5px] text-mute">DAL {r.dal}</span>}
                {r.unit_test && <Badge tone={r.unit_test === "FAIL" ? "FAIL" : "PASS"}>unit test {r.unit_test}</Badge>}
                {r.monitor && <Badge tone="FAIL">world model: violated</Badge>}
              </div>
              <p className="mt-1 text-mute">{r.text}</p>
              {r.objectives.length > 0 && <p className="mt-1 text-[11.5px] text-dim">{r.objectives.join(" · ")}</p>}
            </div>
          ))}
          {d.uncovered && <p className="rounded-md border border-warn/30 bg-warn/5 p-3 text-[12.5px] text-warn">Every requirement test passed, yet the simulated {air ? "flight" : "patient"} left the safe envelope: no requirement covers this. The factory flags it for a new safety requirement.</p>}
          <div className="flex flex-wrap gap-1.5">
            {d.hazards.map(h => <span key={h.id} className="rounded border border-bad/30 px-1.5 py-0.5 text-[11px] text-bad">{h.id} {h.title}{h.severity ? ` · ${h.severity}` : ""}{h.dal ? ` · DAL ${h.dal}` : ""}</span>)}
          </div>
          {sc.violations.map(v => <p key={v.req} className="text-[12px] text-mute"><b className="text-ink">{v.req} at t={v.at}{air ? " s" : " min"}:</b> {v.evidence}</p>)}
        </div>
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-dim">Why: causal chain from the simulation trace</div>
          <ol className="relative space-y-2 border-l border-line pl-4">
            {sc.chain.map((c, i) => (
              <li key={i} className="relative text-[12px] leading-snug">
                <span className={`absolute -left-[21px] top-1 h-2 w-2 rounded-full border-2 border-bg ${c.kind === "violation" ? "bg-bad" : c.kind === "code" ? "bg-warn" : c.kind === "sim" ? "bg-run" : "bg-acc"}`} />
                <span className="mr-2 font-mono text-[11px] text-dim">t={air ? `${c.t}s` : `${(c.t / 60).toFixed(1)}h`}</span>
                <span className={`mr-1.5 text-[10.5px] uppercase tracking-wide ${KIND[c.kind][0]}`}>{KIND[c.kind][1]}</span>
                <span className="text-mute">{c.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {d.code.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-dim">Responsible code</div>
          <div className="grid gap-2 lg:grid-cols-2">
            {d.code.map(f => (
              <div key={f.file} className="overflow-hidden rounded-md border border-line bg-bg">
                <div className="border-b border-line px-2.5 py-1 font-mono text-[11px] text-mute">{f.file}</div>
                <pre className="scroll-thin overflow-x-auto py-1 font-mono text-[11px] leading-relaxed">
                  {f.snippet.map(l => (
                    <div key={l.line} className={l.hot ? "bg-bad/15 text-ink" : "text-dim"}><span className="inline-block w-9 select-none pr-2 text-right text-dim">{l.line}</span>{l.text || " "}</div>
                  ))}
                </pre>
              </div>
            ))}
          </div>
          {d.changed.length > 0 && <p className="mt-2 text-[12px] text-mute">Certified limit{d.changed.length > 1 ? "s" : ""} changed vs main: {d.changed.map(c => <code key={c.symbol} className="mr-2 text-warn">{c.symbol} {c.base ?? "(new)"} → {c.cand}</code>)}</p>}
        </div>
      )}
      <p className="mt-4 rounded-md bg-white/[.03] p-2.5 text-[12px] leading-relaxed text-mute">{d.explain}</p>
    </div>
  );
}

function Diff({ src }: { src: string }) {
  return (
    <pre className="scroll-thin mt-2 max-h-80 overflow-auto rounded-md bg-bg p-3 font-mono text-[11px] leading-relaxed">
      {src.split("\n").map((l, i) => (
        <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "text-ok" : l.startsWith("-") && !l.startsWith("---") ? "text-bad" : l.startsWith("@@") ? "text-acc" : "text-mute"}>{l || " "}</div>
      ))}
    </pre>
  );
}

/* ---------- the loop: scenario -> simulation -> diagnosis -> Claude Code -> fix -> re-simulation ---------- */
function Stepper({ loop }: { loop: Loop }) {
  const first = loop.attempts.find(a => a.diagnosis);
  const last = loop.attempts[loop.attempts.length - 1];
  const steps: [string, string, "ok" | "bad" | "run" | "idle"][] = [
    ["Scenario", first?.diagnosis?.scenarios[0].label.split("(")[0] || "gate scenarios", "ok"],
    ["Simulation", first ? `${first.failing}/${first.total} runs failed` : last ? `${last.total} runs` : "waiting", first ? "bad" : last ? "ok" : "idle"],
    ["Diagnosis", first ? (first.diagnosis!.requirements.map(r => r.id).join(", ") || "requirement gap") + " · " + first.diagnosis!.hazards.map(h => h.id).join(", ") : "—", first ? "bad" : "idle"],
    ["Sent to Claude Code", first ? `attempt ${first.n + 1}` : "—", first && loop.attempts.length > first.n ? "ok" : first ? "run" : "idle"],
    ["Fix", last?.fix ? (last.commit || "").slice(0, 7) : "—", last?.fix ? "ok" : "idle"],
    ["Re-simulation", last?.world_verdict || "—", last?.world_verdict === "PASS" ? "ok" : last?.world_verdict === "BLOCKED" ? "bad" : "idle"],
  ];
  return (
    <ol className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-6">
      {steps.map(([k, v, t], i) => (
        <li key={k} className={`rounded-lg border p-2.5 ${t === "bad" ? "border-bad/40" : t === "ok" ? "border-ok/30" : t === "run" ? "border-run/40" : "border-line"}`}>
          <div className="flex items-center gap-1.5 text-[11px] text-dim"><span className="font-mono">{i + 1}</span>{k}</div>
          <div className={`mt-0.5 truncate text-[12.5px] font-medium ${t === "bad" ? "text-bad" : t === "ok" ? "text-ok" : t === "run" ? "text-run" : "text-mute"}`} title={v}>{v}</div>
        </li>
      ))}
    </ol>
  );
}

export function LoopView({ loop }: { loop: Loop }) {
  const air = loop.device === "flight-controls";
  const thr = loop.threshold ?? (air ? 15 : 54);
  const [diff, setDiff] = useState<number | null>(null);
  return (
    <>
      <Stepper loop={loop} />
      {loop.attempts.map((a, i) => {
        const prev = loop.attempts[i - 1];
        return (
          <Section key={a.n} title={`Attempt ${a.n}${a.commit ? ` · ${a.commit.slice(0, 7)}` : ""}`}
            aside={<span className="inline-flex gap-1.5">{a.world_verdict && <Badge tone={a.world_verdict === "PASS" ? "PASS" : "BLOCKED"}>world model {a.world_verdict}</Badge>}{a.gate_verdict && <Badge tone={a.gate_verdict === "PASS" ? "PASS" : "BLOCKED"}>gate {a.gate_verdict}</Badge>}</span>}>
            <div className="space-y-3">
              {a.fix && prev?.diagnosis && (
                <div className="rounded-lg border border-line bg-panel p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <span className="font-mono text-acc">{"</>"}</span><b>Claude Code&apos;s fix</b>
                    <span className="text-mute">after the world model&apos;s report on attempt {prev.n}</span>
                    <button onClick={() => setDiff(diff === a.n ? null : a.n)} className="ml-auto text-[12px] text-acc hover:underline">{diff === a.n ? "Hide diff" : "View diff"}</button>
                  </div>
                  {a.fix.changed.length > 0 && <p className="mt-1.5 text-[12px] text-mute">{a.fix.changed.map(c => <code key={c.symbol} className="mr-3 text-ink">{c.base == null ? `+ ${c.symbol} = ${c.cand}` : `${c.symbol} ${c.base} → ${c.cand}`}</code>)}</p>}
                  {diff === a.n && <Diff src={a.fix.diff} />}
                </div>
              )}
              {a.series && <LoopChart s={a.series} air={air} threshold={thr} diag={a.diagnosis?.scenarios[0]}
                label={a.diagnosis ? `Simulated ${air ? "flight" : "patient"}: ${a.diagnosis.scenarios[0].label}` : `Re-simulated: the same ${air ? "flight" : "patient"} on the fixed code`} />}
              {a.resim && (
                <p className={`rounded-md border px-3 py-2 text-[12.5px] ${a.world_verdict === "PASS" ? "border-ok/30 bg-ok/5 text-ok" : "border-line text-mute"}`}>
                  {a.world_verdict === "PASS" ? "PASS" : a.world_verdict}: {a.total - a.failing} of {a.total} simulated runs inside the safe envelope. {a.resim.run} now: {a.resim.note}.
                </p>
              )}
              {a.diagnosis && <DiagnosisCard d={a.diagnosis} air={air} />}
              {a.diagnosis && (
                <details className="rounded-lg border border-line bg-panel p-3" open={i === loop.attempts.length - 1}>
                  <summary className="cursor-pointer text-[12.5px]"><b>Sent to Claude Code</b> <span className="text-mute">structured failure report for attempt {a.n + 1}{loop.attempts[i + 1] ? "" : " (waiting for the coder)"}</span></summary>
                  <pre className="scroll-thin mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-bg p-3 font-mono text-[11px] leading-relaxed text-mute">{a.diagnosis.handoff}</pre>
                </details>
              )}
              {!a.series && !a.diagnosis && <p className="text-[12px] text-dim">Simulating…</p>}
            </div>
          </Section>
        );
      })}
    </>
  );
}

/* ---------- page: #/p/<project>/world-loop/<wo> ---------- */
export function WorldLoopPage({ state, events, live, getJSON, id }: Props & { id?: string }) {
  const p = state.project!;
  const air = p.device === "flight-controls";
  const wos = [...(state.work_orders || [])].reverse().filter(w => w.world || w.status !== "Draft");
  const wo = id || wos.find(w => w.world)?.id;
  const loop = useLoop(getJSON, wo, `${events.length}-${live}`);
  return (
    <>
      <PageHead title="World Model" sub={<>Where a change is flown before it can merge: the world model picks the scenarios, the simulation runs them, and every failure comes back as a diagnosis the coding agent fixes. {loop?.replay && <Replayed r={loop.replay} />}</>}>
        {wos.length > 0 && (
          <select aria-label="Work order" value={wo || ""} onChange={e => { location.hash = `/p/${p.id}/world-loop/${e.target.value}`; }}
            className="max-w-[22rem] truncate rounded-md border border-line bg-panel2 px-2 py-1.5 text-[12.5px] outline-none">
            {wos.map(w => <option key={w.id} value={w.id}>{w.id} · {w.title}</option>)}
          </select>
        )}
      </PageHead>
      <SimVsWorld air={air} />
      {loop ? (
        <>
          <p className="mb-3 text-[13px]"><a href={`#/p/${p.id}/work-orders/${loop.wo}`} className="font-mono text-mute hover:underline">{loop.wo}</a> <span className="text-ink">{loop.title}</span></p>
          <LoopView loop={loop} />
        </>
      ) : loop === undefined ? null : <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-dim">{wo ? "No simulation for this work order yet. Run it: the world model flies every attempt." : "Run a work order: every attempt is flown in the world model and diagnosed here."}</p>}
    </>
  );
}

/** Compact loop summary for the Simulations page and the work order view. */
export function LoopSummary({ state, events, live, getJSON, wo }: Props & { wo?: string }) {
  const p = state.project!;
  const target = wo || [...(state.work_orders || [])].reverse().find(w => w.world)?.id;
  const loop = useLoop(getJSON, target, `${events.length}-${live}`);
  const d = loop?.attempts.find(a => a.diagnosis)?.diagnosis;
  if (!loop || !loop.attempts.length) return null;
  return (
    <a href={`#/p/${p.id}/world-loop/${loop.wo}`} className="mb-8 block rounded-lg border border-line bg-panel p-3 hover:border-white/20">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="font-mono text-acc">◈</span><b>World model loop</b><span className="font-mono text-dim">{loop.wo}</span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          {loop.attempts.map((a, i) => <span key={a.n} className="inline-flex items-center gap-1.5">{i > 0 && <span className="text-dim">→</span>}<Badge tone={a.world_verdict === "PASS" ? "PASS" : a.world_verdict ? "BLOCKED" : "Draft"}>{a.world_verdict || "…"}</Badge></span>)}
        </span>
      </div>
      {d ? <p className="mt-1.5 font-mono text-[12px] text-mute">{d.headline} · {d.requirements.map(r => r.id).join(", ") || "requirement gap"}</p>
        : <p className="mt-1.5 text-[12px] text-mute">Every simulated run stayed inside the safe envelope.</p>}
    </a>
  );
}
