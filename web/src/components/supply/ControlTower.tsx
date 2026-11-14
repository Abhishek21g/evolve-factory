"use client";
import type { ReactNode } from "react";
import { RISK_LABEL, money, useLive, type PageCtx, type Tower } from "@/lib/supply";
import { Dot, List, Pending, Row, Stat, StatRow, toneText, type Tone } from "./common";

const verdictTone = (v?: string | null): Tone => !v ? "idle" : ["PASS", "SAFE", "APPROVED"].includes(v) ? "ok" : "bad";
const WO_TONE: Record<string, Tone> = { Approved: "ok", Running: "run", Blocked: "bad", Draft: "idle", Stopped: "warn" };
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const and = (xs: string[]) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const pct = (a: number, b: number) => b ? Math.round((100 * a) / b) : 0;
const runsWord = (t: Tower) => t.safety.sim?.kind === "aircraft" ? "flights" : "patients";

type Attn = { tone: Tone; text: string; href: string; meta: string };
function attention(t: Tower): Attn[] {
  const at = (x: string) => `#/p/${t.project.id}/${x}`;
  const out: Attn[] = [];
  for (const w of t.software.latest) {
    if (w.status === "Blocked") out.push({ tone: "bad", text: `${w.title}`, meta: `${w.id} · blocked by the gate`, href: at(`work-orders/${w.id}`) });
    if (w.status === "Running") out.push({ tone: "run", text: `${w.title}`, meta: `${w.id} · agents building`, href: at(`work-orders/${w.id}`) });
  }
  const s = t.safety.sim;
  if (s && verdictTone(s.verdict) === "bad")
    out.push({ tone: "bad", text: s.wo ? `Simulation of ${s.wo} failed` : `What-if “${s.question}” failed`, meta: `${s.runs} ${runsWord(t)} · world model`, href: at(s.wo ? `world-loop/${s.wo}` : "world-model") });
  for (const g of t.safety.gaps) out.push({ tone: "bad", text: `${g.id}: ${g.gaps.join(", ")}`, meta: "trace gap", href: at(`traceability/${g.id}`) });
  for (const r of t.supply?.top || []) if (r.tone === "bad")
    out.push({ tone: "bad", text: r.text.replace(/ \(sample\)/g, ""), meta: `${RISK_LABEL[r.kind].toLowerCase()} · ${r.affects.slice(0, 2).join(" ")}`, href: r.part ? at("supply-chain") : at(`suppliers/${r.supplier}`) });
  const f = t.finance;
  if (f && f.budget_usd && f.factory_usd > 0.85 * f.budget_usd)
    out.push({ tone: "warn", text: `Factory spend at ${pct(f.factory_usd, f.budget_usd)}% of budget`, meta: "finance", href: at("finance") });
  return out;
}

/** Deterministic status brief: what is wrong, what is fine, what it costs. */
export function brief(t: Tower): { tone: Tone; status: string; open: string[]; fine: string; spend: string } {
  const sw = t.software, sf = t.safety, c = t.supply?.counts, f = t.finance;
  const open: string[] = [];
  if (sw.blocked) open.push(`${n(sw.blocked, "change")} blocked by the gate`);
  if (sf.sim && verdictTone(sf.sim.verdict) === "bad") open.push("a failing simulation");
  if (sf.gaps.length) open.push(`${n(sf.gaps.length, "trace gap")} (${sf.gaps.map(g => g.id).join(", ")})`);
  if (c?.missing_deliverable) open.push(`${n(c.missing_deliverable, "missing supplier deliverable")}`);
  if (c?.expired_cert) open.push(`${n(c.expired_cert, "expired certificate")}`);
  if (c?.import_delay) open.push(`${n(c.import_delay, "import")} held at customs`);
  const soon = c?.expiring_cert || 0;
  const tone: Tone = open.length ? "bad" : soon || sw.running ? "warn" : "ok";
  const sim = sf.sim ? verdictTone(sf.sim.verdict) === "ok" ? `the latest simulation passed all ${sf.sim.runs} ${runsWord(t)}` : `the latest simulation failed` : "no simulation has run yet";
  const fine = `${sw.approved} of ${n(sw.total, "work order")} approved${sw.blocked ? "" : ", nothing blocked by the gate"}, and ${sim}${soon ? `; ${n(soon, "certificate")} ${soon === 1 ? "expires" : "expire"} within 60 days` : ""}.`;
  const spend = f ? `Factory spend is ${money(f.factory_usd, true)}, ${pct(f.factory_usd, f.budget_usd)}% of its ${money(f.budget_usd)} budget.` : "";
  return { tone, status: tone === "bad" ? "at risk" : tone === "warn" ? "on track, with items to watch" : "on track", open, fine: fine.charAt(0).toUpperCase() + fine.slice(1), spend };
}

