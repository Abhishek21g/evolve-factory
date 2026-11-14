"use client";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { PageHead, Section, Table } from "@/components/ui";
import { FLAG_LABEL, RISK_LABEL, money, useLive, type Part, type PartFlag, type PageCtx, type RiskKind, type SupplyView } from "@/lib/supply";
import { Items, Pending, Pill, SampleBox, StatCard, type Tone } from "./common";

const CUSTOMS_TONE: Record<Part["customs"], Tone> = { Domestic: "idle", Cleared: "ok", "In transit": "run", Held: "bad", Delayed: "bad" };
const FLAG_TONE: Record<PartFlag, Tone> = { single_source: "warn", long_lead: "warn", import_delay: "bad", supplier_cert: "warn" };
const CHAIN_RISKS: RiskKind[] = ["single_source", "long_lead", "import_delay", "expiring_cert", "expired_cert"];

export function SupplyChain({ state, getJSON, live }: PageCtx) {
  const p = state.project!;
  const { data: v, missing } = useLive<SupplyView>(getJSON, live, `supply?project=${p.id}`, `supply-${p.id}.json`);
  const [flag, setFlag] = useState<PartFlag | "">("");
  if (!v) return <Pending missing={missing} />;
  if (!v.available) return <PageHead title="Supply chain" sub="No supply-chain data for this device yet." />;
  const sups = Object.fromEntries(v.suppliers!.map(s => [s.id, s]));
  const parts = v.parts!.filter(x => !flag || x.flags.includes(flag));
  const imports = v.parts!.flatMap(x => [{ name: x.name, origin: x.origin, hs: x.hs, supplier: x.supplier, part: x, level: "Part" },
    ...x.materials.map(m => ({ ...m, part: x, level: "Raw material" }))]).filter(m => !["USA", "Open source"].includes(m.origin));
  const count = (k: RiskKind) => v.risks!.filter(r => r.kind === k).length;
  const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-[12px] ${on ? "border-white/30 bg-white/[.08] text-ink" : "border-line text-mute hover:text-ink"}`;
  return (
    <>
      <PageHead title="Supply chain" sub={<>Parts, raw materials and imports for {p.name}: each part traces to its supplier, the raw materials inside it, where they come from, and the hazards and requirements it could affect.</>} />
      <div className="mb-4 rounded-lg border border-line bg-panel px-4 py-3 text-sm">
        <b>Where do raw materials and imports go?</b> <span className="text-mute">Here. Each part below lists its raw materials with their country of origin and HS tariff code, the part&apos;s customs status and lead time, and risk flags (single source, long lead, import delay, expiring supplier certificate) linked to the requirements and hazards they put at risk.</span>
      </div>
      <SampleBox>{v.sample}</SampleBox>
      <div className="mb-8 grid gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Parts in BOM" value={v.parts!.length} sub={`${money(v.finance!.bom_unit)} per unit`} href={`#/p/${p.id}/finance`} />
        {CHAIN_RISKS.map(k => <StatCard key={k} label={RISK_LABEL[k]} value={count(k)} tone={count(k) ? (k === "import_delay" || k === "expired_cert" ? "bad" : "warn") : "ok"} />)}
      </div>

      <Section title="Parts and their chain" aside={
        <span className="flex flex-wrap gap-1.5">
          <button className={chip(!flag)} onClick={() => setFlag("")}>All · {v.parts!.length}</button>
          {(Object.keys(FLAG_LABEL) as PartFlag[]).map(f => {
            const n = v.parts!.filter(x => x.flags.includes(f)).length;
            return n ? <button key={f} className={chip(flag === f)} onClick={() => setFlag(flag === f ? "" : f)}>{FLAG_LABEL[f]} · {n}</button> : null;
          })}
        </span>}>
        <Table head={["Part", "Supplier", "Raw materials → origin", "Origin · HS code", "Lead time", "Customs", "Risk", "Could affect"]}
          rows={parts.map(x => [
            <div key="p" className="min-w-[150px]"><div className="font-medium">{x.name}</div><div className="font-mono text-[11px] text-dim">{x.pn} · ×{x.qty} · {money(x.unit_cost)}</div></div>,
            <a key="s" href={`#/p/${p.id}/suppliers/${x.supplier}`} className="block min-w-[140px] text-[12.5px] hover:underline">{sups[x.supplier]?.name || x.supplier}<div className="text-[11px] text-dim">tier {sups[x.supplier]?.tier}</div></a>,
            <ul key="m" className="min-w-[220px] space-y-0.5 text-[12px]">
              {x.materials.map(m => (
                <li key={m.name} className="flex items-center gap-1.5">
                  {m.supplier ? <a href={`#/p/${p.id}/suppliers/${m.supplier}`} className="hover:underline">{m.name}</a> : <span>{m.name}</span>}
                  <ArrowRight size={11} className="shrink-0 text-dim" /><span className="text-mute">{m.origin}</span>
                </li>
              ))}
            </ul>,
            <span key="o" className="whitespace-nowrap text-[12.5px]">{x.origin} <span className="font-mono text-[11px] text-dim">· {x.hs}</span></span>,
            <span key="l" className={`whitespace-nowrap tabular-nums ${x.flags.includes("long_lead") ? "text-warn" : ""}`}>{x.lead_days} days</span>,
            <span key="c" title={x.customs_note}><Pill tone={CUSTOMS_TONE[x.customs]}>{x.customs}</Pill>{x.customs_note && <div className="mt-1 max-w-[180px] text-[11px] text-dim">{x.customs_note}</div>}</span>,
            <span key="r" className="flex min-w-[110px] flex-wrap gap-1">{x.flags.length ? x.flags.map(f => <Pill key={f} tone={FLAG_TONE[f]}>{FLAG_LABEL[f]}</Pill>) : <Pill tone="ok">none</Pill>}</span>,
            <Items key="a" ids={x.affects} pid={p.id} />,
          ])} empty="No parts with this flag." />
      </Section>

      <Section title="Imports: raw materials and components from outside the US" aside={`${imports.length} lines`}>
        <Table head={["Import", "Level", "Origin", "HS code", "Customs / in part", "Supplier"]} rows={imports.map(m => [
          m.name, <span key="l" className="text-mute">{m.level}</span>, m.origin, <span key="h" className="font-mono text-[12px]">{m.hs}</span>,
          m.level === "Part" ? <Pill key="p" tone={CUSTOMS_TONE[m.part.customs]}>{m.part.customs}</Pill> : m.part.name,
          m.supplier ? <a key="s" href={`#/p/${p.id}/suppliers/${m.supplier}`} className="hover:underline">{sups[m.supplier]?.name}</a>
            : <span key="s" className="text-mute">{sups[m.part.supplier]?.name} (sourced by)</span>,
        ])} />
      </Section>
    </>
  );
}
