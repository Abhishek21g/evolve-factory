"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, FlaskConical, Hammer, Loader2 } from "lucide-react";
import { cn } from "cn";
import type { Project } from "@/lib/api";
import { deviceCopy, type Mode, type Suggestion } from "@/lib/device";
import { ToggleGroup, ToggleGroupItem } from "@/components/kit/toggle-group";
import { Kbd } from "@/components/kit/kbd";
import { DeviceIcon } from "@/components/ProjectSwitcher";

const MODES: Record<Mode, { label: string; icon: typeof Hammer; hint: string; placeholder: (p: Project) => string }> = {
  build: {
    label: "Build", icon: Hammer, hint: "Creates a work order: hazards, code, tests, world model, evidence.",
    placeholder: p => `Describe a change to ${p.name}, e.g. ${deviceCopy(p.device).build}`,
  },
  simulate: {
    label: "Simulate", icon: FlaskConical, hint: "Turns your question into scenarios and runs them on the current code.",
    placeholder: p => `Ask a what-if, e.g. ${deviceCopy(p.device).whatIf}`,
  },
};
const WHAT_IF = /^\s*what (if|happens)\b/i;

/** The factory's one input: build a change or ask the world model, for the selected project. */
export function Composer({ project, onSubmit, disabledReason, modes = ["build", "simulate"], autoFocus, suggestions = true, chips }: {
  project: Project;
  onSubmit: (text: string, mode: Mode) => Promise<string | null | undefined>;
  disabledReason?: string | null;
  modes?: Mode[];
  autoFocus?: boolean;
  suggestions?: boolean;
  /** One-click requests instead of the device's (the hosted site offers its recorded prompts). */
  chips?: readonly Suggestion[];
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>(modes[0]);
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const M = MODES[mode];

  useLayoutEffect(() => { // grow with the text, up to ~8 lines
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  useEffect(() => { // "/" focuses the composer from anywhere on the page
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, []);

  const change = (v: string) => {
    setText(v);
    if (modes.includes("simulate") && WHAT_IF.test(v) && !WHAT_IF.test(text)) setMode("simulate");
  };
  const submit = async () => {
    if (!text.trim() || disabledReason || sending) return;
    setSending(true);
    const e = await onSubmit(text.trim(), mode);
    setSending(false);
    setErr(e || "");
    if (!e) setText("");
  };
  const pick = (m: Mode, t: string) => { setMode(m); setText(t); setErr(""); ref.current?.focus(); };
  const canSend = !!text.trim() && !disabledReason && !sending;

  return (
    <div>
      <form onSubmit={e => { e.preventDefault(); submit(); }}
        className="rounded-2xl border border-line bg-panel shadow-[0_8px_30px_rgb(0_0_0/0.35)] transition-[border-color,box-shadow] focus-within:border-acc/50 focus-within:shadow-[0_0_0_4px_rgb(165_180_252/0.12),0_8px_30px_rgb(0_0_0/0.35)]">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
          {modes.length > 1 ? (
            <ToggleGroup type="single" value={mode} onValueChange={v => v && setMode(v as Mode)} aria-label="What the factory should do"
              className="rounded-lg border border-line bg-bg p-0.5">
              {modes.map(m => {
                const I = MODES[m].icon;
                return (
                  <ToggleGroupItem key={m} value={m} aria-label={MODES[m].label}
                    className="h-7 gap-1.5 rounded-md! px-3 text-sm font-medium text-mute hover:text-ink data-[state=on]:bg-white/[.09] data-[state=on]:text-ink">
                    <I size={14} /> {MODES[m].label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          ) : <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink"><M.icon size={14} className="text-acc" /> {M.label}</span>}
          <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-mute" title={project.standard}>
            <DeviceIcon device={project.device} size={13} /> {project.name}
          </span>
        </div>
        <label htmlFor="composer" className="sr-only">{mode === "build" ? "What should the factory build?" : "Ask the world model"}</label>
        <textarea id="composer" ref={ref} value={text} onChange={e => change(e.target.value)} rows={3} autoFocus={autoFocus}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          placeholder={M.placeholder(project)}
          className="block min-h-[84px] w-full resize-none bg-transparent px-4 pb-2 pt-3 text-md leading-relaxed text-ink outline-none placeholder:text-dim focus-visible:outline-none" />
        <div className="flex items-center gap-3 border-t border-line/70 px-3 py-2.5">
          <p className={cn("min-w-0 flex-1 truncate text-xs", disabledReason ? "text-warn" : "text-dim")}>{disabledReason || M.hint}</p>
          <span className="hidden items-center gap-1 text-xs text-dim sm:inline-flex"><Kbd>↵</Kbd> send <Kbd>⇧↵</Kbd> new line</span>
          <button type="submit" disabled={!canSend} aria-label={M.label}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-semibold text-bg transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />} {M.label}
          </button>
        </div>
      </form>
      {err && <p role="alert" className="mt-2 text-sm text-bad">{err}</p>}
      {suggestions && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {(chips || deviceCopy(project.device).suggest).filter(([m]) => modes.includes(m)).map(([m, t]) => {
            const I = MODES[m].icon;
            return (
              <button key={t} type="button" onClick={() => pick(m, t)}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel/60 px-3 py-1.5 text-sm text-mute transition-colors hover:border-line-strong hover:bg-panel hover:text-ink">
                <I size={13} className="text-dim" /> {t}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
