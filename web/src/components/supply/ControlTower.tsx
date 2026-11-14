"use client";
import type { ReactNode } from "react";
import { ArrowRight, FlaskConical, GitPullRequest, Package, Wallet } from "lucide-react";
import { Badge, PageHead } from "@/components/ui";
import { RISK_LABEL, money, useLive, type PageCtx, type RiskKind, type Tower } from "@/lib/supply";
import { plural as n } from "@/lib/utils";
import { Bar, Items, Pending, Pill, type Tone } from "./common";

const verdictTone = (v?: string | null): Tone => !v ? "idle" : ["PASS", "SAFE", "APPROVED"].includes(v) ? "ok" : v === "AT RISK" ? "warn" : "bad";
/** "2 of 30 unsafe" for a what-if, "0 new failures caused by the change" for a work order's gate run. */
const simResult = (s: NonNullable<Tower["safety"]["sim"]>) => s.wo ? `${n(s.new, "new failure")} caused by the change` : `${s.harmed ?? 0} of ${s.runs} unsafe`;
const and = (xs: string[]) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const pct = (a: number, b: number) => b ? Math.round((100 * a) / b) : 0;

/** Deterministic one-sentence status: what is wrong, what is fine, what it costs. */
function brief(t: Tower): { risky: boolean; text: string } {
  const sw = t.software, sf = t.safety, c = t.supply?.counts, f = t.finance;
  const open: string[] = [];
  if (sw.blocked) open.push(`${n(sw.blocked, "change")} blocked by the gate`);
  if (sf.sim && verdictTone(sf.sim.verdict) === "bad") open.push(sf.sim.wo ? "a failing simulation" : "an unsafe what-if");
  if (sf.gaps.length) open.push(`${n(sf.gaps.length, "trace gap")} (${sf.gaps.map(g => g.id).join(", ")})`);
  if (c?.missing_deliverable) open.push(n(c.missing_deliverable, "missing supplier deliverable"));
  if (c?.expired_cert) open.push(n(c.expired_cert, "expired certificate"));
  if (c?.import_delay) open.push(`${n(c.import_delay, "import")} held at customs`);
  const soon = c?.expiring_cert || 0;
  const runs = sf.sim?.kind === "aircraft" ? "flights" : "patients";
  const sim = !sf.sim ? "no simulation has run yet" : verdictTone(sf.sim.verdict) === "ok" ? `the latest simulation passed all ${sf.sim.runs} ${runs}`
    : sf.sim.wo ? "the latest simulation failed" : `the latest what-if is ${sf.sim.verdict} (${sf.sim.harmed ?? 0} of ${sf.sim.runs} ${runs} unsafe)`;
  const status = open.length ? `At risk: ${and(open)}.` : soon || sw.running ? "On track, with items to watch." : "On track.";
  const fine = `${sw.approved} of ${n(sw.total, "work order")} approved${sw.blocked ? "" : ", nothing blocked by the gate"}, and ${sim}${soon ? `; ${n(soon, "certificate")} ${soon === 1 ? "expires" : "expire"} within 60 days` : ""}.`;
  const spend = f ? ` Factory spend is ${money(f.factory_usd, true)}, ${pct(f.factory_usd, f.budget_usd)}% of its ${money(f.budget_usd)} budget.` : "";
  return { risky: open.length > 0, text: `${status} ${fine}${spend}` };
}

function Tile({ title, icon, href, more, children }: { title: string; icon: ReactNode; href: string; more: [string, string][]; children: ReactNode }) {
  return (
    <section className="flex flex-col rounded-xl border border-line bg-panel">
      <a href={href} className="group flex items-center gap-2 border-b border-line px-4 py-3 hover:bg-white/[.02]">
        <span className="text-acc">{icon}</span><h2 className="text-base font-semibold">{title}</h2>
        <ArrowRight size={14} className="ml-auto text-dim group-hover:text-ink" />
      </a>
      <div className="flex-1 space-y-3 p-4">{children}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs">
        {more.map(([l, h]) => <a key={h} href={h} className="text-mute hover:text-ink">{l}</a>)}
      </div>
    </section>
  );
}

const Num = ({ n, label, tone, href }: { n: ReactNode; label: string; tone?: Tone; href: string }) => (
  <a href={href} {...(href.startsWith("http") ? { target: "_blank", rel: "noopener" } : {})} className="block rounded-md px-1 hover:bg-white/[.03]">
    <div className={`text-xl font-semibold tabular-nums ${tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : tone === "run" ? "text-run" : ""}`}>{n}</div>
    <div className="text-xs text-dim">{label}</div>
  </a>
);

