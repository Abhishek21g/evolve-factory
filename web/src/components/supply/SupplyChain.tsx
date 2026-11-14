"use client";
import { useState } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import { plural as n } from "@/lib/utils";
import { Button, LOCAL_ONLY, PageHead, Section, Table } from "@/components/ui";
import { FLAG_LABEL, RISK_LABEL, money, useLive, type Part, type PartFlag, type PageCtx, type RiskKind, type SupplyView } from "@/lib/supply";
import { Dot, Items, Pending, Pill, SampleBox, StatCard, type Tone } from "./common";
import { Invite, SupplierWorkspace, SuppliersTab, partsOf, supplierHref } from "./Suppliers";

const CUSTOMS_TONE: Record<Part["customs"], Tone> = { Domestic: "idle", Cleared: "ok", "In transit": "run", Held: "bad", Delayed: "bad" };
const FLAG_TONE: Record<PartFlag, Tone> = { single_source: "warn", long_lead: "warn", import_delay: "bad", supplier_cert: "warn" };
const CHAIN_RISKS: RiskKind[] = ["single_source", "long_lead", "import_delay", "expiring_cert", "expired_cert", "missing_deliverable"];
const BAD_RISKS: RiskKind[] = ["import_delay", "expired_cert", "missing_deliverable"];
type Tab = "parts" | "suppliers";
const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-[12px] ${on ? "border-white/30 bg-white/[.08] text-ink" : "border-line text-mute hover:text-ink"}`;

/** Supply chain, suppliers included. #/p/<id>/supply-chain (parts), …/supply-chain/suppliers, …/supply-chain/<supplier> (its workspace). */
export function SupplyChain(ctx: PageCtx & { item: string }) {
  const { state, getJSON, live, item } = ctx;
  const p = state.project!;
  const { data: v, missing, reload } = useLive<SupplyView>(getJSON, live, `supply?project=${p.id}`, `supply-${p.id}.json`);
  const [flag, setFlag] = useState<PartFlag | "">("");
  const [sup, setSup] = useState("");
  const [inviting, setInviting] = useState(false);
  if (!v) return <Pending missing={missing} />;
  if (!v.available) return <PageHead title="Supply chain" sub="No supply-chain data for this device yet." />;
  const showParts = (sid: string) => { setSup(sid); setFlag(""); location.hash = `/p/${p.id}/supply-chain`; };
  if (item && item !== "suppliers") {
    const s = v.suppliers!.find(x => x.id === item);
    return s ? <SupplierWorkspace {...ctx} v={v} s={s} reload={reload} showParts={showParts} /> : <p className="text-dim">Supplier {item} is not part of {p.name}.</p>;
  }
  const tab: Tab = item === "suppliers" ? "suppliers" : "parts";
  const sups = v.suppliers!;
  const count = (k: RiskKind) => v.risks!.filter(r => r.kind === k).length;
  const tiers = [1, 2, 3].map(t => sups.filter(s => s.tier === t).length).join("/");
  const body = () => {
    switch (tab) {
      case "parts": return <PartsTab pid={p.id} v={v} flag={flag} setFlag={setFlag} sup={sup} setSup={setSup} />;
      case "suppliers": return <SuppliersTab ctx={ctx} v={v} showParts={showParts} />;
      default: { const never: never = tab; return never; }
    }
  };
  return (
    <>
      <PageHead title="Supply chain" sub={<>Parts, raw materials, imports and the suppliers behind them for {p.name}: each part traces to its supplier, the raw materials inside it, where they come from, and the hazards and requirements it could affect.</>}>
        {tab === "suppliers" && <Button primary onClick={() => setInviting(true)} disabled={!live} title={live ? undefined : LOCAL_ONLY}><Plus size={14} /> Connect a supplier team</Button>}
      </PageHead>
      <div className="mb-4 rounded-lg border border-line bg-panel px-4 py-3 text-sm">
        <b>Where do raw materials and imports go?</b> <span className="text-mute">Here. Each part below lists its raw materials with their country of origin and HS tariff code, the part&apos;s customs status and lead time, and risk flags (single source, long lead, import delay, expiring supplier certificate) linked to the requirements and hazards they put at risk. Suppliers shows who makes each part, their certificates and deliverables.</span>
      </div>
      <SampleBox>{v.sample} Deliverables a supplier submits are real: each becomes a trace link on the requirement it supports and appears in the evidence pack.</SampleBox>
      <div className="mb-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Suppliers" value={sups.length} sub={`${tiers} by tier`} href={tab === "suppliers" ? undefined : supplierHref(p.id)} />
        <StatCard label="Parts in BOM" value={v.parts!.length} sub={`${money(v.finance!.bom_unit)} per unit`} href={`#/p/${p.id}/finance`} />
        {CHAIN_RISKS.map(k => <StatCard key={k} label={RISK_LABEL[k]} value={count(k)} tone={count(k) ? (BAD_RISKS.includes(k) ? "bad" : "warn") : "ok"} />)}
      </div>

      <div role="tablist" aria-label="Supply chain view" className="mb-6 inline-flex overflow-hidden rounded-md border border-line text-sm">
        {([["parts", "Parts", v.parts!.length, `#/p/${p.id}/supply-chain`], ["suppliers", "Suppliers", sups.length, supplierHref(p.id)]] as const).map(([k, label, num, href]) => (
          <a key={k} role="tab" aria-selected={tab === k} href={href} className={`px-3 py-1.5 ${tab === k ? "bg-white/[.08] text-ink" : "text-mute hover:text-ink"}`}>
            {label} <span className="text-dim">· {num}</span>
          </a>
        ))}
      </div>
      {body()}
      {inviting && <Invite ctx={ctx} v={v} onClose={() => setInviting(false)} onDone={id => { setInviting(false); reload(); location.hash = supplierHref(p.id, id).slice(1); }} />}
    </>
  );
}

