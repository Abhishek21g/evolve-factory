"use client";
import { useMemo, useState, type ReactNode } from "react";
import { BookOpen, Code2, ExternalLink, FileCheck2, FlaskConical, Link2, ListChecks, Plus, Scale, TestTube2, X } from "lucide-react";
import type { State } from "@/lib/api";
import { githubUrl, where, type HazardRow, type Target, type TraceRow } from "@/lib/trace";
import dynamic from "next/dynamic";
// The graph library is large: load it only when the graph is shown.
const TraceGraph = dynamic(() => import("@/components/TraceGraph").then(m => m.TraceGraph), { ssr: false, loading: () => <div className="h-[620px] animate-pulse rounded-lg border border-line bg-panel" /> });
import { Badge, Button, LOCAL_ONLY, PageHead, Section, TONE_CLS } from "@/components/ui";
import { GateNote } from "@/components/GateNote";
import { AddLink, type Draft } from "./AddLink";
import { CodeLines, Drawer, GithubLink, TestResult, useFile, type Api } from "./Viewer";

type Props = {
  state: State; live: boolean; item: string;
  post: (p: string, b: object) => Promise<{ error?: string }>;
  getJSON: <T>(p: string) => Promise<T | null>;
  text: (p: string) => Promise<string>;
};

const ICON: Record<Target["kind"], ReactNode> = {
  clause: <Scale size={11} />, code: <Code2 size={11} />, doc: <BookOpen size={11} />, test: <TestTube2 size={11} />, url: <ExternalLink size={11} />,
  scenario: <FlaskConical size={11} />, work_order: <ListChecks size={11} />, evidence: <FileCheck2 size={11} />, simulation: <FlaskConical size={11} />,
};
const TONE: Record<string, string> = { ok: "bg-ok", fail: "bg-bad", warn: "bg-warn" };
const of = (ts: Target[], ...kinds: Target["kind"][]) => ts.filter(t => kinds.includes(t.kind));

/** One clickable trace target: opens code/doc/test in the viewer, a work order page, or an external URL. */
function Chip({ t, open, pid, onRemove }: { t: Target; open: (t: Target) => void; pid: string; onRemove?: (id: string) => void }) {
  const cls = `group inline-flex min-w-0 max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-xs hover:border-white/25 hover:text-ink ${t.link ? "border-acc/30 bg-acc/[.05] text-ink" : "border-line bg-white/[.02] text-mute"}`;
  const inner = <>
    <span className="shrink-0 text-dim">{ICON[t.kind]}</span>
    {t.tone && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[t.tone] || ""}`} />}
    <span className={`truncate ${t.kind === "code" || t.kind === "test" ? "font-mono text-xs" : ""}`}>{t.label}</span>
  </>;
  const title = `${t.label}${t.note ? ` · ${t.note}` : ""}${t.path || t.url ? `\n${where(t)}` : ""}`;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center">
      {t.kind === "work_order" ? <a href={`#/p/${pid}/work-orders/${t.wo}`} className={cls} title={title}>{inner}</a>
        : t.kind === "url" ? <a href={t.url} target="_blank" rel="noopener" className={cls} title={title}>{inner}</a>
        : <button type="button" onClick={() => open(t)} className={cls} title={title}>{inner}</button>}
      {onRemove && t.link && (
        <button type="button" onClick={() => onRemove(t.link!)} aria-label={`Remove link ${t.link}`} title="Remove this link"
          className="ml-0.5 rounded p-0.5 text-dim hover:bg-bad/10 hover:text-bad"><X size={11} /></button>
      )}
    </span>
  );
}

const Chips = ({ ts, ...p }: { ts: Target[]; open: (t: Target) => void; pid: string; onRemove?: (id: string) => void }) =>
  ts.length ? <div className="flex min-w-0 flex-wrap gap-1">{ts.map((t, i) => <Chip key={i} t={t} {...p} />)}</div> : <span className="text-xs text-dim">—</span>;

