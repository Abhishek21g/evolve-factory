"use client";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2 } from "lucide-react";

/* Types of factory/callouts.py */
type Tone = "ok" | "warn" | "bad";
type CallEv = { t: number; clip: string | null; label: string; detail: string; tone: Tone };
type Timeline = {
  device: "flight-controls" | "insulin-pump"; verdict: string; scenario: string; label: string; run: string; note: string; bad: boolean;
  unit: string; strip_label: string; lines: [number, string][]; series: { value: number[]; strip?: number[] | null; dt: number };
  events: CallEv[]; play_s: number;
};
export type Beat = { wo: string | null; title: string | null; before: Timeline | null; after: Timeline | null };
type Recorded = Record<string, { build: Beat | null; whatif: Beat | null }>;
type GetJSON = <T>(p: string) => Promise<T | null>;

/** The work order's before/after runs from the factory server; else the recorded beat for this device (hosted site). */
export function useCallouts(getJSON: GetJSON, device: string, kind: "build" | "whatif", key: string | undefined, tick: string) {
  const [beat, setBeat] = useState<{ beat: Beat; recorded: boolean } | null>(null);
  useEffect(() => {
    let stop = false;
    (async () => {
      const live = key ? await getJSON<Beat>(kind === "build" ? `callouts?wo=${encodeURIComponent(key)}` : `callouts?project=${encodeURIComponent(key)}`) : null;
      const usable = live && (live.before || live.after)?.device === device;
      const rec = usable ? null : await fetch("/callouts.json").then(r => (r.ok ? r.json() as Promise<Recorded> : null)).catch(() => null);
      const b = usable ? live : rec?.[device]?.[kind] ?? null;
      if (!stop) setBeat(b ? { beat: b, recorded: !usable } : null);
    })();
    return () => { stop = true; };
  }, [getJSON, device, kind, key, tick]);
  return beat;
}

/* one shared player: starting one panel stops the other */
let stopCurrent: (() => void) | null = null;
const cache: Record<string, HTMLAudioElement> = {};
const clip = (id: string) => (cache[id] ??= Object.assign(new Audio(`/audio/${id}.mp3`), { preload: "auto" }));

const TONE: Record<Tone, string> = { ok: "#34d399", warn: "#fbbf24", bad: "#f87171" };
const W = 560, H = 190, PL = 36, PR = 70, PT = 10, PB = 24, SH = 34;

function fmt(t: number, air: boolean) {
  return air ? `${t.toFixed(1)} s` : `${(t / 3600).toFixed(1)} h`;
}

