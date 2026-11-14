"use client";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "cn";
import type { Member } from "@/lib/api";
import type { Replay } from "@/lib/feed";
import { Button as KitButton } from "@/components/kit/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/kit/dialog";

/** Status and verdict colors, shared by every badge and chip. */
export const TONE_CLS = {
  ok: "text-ok bg-ok/10 border-ok/25",
  bad: "text-bad bg-bad/10 border-bad/30",
  warn: "text-warn bg-warn/10 border-warn/25",
  run: "text-run bg-run/10 border-run/30",
  idle: "text-mute bg-white/[.04] border-line",
} as const;
export type Tone = keyof typeof TONE_CLS;

const STATUS: Record<string, Tone> = {
  Draft: "idle", Running: "run", Approved: "ok", Blocked: "bad", Stopped: "warn", "Not run": "warn",
  PASS: "ok", FAIL: "bad", BLOCKED: "bad", APPROVED: "ok",
};

export const Badge = ({ children, tone }: { children: ReactNode; tone?: string }) => {
  const t = STATUS[tone || String(children)] || "idle";
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-xs font-medium", TONE_CLS[t])}>
      {t === "run" ? <span className="pulse size-1.5 rounded-full bg-run" /> : <span className={cn("size-1.5 rounded-full", t === "idle" ? "bg-dim" : "bg-current")} />}
      {children}
    </span>
  );
};

export function Avatar({ m, size = 22 }: { m?: Member; size?: number }) {
  const initials = (m?.name || "?").split(" ").map(w => w[0]).slice(0, 2).join("");
  return (
    <span title={m ? `${m.name} · ${m.role}` : undefined} style={{ width: size, height: size, fontSize: size * 0.42 }}
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold",
        m?.kind === "agent" ? "bg-acc/10 text-acc ring-1 ring-acc/25" : "bg-gradient-to-br from-zinc-200 to-zinc-400 text-zinc-900")}>
      {m?.kind === "agent" ? "AI" : initials}
    </span>
  );
}

export const Who = ({ m }: { m?: Member }) => (
  <span className="inline-flex items-center gap-2 whitespace-nowrap">
    <Avatar m={m} /> <span>{m?.name || "unknown"}</span>
    {m?.kind === "agent" && <span className="rounded border border-line px-1 text-2xs font-medium uppercase tracking-wide text-dim">agent</span>}
  </span>
);

export const PageHead = ({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) => (
  <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      {sub && <div className="mt-1.5 text-base text-mute">{sub}</div>}
    </div>
    {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
  </div>
);

/** A what-if's typed text, muted next to its display title when the two differ (e.g. a typo the agent read through). */
export const Asked = ({ title, asked }: { title?: string; asked?: string }) =>
  asked && asked !== title ? <span className="ml-1.5 text-sm font-normal text-dim">asked as “{asked}”</span> : null;

export const Section = ({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) => (
  <section className="mb-10">
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-md font-semibold text-ink">{title}</h2>
      {aside && <div className="text-sm text-mute">{aside}</div>}
    </div>
    {children}
  </section>
);

export function Table({ head, rows, empty }: { head: ReactNode[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <div className="scroll-thin overflow-x-auto rounded-lg border border-line bg-panel">
      <table className="w-full text-left text-base">
        <thead className="border-b border-line text-sm text-mute">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-4 py-2.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.length ? rows.map((r, i) => (
            <tr key={i} className="align-top transition-colors hover:bg-white/[.02]">
              {r.map((c, j) => <td key={j} className="px-4 py-3">{c}</td>)}
            </tr>
          )) : <tr><td colSpan={head.length} className="px-4 py-10 text-center text-mute">{empty || "Nothing yet."}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Tooltip on actions that need the factory server (agents, git, the simulator): disabled on the hosted site. */
export const LOCAL_ONLY = "Runs on the local factory server";

export const Button = ({ children, onClick, primary, disabled, type = "button", title }:
  { children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; type?: "button" | "submit"; title?: string }) => {
  const b = (
    <KitButton type={type} onClick={onClick} disabled={disabled} title={title} variant={primary ? "default" : "outline"} size="lg"
      className="px-3 font-medium">
      {children}
    </KitButton>
  );
  return disabled && title ? <span title={title} className="inline-flex">{b}</span> : b;  // a disabled button shows no tooltip of its own
};

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block text-sm font-medium text-mute">
    <span className="mb-1.5 block">{label}</span>
    {children}
  </label>
);

export const inputCls = "w-full rounded-md border border-input bg-bg px-3 py-2 text-base text-ink outline-none transition-colors placeholder:text-dim hover:border-line-strong focus:border-ring focus:ring-3 focus:ring-ring/20";

/** Radix dialog: focus trap, Escape and outside click close it, labelled for screen readers. */
export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className={cn("scroll-thin max-h-[88vh] overflow-y-auto border border-line bg-panel p-6 text-base", wide ? "sm:max-w-4xl" : "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Honest note on a run served from a recorded real run instead of fresh agents. */
export const Replayed = ({ r }: { r?: Replay | null }) => r ? (
  <span className="text-xs text-dim">
    {r.hosted ? <span className="rounded border border-line px-1.5 py-0.5 text-mute">Recorded run (replay)</span> : "replayed from real run"}
    {r.wo ? ` ${r.hosted ? "of " : ""}${r.wo}` : ""} · {new Date(r.at * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
    {r.note && ` · ${r.note}`}
  </span>
) : null;

export const ago = (ts: number) => {
  const s = Math.max(0, Date.now() / 1000 - ts);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};

/** `ago` for pages in the prerendered HTML: empty on first paint so hydration matches, then the real age. */
export function Ago({ ts }: { ts: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <>{mounted ? ago(ts) : ""}</>;
}
