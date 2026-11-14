import type { ReactNode } from "react";
import { Info } from "lucide-react";

export type Tone = "ok" | "bad" | "warn" | "run" | "idle";
const TONE: Record<Tone, string> = {
  ok: "text-ok bg-ok/10 border-ok/25", bad: "text-bad bg-bad/10 border-bad/30", warn: "text-warn bg-warn/10 border-warn/25",
  run: "text-run bg-run/10 border-run/30", idle: "text-mute bg-white/[.04] border-line",
};
const DOT: Record<Tone, string> = { ok: "bg-ok", bad: "bg-bad", warn: "bg-warn", run: "pulse bg-run", idle: "bg-dim" };
export const toneText = (t?: Tone) => t === "bad" ? "text-bad" : t === "warn" ? "text-warn" : t === "run" ? "text-run" : t === "ok" ? "text-ok" : "";

export const Pill = ({ tone = "idle", children, title }: { tone?: Tone; children: ReactNode; title?: string }) => (
  <span title={title} className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-px text-[11px] font-medium ${TONE[tone]}`}>{children}</span>
);

export const Dot = ({ tone = "idle" }: { tone?: Tone }) => <span className={`size-1.5 shrink-0 rounded-full ${DOT[tone]}`} />;

/** Requirement / hazard IDs, each opening its traceability view. */
export const Items = ({ ids, pid }: { ids: string[]; pid: string }) => (
  <span className="inline-flex min-w-[96px] flex-wrap gap-1">
    {ids.map(id => (
      <a key={id} href={`#/p/${pid}/traceability/${id}`} title={`Open ${id} in Traceability`}
        className={`rounded px-1 font-mono text-[11px] hover:underline ${id.startsWith("H-") ? "bg-bad/10 text-bad" : "bg-white/[.05] text-ink"}`}>{id}</a>
    ))}
  </span>
);

export const SampleNote = ({ children }: { children: ReactNode }) => (
  <p className="mb-8 flex max-w-3xl items-start gap-2 text-xs text-dim">
    <Info size={13} className="mt-0.5 shrink-0" /><span>{children}</span>
  </p>
);

/** A quiet row of headline numbers: no boxes, large tabular numerals, small muted labels. */
export const StatRow = ({ children }: { children: ReactNode }) => <div className="mb-10 flex flex-wrap gap-x-12 gap-y-6">{children}</div>;

export const Stat = ({ label, value, sub, href, tone }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; tone?: Tone }) => {
  const body = (
    <>
      <div className={`text-2xl font-semibold tabular-nums tracking-tight ${tone === "bad" || tone === "warn" ? toneText(tone) : "text-ink"}`}>{value}</div>
      <div className="mt-0.5 text-xs text-mute">{label}</div>
      {sub && <div className="text-xs text-dim">{sub}</div>}
    </>
  );
  return href
    ? <a href={href} className="group block min-w-[88px] [&>div:first-child]:group-hover:underline [&>div:first-child]:decoration-line-strong [&>div:first-child]:underline-offset-4">{body}</a>
    : <div className="min-w-[88px]">{body}</div>;
};

/** Boxed variants used by the Control Tower, Supply Chain and Finance pages. */
export const SampleBox = ({ children }: { children: ReactNode }) => (
  <div className="mb-6 flex items-start gap-2 rounded-md border border-warn/25 bg-warn/5 px-3 py-2 text-xs text-mute">
    <Info size={14} className="mt-px shrink-0 text-warn" /><div>{children}</div>
  </div>
);

export const StatCard = ({ label, value, sub, href, tone }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; tone?: Tone }) => {
  const body = (
    <>
      <div className="text-xs text-dim">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${toneText(tone === "run" ? undefined : tone)}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-mute">{sub}</div>}
    </>
  );
  return href
    ? <a href={href} className="block rounded-lg border border-line bg-panel p-3 hover:border-line-strong">{body}</a>
    : <div className="rounded-lg border border-line bg-panel p-3">{body}</div>;
};

export const Bar = ({ value, max, tone = "run" }: { value: number; max: number; tone?: Tone }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[.06]">
    <div className={`h-full rounded-full ${tone === "bad" ? "bg-bad" : tone === "warn" ? "bg-warn" : tone === "ok" ? "bg-ok" : "bg-run"}`}
      style={{ width: `${Math.min(100, max ? (value / max) * 100 : 0)}%` }} />
  </div>
);

export const Note = ({ children }: { children: ReactNode }) => <p className="py-6 text-sm text-dim">{children}</p>;

/** While the first answer is on its way (~20 ms on a live server) nothing is drawn; the snapshot says what it lacks. */
export const Pending = ({ missing }: { missing: boolean }) => missing
  ? <Note>Not in the read-only snapshot. Run <code className="text-ink">factory/server.py</code> to see it live.</Note>
  : <div className="min-h-[40vh]" />;