/** Fixed-layout matrix: columns share the width (percent per column) and long chips truncate with a tooltip. */
function Matrix({ cols, children }: { cols: [string, number][]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[960px] table-fixed text-left text-sm">
        <colgroup>{cols.map(([h, w]) => <col key={h} style={{ width: `${w}%` }} />)}</colgroup>
        <thead className="bg-white/[.02] text-xs text-mute">
          <tr>{cols.map(([h]) => <th key={h} className="truncate px-2 py-2 font-medium" title={h}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const TD = "min-w-0 px-2 py-2.5";

const Ids = ({ ids, pid }: { ids: string[]; pid: string }) => (
  <div className="flex flex-wrap gap-1">
    {ids.map(i => <a key={i} href={`#/p/${pid}/traceability/${i}`} className="rounded border border-line px-1.5 py-0.5 font-mono text-xs text-mute hover:text-ink">{i}</a>)}
  </div>
);

/** Links people added to a row, and the + that adds one (local factory only: links are saved to the repo). */
const Added = ({ ts, id, ctx, live, add }: { ts: Target[]; id: string; ctx: Ctx; live: boolean; add: () => void }) => (
  <div className="flex min-w-0 flex-wrap items-center gap-1">
    {ts.filter(x => x.link).map(x => <Chip key={x.link} t={x} {...ctx} />)}
    <span title={live ? undefined : LOCAL_ONLY}>
      <button onClick={add} disabled={!live} aria-label={`Add a trace link to ${id}`}
        className="rounded border border-dashed border-line p-0.5 text-dim hover:border-white/25 hover:text-ink disabled:opacity-30"><Plus size={12} /></button>
    </span>
  </div>
);
const REQ_COLS: [string, number][] = [["Requirement", 17], ["Hazards", 7], ["Regulation", 16], ["Code", 15], ["Test", 11], ["Simulation", 13], ["Work orders", 15], ["Added", 6]];
const HAZ_COLS: [string, number][] = [["Hazard", 22], ["Severity", 16], ["Regulation", 15], ["Mitigated by", 13], ["Simulation", 15], ["Added", 7], ["Coverage", 12]];

const Gaps = ({ gaps }: { gaps: string[] }) => gaps.length
  ? <div className="flex flex-wrap gap-1">{gaps.map(g => <span key={g} className={`rounded-full border px-2 py-px text-xs font-medium leading-snug ${TONE_CLS.bad}`}>{g}</span>)}</div>
  : <Badge tone="PASS">traced</Badge>;

export function Traceability({ state, live, item, post, getJSON, text }: Props) {
  const p = state.project!;
  const t = state.trace;
  const [view, setView] = useState<"matrix" | "graph">("matrix");
  const [open, setOpen] = useState<Target | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState("");
  const api: Api = useMemo(() => ({ getJSON, text, post, live, pid: p.id, gh: t?.github }), [getJSON, text, post, live, p.id, t?.github]);
  const remove = async (id: string) => { const r = await post("trace/links/delete", { project: p.id, id }); setErr(r.error || ""); };
  const reqs = t?.requirements || [];
  const hazards = t?.hazards || [];
  const items = [...reqs.map(r => ({ id: r.id, text: r.text })), ...hazards.map(h => ({ id: h.id, text: h.title }))];
  const ctx = { open: setOpen, pid: p.id, onRemove: live ? remove : undefined };
  const overlays = <>
    {open && <Drawer api={api} t={open} onClose={() => setOpen(null)} />}
    {draft && <AddLink api={api} items={items} draft={draft} onClose={() => setDraft(null)} />}
  </>;

  const req = reqs.find(r => r.id === item), haz = hazards.find(h => h.id === item);
  if (req) return <><RequirementView r={req} hazards={hazards} state={state} api={api} ctx={ctx} add={() => setDraft({ item: req.id })} err={err} />{overlays}</>;
  if (haz) return <><HazardView h={haz} reqs={reqs} ctx={ctx} live={live} add={() => setDraft({ item: haz.id })} err={err} />{overlays}</>;

  const n = reqs.length;
  const withCode = reqs.filter(r => of(r.targets, "code").length).length;
  const withTest = reqs.filter(r => of(r.targets, "test").length).length;
  const passing = reqs.filter(r => of(r.targets, "test").some(x => x.result === "PASS")).length;
  const mitigated = hazards.filter(h => h.requirements.length || h.fixes?.length).length;
  const untraced = t?.untraced || [];
  const focus = (hazards.find(h => h.gaps.length) || hazards[0])?.id;
  const added = [...reqs, ...hazards].reduce((k, r) => k + r.targets.filter(x => x.link).length, 0);

  return (
    <>
      <PageHead title="Traceability" sub={<>Every requirement traced up to its hazard and regulation clause, down to the code lines, test, simulation scenarios, work orders and evidence ({p.standard}). Click anything to open it.</>}>
        <div className="flex overflow-hidden rounded-md border border-line text-sm">
          {(["matrix", "graph"] as const).map(k => (
            <button key={k} aria-pressed={view === k} onClick={() => setView(k)} className={`px-3 py-1.5 capitalize ${view === k ? "bg-white/[.08] text-ink" : "text-mute hover:text-ink"}`}>{k}</button>
          ))}
        </div>
        <Button primary onClick={() => setDraft({})} disabled={!live || !items.length} title={live ? undefined : LOCAL_ONLY}><Plus size={14} /> Add trace link</Button>
      </PageHead>
      {err && <p className="-mt-3 mb-4 text-sm text-bad">{err}</p>}
      {!t?.requirements ? (
        t ? <TraceGraph nodes={t.nodes} edges={t.edges} pid={p.id} onOpen={setOpen} focus={focus} /> : null
      ) : <>
        <div className="mb-6 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Requirements → code" value={`${withCode}/${n}`} bad={withCode < n} />
          <Stat label="Requirements → tests" value={`${withTest}/${n}`} sub={t.tests?.running ? "running tests…" : `${passing} passing`}
            bad={withTest < n || (!t.tests?.running && passing < withTest)} />
          <Stat label="Hazards mitigated" value={`${mitigated}/${hazards.length}`} bad={mitigated < hazards.length} />
          <Stat label="Untraced code" value={`${untraced.length}`} sub={untraced.length ? "functions with no requirement" : "every function traced"} bad={untraced.length > 0} />
          <Stat label="Links added by people" value={`${added}`} sub={`trace/links-${t.device}.json`} />
        </div>
        {view === "graph" ? <TraceGraph nodes={t.nodes} edges={t.edges} pid={p.id} onOpen={setOpen} focus={focus} /> : <>
          <Section title="Requirements" aside="red = traceability gap an auditor would flag">
            <Matrix cols={REQ_COLS}>
              {reqs.map(r => (
                <tr key={r.id} className={`border-t border-line align-top ${r.gaps.length ? "bg-bad/[.04] shadow-[inset_2px_0_0_var(--color-bad)]" : ""}`}>
                  <td className={TD}>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <a href={`#/p/${p.id}/traceability/${r.id}`} className="font-mono text-sm font-semibold hover:underline">{r.id}</a>
                      {r.dal && <span className="text-2xs text-dim">DAL {r.dal}</span>}
                      <Gaps gaps={r.gaps} />
                    </div>
                    <div className="mt-0.5 text-sm leading-snug text-mute">{r.text}</div>
                  </td>
                  <td className={TD}><Ids ids={r.hazards} pid={p.id} /></td>
                  <td className={TD}><Chips ts={of(r.targets, "clause")} {...ctx} /></td>
                  <td className={TD}><Chips ts={of(r.targets, "code").filter(x => !x.link)} {...ctx} /></td>
                  <td className={TD}><Chips ts={of(r.targets, "test").filter(x => !x.link)} {...ctx} /></td>
                  <td className={TD}><Chips ts={of(r.targets, "scenario")} {...ctx} /></td>
                  <td className={TD}><Chips ts={of(r.targets, "work_order", "evidence").slice(-4)} {...ctx} /></td>
                  <td className={TD}><Added ts={r.targets} id={r.id} ctx={ctx} live={live} add={() => setDraft({ item: r.id })} /></td>
                </tr>
              ))}
            </Matrix>
          </Section>
          <Section title="Hazards">
            <Matrix cols={HAZ_COLS}>
              {hazards.map(h => (
                <tr key={h.id} className={`border-t border-line align-top ${h.gaps.length ? "bg-bad/[.04] shadow-[inset_2px_0_0_var(--color-bad)]" : ""}`}>
                  <td className={TD}>
                    <a href={`#/p/${p.id}/traceability/${h.id}`} className="font-mono text-sm font-semibold hover:underline">{h.id}</a>
                    <div className="text-sm leading-snug text-mute">{h.title}</div>
                  </td>
                  <td className={TD}><Badge tone={["S3", "Catastrophic", "Hazardous"].includes(h.severity) ? "FAIL" : "Stopped"}>{h.dal ? `${h.severity} · DAL ${h.dal}` : h.severity}</Badge></td>
                  <td className={TD}><Chips ts={of(h.targets, "clause")} {...ctx} /></td>
                  <td className={TD}>
                    {h.requirements.length ? <Ids ids={h.requirements} pid={p.id} />
                      : h.fixes?.length ? <Chips ts={of(h.targets, "work_order")} {...ctx} /> : <span className="text-xs text-dim">—</span>}
                  </td>
                  <td className={TD}><Chips ts={of(h.targets, "scenario")} {...ctx} /></td>
                  <td className={TD}><Added ts={h.targets} id={h.id} ctx={ctx} live={live} add={() => setDraft({ item: h.id })} /></td>
                  <td className={TD}><Gaps gaps={h.gaps} /></td>
                </tr>
              ))}
            </Matrix>
          </Section>
          <Section title="Untraced code" aside={`functions in the device code that no requirement traces to${t.device === "flight-controls" ? " (DO-178C: no untraced code)" : ""}`}>
            {untraced.length ? (
              <div className="divide-y divide-line rounded-lg border border-bad/30 bg-bad/[.03]">
                {untraced.map(u => (
                  <div key={`${u.path}${u.start}`} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                    <Chip t={u} {...ctx} onRemove={undefined} />
                    <span className="font-mono text-xs text-dim">{where(u)}</span>
                    <span className="ml-auto flex gap-2">
                      <Button onClick={() => setDraft({ kind: "code", path: u.path, start: u.start, end: u.end })} disabled={!live} title={live ? undefined : LOCAL_ONLY}><Link2 size={13} /> Trace to a requirement</Button>
                    </span>
                  </div>
                ))}
              </div>
            ) : <p className="rounded-lg border border-line px-4 py-4 text-base text-mute">Every function in the device code is traced to a requirement.</p>}
          </Section>
        </>}
      </>}
      {overlays}
    </>
  );
}

const Stat = ({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) => (
  <div className={`rounded-lg border bg-panel px-3 py-2.5 ${bad ? "border-bad/40" : "border-line"}`}>
    <div className="text-xs text-dim">{label}</div>
    <div className={`mt-0.5 text-2xl font-semibold tabular-nums ${bad ? "text-bad" : ""}`}>{value}</div>
    {sub && <div className="truncate text-xs text-dim">{sub}</div>}
  </div>
);

type Ctx = { open: (t: Target) => void; pid: string; onRemove?: (id: string) => void };

/** A code or test target shown inline: the exact lines, with GitHub and full-file links. */
function Snippet({ t, api, ctx }: { t: Target; api: Api; ctx: Ctx }) {
  const file = useFile(api, t.path);
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
        <Chip t={t} {...ctx} />
        <button onClick={() => ctx.open(t)} className="font-mono text-xs text-dim hover:text-ink hover:underline">{where(t)}</button>
        {t.link && <span className="text-xs text-dim">added by {t.by}</span>}
        <span className="ml-auto"><GithubLink href={githubUrl(api.gh, t)} /></span>
      </div>
      {file ? <CodeLines file={file} start={t.start} end={t.end} only /> : file === null ? <p className="text-sm text-dim">Open on GitHub to view {where(t)}.</p> : null}
    </div>
  );
}

const Back = ({ pid, id }: { pid: string; id: string }) => (
  <div className="mb-1 text-sm text-dim"><a href={`#/p/${pid}/traceability`} className="hover:text-ink">Traceability</a> / {id}</div>
);

function RequirementView({ r, hazards, state, api, ctx, add, err }: { r: TraceRow; hazards: HazardRow[]; state: State; api: Api; ctx: Ctx; add: () => void; err: string }) {
  const code = of(r.targets, "code"), tests = of(r.targets, "test");
  const last = [...(state.work_orders || [])].reverse().find(w => w.gate?.checker && w.gate.rows.some(x => x.id === r.id));
  const docs = of(r.targets, "doc", "url");
  return (
    <>
      <Back pid={ctx.pid} id={r.id} />
      <PageHead title={`${r.id} · ${r.text}`} sub={<span className="inline-flex flex-wrap items-center gap-2"><Gaps gaps={r.gaps} />{r.dal && <span>DAL {r.dal}</span>} <span>Imported from safety.json; links added here are saved to the repo.</span></span>}>
        <Button primary onClick={add} disabled={!api.live} title={api.live ? undefined : LOCAL_ONLY}><Plus size={14} /> Add trace link</Button>
      </PageHead>
      {err && <p className="-mt-3 mb-4 text-sm text-bad">{err}</p>}
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="min-w-0">
          <Section title="Implemented by" aside={code.length ? `${code.length} code location${code.length === 1 ? "" : "s"}` : undefined}>
            {code.length ? code.map((t, i) => <Snippet key={i} t={t} api={api} ctx={ctx} />) : <p className="rounded-lg border border-bad/40 bg-bad/[.04] px-4 py-4 text-base text-bad">No code link: nothing shows where this requirement is implemented.</p>}
          </Section>
          <Section title="Verified by">
            {tests.length ? tests.map((t, i) => <div key={i}>{!t.link && <TestResult api={api} t={t} />}<Snippet t={t} api={api} ctx={ctx} /></div>)
              : <p className="rounded-lg border border-bad/40 bg-bad/[.04] px-4 py-4 text-base text-bad">No test: this requirement is not verified.</p>}
          </Section>
        </div>
        <div className="min-w-0">
          <Section title="Mitigates">
            <div className="space-y-1.5">{r.hazards.map(h => {
              const hz = hazards.find(x => x.id === h);
              return <a key={h} href={`#/p/${ctx.pid}/traceability/${h}`} className="block rounded-md border border-line px-3 py-2 text-sm hover:border-white/20"><b className="font-mono text-sm">{h}</b> <span className="text-mute">{hz?.title}</span></a>;
            })}</div>
          </Section>
          <Section title="Regulation"><Chips ts={of(r.targets, "clause")} {...ctx} /></Section>
          <Section title="Simulation scenarios"><Chips ts={of(r.targets, "scenario")} {...ctx} /></Section>
          <Section title="Work orders · evidence">
            <Chips ts={of(r.targets, "work_order", "evidence")} {...ctx} />
            {last?.gate?.checker && <div className="mt-2"><span className="font-mono text-xs text-mute">{last.id}</span> <GateNote checker={last.gate.checker} state={state} api={api} /></div>}
          </Section>
          <Section title="Docs and links"><Chips ts={docs} {...ctx} /></Section>
        </div>
      </div>
    </>
  );
}

function HazardView({ h, reqs, ctx, live, add, err }: { h: HazardRow; reqs: TraceRow[]; ctx: Ctx; live: boolean; add: () => void; err: string }) {
  const mine = reqs.filter(r => h.requirements.includes(r.id));
  return (
    <>
      <Back pid={ctx.pid} id={h.id} />
      <PageHead title={`${h.id} · ${h.title}`} sub={<span className="inline-flex flex-wrap items-center gap-2"><Gaps gaps={h.gaps} /><span>{h.severity}{h.dal ? ` · DAL ${h.dal}` : ""}</span></span>}>
        <Button primary onClick={add} disabled={!live} title={live ? undefined : LOCAL_ONLY}><Plus size={14} /> Add trace link</Button>
      </PageHead>
      {err && <p className="-mt-3 mb-4 text-sm text-bad">{err}</p>}
      {h.fha && <p className="mb-6 max-w-3xl text-base text-mute">{h.fha}</p>}
      <Section title="Mitigated by">
        {mine.length ? (
          <div className="divide-y divide-line rounded-lg border border-line">
            {mine.map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <a href={`#/p/${ctx.pid}/traceability/${r.id}`} className="font-mono text-sm font-semibold hover:underline">{r.id}</a>
                <span className="min-w-0 flex-1 text-mute">{r.text}</span>
                <Chips ts={of(r.targets, "code", "test").filter(x => !x.link)} {...ctx} onRemove={undefined} />
                <Gaps gaps={r.gaps} />
              </div>
            ))}
          </div>
        ) : h.fixes?.length ? (
          <div className="rounded-lg border border-line px-4 py-3 text-base text-mute">
            <div className="mb-2"><Chips ts={of(h.targets, "work_order", "evidence")} {...ctx} onRemove={undefined} /></div>
            Closed by an approved work order: the safety analysis targeted {h.id}, and the change passed the requirement tests and the world model.
            No requirement in safety.json names {h.id} yet; add the one this change implements to keep it in the record.
          </div>
        ) : <p className="rounded-lg border border-bad/40 bg-bad/[.04] px-4 py-4 text-base text-bad">No safety requirement mitigates this hazard: an open item in the hazard log.</p>}
      </Section>
      <div className="grid gap-8 md:grid-cols-3">
        <Section title="Regulation"><Chips ts={of(h.targets, "clause")} {...ctx} /></Section>
        <Section title="Simulation scenarios"><Chips ts={of(h.targets, "scenario")} {...ctx} /></Section>
        <Section title="Added links"><Chips ts={h.targets.filter(x => x.link)} {...ctx} /></Section>
      </div>
    </>
  );
}
