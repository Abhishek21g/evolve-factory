"use client";
import { useCallback, useEffect, useState } from "react";
import { Bot, Check, Copy, Database, ExternalLink, Factory, FileStack, Github, Info, Plus, Server, Terminal, Trash2, Triangle } from "lucide-react";
import type { State } from "@/lib/api";
import { Button as KitButton } from "@/components/kit/button";
import { Input } from "@/components/kit/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/kit/tabs";
import { Badge, Button, LOCAL_ONLY, PageHead, Section, TONE_CLS } from "@/components/ui";

type Tone = "ok" | "warn" | "off";
type Tool = { id: string; name: string; tone: Tone; detail: string; use: string; connect?: string | null; url?: string };
type Plugin = { id: string; name: string; category: string; use: string; via: string; connected: boolean; logo: string };
type McpServer = { name: string; transport: "http" | "stdio"; url: string; command: string };
type Probe = { ok: boolean; ms?: number; server?: string; protocol?: string; tools?: { name: string; description: string }[]; error?: string };
type Overview = {
  connected: Tool[]; catalog: Plugin[]; composio: { key: boolean; checked: number | null; error: string | null };
  requirements_tools: { name: string; use: string }[];
  mcp: { servers: McpServer[]; self: { tools: { name: string; description: string }[]; python: string; script: string } };
};
type Props = { state: State; live: boolean; base: string | null; getJSON: <T>(p: string) => Promise<T | null>; post: (p: string, b: object) => Promise<unknown> };

const SELF = "certus-factory";
const ICONS: Record<string, typeof Bot> = { "claude-code": Bot, "software-factory": Factory, hydradb: Database, composio: Github, vercel: Triangle };
const DOT: Record<Tone, string> = { ok: "bg-ok shadow-[0_0_8px] shadow-ok/50", warn: "bg-run", off: "bg-[#2a2f36]" };
const CATALOG: [string, string, string, string][] = [
  ["slack", "Slack", "Communication", "Post verdicts and blocked merges to the safety channel"],
  ["linear", "Linear", "Issues", "Turn Linear issues into work orders and close them with evidence"],
  ["jira", "Jira", "Issues", "Sync work orders and change requests with Jira"],
  ["notion", "Notion", "Docs", "Pull design reviews and meeting notes into org memory"],
  ["googledrive", "Google Drive", "Docs", "Import hazard analyses and test protocols"],
  ["sentry", "Sentry", "Monitoring", "Field errors become hazards to review"],
  ["datadog", "Datadog", "Monitoring", "Fleet telemetry for the world model"],
  ["neon", "Neon", "Database", "Postgres for the audit trail and evidence index"],
];
const SELF_TOOLS = [
  ["list_projects", "Projects in the factory: device, safety standard, world model."],
  ["get_trace", "Trace of a safety requirement: hazards, clauses, code lines, test result, work orders, gaps."],
  ["get_verdict", "Merge verdict of a work order: requirement tests, world-model verdict, evidence."],
  ["list_gaps", "Coverage gaps: untested or unlinked requirements, unmitigated hazards, untraced code."],
  ["recall_memory", "Search org memory, the regulatory knowledge base and lessons from past verdicts."],
] as const;

/** Read-only snapshot (Vercel): status from the bundled state, nothing can be connected from here. */
function snapshotOverview(state: State): Overview {
  const st = state.status;
  const hydra = st?.hydradb || (st?.memory === "HydraDB" ? "connected" : "missing key");
  const gh = st?.composio_status || (st?.composio ? "connected" : "missing key");
  return {
    connected: [
      { id: "claude-code", name: "Claude Code", tone: "ok", detail: "coding agent", use: "Writes each change in its own git worktree" },
      { id: "software-factory", name: "8090 Software Factory", tone: st?.software_factory ? "ok" : "off", detail: st?.software_factory ? "work orders and reports via REST" : "not connected in this snapshot", use: "Requirements, blueprints and work orders come from Software Factory" },
      { id: "hydradb", name: "HydraDB", tone: hydra === "connected" ? "ok" : "off", detail: hydra === "connected" ? "shared memory, live recall" : "not connected in this snapshot", use: "Org memory, regulatory knowledge base, lessons from every verdict" },
      { id: "composio", name: "Composio · GitHub", tone: gh === "connected" ? "ok" : "off", detail: gh === "connected" ? "files evidence as GitHub issues" : "not connected in this snapshot", use: "Files the evidence pack on GitHub after every verdict" },
      { id: "elevenlabs", name: "ElevenLabs", tone: "ok", detail: "recorded callouts and a recorded hotline call", use: "Cockpit callouts from the simulation, the safety hotline voice agent" },
      { id: "vercel", name: "Vercel", tone: "ok", detail: "you are on certus-factory-ten.vercel.app", use: "Hosts the read-only snapshot of the factory", url: "https://certus-factory-ten.vercel.app" },
    ],
    catalog: CATALOG.map(([id, name, category, use]) => ({ id, name, category, use, via: "Composio", connected: false, logo: `https://logos.composio.dev/api/${id}` })),
    composio: { key: false, checked: null, error: null },
    requirements_tools: [
      { name: "Jama Connect", use: "Requirements, hazards and trace links" }, { name: "IBM DOORS Next", use: "Requirements modules and link types" },
      { name: "Polarion ALM", use: "Work items, test runs and risk records" }, { name: "Ketryx", use: "IEC 62304 design controls and SOUP" },
    ],
    mcp: { servers: [], self: { tools: SELF_TOOLS.map(([name, description]) => ({ name, description })), python: ".venv/bin/python", script: "factory/mcp_server.py" } },
  };
}