function Panel({ tl, side }: { tl: Timeline; side: "before" | "after" | "whatif" }) {
  const air = tl.device === "flight-controls";
  const v = tl.series.value, dt = tl.series.dt;
  const total = (v.length - 1) * dt;
  const [now, setNow] = useState<number | null>(null);
  const [fired, setFired] = useState<number[]>([]);
  const raf = useRef(0);
  useEffect(() => {
    for (const e of tl.events) if (e.clip) clip(e.clip);
    return () => cancelAnimationFrame(raf.current);
  }, [tl]);

  const stop = () => { cancelAnimationFrame(raf.current); setNow(null); if (stopCurrent === stop) stopCurrent = null; };
  const play = () => {
    stopCurrent?.();
    stopCurrent = stop;
    setFired([]);
    const t0 = performance.now(), done = new Set<number>();
    const tick = () => {
      const t = Math.min(total, ((performance.now() - t0) / 1000 / tl.play_s) * total);
      tl.events.forEach((e, i) => {
        if (e.t <= t && !done.has(i)) {
          done.add(i);
          setFired(f => [...f, i]);
          if (e.clip) {
            const a = clip(e.clip).cloneNode() as HTMLAudioElement;
            a.play().catch(() => { /* clip not generated yet: the caption still shows */ });
          }
        }
      });
      setNow(t);
      if (t < total) raf.current = requestAnimationFrame(tick);
      else setTimeout(stop, 1200);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const lo = air ? Math.min(-5, Math.floor(Math.min(...v))) : 0;
  const hi = air ? Math.max(20, Math.ceil(Math.max(...v) / 5) * 5) : Math.max(250, Math.ceil(Math.max(...v) / 50) * 50);
  const x = (t: number) => PL + (t / total) * (W - PL - PR);
  const y = (val: number) => PT + (1 - (val - lo) / (hi - lo)) * (H - PT - PB);
  const strip = tl.series.strip;
  const sMax = Math.max(air ? 3 : 0.5, ...(strip || [0]));
  const col = tl.bad ? "#f87171" : "#34d399";
  const latest = now === null ? null : [...fired].reverse().map(i => tl.events[i]).find(e => e.label);
  const head = side === "before" ? "Before: the blocked patch" : side === "after" ? "After: the fix that passed" : "What-if";
  const ticks = Array.from({ length: 7 }, (_, i) => (total * i) / 6);

  return (
    <figure className="min-w-0 rounded-lg border border-line bg-bg/60 p-3">
      <figcaption className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <button onClick={now === null ? play : stop} aria-label={now === null ? `Play ${head}` : "Stop"}
          className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full border ${now === null ? "border-acc/40 bg-acc/10 text-acc hover:bg-acc/20" : "border-bad/40 bg-bad/10 text-bad"}`}>
          {now === null ? <Play size={14} /> : <Pause size={14} />}
        </button>
        <span className="font-medium">{head}</span>
        <span className={`rounded-full border px-2 text-xs ${tl.bad ? "border-bad/30 text-bad" : "border-ok/30 text-ok"}`}>{tl.verdict}</span>
        <span className="ml-auto font-mono text-xs text-dim">{tl.run}</span>
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H + (strip ? SH : 0)}`} className="block h-auto w-full" role="img" aria-label={`${head}: ${tl.note}`}>
          {tl.lines.map(([val, l], i) => val >= lo && val <= hi && (
            <g key={l}><line x1={PL} x2={W - PR} y1={y(val)} y2={y(val)} stroke={i ? "#fbbf24" : "#f87171"} strokeDasharray="4 3" opacity=".7" />
              <text x={W - PR + 4} y={y(val) + (air ? (i ? 10 : -2) : 3)} fontSize="9.5" fill={i ? "#fbbf24" : "#f87171"}>{l}</text></g>
          ))}
          {ticks.map(t => <text key={t} x={x(t)} y={H - PB + 14} textAnchor="middle" fontSize="9.5" fill="#5b616a">{air ? Math.round(t) : (t / 3600).toFixed(0)}</text>)}
          <text x={(PL + W - PR) / 2} y={H - 1} textAnchor="middle" fontSize="9.5" fill="#8a9099">{air ? "time (s)" : "time (h)"} · {tl.unit}</text>
          <polyline points={v.map((val, i) => `${x(i * dt).toFixed(1)},${y(val).toFixed(1)}`).join(" ")} fill="none" stroke={col} strokeWidth="1.8" opacity={now === null ? 1 : 0.35} />
          {now !== null && <polyline points={v.filter((_, i) => i * dt <= now).map((val, i) => `${x(i * dt).toFixed(1)},${y(val).toFixed(1)}`).join(" ")} fill="none" stroke={col} strokeWidth="2.2" />}
          {tl.events.map((e, i) => e.label && (
            <g key={i} opacity={now === null || fired.includes(i) ? 1 : 0.3}>
              <line x1={x(e.t)} x2={x(e.t)} y1={PT} y2={H - PB} stroke={TONE[e.tone]} strokeDasharray={e.clip ? "" : "2 3"} strokeWidth="1.2" />
              <circle cx={x(e.t)} cy={PT + 3} r="3" fill={TONE[e.tone]}><title>{`${e.label} · t=${fmt(e.t, air)} · ${e.detail}`}</title></circle>
            </g>
          ))}
          {strip && (
            <g transform={`translate(0 ${H})`}>
              <text x={PL} y={9} fontSize="9" fill="#8a9099">{tl.strip_label}</text>
              <polyline points={strip.map((s, i) => `${x(i * dt).toFixed(1)},${(SH - 4 - (s / sMax) * (SH - 16)).toFixed(1)}`).join(" ")} fill="none" stroke="#60a5fa" strokeWidth="1.4" />
            </g>
          )}
          {now !== null && <line x1={x(now)} x2={x(now)} y1={PT} y2={H + (strip ? SH : 0) - 4} stroke="#e5e7eb" strokeWidth="1.5" />}
        </svg>
        {latest && (
          <div key={latest.label + latest.t} className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 animate-pulse rounded border-2 px-3 py-1 font-mono text-sm font-bold tracking-widest"
            style={{ borderColor: TONE[latest.tone], color: TONE[latest.tone], background: "rgba(10,11,13,.85)" }}>
            {latest.label}
          </div>
        )}
      </div>
      <ol className="mt-2 space-y-1 text-sm">
        {tl.events.map((e, i) => e.label && (
          <li key={i} className={`flex gap-2 transition-opacity ${now === null || fired.includes(i) ? "" : "opacity-30"}`}>
            <span className="w-14 shrink-0 font-mono text-xs leading-5 text-dim">{fmt(e.t, air)}</span>
            <span className="shrink-0 font-mono text-xs font-semibold leading-5" style={{ color: TONE[e.tone] }}>{e.clip ? <Volume2 size={11} className="mr-1 inline" /> : null}{e.label}</span>
            <span className="min-w-0 text-xs leading-5 text-mute">{e.detail}</span>
          </li>
        ))}
        {!tl.events.some(e => e.label) && <li className="text-xs text-dim">No alerts in this run.</li>}
      </ol>
    </figure>
  );
}

/** Hear the failure: the simulated run's callouts played in sync with a playhead, before vs after side by side. */
export function CockpitCallouts({ getJSON, device, kind = "build", wkey, tick = "" }:
  { getJSON: GetJSON; device: string; kind?: "build" | "whatif"; wkey?: string; tick?: string }) {
  const b = useCallouts(getJSON, device, kind, wkey, tick);
  if (!b) return null;
  const { beat, recorded } = b;
  const air = device === "flight-controls";
  const panels: [Timeline, "before" | "after" | "whatif"][] = kind === "whatif"
    ? (beat.after ? [[beat.after, "whatif"]] : [])
    : [...(beat.before ? [[beat.before, "before"] as [Timeline, "before"]] : []), ...(beat.after ? [[beat.after, "after"] as [Timeline, "after"]] : [])];
  if (!panels.length) return null;
  const tl = panels[0][0];
  return (
    <section className="mb-8 rounded-lg border border-line bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-md font-semibold text-ink"><Volume2 size={15} className="mr-1.5 inline text-acc" />Hear the {air ? "cockpit" : "pump"}{kind === "whatif" ? "" : ": before vs after"}</h2>
        <span className="text-sm text-mute">{tl.label} · {tl.run}</span>
        <span className="ml-auto text-xs text-dim">
          {air ? "callouts" : "alarms"} derived from the simulation trace by code, no LLM · voices by ElevenLabs
          {recorded && beat.wo ? ` · recorded run ${beat.wo}` : recorded ? " · recorded run" : ""}
        </span>
      </div>
      <div className={`grid gap-3 ${panels.length > 1 ? "xl:grid-cols-2" : ""}`}>
        {panels.map(([t, side]) => <Panel key={side} tl={t} side={side} />)}
      </div>
    </section>
  );
}
