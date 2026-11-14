"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Conversation } from "@elevenlabs/client";
import { Mic, Phone, PhoneOff, Play, Square } from "lucide-react";
import type { State } from "@/lib/api";
import { Ago, Badge, Button, PageHead, Section } from "@/components/ui";

/* Types of factory/incidents.py */
type Turn = { role: "agent" | "caller" | "tool"; text: string; t?: number };
export type Incident = {
  id: string; ts: number; project: string; device: string; caller: string; what: string; when: string; severity: string; context: string;
  summary: string; hazard: { id: string; title: string; severity?: string; score: number; matched: string[] }; wo: string; link: string;
  conversation_id: string; source: "live" | "simulated" | "recorded"; transcript: Turn[]; memory: { id: string; backend: string; ms?: number; collection?: string };
};
type Sample = { conversation_id: string; agent_id: string; duration: number; audio: string; turns: Turn[]; incident: Incident };
type Props = {
  state: State; live: boolean; base: string | null; id?: string;
  post: (p: string, b: object) => Promise<{ error?: string; id?: string }>; getJSON: <T>(p: string) => Promise<T | null>;
};
type CallStatus = "idle" | "connecting" | "connected" | "ended" | "error";

/** Incidents from the factory server, else the recorded sample call's incident (hosted site). */
function useIncidents(getJSON: Props["getJSON"], live: boolean, project: string, tick: number) {
  const [list, setList] = useState<Incident[] | null>(null);
  const [sample, setSample] = useState<Sample | null>(null);
  useEffect(() => {
    let stop = false;
    (async () => {
      const s = await fetch("/hotline/sample-call.json").then(r => (r.ok ? r.json() as Promise<Sample> : null)).catch(() => null);
      const l = live ? (await getJSON<{ incidents: Incident[] }>(`incidents?project=${encodeURIComponent(project)}`))?.incidents ?? null : null;
      if (stop) return;
      setSample(s);
      setList(l ?? (s && s.incident.project === project ? [s.incident] : []));
    })();
    return () => { stop = true; };
  }, [getJSON, live, project, tick]);
  return { list, sample };
}

function Transcript({ turns, at }: { turns: Turn[]; at?: number | null }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (at === undefined) end.current?.scrollIntoView({ block: "nearest" }); }, [turns.length, at]);
  return (
    <div className="scroll-thin max-h-80 space-y-2 overflow-y-auto rounded-md bg-bg p-3 text-sm">
      {turns.map((t, i) => {
        const dim = at != null && t.t != null && t.t > at;
        return t.role === "tool" ? (
          <div key={i} className={`font-mono text-xs text-acc ${dim ? "opacity-25" : ""}`}>⚙ {t.text}</div>
        ) : (
          <div key={i} className={`flex gap-2 transition-opacity ${dim ? "opacity-25" : ""}`}>
            <span className={`w-14 shrink-0 text-xs font-medium uppercase leading-5 tracking-wide ${t.role === "agent" ? "text-acc" : "text-warn"}`}>{t.role === "agent" ? "Hotline" : "Caller"}</span>
            <span className="leading-5 text-ink">{t.text}</span>
          </div>
        );
      })}
      {!turns.length && <p className="text-dim">The transcript appears here as you talk.</p>}
      <div ref={end} />
    </div>
  );
}

/** Call the hotline from the browser: an ElevenLabs agent session (WebRTC, token from the factory server). Its
 *  create_incident tool runs here and files the report with the factory (POST /api/incidents). */
