"use client";
import { Badge, PageHead, Section, Table } from "@/components/ui";
import { money, useLive, type PageCtx, type SupplyView } from "@/lib/supply";
import { Bar, Note, Pending, Pill, SampleNote, Stat, StatRow } from "./common";

export function Finance({ state, getJSON, live }: PageCtx) {
  const p = state.project!;
  const { data: v, missing } = useLive<SupplyView>(getJSON, live, `supply?project=${p.id}`, `supply-${p.id}.json`);
  if (!v) return <Pending missing={missing} />;
  if (!v.available) return <PageHead title="Finance" sub="No budget for this device yet." />;
  const f = v.finance!;
  const sups = Object.fromEntries(v.suppliers!.map(s => [s.id, s.name]));
  const fac = f.lines.filter(l => l.id !== "suppliers");
  const facBudget = fac.reduce((n, l) => n + l.budget, 0);
  return (
    <>
      <PageHead title="Finance" sub={<>Budget vs actual for {p.name} · {f.period}. What the agent team costs per work order and per requirement it verifies, what suppliers cost, and the certification effort the factory saves.</>} />
      <SampleNote>Budget, supplier spend and BOM prices are sample data. Agent and compute costs are <b className="text-ink">estimated</b>: coding attempts, analysis steps and simulations are counted from the real event feed and priced with the assumptions at the bottom of this page.</SampleNote>
      <StatRow>
        <Stat label="factory spend" value={money(f.factory_usd, true)} sub={`of ${money(facBudget)} · estimated`} />
        <Stat label="per work order" value={money(f.cost_per_wo, true)} sub={`${f.completed} completed`} href={`#/p/${p.id}/work-orders`} />
        <Stat label="per requirement verified" value={money(f.cost_per_req, true)} sub={`${f.verified} tests passed`} href={`#/p/${p.id}/traceability`} />
        <Stat label="certification effort saved" value={`${f.saved.hours} h`} sub={`≈ ${money(f.saved.usd)} · assumption`} />
        <Stat label="BOM per unit" value={money(f.bom_unit)} sub={`${f.bom.length} parts · sample`} href={`#/p/${p.id}/supply-chain`} />
      </StatRow>

      <Section title="Budget vs actual">
        <Table head={["Category", "Budget", "Actual", "", "Basis"]} rows={f.lines.map(l => {
          const pct = l.budget ? l.actual / l.budget : 0;
          return [
            <span key="l" className="font-medium">{l.label}</span>, <span key="b" className="tabular-nums">{money(l.budget)}</span>,
            <span key="a" className="tabular-nums">{money(l.actual, l.actual < 1000)}</span>,
            <div key="bar" className="flex min-w-[180px] items-center gap-2"><Bar value={l.actual} max={l.budget} tone={pct > 1 ? "bad" : pct > 0.85 ? "warn" : "ok"} /><span className="w-10 text-right text-[11px] tabular-nums text-dim">{Math.round(pct * 100)}%</span></div>,
            <Pill key="x" tone={l.basis === "estimated" ? "run" : "warn"}>{l.basis}</Pill>,
          ];
        })} />
      </Section>

      <Section title="Agent runs per work order" aside="counted from the event feed · priced with the assumptions below">
        {f.work_orders.length ? (
          <Table head={["Work order", "Status", "Runs", "Coding attempts", "Analysis steps", "Coding agent time", "Simulations", "Requirements verified", "LLM (est.)", "Compute (est.)", "Total"]}
            rows={f.work_orders.map(w => [
              <a key="w" href={`#/p/${p.id}/work-orders/${w.wo}`} className="block min-w-[160px] hover:underline"><span className="font-mono text-[12px]">{w.wo}</span> <span className="text-mute">{w.title}</span></a>,
              <Badge key="s">{w.status}</Badge>, w.runs, w.attempts, w.steps,
              w.agent_min === null ? <span key="m" className="whitespace-nowrap text-dim" title="Replayed from a recorded real run: timings are compressed">replayed run</span>
                : <span key="m" className="whitespace-nowrap tabular-nums">{w.agent_min} min</span>, w.sims, w.verified,
              <span key="l" className="tabular-nums">{money(w.llm_usd, true)}</span>, <span key="c" className="tabular-nums">{money(w.compute_usd, true)}</span>,
              <b key="t" className="tabular-nums">{money(w.total_usd, true)}</b>,
            ])} />
        ) : <Note>No work order has run in {p.name} yet. Costs appear here after the first run.</Note>}
        {f.whatifs.runs > 0 && <p className="mt-2 text-[12px] text-dim">Plus {f.whatifs.runs} what-if question{f.whatifs.runs === 1 ? "" : "s"} to the world model ({f.whatifs.sims} simulations, {money(f.whatifs.usd, true)} estimated).</p>}
      </Section>

      <div className="grid gap-8 xl:grid-cols-2">
        <Section title="Supplier spend (sample)" aside={<a href={`#/p/${p.id}/suppliers`} className="hover:text-ink">Suppliers</a>}>
          <Table head={["Supplier", "Tier", "PO value", "Invoiced", ""]} rows={f.spend.filter(s => s.po).map(s => [
            <a key="n" href={`#/p/${p.id}/suppliers/${s.supplier}`} className="hover:underline">{s.name}</a>, s.tier,
            <span key="p" className="tabular-nums">{money(s.po)}</span>, <span key="i" className="tabular-nums">{money(s.invoiced)}</span>,
            <div key="b" className="min-w-[80px]"><Bar value={s.invoiced} max={s.po} /></div>,
          ])} />
        </Section>
        <Section title="BOM cost per unit (sample)" aside={<a href={`#/p/${p.id}/supply-chain`} className="hover:text-ink">Supply chain</a>}>
          <Table head={["Part", "Supplier", "Qty", "Unit", "Extended"]} rows={[
            ...f.bom.map(b => [b.name, <a key="s" href={`#/p/${p.id}/suppliers/${b.supplier}`} className="text-mute hover:underline">{sups[b.supplier]}</a>, b.qty,
              <span key="u" className="tabular-nums">{money(b.unit_cost)}</span>, <span key="e" className="tabular-nums">{money(b.qty * b.unit_cost)}</span>]),
            [<b key="t">Total per unit</b>, "", "", "", <b key="v" className="tabular-nums">{money(f.bom_unit)}</b>],
          ]} />
        </Section>
      </div>

      <Section title="Assumptions">
        <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-mute">{f.assumptions.map(a => <li key={a}>{a}</li>)}</ul>
      </Section>
    </>
  );
}
