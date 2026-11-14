"use client";
import { useState } from "react";
import { FilePlus2, Mail, Plus, Users } from "lucide-react";
import { Badge, Button, Field, Modal, PageHead, Section, Table, inputCls } from "@/components/ui";
import { KIND_LABEL, RISK_LABEL, useLive, type Deliverable, type PageCtx, type Risk, type Supplier, type SupplierKind, type SupplyView } from "@/lib/supply";
import { Dot, Items, Pending, Pill, SampleNote, Stat, StatRow, type Tone } from "./common";

const STATUS_TONE: Record<Supplier["status"], string> = { Approved: "Approved", Conditional: "Stopped", Invited: "Draft" };
const DELIV_TONE: Record<Deliverable["status"], Tone> = { accepted: "ok", submitted: "run", missing: "bad" };
const DELIV_KINDS = ["certificate", "test_report", "sbom", "cert_data", "report", "agreement", "declaration"] as const;
const TIER_TITLE = ["", "Tier 1 · direct suppliers", "Tier 2 · their suppliers", "Tier 3 · raw materials and components"];

function Expiry({ d }: { d: Deliverable }) {
  if (d.days_left === null) return <span className="text-dim">—</span>;
  const tone: Tone = d.expiry === "expired" ? "bad" : d.expiry === "expiring" ? "warn" : "idle";
  return <Pill tone={tone} title={d.expires}>{d.expiry === "expired" ? `expired ${-d.days_left}d ago` : `${d.days_left}d left`}</Pill>;
}

function DeliverableSummary({ s }: { s: Supplier }) {
  const n = (st: Deliverable["status"]) => s.deliverables.filter(d => d.status === st).length;
  return (
    <span className="whitespace-nowrap text-[12px]">
      <span className="text-ok">{n("accepted")} accepted</span>
      {n("submitted") > 0 && <span className="text-run"> · {n("submitted")} submitted</span>}
      {n("missing") > 0 && <span className="text-bad"> · {n("missing")} missing</span>}
    </span>
  );
}

export function Suppliers(ctx: PageCtx & { item: string }) {
  const { state, getJSON, live, item } = ctx;
  const p = state.project!;
  const { data: v, missing, reload } = useLive<SupplyView>(getJSON, live, `supply?project=${p.id}`, `supply-${p.id}.json`);
  const [inviting, setInviting] = useState(false);
  if (!v) return <Pending missing={missing} />;
  if (!v.available) return <PageHead title="Suppliers" sub="No supplier data for this device yet." />;
  if (item) {
    const s = v.suppliers!.find(x => x.id === item);
    return s ? <Workspace {...ctx} v={v} s={s} reload={reload} /> : <p className="text-dim">Supplier {item} is not part of {p.name}.</p>;
  }
  const sups = v.suppliers!;
  const certs = v.risks!.filter(r => r.kind === "expiring_cert" || r.kind === "expired_cert");
  const findings = v.risks!.filter(r => ["expired_cert", "expiring_cert", "missing_deliverable"].includes(r.kind));
  const name = (id: string | null) => sups.find(x => x.id === id)?.name || "";
  return (
    <>
      <PageHead title="Suppliers" sub={<>Sub-supplier teams across the tiers, what each supplies, the assurance {p.name} requires of them, and the requirements and hazards their parts touch. Required here: {v.assurance!.join(" · ")}.</>}>
        <Button primary onClick={() => setInviting(true)} disabled={!live}><Plus size={14} /> Connect a supplier team</Button>
      </PageHead>
      <SampleNote>{v.sample} Deliverables a supplier submits here are real: each becomes a trace link on the requirement it supports and appears in the evidence pack.</SampleNote>
      <StatRow>
        {[1, 2, 3].map(t => <Stat key={t} label={`tier ${t} · ${t === 1 ? "direct" : t === 2 ? "sub-suppliers" : "raw materials"}`} value={sups.filter(s => s.tier === t).length} />)}
        <Stat label="missing deliverables" value={sups.reduce((n, s) => n + s.missing, 0)} tone="bad" />
        <Stat label="certificates expiring or expired" value={certs.length} tone={certs.length ? "warn" : "ok"} />
      </StatRow>

      <Section title="Supplier compliance findings" aside={<span>{findings.length} open · from certificates and requested deliverables</span>}>
        <ComplianceFindings ctx={ctx} v={v} findings={findings} />
      </Section>

      {[1, 2, 3].map(t => (
        <Section key={t} title={TIER_TITLE[t]}>
          <Table head={["Supplier", "Supplies", "Assurance", "Deliverables", "Certificate", "Affects", "Status"]}
            rows={sups.filter(s => s.tier === t).map(s => {
              const cert = s.deliverables.filter(d => d.days_left !== null).sort((a, b) => a.days_left! - b.days_left!)[0];
              return [
                <div key="n" className="min-w-[180px]">
                  <a href={`#/p/${p.id}/suppliers/${s.id}`} className="font-medium hover:underline">{s.name}</a>
                  <div className="text-[11.5px] text-dim">{s.location}{s.parent ? ` · supplies ${name(s.parent)}` : ""}</div>
                </div>,
                <div key="s" className="min-w-[200px] text-[12.5px]"><Pill>{KIND_LABEL[s.kind]}</Pill> <span className="text-mute">{s.supplies}</span></div>,
                <div key="a" className="flex min-w-[160px] flex-wrap gap-1">{s.assurance.map(a => <Pill key={a}>{a}</Pill>)}</div>,
                <DeliverableSummary key="d" s={s} />,
                cert ? <Expiry key="c" d={cert} /> : <span key="c" className="text-dim">—</span>,
                <Items key="i" ids={s.affects} pid={p.id} />,
                <Badge key="st" tone={STATUS_TONE[s.status]}>{s.status}</Badge>,
              ];
            })} />
        </Section>
      ))}
      {inviting && <Invite ctx={ctx} v={v} onClose={() => setInviting(false)} onDone={id => { setInviting(false); reload(); location.hash = `/p/${p.id}/suppliers/${id}`; }} />}
    </>
  );
}