export function Integrations({ state, live, base, getJSON, post }: Props) {
  const [data, setData] = useState<Overview | null>(null);
  const [probes, setProbes] = useState<Record<string, Probe | "testing">>({});
  const load = useCallback(async () => setData(await getJSON<Overview>("integrations")), [getJSON]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load, live]);
  const o = data || snapshotOverview(state);
  const test = async (name: string) => {
    setProbes(p => ({ ...p, [name]: "testing" }));
    const r = await post("integrations/mcp/test", { name }) as Probe;
    setProbes(p => ({ ...p, [name]: r.error && r.ok === undefined ? { ok: false, error: r.error } : r }));
  };
  const remove = async (name: string) => { await post("integrations/mcp/delete", { name }); load(); };
  const connectUrl = (id: string) => `${base}/api/integrations/connect?toolkit=${id}`;
  const factoryUrl = base === null ? "http://localhost:8787/mcp" : `${base || location.origin}/mcp`;

  return (
    <>
      <div className="mb-1 text-sm text-dim">Settings / Integrations</div>
      <PageHead title="Integrations" sub="The tools and agents the factory works with. Status is read live from the factory server; nothing on this page is shown as connected unless it is." />
      {!live && (
        <div className="-mt-3 mb-8 flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-2.5 text-sm text-mute">
          <Info size={15} className="shrink-0 text-acc" /> Read-only snapshot: connecting tools and adding MCP servers works on the live factory (<code className="font-mono text-ink">demo/go.sh live</code>).
        </div>
      )}

      <Section title="Connected now" aside={o.composio.checked ? `checked ${Math.round(Date.now() / 1000 - o.composio.checked)}s ago` : undefined}>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" data-testid="connected-now">
          {o.connected.map(t => {
            const Icon = ICONS[t.id] || Server;
            return (
              <div key={t.id} className="rounded-lg border border-line bg-panel p-3.5">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-md border border-line bg-bg text-mute"><Icon size={15} /></span>
                  <span className="text-base font-medium leading-tight">{t.name}</span>
                  <span className={`ml-auto size-2 shrink-0 rounded-full ${DOT[t.tone]}`} title={t.tone} />
                </div>
                <p className={`mt-2.5 text-sm ${t.tone === "ok" ? "text-ink" : "text-mute"}`}>{t.detail}</p>
                <p className="mt-1 text-xs leading-snug text-dim">{t.use}</p>
                {t.connect && live && <a href={connectUrl(t.connect)} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1 text-sm text-acc hover:underline">Connect GitHub <ExternalLink size={12} /></a>}
                {t.url && <a href={t.url} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1 text-xs text-mute hover:text-ink">Open site <ExternalLink size={11} /></a>}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Plugins" aside={o.composio.key ? "connected through Composio · one click, OAuth handled by Composio" : live ? "add COMPOSIO_API_KEY to connect" : "via Composio"}>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="catalog">
          {o.catalog.map(p => (
            <div key={p.id} className="flex gap-3 rounded-lg border border-line bg-panel p-3.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- remote logo on a static export */}
              <img src={p.logo} alt="" width={32} height={32} className="size-8 shrink-0 rounded-md bg-white p-1" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-base font-medium">{p.name}</span>
                  <span className="rounded border border-line px-1.5 py-px text-2xs text-dim">{p.category}</span>
                </div>
                <p className="mt-1 text-sm leading-snug text-mute">{p.use}</p>
              </div>
              <div className="shrink-0 self-center">
                {p.connected ? <Badge tone="ok">Connected</Badge>
                  : <span title={live ? `Authorize ${p.name} for the factory in Composio` : LOCAL_ONLY} className="inline-flex"><KitButton variant="outline" size="sm" disabled={!live || !o.composio.key}
                    onClick={() => window.open(connectUrl(p.id), "_blank", "noopener")}>Connect <ExternalLink size={12} /></KitButton></span>}
              </div>
            </div>
          ))}
        </div>
        {o.composio.error && <p className="mt-2 text-sm text-run">Composio did not answer ({o.composio.error}); status will refresh.</p>}
      </Section>

      <Section title="Requirements and ALM tools" aside="import hazards and requirements into the trace">
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {o.requirements_tools.map(t => (
            <div key={t.name} className="rounded-lg border border-dashed border-line p-3.5">
              <div className="flex items-center gap-2">
                <FileStack size={15} className="text-dim" />
                <span className="text-base font-medium">{t.name}</span>
              </div>
              <p className="mt-1 text-sm text-mute">{t.use}</p>
              <KitButton variant="outline" size="sm" disabled className="mt-3">Import requirements (coming soon)</KitButton>
            </div>
          ))}
        </div>
      </Section>

      <Section title="MCP servers">
        <div className="grid gap-6 xl:grid-cols-2">
          <SelfServer o={o} live={live} factoryUrl={factoryUrl} probe={probes[SELF]} onTest={() => test(SELF)} />
          <div className="space-y-4">
            <AddServer live={live} post={post} onAdded={load} />
            <div className="divide-y divide-line rounded-lg border border-line" data-testid="mcp-servers">
              {o.mcp.servers.map(s => (
                <div key={s.name} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Server size={14} className="text-dim" />
                    <span className="text-base font-medium">{s.name}</span>
                    <span className="rounded border border-line px-1.5 py-px font-mono text-2xs uppercase text-dim">{s.transport}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-mute">{s.url || s.command}</span>
                    <KitButton variant="outline" size="sm" onClick={() => test(s.name)} disabled={!live || probes[s.name] === "testing"}>
                      {probes[s.name] === "testing" ? "Testing…" : "Test connection"}
                    </KitButton>
                    <KitButton variant="ghost" size="icon-sm" aria-label={`Remove ${s.name}`} onClick={() => remove(s.name)} disabled={!live}><Trash2 size={14} /></KitButton>
                  </div>
                  <ProbeResult p={probes[s.name]} />
                </div>
              ))}
              {!o.mcp.servers.length && <p className="px-4 py-5 text-center text-sm text-dim">No MCP servers added yet. They are saved to <code className="font-mono">.runs/mcp.json</code> in Cursor&apos;s format.</p>}
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}

function ProbeResult({ p }: { p?: Probe | "testing" }) {
  if (!p || p === "testing") return null;
  if (!p.ok) return <p className="mt-2 text-sm text-bad">Could not connect: {p.error}</p>;
  return (
    <div className="mt-2.5" data-testid="probe-ok">
      <p className="flex items-center gap-1.5 text-sm text-ok"><Check size={14} /> Connected to {p.server} · MCP {p.protocol} · {p.tools?.length} tools in {p.ms} ms</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {p.tools?.map(t => <span key={t.name} title={t.description} className={`rounded-full border px-2 py-0.5 font-mono text-xs ${TONE_CLS.idle}`}>{t.name}</span>)}
      </div>
    </div>
  );
}

function AddServer({ live, post, onAdded }: { live: boolean; post: Props["post"]; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"http" | "stdio">("http");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await post("integrations/mcp", { name, transport, target }) as { error?: string };
    if (r.error) return setErr(r.error);
    setErr(""); setName(""); setTarget(""); onAdded();
  };
  const preset = (n: string, u: string) => { setName(n); setTransport("http"); setTarget(u); };
  return (
    <form onSubmit={submit} className="rounded-lg border border-line bg-panel p-4" data-testid="add-mcp">
      <div className="mb-3 flex items-center gap-2 text-base font-medium"><Plus size={15} className="text-acc" /> Add MCP server</div>
      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Name, e.g. deepwiki" aria-label="Server name" required />
        <div className="flex overflow-hidden rounded-md border border-line text-sm" role="radiogroup" aria-label="Transport">
          {(["http", "stdio"] as const).map(t => (
            <button type="button" key={t} role="radio" aria-checked={transport === t} onClick={() => setTransport(t)}
              className={`px-3 ${transport === t ? "bg-white/[.08] text-ink" : "text-mute hover:text-ink"}`}>{t === "http" ? "HTTP" : "stdio"}</button>
          ))}
        </div>
        <Input value={target} onChange={e => setTarget(e.target.value)} className="font-mono text-sm sm:col-span-2" required aria-label={transport === "http" ? "URL" : "Command"}
          placeholder={transport === "http" ? "https://example.com/mcp" : "npx -y @modelcontextprotocol/server-filesystem ."} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-dim">Try:</span>
        <button type="button" onClick={() => preset("deepwiki", "https://mcp.deepwiki.com/mcp")} className="rounded-full border border-line px-2 py-0.5 text-xs text-mute hover:text-ink">DeepWiki (public)</button>
        <button type="button" onClick={() => preset("certus-factory-http", "http://localhost:8787/mcp")} className="rounded-full border border-line px-2 py-0.5 text-xs text-mute hover:text-ink">Certus Factory (HTTP)</button>
        <span className="flex-1" />
        <Button primary type="submit" disabled={!live || !name.trim() || !target.trim()} title={live ? undefined : LOCAL_ONLY}>Add server</Button>
      </div>
      {transport === "stdio" && <p className="mt-2 text-xs text-dim">stdio servers are saved for your MCP clients; the factory never starts local commands from the browser, so only HTTP servers can be tested here.</p>}
      {err && <p className="mt-2 text-sm text-bad">{err}</p>}
    </form>
  );
}

function SelfServer({ o, live, factoryUrl, probe, onTest }: { o: Overview; live: boolean; factoryUrl: string; probe?: Probe | "testing"; onTest: () => void }) {
  const { python, script, tools } = o.mcp.self;
  const stdio = JSON.stringify({ mcpServers: { [SELF]: { command: python, args: [script] } } }, null, 2);
  const snippets = [
    ["cursor", "Cursor", ".cursor/mcp.json in the repo (paths are relative to the repo root)", stdio],
    ["claude-code", "Claude Code", "terminal, from the repo root", `claude mcp add ${SELF} -- ${python} ${script}`],
    ["claude-desktop", "Claude Desktop", "claude_desktop_config.json (prefix both paths with where you cloned the repo)", stdio],
    ["http", "HTTP", "while the factory server runs", `claude mcp add --transport http ${SELF} ${factoryUrl}\n\n${JSON.stringify({ mcpServers: { [SELF]: { url: factoryUrl } } }, null, 2)}`],
  ] as const;
  return (
    <div className="rounded-lg border border-acc/30 bg-panel p-4" data-testid="certus-mcp">
      <div className="flex items-center gap-2">
        <Terminal size={15} className="text-acc" />
        <span className="text-base font-medium">Certus Factory as an MCP server</span>
        <span className="rounded border border-line px-1.5 py-px text-2xs text-dim">read-only</span>
        <span className="flex-1" />
        <span title={live ? undefined : LOCAL_ONLY} className="inline-flex"><KitButton variant="outline" size="sm" onClick={onTest} disabled={!live || probe === "testing"}>{probe === "testing" ? "Testing…" : "Test connection"}</KitButton></span>
      </div>
      <p className="mt-1.5 text-sm text-mute">Claude Code, Cursor or any MCP client can query the safety record: traces, verdicts, gaps and memory.</p>
      <ProbeResult p={probe} />
      <ul className="mt-3 space-y-1">
        {tools.map(t => (
          <li key={t.name} className="flex gap-2 text-sm"><code className="shrink-0 font-mono text-xs text-acc">{t.name}</code><span className="line-clamp-1 text-dim" title={t.description}>{t.description}</span></li>
        ))}
      </ul>
      <Tabs defaultValue="cursor" className="mt-4">
        <TabsList>{snippets.map(([k, l]) => <TabsTrigger key={k} value={k}>{l}</TabsTrigger>)}</TabsList>
        {snippets.map(([k, , where, code]) => (
          <TabsContent key={k} value={k}>
            <Snippet code={code} where={where} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function Snippet({ code, where }: { code: string; where: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(code).catch(() => null); setDone(true); setTimeout(() => setDone(false), 1500); };
  return (
    <div className="relative">
      <p className="mb-1.5 text-xs text-dim">{where}</p>
      <pre className="scroll-thin overflow-x-auto rounded-md border border-line bg-bg p-3 pr-12 font-mono text-xs leading-relaxed text-ink">{code}</pre>
      <KitButton variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy" className="absolute right-2 top-7">{done ? <Check size={14} className="text-ok" /> : <Copy size={14} />}</KitButton>
    </div>
  );
}
