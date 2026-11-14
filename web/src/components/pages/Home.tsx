"use client";
import { cn } from "cn";
import { blocked, go, type Ctx } from "@/lib/ctx";
import { AgentIcon } from "@/components/Agents";
import { Composer } from "@/components/Composer";
import { Badge, Section } from "@/components/ui";

/** Agent-first home: one composer for the selected project, then the team and recent work. */
export function HomePage({ state, post, team, me, live, base }: Ctx) {
  const p = state.project!;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const agents = state.team.filter(m => m.kind === "agent" && m.id !== "coder-codex");
  const live_ = state.agents || {};
  const st = state.status;
  const busy = st?.busy;
  const wos = [...(state.work_orders || [])].reverse().slice(0, 5);
  const ask = async (text: string, skill: string) => {
    const r = await post("ask", { text, skill, project: p.id });
    if (r.error) return r.error === "factory busy" ? blocked(state, live) || "The factory is busy." : r.error;
    go(r.id ? `/p/${p.id}/work-orders/${r.id}` : `/p/${p.id}/world-model`);
  };
  const hydra = st?.hydradb || (st?.memory === "HydraDB" ? "connected" : "missing key");
  const comp = st?.composio_status || (st?.composio ? "connected" : "missing key");
  const connected: [string, "ok" | "warn" | "off", React.ReactNode][] = [
    ["Claude Code", "ok", "coding agent"],
    ["8090 Software Factory", st?.software_factory ? "ok" : "off", st?.software_factory ? "work orders via MCP" : "add key to connect"],
    ["HydraDB", hydra === "connected" ? "ok" : hydra === "missing key" ? "off" : "warn",
      { connected: "shared memory, live recall", connecting: "connecting…", "falling back": "unreachable: using local memory", "missing key": "add key to connect" }[hydra]],
    ["Composio", comp === "connected" ? "ok" : comp === "missing key" ? "off" : "warn",
      base === null ? "Connect on the live server"
        : comp === "not connected" ? <a href={`${base}/api/connect/composio`} target="_blank" rel="noopener" className="text-acc hover:underline">Connect GitHub</a>
        : { connected: "files evidence on GitHub", checking: "checking…", error: "unreachable: runs continue", "missing key": "add key to connect" }[comp]],
    ["ElevenLabs", !st?.elevenlabs || st.elevenlabs === "connected" ? "ok" : st.elevenlabs === "no agent" ? "warn" : "off",
      !st?.elevenlabs ? "recorded callouts and hotline call"
        : { connected: "cockpit callouts, safety hotline", "no agent": "run factory/hotline.py setup", "missing key": "add key to connect" }[st.elevenlabs]],
    ["Vercel", "ok", "hosting"],
  ];
  return (
    <>
      <div className="mx-auto mt-4 max-w-3xl md:mt-12">
        <h1 className="text-center text-3xl font-semibold tracking-tight">{greet}, {team[me]?.name.split(" ")[0]}.</h1>
        <p className="mb-7 mt-2 text-center text-md text-mute">What should the agent team build for {p.name}, or what should the world model try?</p>
        <Composer project={p} onSubmit={ask} disabledReason={blocked(state, live)} />
        {busy && (
          <p className="mt-4 flex items-center justify-center gap-2 text-sm text-run">
            <span className="pulse size-1.5 rounded-full bg-run" />
            Agents are working on <a href={`#/p/${st?.project || p.id}/${st?.running ? `work-orders/${st.running}` : "world-model"}`} className="underline underline-offset-2">{st?.running || "a simulation"}</a>
            <a href={`#/p/${st?.project || p.id}/agents`} className="underline underline-offset-2">Watch the team</a>
          </p>
        )}
      </div>

      <div className="mx-auto mt-16 max-w-5xl">
        <Section title="Your agent team" aside={<a href={`#/p/${p.id}/agents`} className="hover:text-ink">All agents</a>}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {agents.map(a => {
              const l = live_[a.id];
              const s = l?.state === "working" && !busy ? "idle" : l?.state || "idle";
              const t = s === "working" ? "run" : s === "blocked" ? "bad" : l?.done ? "ok" : "idle";
              return (
                <a key={a.id} href={`#/p/${p.id}/agents/${a.id}`}
                  className={cn("block rounded-xl border bg-panel p-3.5 transition-colors hover:border-line-strong hover:bg-panel2", t === "run" ? "border-run/40" : "border-line")}>
                  <div className="flex items-center gap-2.5">
                    <AgentIcon id={a.id} size={26} />
                    <span className="truncate text-base font-medium">{a.name}</span>
                    <span className={cn("ml-auto size-1.5 shrink-0 rounded-full", t === "run" ? "pulse bg-run" : t === "bad" ? "bg-bad" : t === "ok" ? "bg-ok" : "bg-line-strong")} />
                  </div>
                  <p className="mt-2.5 line-clamp-2 min-h-[2.6em] text-sm leading-snug text-mute">{l?.msg || a.role}</p>
                  <div className="mt-2 text-xs text-dim">{l ? `${s === "working" ? "working" : "idle"} · ${l.done} step${l.done === 1 ? "" : "s"} done${l.wo ? ` · ${l.wo}` : ""}` : "idle · not run yet"}</div>
                </a>
              );
            })}
          </div>
        </Section>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Section title="Recent work orders" aside={<a href={`#/p/${p.id}/work-orders`} className="hover:text-ink">View all</a>}>
            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
              {wos.length ? wos.map(w => (
                <a key={w.id} href={`#/p/${p.id}/work-orders/${w.id}`} className="flex items-center gap-3 px-4 py-3 text-base transition-colors hover:bg-white/[.03]">
                  <span className="font-mono text-sm text-dim">{w.id}</span>
                  <span className="min-w-0 flex-1 truncate">{w.title}</span>
                  <Badge>{w.status}</Badge>
                </a>
              )) : <p className="px-4 py-6 text-center text-base text-dim">Nothing built for {p.name} yet. Describe a change above.</p>}
            </div>
          </Section>
          <Section title="Connected" aside={<a href={`#/p/${p.id}/integrations`} className="hover:text-ink">Manage integrations</a>}>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel text-base">
              {connected.map(([n, tone, what]) => (
                <li key={n} className="flex items-center gap-2.5 px-4 py-2.5">
                  <span className={cn("size-1.5 rounded-full", tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-run" : "bg-line-strong")} />
                  <span className={tone === "off" ? "text-mute" : ""}>{n}</span>
                  <span className="ml-auto text-right text-sm text-dim">{what}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