type Attn = { tone: Tone; text: string; href: string; tag: string };
function attention(t: Tower): Attn[] {
  const at = (x: string) => `#/p/${t.project.id}/${x}`;
  const out: Attn[] = [];
  for (const w of t.software.latest) {
    if (w.status === "Running") out.push({ tone: "run", tag: "Building", text: `Agents are building ${w.id}: ${w.title}`, href: at(`work-orders/${w.id}`) });
    if (w.status === "Blocked") out.push({ tone: "bad", tag: "Gate", text: `${w.id} blocked by the safety gate: ${w.title}`, href: at(`work-orders/${w.id}`) });
  }
  const s = t.safety.sim;
  if (s && verdictTone(s.verdict) === "bad")
    out.push({ tone: "bad", tag: "World model", text: `${s.wo ? `${s.wo} simulation` : `What-if “${s.question}”`}: ${s.verdict}`, href: at(s.wo ? `world-loop/${s.wo}` : "world-model") });
  for (const g of t.safety.gaps) out.push({ tone: "bad", tag: "Trace gap", text: `${g.id}: ${g.gaps.join(", ")}`, href: at(`traceability/${g.id}`) });
  for (const r of t.supply?.top || []) if (r.tone === "bad")
    out.push({ tone: "bad", tag: RISK_LABEL[r.kind], text: r.text, href: r.part ? at("supply-chain") : at(`supply-chain/${r.supplier}`) });
  const f = t.finance;
  if (f && f.budget_usd && f.factory_usd > 0.85 * f.budget_usd) out.push({ tone: "warn", tag: "Budget", text: `Factory spend at ${Math.round(100 * f.factory_usd / f.budget_usd)}% of budget`, href: at("finance") });
  return out;
}

