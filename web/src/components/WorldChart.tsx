"use client";
import { useState } from "react";
import type { Scenario, World, WorldRun } from "@/lib/feed";

const W = 640, H = 260, PL = 44, PR = 84, PT = 10, PB = 30, IH = 70;
const COL = { harm: "#f87171", pre: "#fbbf24", hyper: "#fb923c", ok: "#34d399", base: "#6b7280", grid: "#1a1d22", axis: "#5b616a", text: "#8a9099" };
const HYPER_LONG = 120; // minutes above the hyper line that count as a hyperglycemia event

type St = "harm" | "pre" | "hyper" | "ok";
const DRAW_ORDER: St[] = ["ok", "hyper", "pre", "harm"];

export const isWhatIf = (w: World) => !!w.question || w.base === "none";

/** Axis and wording for the world model that produced this run (insulin pump by default, or the run's own axis). */
function axisOf(w: World) {
  const a = w.axis;
  if (a) return { glucose: false, unit: a.unit, lo: a.min, hi: a.max, band: a.band, thr: a.threshold_label, event: a.event_label,
    above: !!a.above, time: a.time_unit, subject: a.subject };
  return { glucose: true, unit: "mg/dL", lo: 0, hi: 300, band: [70, 180] as [number, number], thr: "severe hypo", event: "meal + bolus request",
    above: false, time: "min", subject: "virtual patients" };
}
type Ax = ReturnType<typeof axisOf>;

const hyperLine = (w: World) => w.hyper ?? 250;
const hyperMin = (r: WorldRun, w: World) => r.hyper_min ?? r.trace.filter(g => g > hyperLine(w)).length * w.step_min;
const fmtT = (t: number, ax: Ax) => ax.time === "min" ? `${(t / 60).toFixed(1)} h` : `${t.toFixed(t < 10 ? 1 : 0)} ${ax.time}`;
const nice = (span: number, n: number) => [1, 2, 5, 10, 20, 50, 100, 200, 500].find(s => span / s <= n) || 1000;
const harmText = (w: World, ax: Ax) => ax.glucose ? `severe hypo < ${w.threshold}` : `${ax.thr} ${ax.above ? ">" : "<"} ${w.threshold} ${ax.unit}`;
/** Units the pump code delivered; older recordings only have the pump decision text. */
const units = (r: WorldRun) => r.bolus_u ?? noteUnits(r.note);
function noteUnits(note = "") {
  if (note.endsWith("no insulin")) return 0;
  const m = [...note.matchAll(/([\d.]+) U/g)];
  return m.length ? Number(m[m.length - 1][1]) : undefined;
}

function status(r: WorldRun, w: World): St {
  if (isWhatIf(w) ? r.hypo : r.new_hypo) return "harm"; // what the gate (or the what-if verdict) decides on
  if (r.hypo) return "pre"; // gate run: this run also fails on main
  return axisOf(w).glucose && hyperMin(r, w) >= HYPER_LONG ? "hyper" : "ok";
}

/** Verdict with the same rule as the world model: a gate run blocks on any NEW harm; a what-if is unsafe on any harm. */
export function simVerdict(w: World, rs = w.results): { label: string; tone: "bad" | "warn" | "ok" } {
  const st = rs.map(r => status(r, w));
  if (!isWhatIf(w)) return st.includes("harm") ? { label: "BLOCKED", tone: "bad" } : { label: "PASS", tone: "ok" };
  return st.includes("harm") ? { label: "UNSAFE", tone: "bad" } : st.includes("hyper") ? { label: "AT RISK", tone: "warn" } : { label: "SAFE", tone: "ok" };
}

const TONE = { bad: "text-bad bg-bad/10 border-bad/30", warn: "text-warn bg-warn/10 border-warn/25", ok: "text-ok bg-ok/10 border-ok/25" };
export const VerdictChip = ({ v }: { v: ReturnType<typeof simVerdict> }) => (
  <span className={`inline-flex items-center rounded border px-1.5 py-px text-xs font-semibold tracking-wide ${TONE[v.tone]}`}>{v.label}</span>
);

function describe(s?: Scenario) {
  if (!s) return "";
  const bits = [s.dose_u != null ? `${s.dose_u} U typed` : s.carbs != null ? `${s.carbs} g meal` : "",
    s.eaten != null && s.eaten !== s.carbs ? `${s.eaten} g eaten` : "",
    s.typo && s.typo !== 1 ? `dose typed ${s.typo}×` : "",
    s.fallback ? (s.fallback === "extended" ? "extended bolus if rejected" : "re-enter if rejected") : ""];
  return bits.filter(Boolean).join(" · ");
}