function PartsTab({ pid, v, flag, setFlag, sup, setSup }: {
  pid: string; v: SupplyView; flag: PartFlag | ""; setFlag: (f: PartFlag | "") => void; sup: string; setSup: (s: string) => void;
}) {
  const sups = Object.fromEntries(v.suppliers!.map(s => [s.id, s]));
  const base = sup ? partsOf(v.parts!, sup) : v.parts!;
  const parts = base.filter(x => !flag || x.flags.includes(flag));
  const imports = base.flatMap(x => [{ name: x.name, origin: x.origin, hs: x.hs, supplier: x.supplier, part: x, level: "Part" },
    ...x.materials.map(m => ({ ...m, part: x, level: "Raw material" }))]).filter(m => !["USA", "Open source"].includes(m.origin));
  return (
    <>
      <Section title="Parts and their chain" aside={
        <span className="flex flex-wrap gap-1.5">
          {sup && <button className={`${chip(true)} inline-flex items-center gap-1`} onClick={() => setSup("")} title="Show every supplier's parts">{sups[sup]?.name || sup} <X size={11} /></button>}
          <button aria-pressed={!flag} className={chip(!flag)} onClick={() => setFlag("")}>All · {base.length}</button>
          {(Object.keys(FLAG_LABEL) as PartFlag[]).map(f => {
            const k = base.filter(x => x.flags.includes(f)).length;
            return k ? <button key={f} aria-pressed={flag === f} className={chip(flag === f)} onClick={() => setFlag(flag === f ? "" : f)}>{FLAG_LABEL[f]} · {k}</button> : null;
          })}
        </span>}>
        <Table head={["Part", "Supplier", "Raw materials → origin", "Origin · HS code", "Lead time", "Customs", "Risk", "Could affect"]}
          rows={parts.map(x => [
            <div key="p" className="min-w-[150px]"><div className="font-medium">{x.name}</div><div className="font-mono text-[11px] text-dim">{x.pn} · ×{x.qty} · {money(x.unit_cost)}</div></div>,
            <a key="s" href={supplierHref(pid, x.supplier)} className="block min-w-[140px] text-[12.5px] hover:underline">{sups[x.supplier]?.name || x.supplier}<div className="text-[11px] text-dim">tier {sups[x.supplier]?.tier}</div></a>,
            <ul key="m" className="min-w-[220px] space-y-0.5 text-[12px]">
              {x.materials.map(m => (
                <li key={m.name} className="flex items-center gap-1.5">
                  {m.supplier ? <a href={supplierHref(pid, m.supplier)} className="hover:underline">{m.name}</a> : <span>{m.name}</span>}
                  <ArrowRight size={11} className="shrink-0 text-dim" /><span className="text-mute">{m.origin}</span>
                </li>
              ))}
            </ul>,
            <span key="o" className="whitespace-nowrap text-[12.5px]">{x.origin} <span className="font-mono text-[11px] text-dim">· {x.hs}</span></span>,
            <span key="l" className={`whitespace-nowrap tabular-nums ${x.flags.includes("long_lead") ? "text-warn" : ""}`}>{n(x.lead_days, "day")}</span>,
            <span key="c" title={x.customs_note}><Pill tone={CUSTOMS_TONE[x.customs]}>{x.customs}</Pill>{x.customs_note && <div className="mt-1 max-w-[180px] text-[11px] text-dim">{x.customs_note}</div>}</span>,
            <ul key="r" className="min-w-[120px] space-y-0.5 text-[12px]">{x.flags.length
              ? x.flags.map(f => <li key={f} className="flex items-center gap-1.5 whitespace-nowrap"><Dot tone={FLAG_TONE[f]} />{FLAG_LABEL[f]}</li>)
              : <li className="flex items-center gap-1.5 text-mute"><Dot tone="ok" />none</li>}</ul>,
            <Items key="a" ids={x.affects} pid={pid} />,
          ])} empty="No parts with this flag." />
      </Section>

      <Section title="Imports: raw materials and components from outside the US" aside={n(imports.length, "line")}>
        <Table head={["Import", "Level", "Origin", "HS code", "Customs / in part", "Supplier"]} rows={imports.map(m => [
          m.name, <span key="l" className="text-mute">{m.level}</span>, m.origin, <span key="h" className="font-mono text-[12px]">{m.hs}</span>,
          m.level === "Part" ? <Pill key="p" tone={CUSTOMS_TONE[m.part.customs]}>{m.part.customs}</Pill> : m.part.name,
          m.supplier ? <a key="s" href={supplierHref(pid, m.supplier)} className="hover:underline">{sups[m.supplier]?.name}</a>
            : <span key="s" className="text-mute">{sups[m.part.supplier]?.name} (sourced by)</span>,
        ])} />
      </Section>
    </>
  );
}