export function ControlTower({ state, getJSON, live }: PageCtx) {
  const p = state.project!;
  const { data: t, missing } = useLive<Tower>(getJSON, live, `supply/tower?project=${p.id}`, `tower-${p.id}.json`, 3000);
  if (!t || t.project.id !== p.id) return <Pending missing={missing} />;
  const at = (x: string) => `#/p/${p.id}/${x}`;
  const sw = t.software, sf = t.safety, su = t.supply, fi = t.finance;
  const items = attention(t);
  const riskN = (k: RiskKind) => su?.counts[k] || 0;
  return (
    <>
      <PageHead title="Control Tower" sub={<>{p.name} · {p.standard}. {brief(t).text}</>} />
      <section className="mb-8">
        <h2 className="mb-2.5 text-sm font-semibold">Needs attention <span className="font-normal text-dim">· {items.length}</span></h2>
        {items.length ? (
          <div className="divide-y divide-line rounded-lg border border-line">
            {items.slice(0, 8).map((a, i) => (
              <a key={i} href={a.href} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-white/[.02]">
                <Pill tone={a.tone}>{a.tag}</Pill><span className="min-w-0 flex-1 truncate">{a.text}</span><ArrowRight size={13} className="text-dim" />
              </a>
            ))}
          </div>
        ) : <p className="rounded-lg border border-ok/25 bg-ok/5 px-3 py-2 text-sm text-ok">All clear: no blocked work, trace gaps, or supplier and import issues.</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tile title="Software building" icon={<GitPullRequest size={16} />} href={at("work-orders")}
          more={[["Work orders", at("work-orders")], ["Agents", at("agents")], ["Audit trail", at("audit")]]}>
          <div className="grid grid-cols-4 gap-2">
            <Num n={sw.running} label="in flight" tone={sw.running ? "run" : undefined} href={at("work-orders")} />
            <Num n={sw.approved} label="approved" tone="ok" href={at("work-orders")} />
            <Num n={sw.blocked} label="blocked" tone={sw.blocked ? "bad" : undefined} href={at("work-orders")} />
            <Num n={sw.prs.length} label="pull requests" href={sw.prs.length ? sw.prs[sw.prs.length - 1] : at("work-orders")} />
          </div>
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">
            {sw.latest.length ? sw.latest.map(w => (
              <li key={w.id}><a href={at(`work-orders/${w.id}`)} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/[.02]">
                <span className="font-mono text-2xs text-dim">{w.id}</span><span className="min-w-0 flex-1 truncate">{w.title}</span><Badge>{w.status}</Badge>
              </a></li>
            )) : <li className="px-3 py-3 text-center text-dim">No work orders yet. <a href={at("overview")} className="text-acc hover:underline">Ask the factory to build something</a>.</li>}
          </ul>
        </Tile>

        <Tile title="Physical-AI safety" icon={<FlaskConical size={16} />} href={at("world-model")}
          more={[["Simulations", at("world-model")], ["World model", at("world-loop")], ["Traceability", at("traceability")], ["Requirements", at("requirements")]]}>
          <div className="grid grid-cols-4 gap-2">
            <Num n={sf.sim ? <Pill tone={verdictTone(sf.sim.verdict)}>{sf.sim.verdict}</Pill> : "—"} label="latest simulation" href={sf.sim?.wo ? at(`world-loop/${sf.sim.wo}`) : at("world-model")} />
            <Num n={sf.sim ? sf.sim.runs : 0} label={sf.sim?.kind === "aircraft" ? "flights simulated" : "patients simulated"} href={at("world-model")} />
            <Num n={sf.gaps.length} label="trace gaps" tone={sf.gaps.length ? "bad" : "ok"} href={at("traceability")} />
            <Num n={sf.untraced} label="untraced functions" tone={sf.untraced ? "warn" : "ok"} href={at("traceability")} />
          </div>
          <p className="text-sm text-mute">
            {sf.sim ? <>Latest: {sf.sim.wo ? <a href={at(`work-orders/${sf.sim.wo}`)} className="text-ink hover:underline">{sf.sim.wo}</a> : <>what-if “{sf.sim.question}”</>} · {n(sf.sim.runs, "run")} · {simResult(sf.sim)}.</> : "No simulation yet."}
            {" "}{n(t.hazards, "hazard")} and {n(t.requirements, "safety requirement")} under the deterministic gate.
          </p>
          {sf.gaps.length > 0 && <div className="flex flex-wrap items-center gap-1.5 text-xs text-dim">Gaps: <Items ids={sf.gaps.map(g => g.id)} pid={p.id} /></div>}
        </Tile>

        <Tile title="Supply chain" icon={<Package size={16} />} href={at("supply-chain")}
          more={[["Suppliers", at("supply-chain/suppliers")], ["Parts and imports", at("supply-chain")]]}>
          {su ? <>
            <div className="grid grid-cols-4 gap-2">
              <Num n={su.suppliers} label={`suppliers · ${su.tiers["1"]}/${su.tiers["2"]}/${su.tiers["3"]} by tier`} href={at("supply-chain/suppliers")} />
              <Num n={riskN("expiring_cert") + riskN("expired_cert")} label="certs expiring / expired" tone={riskN("expired_cert") ? "bad" : riskN("expiring_cert") ? "warn" : "ok"} href={at("supply-chain/suppliers")} />
              <Num n={riskN("missing_deliverable")} label="missing deliverables" tone={riskN("missing_deliverable") ? "bad" : "ok"} href={at("supply-chain/suppliers")} />
              <Num n={riskN("import_delay")} label="import delays" tone={riskN("import_delay") ? "bad" : "ok"} href={at("supply-chain")} />
            </div>
            <ul className="space-y-1.5 text-sm">
              {su.top.map((r, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Pill tone={r.tone}>{RISK_LABEL[r.kind]}</Pill>
                  <a href={r.part ? at("supply-chain") : at(`supply-chain/${r.supplier}`)} className="min-w-0 flex-1 truncate text-mute hover:text-ink">{r.text}</a>
                  <Items ids={r.affects.slice(0, 2)} pid={p.id} />
                </li>
              ))}
            </ul>
            <p className="text-2xs text-dim">Sample supplier data · {n(riskN("single_source"), "single-source part")} · {n(riskN("long_lead"), "long-lead part")}</p>
          </> : <p className="text-sm text-dim">No supply-chain data for this device yet.</p>}
        </Tile>

        <Tile title="Finance" icon={<Wallet size={16} />} href={at("finance")} more={[["Budget vs actual", at("finance")], ["Supplier spend", at("finance")]]}>
          {fi ? <>
            <div className="grid grid-cols-4 gap-2">
              <Num n={money(fi.factory_usd, true)} label="factory spend (est.)" href={at("finance")} />
              <Num n={money(fi.cost_per_wo, true)} label="per work order" href={at("finance")} />
              <Num n={money(fi.cost_per_req, true)} label="per requirement verified" href={at("finance")} />
              <Num n={`${fi.saved.hours} h`} label="cert effort saved (est.)" tone="ok" href={at("finance")} />
            </div>
            <div className="space-y-2 text-xs">
              <div><div className="mb-1 flex justify-between text-mute"><span>Agents + compute vs budget</span><span className="tabular-nums">{money(fi.factory_usd, true)} / {money(fi.budget_usd)}</span></div><Bar value={fi.factory_usd} max={fi.budget_usd} tone="ok" /></div>
              <div><div className="mb-1 flex justify-between text-mute"><span>Supplier spend vs budget (sample)</span><span className="tabular-nums">{money(fi.suppliers_usd)} / {money(fi.suppliers_budget)}</span></div><Bar value={fi.suppliers_usd} max={fi.suppliers_budget} /></div>
            </div>
            <p className="text-2xs text-dim">BOM {money(fi.bom_unit)} per unit (sample) · agent costs estimated from the real event feed</p>
          </> : <p className="text-sm text-dim">No budget for this device yet.</p>}
        </Tile>
      </div>
    </>
  );
}

/** All projects on one screen: each row deep-links into that project's pages. */
export function AllTowers({ getJSON, live }: Pick<PageCtx, "getJSON" | "live">) {
  const { data, missing } = useLive<{ projects: Tower[] }>(getJSON, live, "supply/tower", "tower-all.json", 5000);
  if (!data) return <Pending missing={missing} />;
  const ts = data.projects;
  const sum = (f: (t: Tower) => number) => ts.reduce((k, t) => k + f(t), 0);
  const risks = (t: Tower) => t.supply ? Object.values(t.supply.counts).reduce((a, b) => a + b, 0) : 0;
  const risky = ts.filter(t => brief(t).risky);
  return (
    <>
      <PageHead title="Control Tower" sub={<>
        Every project at a glance. {n(ts.length, "project")}, {risky.length ? `${risky.length} at risk (${risky.map(t => t.project.name).join(", ")})` : "all on track"}.{" "}
        {sum(t => t.software.approved)} of {n(sum(t => t.software.total), "work order")} approved, {sum(t => t.software.blocked) ? `${sum(t => t.software.blocked)} blocked by the gate` : "none blocked by the gate"}. Factory spend so far is {money(sum(t => t.finance?.factory_usd || 0), true)}. Open a project for its full tower.
      </>} />
      <div className="mb-8 grid gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {([["Projects", ts.length], ["Work orders in flight", sum(t => t.software.running)], ["Approved", sum(t => t.software.approved)],
          ["Blocked by the gate", sum(t => t.software.blocked)], ["Trace gaps", sum(t => t.safety.gaps.length)], ["Supply risks", sum(risks)]] as const).map(([l, n]) => (
          <div key={l} className="rounded-lg border border-line bg-panel p-3"><div className="text-xs text-dim">{l}</div><div className="text-xl font-semibold tabular-nums">{n}</div></div>
        ))}
      </div>
      <div className="space-y-3">
        {ts.map(t => {
          const at = (x: string) => `#/p/${t.project.id}/${x}`;
          return (
            <section key={t.project.id} className="rounded-xl border border-line bg-panel">
              <a href={at("control-tower")} className="group flex flex-wrap items-baseline gap-2 border-b border-line px-4 py-3 hover:bg-white/[.02]">
                <h2 className="text-base font-semibold">{t.project.name}</h2><span className="text-xs text-dim">{t.project.standard}</span>
                <ArrowRight size={14} className="ml-auto self-center text-dim group-hover:text-ink" />
              </a>
              <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <div><div className="mb-1 flex items-center gap-1.5 text-xs text-dim"><GitPullRequest size={13} /> Software building</div>
                  <div className="grid grid-cols-3 gap-1">
                    <Num n={t.software.running} label="in flight" tone={t.software.running ? "run" : undefined} href={at("work-orders")} />
                    <Num n={t.software.approved} label="approved" tone="ok" href={at("work-orders")} />
                    <Num n={t.software.blocked} label="blocked" tone={t.software.blocked ? "bad" : undefined} href={at("work-orders")} />
                  </div></div>
                <div><div className="mb-1 flex items-center gap-1.5 text-xs text-dim"><FlaskConical size={13} /> Physical-AI safety</div>
                  <div className="grid grid-cols-2 gap-1">
                    <Num n={t.safety.sim ? <Pill tone={verdictTone(t.safety.sim.verdict)}>{t.safety.sim.verdict}</Pill> : "—"} label="latest simulation" href={at("world-model")} />
                    <Num n={t.safety.gaps.length} label="trace gaps" tone={t.safety.gaps.length ? "bad" : "ok"} href={at("traceability")} />
                  </div></div>
                <div><div className="mb-1 flex items-center gap-1.5 text-xs text-dim"><Package size={13} /> Supply chain</div>
                  {t.supply ? <div className="grid grid-cols-2 gap-1">
                    <Num n={t.supply.suppliers} label="suppliers" href={at("supply-chain/suppliers")} />
                    <Num n={risks(t)} label="open risks" tone={risks(t) ? "warn" : "ok"} href={at("supply-chain")} />
                  </div> : <p className="text-xs text-dim">No data</p>}</div>
                <div><div className="mb-1 flex items-center gap-1.5 text-xs text-dim"><Wallet size={13} /> Finance</div>
                  {t.finance ? <div className="grid grid-cols-2 gap-1">
                    <Num n={money(t.finance.factory_usd, true)} label="factory spend (est.)" href={at("finance")} />
                    <Num n={money(t.finance.cost_per_wo, true)} label="per work order" href={at("finance")} />
                  </div> : <p className="text-xs text-dim">No data</p>}</div>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