/** The world-model simulation: every simulated run over time, with the real code under review in the loop. */
export function WorldChart({ world }: { world: World }) {
  const whatif = isWhatIf(world);
  const ax = axisOf(world);
  const scenarios = [...new Set(world.results.map(r => r.scenario))];
  const meta = Object.fromEntries((world.scenarios || []).map(s => [s.id, s]));
  const subjects = new Set(world.results.map(r => r.patient)).size;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-mute">
        <VerdictChip v={simVerdict(world)} />
        <span>{world.results.length} simulated runs · {subjects} {ax.subject} · {scenarios.length} scenario{scenarios.length > 1 ? "s" : ""}</span>
        {ax.glucose && <span className="text-dim">simglucose (UVA/Padova T1D) · real pump.c in the loop · 1-min steps</span>}
        <span className="text-dim">{whatif ? "unsafe if any run hits " : `candidate vs ${world.base} · blocks if any run newly hits `}{harmText(world, ax)}</span>
      </div>
      <Legend world={world} ax={ax} />
      {scenarios.map(sc => <ScenarioSim key={sc} world={world} ax={ax} sc={sc} meta={meta[sc]} />)}
    </div>
  );
}

function Legend({ world, ax }: { world: World; ax: Ax }) {
  const whatif = isWhatIf(world);
  const items: [string, string, boolean?][] = [
    [COL.ok, "within limits"], [COL.harm, whatif ? harmText(world, ax) : `new: ${harmText(world, ax)} (blocks)`],
    ...(whatif ? [] : [[COL.pre, `also on ${world.base} (pre-existing)`] as [string, string]]),
    ...(ax.glucose ? [[COL.hyper, `above ${hyperLine(world)} mg/dL for 2 h+`] as [string, string]] : []),
    ...(whatif ? [] : [[COL.base, `same run on ${world.base} (before)`, true] as [string, string, boolean]]),
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
      {items.map(([c, l, dash]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <svg width="18" height="6"><line x1="0" x2="18" y1="3" y2="3" stroke={c} strokeWidth="2" strokeDasharray={dash ? "3 3" : undefined} /></svg>{l}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-ok/15" />{ax.glucose ? "target range 70–180" : `normal ${ax.band[0]}–${ax.band[1]} ${ax.unit}`}</span>
    </div>
  );
}

function ScenarioSim({ world, ax, sc, meta }: { world: World; ax: Ax; sc: string; meta?: Scenario }) {
  const [hi, setHi] = useState<string | null>(null);
  const whatif = isWhatIf(world);
  const rs = world.results.filter(r => r.scenario === sc);
  const step = world.step_min;
  const total = Math.max(...rs.map(r => r.trace.length)) * step;
  const eventAt = meta?.meal_at ?? world.meal_at;
  const all = rs.flatMap(r => [...r.trace, ...(whatif ? [] : r.base_trace)]);
  const top = ax.glucose ? Math.max(300, Math.ceil(Math.max(...all) / 50) * 50) : Math.max(ax.hi, Math.ceil(Math.max(...all)));
  const bottom = ax.glucose ? 0 : Math.min(ax.lo, Math.floor(Math.min(...all)));
  const x = (t: number) => PL + (t / total) * (W - PL - PR);
  const y = (g: number) => PT + (1 - (g - bottom) / (top - bottom)) * (H - PT - PB);
  const pts = (tr: number[]) => tr.map((g, i) => `${x(i * step).toFixed(1)},${y(g).toFixed(1)}`).join(" ");
  const st = Object.fromEntries(rs.map(r => [r.patient, status(r, world)]));
  const count = (s: St) => rs.filter(r => st[r.patient] === s).length;
  const worst = rs.reduce((a, r) => ((ax.above ? r.max > a.max : r.min < a.min) ? r : a), rs[0]);
  const tir = ax.glucose && rs.every(r => r.tir != null) ? Math.round(rs.reduce((a, r) => a + (r.tir || 0), 0) / rs.length) : null;
  const meanU = ax.glucose && rs.every(r => units(r) != null) ? rs.reduce((a, r) => a + (units(r) || 0), 0) / rs.length : null;
  const yStep = ax.glucose ? 100 : nice(top - bottom, 7);
  const yTicks = Array.from({ length: Math.floor((top - bottom) / yStep) + 1 }, (_, i) => Math.ceil(bottom / yStep) * yStep + i * yStep).filter(g => g <= top);
  const tUnit = ax.time === "min" ? 60 : 1;
  const tStep = ax.time === "min" ? (total > 480 ? 2 : 1) : nice(total, 8);
  const tTicks = Array.from({ length: Math.floor(total / tUnit / tStep) + 1 }, (_, i) => i * tStep);
  const lines: [number, string, string][] = ax.glucose
    ? [[world.threshold, COL.harm, `severe hypo ${world.threshold}`], [70, COL.ok, "70"], [180, COL.ok, "180"], [hyperLine(world), COL.hyper, `hyper ${hyperLine(world)}`]]
    : [[world.threshold, COL.harm, `${ax.thr} ${world.threshold}`]];
  const sel = rs.find(r => r.patient === hi);
  const ordered = [...rs].sort((a, b) => DRAW_ORDER.indexOf(st[a.patient]) - DRAW_ORDER.indexOf(st[b.patient]));
  const ins = ax.glucose && rs.some(r => r.insulin?.length) ? (sel?.insulin || rs[0].insulin!.map((_, i) => rs.reduce((a, r) => a + (r.insulin?.[i] || 0), 0) / rs.length)) : null;
  const insMax = ins ? Math.max(0.5, ...ins) : 1;
  const bw = ins ? (W - PL - PR) / ins.length : 0;
  const v = simVerdict(world, rs);
  const harmLabel = ax.glucose ? (whatif ? "Severe hypo < 54" : "New severe hypo < 54") : `${whatif ? "" : "New "}${ax.thr} exceeded`;
  const stats: [string, string, string?][] = [
    [harmLabel, `${count("harm")} / ${rs.length}`, count("harm") ? "text-bad" : "text-ok"],
    ...(!whatif ? [[`Pre-existing (also on ${world.base})`, String(count("pre")), count("pre") ? "text-warn" : ""] as [string, string, string]] : []),
    ...(ax.glucose ? [["Above 250 for 2 h+", `${count("hyper")} / ${rs.length}`, count("hyper") ? "text-[#fb923c]" : ""] as [string, string, string]] : []),
    [ax.glucose ? "Lowest BG" : "Worst peak", `${ax.above ? worst.max : worst.min} ${ax.unit} · ${worst.patient}`, worst.hypo ? "text-bad" : ""],
    ...(ax.glucose ? [["Highest BG", `${Math.max(...rs.map(r => r.max))} mg/dL`] as [string, string]] : []),
    ...(tir != null ? [["Time in range 70–180", `${tir}% (mean)`] as [string, string]] : []),
    ...(meanU != null ? [["Insulin from pump.c", `${meanU.toFixed(1)} U mean`] as [string, string]] : []),
  ];

  return (
    <figure className="@container rounded-lg border border-line bg-bg/60 p-3">
      <figcaption className="mb-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="text-base font-medium">{meta?.label || sc}</div>
          <div className="text-xs text-dim">{rs.length} {meta?.cohort ? `virtual ${meta.cohort}s` : ax.subject} · {describe(meta)}{describe(meta) ? " · " : ""}{fmtT(total, ax)} simulated</div>
        </div>
        <VerdictChip v={v} />
      </figcaption>
      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)]">
        <svg viewBox={`0 0 ${W} ${H + (ins ? IH : 0)}`} className="block h-auto w-full" role="img" aria-label={`Simulation, ${meta?.label || sc}`}>
          <rect x={PL} y={y(ax.band[1])} width={W - PL - PR} height={y(ax.band[0]) - y(ax.band[1])} fill="#34d39914" />
          {yTicks.map(g => (
            <g key={g}>
              <line x1={PL} x2={W - PR} y1={y(g)} y2={y(g)} stroke={COL.grid} />
              <text x={PL - 6} y={y(g) + 3} textAnchor="end" fontSize="10" fill={COL.axis}>{g}</text>
            </g>
          ))}
          {lines.map(([g, c, l]) => (
            <g key={l}>
              <line x1={PL} x2={W - PR} y1={y(g)} y2={y(g)} stroke={c} strokeDasharray={g === 70 || g === 180 ? "1 3" : "4 3"} opacity=".75" />
              <text x={W - PR + 4} y={y(g) + (ax.glucose && g === world.threshold ? 10 : ax.glucose && g === 70 ? -2 : 3)} fontSize="9.5" fill={c}>{l}</text>
            </g>
          ))}
          {tTicks.map(t => (
            <g key={t}>
              <line x1={x(t * tUnit)} x2={x(t * tUnit)} y1={H - PB} y2={H - PB + 4} stroke={COL.axis} />
              <text x={x(t * tUnit)} y={H - PB + 14} textAnchor="middle" fontSize="10" fill={COL.axis}>{t}</text>
            </g>
          ))}
          <line x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} stroke={COL.axis} />
          <text x={(PL + W - PR) / 2} y={H - 3} textAnchor="middle" fontSize="10" fill={COL.text}>time ({ax.time === "min" ? "hours" : ax.time})</text>
          <text transform={`translate(11 ${(PT + H - PB) / 2}) rotate(-90)`} textAnchor="middle" fontSize="10" fill={COL.text}>{ax.glucose ? "blood glucose (mg/dL)" : ax.unit}</text>
          <line x1={x(eventAt)} x2={x(eventAt)} y1={PT} y2={H - PB} stroke="#a5f3fc" strokeDasharray="2 3" opacity=".5" />
          <text x={x(eventAt) + 4} y={PT + 9} fontSize="9.5" fill="#a5f3fc" opacity=".8">{ax.event}</text>
          {!whatif && rs.map(r => (
            <polyline key={"b" + r.patient} points={pts(r.base_trace)} fill="none" stroke={COL.base} strokeWidth="1" strokeDasharray="3 3"
              opacity={hi && hi !== r.patient ? 0.08 : 0.55} />
          ))}
          {ordered.map(r => {
            const s = st[r.patient];
            return (
              <polyline key={r.patient} points={pts(r.trace)} fill="none" stroke={COL[s]} pathLength={1} strokeDasharray="1"
                strokeWidth={hi === r.patient ? 2.6 : s === "ok" ? 1.3 : 2} opacity={hi && hi !== r.patient ? 0.12 : s === "ok" ? 0.8 : 1}
                onMouseEnter={() => setHi(r.patient)} onMouseLeave={() => setHi(null)}>
                <animate attributeName="stroke-dashoffset" from="1" to="0" dur="1.6s" fill="freeze" />
                <title>{`${r.patient}: ${r.note}`}</title>
              </polyline>
            );
          })}
          {rs.filter(r => r.hypo).map(r => {
            const g = ax.above ? Math.max(...r.trace) : Math.min(...r.trace);
            const at = ax.glucose && r.nadir_at != null ? r.nadir_at : r.trace.indexOf(g) * step;
            return <circle key={"n" + r.patient} cx={x(at)} cy={y(ax.glucose ? r.min : g)} r="3" fill={COL[st[r.patient]]} opacity={hi && hi !== r.patient ? 0.15 : 1}><title>{`${r.patient}: ${ax.glucose ? r.min : g} ${ax.unit} at ${fmtT(at, ax)}`}</title></circle>;
          })}
          {ins && (
            <g transform={`translate(0 ${H})`}>
              <text x={PL} y={12} fontSize="10" fill={COL.text}>insulin delivered by pump.c, U per 5 min ({sel ? sel.patient : "cohort mean"}; basal not shown)</text>
              <line x1={PL} x2={W - PR} y1={IH - 8} y2={IH - 8} stroke={COL.axis} />
              <text x={PL - 6} y={22} textAnchor="end" fontSize="9" fill={COL.axis}>{insMax.toFixed(1)}</text>
              <text x={PL - 6} y={IH - 8} textAnchor="end" fontSize="9" fill={COL.axis}>0</text>
              {ins.map((u, i) => u > 0 && (
                <rect key={i} x={PL + i * bw} y={IH - 8 - (u / insMax) * (IH - 28)} width={Math.max(1, bw - 0.5)} height={(u / insMax) * (IH - 28)} fill="#60a5fa" opacity=".8" />
              ))}
            </g>
          )}
        </svg>
        <div className="min-w-0 space-y-3">
          <dl className="grid gap-x-6 gap-y-1.5 text-sm @lg:grid-cols-2 @4xl:grid-cols-1">
            {stats.map(([k, val, cls]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line/60 pb-1.5">
                <dt className="text-dim">{k}</dt><dd className={`text-right font-mono ${cls || "text-ink"}`}>{val}</dd>
              </div>
            ))}
          </dl>
          <div className="rounded-md bg-white/[.03] p-2 text-xs leading-relaxed text-mute">
            {sel ? <><b className="font-mono text-ink">{sel.patient}</b><br />{sel.note}
              {ax.glucose && <><br />min {sel.min} mg/dL{sel.nadir_at != null ? ` at ${fmtT(sel.nadir_at, ax)}` : ""} · max {sel.max}{sel.tir != null ? ` · in range ${sel.tir}%` : ""}</>}
              {!whatif ? <><br />on {world.base}: {ax.glucose ? `min ${sel.base_min} mg/dL` : `${sel.base_min} ${ax.unit}`}</> : null}</>
              : "Hover a trace or a row to follow one simulated run."}
          </div>
        </div>
      </div>
      {ax.glucose ? <PatientTable rows={rs} st={st} world={world} hi={hi} setHi={setHi} /> : <RunTable rows={rs} st={st} world={world} ax={ax} hi={hi} setHi={setHi} />}
    </figure>
  );
}