/** The supplier compliance monitor's output: each finding can become a work order in one click. */
function ComplianceFindings({ ctx, v, findings }: { ctx: PageCtx; v: SupplyView; findings: Risk[] }) {
  const p = ctx.state.project!;
  const [err, setErr] = useState("");
  const open = async (r: Risk) => {
    const s = v.suppliers!.find(x => x.id === r.supplier);
    const res = await ctx.post("workorders", {
      project: p.id, title: `Supplier compliance: ${r.kind === "missing_deliverable" ? "obtain" : "renew"} ${s?.deliverables.find(d => d.id === r.deliverable)?.title || "deliverable"} from ${s?.name || r.supplier}`.slice(0, 120),
      description: `${r.text}. Affects ${r.affects.join(", ")}. Raised by the supplier compliance check (${RISK_LABEL[r.kind]}).`,
    });
    if (res.error) return setErr(res.error);
    location.hash = `/p/${p.id}/work-orders/${res.id}`;
  };
  if (!findings.length) return <p className="text-[13px] text-dim">Every supplier certificate is current and every requested deliverable is in.</p>;
  return (
    <>
      <div className="divide-y divide-line border-y border-line">
        {findings.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-3 py-2 text-base">
            <Dot tone={r.tone} />
            <a href={`#/p/${p.id}/suppliers/${r.supplier}`} className="min-w-0 flex-1 hover:underline">{r.text}</a>
            <span className="text-sm text-dim">{RISK_LABEL[r.kind].toLowerCase()}</span>
            <Items ids={r.affects} pid={p.id} />
            <Button onClick={() => open(r)} disabled={!ctx.live}>Open work order</Button>
          </div>
        ))}
      </div>
      {err && <p className="mt-2 text-[12px] text-bad">{err}</p>}
    </>
  );
}

