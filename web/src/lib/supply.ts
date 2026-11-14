"use client";
import { useCallback, useEffect, useState } from "react";
import type { Project, State } from "./api";

/** What the supply-chain, finance and control-tower pages need from the app. */
export type PageCtx = {
  state: State; live: boolean; getJSON: <T>(p: string) => Promise<T | null>;
  post: (p: string, b: object) => Promise<{ error?: string; id?: string }>;
};

/** factory/supply.py: suppliers (sub-supplier teams), parts/BOM with risk flags, finance, control tower. */
export type SupplierKind = "hardware" | "software" | "raw_material";
export type Deliverable = {
  id: string; title: string; kind: string; status: "accepted" | "submitted" | "missing"; item?: string; expires?: string;
  days_left: number | null; expiry: "" | "expiring" | "expired"; url?: string; link?: string; by?: string; submitted?: number;
};
export type Supplier = {
  id: string; name: string; tier: 1 | 2 | 3; parent: string | null; kind: SupplierKind; supplies: string; location: string;
  assurance: string[]; status: "Approved" | "Conditional" | "Invited"; invited?: number;
  contacts: { name: string; role: string; email: string }[]; affects: string[]; spend: { po: number; invoiced: number };
  deliverables: Deliverable[]; missing: number; expiring: number;
};
export type PartFlag = "single_source" | "long_lead" | "import_delay" | "supplier_cert";
export type Part = {
  id: string; name: string; pn: string; supplier: string; qty: number; unit_cost: number; origin: string; hs: string;
  lead_days: number; customs: "Domestic" | "Cleared" | "In transit" | "Held" | "Delayed"; customs_note?: string; single_source: boolean;
  affects: string[]; materials: { name: string; origin: string; hs: string; supplier?: string }[]; flags: PartFlag[];
};
export type RiskKind = "expired_cert" | "expiring_cert" | "missing_deliverable" | "single_source" | "long_lead" | "import_delay";
export type Risk = { kind: RiskKind; tone: "bad" | "warn"; text: string; supplier?: string; part?: string; deliverable?: string; affects: string[] };
export type WoCost = {
  wo: string; title: string; status: string; runs: number; attempts: number; steps: number; agent_min: number | null; sims: number;
  verified: number; llm_usd: number; compute_usd: number; total_usd: number;
};
export type Finance = {
  period: string; lines: { id: string; label: string; budget: number; actual: number; basis: "estimated" | "sample" }[];
  work_orders: WoCost[]; whatifs: { runs: number; sims: number; usd: number }; factory_usd: number;
  cost_per_wo: number | null; cost_per_req: number | null; verified: number; completed: number;
  saved: { hours: number; usd: number }; bom_unit: number;
  bom: { part: string; name: string; qty: number; unit_cost: number; supplier: string }[];
  spend: { supplier: string; name: string; tier: number; po: number; invoiced: number }[];
  rates: { hours_per_wo: number; hour_usd: number }; assumptions: string[];
};
export type SupplyView = {
  project: string; device: string; available: boolean; sample?: string; assurance?: string[];
  required?: Record<SupplierKind, [string, string][]>; suppliers?: Supplier[]; parts?: Part[]; risks?: Risk[]; finance?: Finance;
  items?: { id: string; text: string }[];
};
export type Tower = {
  project: Project; requirements: number; hazards: number;
  software: { total: number; running: number; approved: number; blocked: number; draft: number; prs: string[];
    latest: { id: string; title: string; status: string; verdict: string | null }[] };
  safety: { sim: { wo: string | null; question?: string; verdict: string; runs: number; new: number; kind: string } | null;
    gaps: { id: string; gaps: string[] }[]; untraced: number };
  supply?: { suppliers: number; tiers: Record<string, number>; parts: number; counts: Record<RiskKind, number>; top: Risk[] };
  finance?: { factory_usd: number; budget_usd: number; suppliers_usd: number; suppliers_budget: number; cost_per_wo: number | null;
    cost_per_req: number | null; saved: { hours: number; usd: number }; bom_unit: number };
};

const cache = new Map<string, unknown>();

/** JSON from the factory, kept per path so a revisit paints at once, refreshed every `every` ms while shown.
 *  Read-only snapshot (no server): the exported `file` from factory/snapshot.py, if any. */
export function useLive<T>(getJSON: <U>(p: string) => Promise<U | null>, live: boolean, path: string, file: string, every = 4000) {
  const [data, setData] = useState<T | null>(() => (cache.get(path) as T) ?? null);
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    const d = await getJSON<T>(path);
    if (d) { cache.set(path, d); setData(d); }
  }, [getJSON, path]);
  useEffect(() => {
    setData((cache.get(path) as T) ?? null);
    if (!live) {  // the server probe takes a moment: only fall back to the snapshot once it has clearly failed
      const t = setTimeout(async () => {
        const r = await fetch(`/${file}`).catch(() => null);
        if (r && r.ok) setData(await r.json()); else setMissing(true);
      }, 1600);
      return () => clearTimeout(t);
    }
    load();
    const t = setInterval(load, every);
    return () => clearInterval(t);
  }, [live, path, file, every, load]);
  return { data, missing, reload: load };
}

export const money = (n: number | null | undefined, cents = false) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents || (Math.abs(n) < 1000 && !Number.isInteger(n)) ? 2 : 0 });

export const KIND_LABEL: Record<SupplierKind, string> = { hardware: "Hardware part", software: "Software component", raw_material: "Raw material" };
export const RISK_LABEL: Record<RiskKind, string> = {
  expired_cert: "Expired certificate", expiring_cert: "Expiring certificate", missing_deliverable: "Missing deliverable",
  single_source: "Single source", long_lead: "Long lead time", import_delay: "Import delay",
};
export const FLAG_LABEL: Record<PartFlag, string> = {
  single_source: "Single source", long_lead: "Long lead", import_delay: "Import delay", supplier_cert: "Supplier cert expiring",
};
