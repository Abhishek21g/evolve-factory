import type { ReactNode } from "react";
import type { Member } from "@/lib/api";

const STATUS: Record<string, string> = {
  Draft: "text-mute bg-white/[.04] border-line",
  Running: "text-run bg-run/10 border-run/30",
  Approved: "text-ok bg-ok/10 border-ok/25",
  Blocked: "text-bad bg-bad/10 border-bad/30",
  Stopped: "text-warn bg-warn/10 border-warn/25",
  "Not run": "text-warn bg-warn/10 border-warn/25",
  PASS: "text-ok bg-ok/10 border-ok/25",
  FAIL: "text-bad bg-bad/10 border-bad/30",
  BLOCKED: "text-bad bg-bad/10 border-bad/30",
  APPROVED: "text-ok bg-ok/10 border-ok/25",
};

export const Badge = ({ children, tone }: { children: ReactNode; tone?: string }) => (
  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px text-[11px] font-medium ${STATUS[tone || String(children)] || STATUS.Draft}`}>
    {tone === "Running" || children === "Running" ? <span className="pulse h-1.5 w-1.5 rounded-full bg-run" /> : null}
    {children}
  </span>
);

export function Avatar({ m, size = 22 }: { m?: Member; size?: number }) {
  const initials = (m?.name || "?").split(" ").map(w => w[0]).slice(0, 2).join("");
  return (
    <span title={m ? `${m.name} · ${m.role}` : undefined} style={{ width: size, height: size, fontSize: size * 0.42 }}
      className={`inline-grid shrink-0 place-items-center rounded-full font-semibold ${m?.kind === "agent" ? "bg-white/[.06] text-acc ring-1 ring-acc/20" : "bg-ink/90 text-bg"}`}>
      {m?.kind === "agent" ? "◇" : initials}
    </span>
  );
}

export const Who = ({ m }: { m?: Member }) => (
  <span className="inline-flex items-center gap-2 whitespace-nowrap">
    <Avatar m={m} /> <span>{m?.name || "unknown"}</span>
    {m && <span className="text-[10px] uppercase tracking-wider text-dim">{m.kind}</span>}
  </span>
);

export const PageHead = ({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
    <div className="min-w-0">
      <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
      {sub && <p className="mt-1 text-[13px] text-mute">{sub}</p>}
    </div>
    <div className="flex items-center gap-2">{children}</div>
  </div>
);

export const Section = ({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) => (
  <section className="mb-8">
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
      {aside && <div className="text-[12px] text-dim">{aside}</div>}
    </div>
    {children}
  </section>
);

export function Table({ head, rows, empty }: { head: ReactNode[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-white/[.02] text-[12px] text-mute">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top hover:bg-white/[.015]">
              {r.map((c, j) => <td key={j} className="px-3 py-2.5">{c}</td>)}
            </tr>
          )) : <tr><td colSpan={head.length} className="px-3 py-6 text-center text-dim">{empty || "Nothing yet."}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export const Button = ({ children, onClick, primary, disabled, type = "button" }:
  { children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; type?: "button" | "submit" }) => (
  <button type={type} onClick={onClick} disabled={disabled}
    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${primary ? "bg-ink text-bg hover:bg-white" : "border border-line bg-panel2 text-ink hover:border-white/20"}`}>
    {children}
  </button>
);

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block text-[12px] text-mute">
    <span className="mb-1.5 block">{label}</span>
    {children}
  </label>
);

export const inputCls = "w-full rounded-md border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none placeholder:text-dim focus:border-white/25";

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className={`scroll-thin max-h-[88vh] w-full overflow-y-auto rounded-xl border border-line bg-panel p-5 ${wide ? "max-w-4xl" : "max-w-lg"}`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-mute hover:text-ink">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Honest note on a run served from a recorded real run instead of fresh agents. */
export const Replayed = ({ r }: { r?: { wo?: string | null; at: number } }) => r ? (
  <span className="text-[11px] text-dim">
    replayed from real run{r.wo ? ` ${r.wo}` : ""} · {new Date(r.at * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
  </span>
) : null;

export const ago = (ts: number) => {
  const s = Math.max(0, Date.now() / 1000 - ts);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