function Workspace({ state, live, post, v, s, reload }: PageCtx & { v: SupplyView; s: Supplier; reload: () => void }) {
  const p = state.project!;
  const [submitting, setSubmitting] = useState<Deliverable | "new" | null>(null);
  const [done, setDone] = useState<{ item: string; link: string; title: string } | null>(null);
  const sups = v.suppliers!;
  const parent = sups.find(x => x.id === s.parent);
  const children = sups.filter(x => x.parent === s.id);
  const parts = v.parts!.filter(x => x.supplier === s.id);
  const text = Object.fromEntries(v.items!.map(i => [i.id, i.text]));
  return (
    <>
      <div className="mb-1 text-[12px] text-dim"><a href={`#/p/${p.id}/suppliers`} className="hover:text-ink">Suppliers</a> / {s.id}</div>
      <PageHead title={s.name} sub={<span className="inline-flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge> Tier {s.tier} · {KIND_LABEL[s.kind]} · {s.location}{parent && <> · supplies <a href={`#/p/${p.id}/suppliers/${parent.id}`} className="underline">{parent.name}</a></>}</span>}>
        <Button primary onClick={() => setSubmitting("new")} disabled={!live}><FilePlus2 size={14} /> Submit a deliverable</Button>
      </PageHead>
      <SampleNote>Supplier workspace for {p.name}. {s.status === "Invited" ? "This team was connected from the factory; it sees only what is requested of it." : v.sample}</SampleNote>
      {done && (
        <div className="mb-6 rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-[12.5px] text-mute">
          <b className="text-ok">Recorded.</b> “{done.title}” is now trace link <b className="text-ink">{done.link}</b> on{" "}
          <a href={`#/p/${p.id}/traceability/${done.item}`} className="text-acc underline">{done.item}</a> and appears in the evidence pack of every work order that touches it.
        </div>
      )}
      <p className="mb-6 max-w-3xl text-[13px] text-mute">{s.supplies}</p>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <div className="min-w-0">
          <Section title="Deliverables" aside="certificates, test reports, SBOM, certification data">
            <Table head={["Deliverable", "Kind", "Status", "Expires", "Supports", "Document", ""]} rows={s.deliverables.map(d => [
              <span key="t" className="font-medium">{d.title}</span>,
              <span key="k" className="whitespace-nowrap text-[12px] text-mute">{d.kind.replace("_", " ")}</span>,
              <Pill key="s" tone={DELIV_TONE[d.status]}>{d.status}</Pill>,
              <Expiry key="e" d={d} />,
              d.item ? <Items key="i" ids={[d.item]} pid={p.id} /> : <span key="i" className="text-dim">—</span>,
              d.url ? <a key="u" href={d.url} target="_blank" rel="noopener" className="text-[12px] text-acc hover:underline">open{d.link ? ` · ${d.link}` : ""}</a> : <span key="u" className="text-dim">—</span>,
              d.status === "missing" || d.expiry ? <Button key="b" onClick={() => setSubmitting(d)} disabled={!live}>{d.status === "missing" ? "Submit" : "Renew"}</Button> : <span key="b" />,
            ])} />
          </Section>
          <Section title="Requirements and hazards this supplier affects">
            <Table head={["ID", "What it says"]} rows={s.affects.map(id => [<Items key="i" ids={[id]} pid={p.id} />, <span key="t" className="text-mute">{text[id]}</span>])} empty="No requirement linked yet." />
          </Section>
          <Section title="Parts from this supplier" aside={<a href={`#/p/${p.id}/supply-chain`} className="hover:text-ink">Supply chain</a>}>
            <Table head={["Part", "Origin", "Lead time", "Customs"]} empty="No parts in the BOM from this supplier yet."
              rows={parts.map(x => [<span key="n">{x.name} <span className="font-mono text-[11px] text-dim">{x.pn}</span></span>, x.origin, `${x.lead_days} days`, x.customs])} />
          </Section>
        </div>
        <div>
          <Section title="Team contacts">
            <ul className="divide-y divide-line border-y border-line text-[13px]">
              {s.contacts.map(c => (
                <li key={c.email || c.name} className="py-2.5">
                  <div className="flex items-center gap-2 font-medium"><Users size={13} className="text-dim" /> {c.name}</div>
                  <div className="text-[12px] text-dim">{c.role}</div>
                  {c.email && <a href={`mailto:${c.email}`} className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-acc hover:underline"><Mail size={12} /> {c.email}</a>}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Required assurance">
            <div className="flex flex-wrap gap-1.5">{s.assurance.map(a => <Pill key={a}>{a}</Pill>)}</div>
          </Section>
          {children.length > 0 && (
            <Section title="Its suppliers">
              <ul className="space-y-1 text-[13px]">{children.map(c => <li key={c.id}><a href={`#/p/${p.id}/suppliers/${c.id}`} className="hover:underline">{c.name}</a> <span className="text-dim">· tier {c.tier}</span></li>)}</ul>
            </Section>
          )}
        </div>
      </div>
      {submitting && <Submit post={post} pid={p.id} v={v} s={s} d={submitting === "new" ? null : submitting}
        onClose={() => setSubmitting(null)} onDone={r => { setSubmitting(null); setDone(r); reload(); }} />}
    </>
  );
}

function Submit({ post, pid, v, s, d, onClose, onDone }: {
  post: PageCtx["post"]; pid: string; v: SupplyView; s: Supplier; d: Deliverable | null; onClose: () => void;
  onDone: (r: { item: string; link: string; title: string }) => void;
}) {
  const reqs = v.items!.filter(i => i.id.startsWith("SR-"));
  const [title, setTitle] = useState(d?.title || "");
  const [kind, setKind] = useState(d?.kind || "test_report");
  const [url, setUrl] = useState("");
  const [item, setItem] = useState(d?.item || s.affects.find(a => a.startsWith("SR-")) || reqs[0]?.id || "");
  const [expires, setExpires] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await post("supply/deliverables", { project: pid, supplier: s.id, deliverable: d?.id || "", title, kind, url, item, expires }) as { error?: string; link?: string };
    if (r.error) return setErr(r.error);
    onDone({ item, link: r.link || "", title });
  };
  return (
    <Modal title={`Submit a deliverable · ${s.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Deliverable"><input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="DO-160G qualification report, rev C" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <select className={inputCls} value={kind} onChange={e => setKind(e.target.value)}>
              {DELIV_KINDS.map(k => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
            </select>
          </Field>
          <Field label="Expires (certificates)"><input type="date" className={inputCls} value={expires} onChange={e => setExpires(e.target.value)} /></Field>
        </div>
        <Field label="Document link"><input className={inputCls} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://supplier-portal.example/docs/report.pdf" /></Field>
        <Field label="Supports requirement">
          <select className={inputCls} value={item} onChange={e => setItem(e.target.value)}>
            {reqs.map(r => <option key={r.id} value={r.id}>{r.id} · {r.text}{s.affects.includes(r.id) ? "" : " (not yet linked to this supplier)"}</option>)}
          </select>
        </Field>
        <p className="text-[12px] text-dim">The document becomes a trace link on {item}, shows in Traceability and in the evidence pack.</p>
        {err && <p className="text-[12px] text-bad">{err}</p>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button primary type="submit" disabled={!title.trim() || !url.trim()}>Submit deliverable</Button></div>
      </form>
    </Modal>
  );
}

function Invite({ ctx, v, onClose, onDone }: { ctx: PageCtx; v: SupplyView; onClose: () => void; onDone: (id: string) => void }) {
  const p = ctx.state.project!;
  const air = p.device === "flight-controls";
  const [name, setName] = useState(air ? "Pitot-static probe supplier (sample)" : "Infusion tubing extruder (sample)");
  const [tier, setTier] = useState(2);
  const [parent, setParent] = useState(v.suppliers!.find(s => s.tier === 1)?.id || "");
  const [kind, setKind] = useState<SupplierKind>("hardware");
  const [supplies, setSupplies] = useState(air ? "Pitot-static probes feeding air data to the AoA cross-check" : "Medical-grade PVC-free infusion tubing");
  const [location, setLocation] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [affects, setAffects] = useState<string[]>(air ? ["SR-2", "H-3"] : ["SR-4", "H-4"]);
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await ctx.post("supply/suppliers", { project: p.id, name, tier, parent: tier > 1 ? parent : "", kind, supplies, location, contact, email, affects });
    if (r.error) return setErr(r.error);
    onDone(r.id!);
  };
  const toggle = (id: string) => setAffects(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]);
  return (
    <Modal title="Connect a supplier team" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Supplier"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Tier">
            <select className={inputCls} value={tier} onChange={e => setTier(Number(e.target.value))}>
              {[1, 2, 3].map(t => <option key={t} value={t}>Tier {t}</option>)}
            </select>
          </Field>
          <Field label="Supplies a">
            <select className={inputCls} value={kind} onChange={e => setKind(e.target.value as SupplierKind)}>
              {(Object.keys(KIND_LABEL) as SupplierKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Location"><input className={inputCls} value={location} onChange={e => setLocation(e.target.value)} placeholder="City, country" /></Field>
        </div>
        {tier > 1 && (
          <Field label="Supplies to (parent supplier)">
            <select className={inputCls} value={parent} onChange={e => setParent(e.target.value)}>
              {v.suppliers!.filter(s => s.tier < tier).map(s => <option key={s.id} value={s.id}>{s.name} · tier {s.tier}</option>)}
            </select>
          </Field>
        )}
        <Field label="What they supply"><input className={inputCls} value={supplies} onChange={e => setSupplies(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact"><input className={inputCls} value={contact} onChange={e => setContact(e.target.value)} placeholder="Quality lead" /></Field>
          <Field label="Contact email"><input className={inputCls} value={email} onChange={e => setEmail(e.target.value)} placeholder="quality@supplier.example" /></Field>
        </div>
        <Field label="Requirements and hazards their parts affect">
          <div className="flex flex-wrap gap-1.5">
            {v.items!.map(i => (
              <button type="button" key={i.id} title={i.text} onClick={() => toggle(i.id)}
                className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${affects.includes(i.id) ? "border-white/30 bg-white/[.08] text-ink" : "border-line text-dim hover:text-ink"}`}>{i.id}</button>
            ))}
          </div>
        </Field>
        <p className="text-[12px] text-dim">Requested from them for {KIND_LABEL[kind].toLowerCase()}: {v.required![kind].map(([t]) => t).join(" · ")}.</p>
        {err && <p className="text-[12px] text-bad">{err}</p>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button primary type="submit" disabled={!name.trim()}>Connect team</Button></div>
      </form>
    </Modal>
  );
}