function LiveCall({ post, base, onFiled }: { post: Props["post"]; base: string; onFiled: () => void }) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [mode, setMode] = useState("listening");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [err, setErr] = useState("");
  const conv = useRef<Conversation | null>(null);
  const filed = useRef<string | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const add = (t: Turn) => { turnsRef.current = [...turnsRef.current, t]; setTurns(turnsRef.current); };

  const finish = useCallback(async () => {
    const c = conv.current;
    conv.current = null;
    if (filed.current) {
      await post("incidents/transcript", { id: filed.current, conversation_id: c?.getId() || "", transcript: turnsRef.current.filter(t => t.role !== "tool") });
      onFiled();
    }
  }, [post, onFiled]);

  const start = async () => {
    setErr(""); setTurns([]); turnsRef.current = []; filed.current = null; setStatus("connecting");
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = await fetch(`${base}/api/hotline/token`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "no token");
      conv.current = await Conversation.startSession({
        conversationToken: j.token, connectionType: "webrtc",
        clientTools: {
          create_incident: async (p: Record<string, string>) => {
            const res = await post("incidents", { ...p, conversation_id: conv.current?.getId() || "", source: "live", transcript: turnsRef.current });
            if (res.error) return JSON.stringify({ error: res.error });
            const inc = res as unknown as Incident;
            filed.current = inc.id;
            add({ role: "tool", text: `create_incident → ${inc.id}, ${inc.wo}, ${inc.hazard.id} ${inc.hazard.title}` });
            onFiled();
            return JSON.stringify({ incident: inc.id, work_order: inc.wo, hazard: `${inc.hazard.id} ${inc.hazard.title}` });
          },
        },
        onMessage: m => add({ role: m.role === "agent" ? "agent" : "caller", text: m.message }),
        onModeChange: m => setMode(m.mode),
        onStatusChange: s => setStatus(s.status === "connected" ? "connected" : s.status === "connecting" ? "connecting" : "ended"),
        onDisconnect: () => { setStatus("ended"); finish(); },
        onError: m => setErr(String(m)),
      });
    } catch (e) {
      setStatus("error");
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const hang = async () => { await conv.current?.endSession(); };
  useEffect(() => () => { conv.current?.endSession(); }, []);

  const on = status === "connecting" || status === "connected";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {!on ? <Button primary onClick={start}><Phone size={14} /> Call safety hotline</Button>
          : <Button onClick={hang}><PhoneOff size={14} /> Hang up</Button>}
        {on && <span className="inline-flex items-center gap-2 text-sm text-mute"><span className={`size-2 rounded-full ${status === "connected" ? "pulse bg-ok" : "bg-warn"}`} />
          {status === "connecting" ? "Connecting…" : mode === "speaking" ? "Hotline is speaking" : <><Mic size={13} /> Listening: describe what happened</>}</span>}
        {status === "ended" && <span className="text-sm text-mute">Call ended.{filed.current ? ` Filed ${filed.current}.` : ""}</span>}
        {err && <span className="text-sm text-bad">{err}</span>}
      </div>
      {(on || turns.length > 0) && <Transcript turns={turns} />}
    </div>
  );
}

/** The recorded sample call (a real hotline conversation, voiced): plays with the transcript in sync. */
function RecordedCall({ sample }: { sample: Sample }) {
  const [at, setAt] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const a = new Audio(sample.audio);
    a.preload = "auto";
    a.ontimeupdate = () => setAt(a.currentTime);
    a.onended = () => setAt(null);
    audio.current = a;
    return () => { a.pause(); };
  }, [sample.audio]);
  const playing = at !== null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => { const a = audio.current!; if (playing) { a.pause(); a.currentTime = 0; setAt(null); } else { a.currentTime = 0; setAt(0); a.play().catch(() => setAt(null)); } }}>
          {playing ? <><Square size={13} /> Stop</> : <><Play size={13} /> Play recorded call</>}
        </Button>
        <span className="text-sm text-mute">{Math.round(sample.duration)} s · real conversation with the hotline agent ({sample.conversation_id.slice(0, 14)}…), voiced for replay</span>
      </div>
      <Transcript turns={sample.turns} at={at ?? (playing ? 0 : undefined)} />
    </div>
  );
}