const Brief = ({ t, big }: { t: Tower; big?: boolean }) => {
  const b = brief(t);
  const status = <span className={b.tone === "bad" ? "text-bad" : b.tone === "warn" ? "text-warn" : "text-ok"}>{b.status}</span>;
  return (
    big ? (
      <p className="max-w-[760px] text-md leading-7 text-mute">
        <span className="text-ink">{t.project.name} is {status}{b.open.length ? `: ${and(b.open)}.` : "."}</span> {b.fine} {b.spend}
      </p>
    ) : <p className="text-sm text-mute"><span className={toneText(b.tone)}>{b.status.charAt(0).toUpperCase() + b.status.slice(1)}</span>{b.open.length ? `: ${and(b.open)}.` : "."}</p>
  );
};

const Head = ({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) => (
  <header className="mb-10">
    <div className="mb-1 text-xs text-dim">{eyebrow}</div>
    <h1 className="mb-3 text-2xl font-semibold tracking-tight text-ink">{title}</h1>
    {children}
  </header>
);

export function ControlTower({ state, getJSON, live }: PageCtx) {
  const p = state.project!;
  const { data: t, missing } = useLive<Tower>(getJSON, live, `supply/tower?project=${p.id}`, `tower-${p.id}.json`, 3000);
  if (!t || t.project.id !== p.id) return <Pending missing={missing} />;
  const at = (x: string) => `#/p/${p.id}/${x}`;
  const sw = t.software, sf = t.safety, su = t.supply, fi = t.finance, c = su?.counts;
  const items = attention(t);
  const safetyIssues = sw.blocked + sf.gaps.length + (sf.sim && verdictTone(sf.sim.verdict) === "bad" ? 1 : 0);
  const supplyIssues = c ? c.missing_deliverable + c.expired_cert + c.import_delay : 0;
  return (
    <div className="mx-auto max-w-[920px]">
      <Head eyebrow={`Control Tower · ${p.standard}`} title={p.name}><Brief t={t} big /></Head>

      <StatRow>
        <Stat value={`${sw.approved}/${sw.total}`} label="work orders approved" href={at("work-orders")} />
        <Stat value={safetyIssues} label="open safety issues" tone={safetyIssues ? "bad" : undefined} href={at("traceability")} />
        {su && <Stat value={supplyIssues} label="supplier issues" tone={supplyIssues ? "bad" : undefined} href={at("suppliers")} />}
        {fi && <Stat value={money(fi.factory_usd, true)} label={`factory spend · ${pct(fi.factory_usd, fi.budget_usd)}% of budget`} href={at("finance")} />}
      </StatRow>

      <List title="Needs attention" count={items.length} aside={t.supply ? "supplier names are samples" : undefined}>
        {items.length ? items.slice(0, 6).map((a, i) => <Row key={i} tone={a.tone} href={a.href} meta={a.meta}>{a.text}</Row>)
          : <Row tone="ok">Nothing needs attention: no blocked changes, trace gaps or supplier issues.</Row>}
      </List>

      <List title="Building" aside={<a href={at("work-orders")} className="hover:text-ink">Work orders</a>}>
        {sw.latest.length ? sw.latest.map(w => (
          <Row key={w.id} tone={WO_TONE[w.status] || "idle"} href={at(`work-orders/${w.id}`)} meta={`${w.id} · ${w.status}`}>{w.title}</Row>
        )) : <Row href={at("overview")}>No work orders yet. Ask the factory to build something.</Row>}
        {sw.prs.length > 0 && <Row tone="idle" href={sw.prs[sw.prs.length - 1]} meta="GitHub">{n(sw.prs.length, "pull request")} opened by the agent team</Row>}
      </List>

      <List title="Safety" aside={<a href={at("world-model")} className="hover:text-ink">Simulations</a>}>
        {sf.sim ? (
          <Row tone={verdictTone(sf.sim.verdict)} href={sf.sim.wo ? at(`world-loop/${sf.sim.wo}`) : at("world-model")} meta={sf.sim.wo || "what-if"}>
            Latest simulation {verdictTone(sf.sim.verdict) === "ok" ? "passed" : "failed"}: {sf.sim.runs} {runsWord(t)}, {sf.sim.new ? n(sf.sim.new, "new failure") : "no new failures"} caused by the change
          </Row>
        ) : <Row href={at("world-model")}>No simulation yet. Ask the world model a what-if.</Row>}
        {sf.gaps.length ? sf.gaps.map(g => <Row key={g.id} tone="bad" href={at(`traceability/${g.id}`)} meta="trace gap">{g.id}: {g.gaps.join(", ")}</Row>)
          : <Row tone="ok" href={at("traceability")} meta="Traceability">All {t.hazards} hazards and {t.requirements} safety requirements are traced to tests</Row>}
        {sf.untraced > 0 && <Row tone="warn" href={at("traceability")} meta="Traceability">{n(sf.untraced, "function")} in the code not yet traced to a requirement</Row>}
      </List>

      {su && c && fi && (
        <List title="Supply chain and spend" aside={<span>sample supplier data</span>}>
          <Row tone={c.missing_deliverable ? "bad" : "ok"} href={at("suppliers")} meta={`${su.suppliers} suppliers · ${Object.values(su.tiers).filter(Boolean).length} tiers`}>
            {c.missing_deliverable ? `${n(c.missing_deliverable, "requested deliverable")} not yet received` : "Every requested supplier deliverable is in"}
          </Row>
          <Row tone={c.expired_cert ? "bad" : c.expiring_cert ? "warn" : "ok"} href={at("suppliers")} meta="certificates">
            {c.expired_cert || c.expiring_cert ? and([c.expired_cert ? `${n(c.expired_cert, "certificate")} expired` : "", c.expiring_cert ? (c.expired_cert ? `${c.expiring_cert} expiring within 60 days` : `${n(c.expiring_cert, "certificate")} expiring within 60 days`) : ""].filter(Boolean)) : "All supplier certificates are current"}
          </Row>
          <Row tone={c.import_delay ? "bad" : c.single_source || c.long_lead ? "warn" : "ok"} href={at("supply-chain")} meta={`${su.parts} parts`}>
            {c.import_delay ? `${n(c.import_delay, "import")} held at customs` : "No imports held at customs"}{c.single_source || c.long_lead ? `; ${and([c.single_source ? `${c.single_source} single-source` : "", c.long_lead ? `${c.long_lead} long-lead` : ""].filter(Boolean))} parts` : ""}
          </Row>
          <Row tone={fi.factory_usd > fi.budget_usd ? "bad" : "ok"} href={at("finance")} meta="estimated">
            Agents and compute: {money(fi.factory_usd, true)} of {money(fi.budget_usd)} · {money(fi.cost_per_wo, true)} per work order, {money(fi.cost_per_req, true)} per requirement verified
          </Row>
          <Row tone={fi.suppliers_usd > fi.suppliers_budget ? "bad" : fi.suppliers_usd > 0.85 * fi.suppliers_budget ? "warn" : "ok"} href={at("finance")} meta="sample">
            Supplier spend: {money(fi.suppliers_usd)} of {money(fi.suppliers_budget)} ({pct(fi.suppliers_usd, fi.suppliers_budget)}%) · BOM {money(fi.bom_unit)} per unit
          </Row>
        </List>
      )}
    </div>
  );
}

/** All projects on one page: a brief, four totals, then one line per project and what needs attention across them. */
export function AllTowers({ getJSON, live }: Pick<PageCtx, "getJSON" | "live">) {
  const { data, missing } = useLive<{ projects: Tower[] }>(getJSON, live, "supply/tower", "tower-all.json", 5000);
  if (!data) return <Pending missing={missing} />;
  const ts = data.projects;
  const sum = (f: (t: Tower) => number) => ts.reduce((k, t) => k + f(t), 0);
  const supplyIssues = (t: Tower) => t.supply ? t.supply.counts.missing_deliverable + t.supply.counts.expired_cert + t.supply.counts.import_delay : 0;
  const safetyIssues = (t: Tower) => t.software.blocked + t.safety.gaps.length + (t.safety.sim && verdictTone(t.safety.sim.verdict) === "bad" ? 1 : 0);
  const risky = ts.filter(t => brief(t).tone === "bad");
  const items = ts.flatMap(t => attention(t).map(a => ({ ...a, meta: `${t.project.name} · ${a.meta.split(" · ")[0]}` })));
  return (
    <div className="mx-auto max-w-[920px]">
      <Head eyebrow="Control Tower · all projects" title="Every project at a glance">
        <p className="max-w-[760px] text-md leading-7 text-mute">
          <span className="text-ink">{n(ts.length, "project")}, {risky.length ? <><span className="text-bad">{risky.length} at risk</span> ({risky.map(t => t.project.name).join(", ")})</> : <span className="text-ok">all on track</span>}.</span>{" "}
          {sum(t => t.software.approved)} of {n(sum(t => t.software.total), "work order")} approved, {sum(t => t.software.blocked) ? `${sum(t => t.software.blocked)} blocked by the gate` : "none blocked by the gate"}. Factory spend so far is {money(sum(t => t.finance?.factory_usd || 0), true)}.
        </p>
      </Head>

      <StatRow>
        <Stat value={`${sum(t => t.software.approved)}/${sum(t => t.software.total)}`} label="work orders approved" />
        <Stat value={sum(safetyIssues)} label="open safety issues" tone={sum(safetyIssues) ? "bad" : undefined} />
        <Stat value={sum(supplyIssues)} label="supplier issues" tone={sum(supplyIssues) ? "bad" : undefined} />
        <Stat value={money(sum(t => t.finance?.factory_usd || 0), true)} label="factory spend (estimated)" />
      </StatRow>

      <List title="Projects" count={ts.length}>
        {ts.map(t => (
          <a key={t.project.id} href={`#/p/${t.project.id}/control-tower`} className="-mx-2 flex items-start gap-3 rounded-sm px-2 py-3 transition-colors hover:bg-white/[.03]">
            <span className="mt-2 flex"><Dot tone={brief(t).tone} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2"><span className="text-base font-medium text-ink">{t.project.name}</span><span className="truncate text-xs text-dim">{t.project.standard}</span></span>
              <Brief t={t} />
            </span>
            <span className="shrink-0 pt-0.5 text-right text-sm tabular-nums text-dim">
              {t.software.approved}/{t.software.total} approved · {safetyIssues(t)} safety · {supplyIssues(t)} supplier{t.finance ? ` · ${money(t.finance.factory_usd, true)}` : ""}
            </span>
          </a>
        ))}
      </List>

      <List title="Needs attention" count={items.length} aside="supplier names are samples">
        {items.length ? items.slice(0, 8).map((a, i) => <Row key={i} tone={a.tone} href={a.href} meta={a.meta}>{a.text}</Row>)
          : <Row tone="ok">Nothing needs attention in any project.</Row>}
      </List>
    </div>
  );
}