const RESULT: Record<St, [string, string]> = {
  harm: ["text-bad", "severe hypo"], pre: ["text-warn", "pre-existing hypo"], hyper: ["text-[#fb923c]", "hyperglycemia"], ok: ["text-ok", "ok"],
};
type TableProps = { rows: WorldRun[]; st: Record<string, St>; world: World; hi: string | null; setHi: (p: string | null) => void };
const th = "whitespace-nowrap py-1 pr-3 font-medium";
const td = "whitespace-nowrap py-1 pr-3 font-mono";

function PatientTable({ rows, st, world, hi, setHi }: TableProps) {
  const whatif = isWhatIf(world);
  const fmtU = (u?: number) => (u == null ? "—" : u.toFixed(1));
  const baseU = (r: WorldRun) => r.base_bolus_u ?? noteUnits(r.base_note);
  const cmpU = !whatif && rows.some(r => baseU(r) != null);
  const ax = axisOf(world);
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-dim">
          <tr>{["Patient", "Pump decision", cmpU ? "Insulin (U) main → new" : "Insulin (U)", whatif ? "Min BG" : "Min BG main → new", "Max BG", "In range", "> 250", "Result"].map(h => <th key={h} className={th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const [cls, label] = RESULT[st[r.patient]];
            const hm = hyperMin(r, world);
            return (
              <tr key={r.patient} onMouseEnter={() => setHi(r.patient)} onMouseLeave={() => setHi(null)}
                className={`cursor-default border-t border-line ${hi === r.patient ? "bg-white/[.04]" : ""}`}>
                <td className={td}>{r.patient}</td>
                <td className="py-1 pr-3 text-mute">{r.note}</td>
                <td className={td}>{cmpU ? `${fmtU(baseU(r))} → ${fmtU(units(r))}` : fmtU(units(r))}</td>
                <td className={`${td} ${r.hypo ? "text-bad" : ""}`}>{whatif ? r.min : `${r.base_min} → ${r.min}`}</td>
                <td className={`${td} ${r.max > hyperLine(world) ? "text-[#fb923c]" : ""}`}>{r.max}</td>
                <td className={td}>{r.tir != null ? `${r.tir}%` : "—"}</td>
                <td className={td}>{hm ? fmtT(hm, ax) : "—"}</td>
                <td className={`whitespace-nowrap py-1 font-medium ${cls}`}>{label}{st[r.patient] === "harm" && !whatif ? " (new)" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RunTable({ rows, st, world, ax, hi, setHi }: TableProps & { ax: Ax }) {
  const whatif = isWhatIf(world);
  const label: Record<St, [string, string]> = { harm: ["text-bad", whatif ? "exceeded" : "exceeded (new)"], pre: ["text-warn", "pre-existing"], hyper: ["", ""], ok: ["text-ok", "inside"] };
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-dim">
          <tr>{["Run", "Outcome", whatif ? `Peak (${ax.unit})` : `Peak (${ax.unit}) ${world.base} → new`, "Result"].map(h => <th key={h} className={th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.patient} onMouseEnter={() => setHi(r.patient)} onMouseLeave={() => setHi(null)}
              className={`cursor-default border-t border-line ${hi === r.patient ? "bg-white/[.04]" : ""}`}>
              <td className={td}>{r.patient}</td>
              <td className="py-1 pr-3 text-mute">{r.note}</td>
              <td className={`${td} ${r.hypo ? "text-bad" : ""}`}>{whatif ? r.max : `${r.base_min} → ${r.max}`}</td>
              <td className={`whitespace-nowrap py-1 font-medium ${label[st[r.patient]][0]}`}>{label[st[r.patient]][1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