function IncidentCard({ inc, pid }: { inc: Incident; pid: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <a href={`#/p/${pid}/incidents/${inc.id}`} className="font-mono text-sm font-semibold hover:underline">{inc.id}</a>
        <span className="text-base text-ink">{inc.summary}</span>
        <span className="ml-auto text-xs text-dim">{inc.source} · <Ago ts={inc.ts} /></span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        <a href={`#/p/${pid}/work-orders/${inc.wo}`} className="rounded border border-line px-2 py-0.5 hover:border-white/30">Work order <b className="font-mono">{inc.wo}</b> <Badge tone="Draft">draft</Badge></a>
        <a href={`#/p/${pid}/traceability/${inc.hazard.id}`} className="rounded border border-bad/30 px-2 py-0.5 text-bad hover:border-bad/60">Traced to {inc.hazard.id} {inc.hazard.title}</a>
        <span className="rounded border border-line px-2 py-0.5 text-mute">Memory: {inc.memory.backend}{inc.memory.collection ? ` · ${inc.memory.collection}` : ""}</span>
        <span className="rounded border border-line px-2 py-0.5 text-mute">Severity (caller): {inc.severity}</span>
      </div>
    </div>
  );
}

function IncidentDetail({ inc, pid }: { inc: Incident; pid: string }) {
  const rows: [string, string][] = [["Caller", inc.caller || "not named"], ["What happened", inc.what], ["When", inc.when || "not stated"],
    ["Severity (caller)", inc.severity], ["Context", inc.context || "none given"],
    ["Hazard match", `${inc.hazard.id} ${inc.hazard.title} · keyword overlap ${inc.hazard.score}: ${inc.hazard.matched.join(", ") || "none"}`],
    ["Conversation", inc.conversation_id || "—"]];
  return (
    <>
      <IncidentCard inc={inc} pid={pid} />
      <dl className="mt-4 grid gap-y-2 text-sm">
        {rows.map(([k, v]) => <div key={k} className="grid grid-cols-[10rem_1fr] gap-3 border-b border-line/60 pb-2"><dt className="text-dim">{k}</dt><dd className="text-ink">{v}</dd></div>)}
      </dl>
      <Section title="Transcript"><Transcript turns={inc.transcript} at={null} /></Section>
    </>
  );
}

/* ---------- page: #/p/<project>/incidents[/<INC-n>] ---------- */
export function Incidents({ state, live, base, post, getJSON, id }: Props) {
  const p = state.project!;
  const [tick, setTick] = useState(0);
  const [cfg, setCfg] = useState<{ live: boolean; agent_id: string | null } | null>(null);
  const { list, sample } = useIncidents(getJSON, live, p.id, tick);
  useEffect(() => { if (live) getJSON<{ live: boolean; agent_id: string | null }>("hotline").then(setCfg); }, [live, getJSON]);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  const one = id ? list?.find(x => x.id === id) : null;
  const agent = cfg?.agent_id || sample?.agent_id;
  return (
    <>
      <PageHead title="Incidents" sub={<>Safety hotline: call in an incident and it becomes a traced draft work order, a memory item and a link to the most likely hazard. Voice agent by ElevenLabs{agent ? <> · agent <code className="font-mono text-xs">{agent}</code></> : null}.</>} />
      {one ? <IncidentDetail inc={one} pid={p.id} /> : (
        <>
          <Section title="Call the hotline" aside={cfg?.live ? "live: your microphone, the ElevenLabs agent, this factory" : "recorded sample call"}>
            <div className="rounded-lg border border-line bg-panel p-4">
              {cfg?.live && base !== null ? <LiveCall post={post} base={base} onFiled={refresh} /> : sample ? <RecordedCall sample={sample} /> : <p className="text-sm text-dim">Hotline not configured: set ELEVENLABS_API_KEY in .env and run <code className="font-mono">factory/hotline.py setup</code> (docs/HOTLINE.md).</p>}
              {cfg?.live && sample && <details className="mt-4"><summary className="cursor-pointer text-sm text-mute">Recorded sample call</summary><div className="mt-3"><RecordedCall sample={sample} /></div></details>}
            </div>
          </Section>
          <Section title="Reported incidents">
            <div className="space-y-3">
              {list?.map(inc => <IncidentCard key={inc.id} inc={inc} pid={p.id} />)}
              {list && !list.length && <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-base text-dim">No incidents on this project yet.</p>}
            </div>
          </Section>
        </>
      )}
    </>
  );
}
