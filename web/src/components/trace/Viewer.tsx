"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, Play, X } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { githubUrl, loadFile, slug, where, type Github, type RepoFile, type Target } from "@/lib/trace";

export type Api = {
  getJSON: <T>(p: string) => Promise<T | null>;
  text: (p: string) => Promise<string>;
  post: (p: string, b: object) => Promise<{ error?: string }>;
  live: boolean; pid: string; gh?: Github;
};

/* ---------- syntax highlighting: small, for C, Python, TS and shell ---------- */
const KW = new Set(("int double float char void static const struct return if else for while do switch case break continue typedef enum " +
  "sizeof unsigned long short bool def import from class in not and or is None True False with as try except raise lambda yield pass " +
  "export function let var type interface async await new elif global").split(" "));
const TOKEN = /(\/\*.*?(?:\*\/|$)|\/\/.*$)|(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?(?:e-?\d+)?\b)|(\b[A-Za-z_]\w*\b)/g;

function highlightLine(line: string, lang: string, inBlock: boolean): [ReactNode[], boolean] {
  const out: ReactNode[] = [];
  let rest = line;
  if (inBlock) {
    const end = line.indexOf("*/");
    if (end < 0) return [[<span key="c" className="text-[#6b7280]">{line}</span>], true];
    out.push(<span key="c0" className="text-[#6b7280]">{line.slice(0, end + 2)}</span>);
    rest = line.slice(end + 2);
  }
  let last = 0, block = false;
  for (const m of rest.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(rest.slice(last, i));
    const [tok, comment, hash, str, num, word] = m;
    const key = `${i}-${out.length}`;
    if (comment) {
      out.push(<span key={key} className="text-[#6b7280]">{tok}</span>);
      block = tok.startsWith("/*") && !tok.endsWith("*/");
    } else if (hash) {
      if (lang === "c") {
        const d = tok.match(/^#\s*\w+/)?.[0] || "#";
        out.push(<span key={key} className="text-[#c084fc]">{d}</span>);
        out.push(...highlightLine(tok.slice(d.length), lang, false)[0]);
      } else out.push(<span key={key} className="text-[#6b7280]">{tok}</span>);
    } else if (str) out.push(<span key={key} className="text-[#86efac]">{tok}</span>);
    else if (num) out.push(<span key={key} className="text-[#fbbf24]">{tok}</span>);
    else if (word && KW.has(word)) out.push(<span key={key} className="text-[#f472b6]">{tok}</span>);
    else if (word && /^[A-Z][A-Z0-9_]{2,}$/.test(word)) out.push(<span key={key} className="text-[#a5f3fc]">{tok}</span>);
    else if (word && rest[i + tok.length] === "(") out.push(<span key={key} className="text-[#93c5fd]">{tok}</span>);
    else out.push(tok);
    last = i + tok.length;
  }
  if (last < rest.length) out.push(rest.slice(last));
  return [out, block];
}

const langOf = (p: string) => /\.(c|h)$/.test(p) ? "c" : /\.py$/.test(p) ? "py" : /\.(ts|tsx|js)$/.test(p) ? "ts" : "text";

/** Source with line numbers; lines start..end are highlighted and scrolled into view. `only` shows just that range (+ context). */
export function CodeLines({ file, start, end, only, context = 2 }: { file: RepoFile; start?: number; end?: number; only?: boolean; context?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const lines = file.text.replace(/\n$/, "").split("\n");
  const lang = langOf(file.path);
  const from = only && start ? Math.max(1, start - context) : 1;
  const to = only && end ? Math.min(lines.length, end + context) : lines.length;
  useEffect(() => {
    if (!only) ref.current?.querySelector("[data-hit]")?.scrollIntoView({ block: "center" });
  }, [file, start, only]);
  let block = false;
  const rows: ReactNode[] = [];
  lines.forEach((l, idx) => {
    const n = idx + 1;
    const [nodes, b] = highlightLine(l, lang, block);
    block = b;
    if (n < from || n > to) return;
    const hit = !!start && n >= start && n <= (end || start);
    rows.push(
      <div key={n} data-hit={hit && n === start ? "" : undefined} className={`flex ${hit ? "bg-acc/[.09]" : ""}`}>
        <span className={`w-10 shrink-0 select-none border-r pr-2 text-right ${hit ? "border-acc/60 text-acc" : "border-transparent text-[#3f454d]"}`}>{n}</span>
        <span className="whitespace-pre pl-3">{nodes.length ? nodes : " "}</span>
      </div>);
  });
  return (
    <div ref={ref} className={`scroll-thin overflow-auto rounded-md border border-line bg-bg py-2 font-mono text-[11.5px] leading-[1.6] text-[#d1d5db] ${only ? "max-h-72" : ""}`}>
      {rows}
    </div>
  );
}

/* ---------- markdown: headings carry GitHub anchors so #section links land ---------- */
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|_[^_]+_)/g).map((p, i) => {
    if (p.startsWith("**")) return <b key={i}>{p.slice(2, -2)}</b>;
    if (p.startsWith("`")) return <code key={i} className="rounded bg-white/[.05] px-1 font-mono text-[11.5px] text-acc">{p.slice(1, -1)}</code>;
    const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return /^https?:/.test(link[2]) ? <a key={i} href={link[2]} target="_blank" rel="noopener" className="text-acc hover:underline">{link[1]}</a> : <span key={i} className="text-acc">{link[1]}</span>;
    if (/^_[^_]+_$/.test(p)) return <i key={i}>{p.slice(1, -1)}</i>;
    return p;
  });
}

export function MarkdownDoc({ src, anchor }: { src: string; anchor?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = anchor ? ref.current?.querySelector(`[id="${CSS.escape(anchor)}"]`) : null;
    el?.scrollIntoView({ block: "start" });
  }, [src, anchor]);
  const out: ReactNode[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("```")) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) body.push(lines[i]);
      out.push(<pre key={i} className="scroll-thin my-3 overflow-x-auto rounded-md bg-bg p-3 font-mono text-[11.5px] text-mute">{body.join("\n")}</pre>);
      continue;
    }
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].startsWith("|"); i++) {
        if (!/^\|[-:|\s]+\|$/.test(lines[i])) rows.push(lines[i].replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
      }
      i--;
      out.push(<div key={i} className="my-3 overflow-x-auto"><table className="w-full text-[12.5px]"><tbody>
        {rows.map((r, j) => <tr key={j} className={j ? "border-t border-line" : "text-dim"}>{r.map((c, k) => <td key={k} className="py-1.5 pr-3 align-top">{inline(c)}</td>)}</tr>)}
      </tbody></table></div>);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      const id = slug(h[2]);
      const hit = id === anchor;
      const cls = h[1].length === 1 ? "mb-3 text-[18px]" : h[1].length === 2 ? "mb-2 mt-6 text-[15px]" : "mb-1.5 mt-5 text-[13.5px]";
      out.push(<div key={i} id={id} className={`scroll-mt-4 font-semibold ${cls} ${hit ? "-mx-2 rounded bg-acc/[.09] px-2 py-1 text-acc" : ""}`}>{h[2]}</div>);
    } else if (/^\s*[-*] /.test(l)) out.push(<li key={i} className="ml-5 list-disc text-[13px] leading-relaxed">{inline(l.replace(/^\s*[-*] /, ""))}</li>);
    else if (/^\d+\. /.test(l)) out.push(<li key={i} className="ml-5 list-decimal text-[13px] leading-relaxed">{inline(l.replace(/^\d+\. /, ""))}</li>);
    else if (l.trim()) out.push(<p key={i} className="my-1.5 text-[13px] leading-relaxed text-[#cfd3d8]">{inline(l)}</p>);
  }
  return <div ref={ref}>{out}</div>;
}

/* ---------- the drawer that opens a trace target ---------- */
export function useFile(api: Api, path?: string) {
  const [f, setF] = useState<RepoFile | null | undefined>(undefined);
  useEffect(() => {
    let on = true;
    setF(undefined);
    if (path) loadFile(api.getJSON, path).then(x => { if (on) setF(x); });
    return () => { on = false; };
  }, [path, api.getJSON]);
  return f;
}

export const GithubLink = ({ href }: { href: string }) => href ? (
  <a href={href} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-3 py-1.5 text-[13px] font-medium hover:border-white/20">
    <ExternalLink size={13} /> Open on GitHub
  </a>
) : null;

const Notice = ({ children }: { children: ReactNode }) => <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-dim">{children}</p>;

function FileBody({ api, t, file }: { api: Api; t: Target; file: RepoFile | null | undefined }) {
  if (file === undefined) return <Notice>Opening {t.path}…</Notice>;
  if (file === null) return <Notice>{api.live ? `${t.path} is not a file in the repository.` : "The in-app viewer needs the live factory. Use Open on GitHub."}</Notice>;
  return t.path?.endsWith(".md") && t.kind !== "code" && t.kind !== "test" ? <MarkdownDoc src={file.text} anchor={t.anchor} /> : <CodeLines file={file} start={t.start} end={t.end} />;
}

export function TestResult({ api, t }: { api: Api; t: Target }) {
  const [run, setRun] = useState<{ result: string; at: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const id = t.label.replace(/^test /, "");
  const again = async () => {
    setBusy(true);
    const r = await api.post("trace/tests", { project: api.pid }) as { results?: Record<string, string>; error?: string };
    setBusy(false);
    setRun({ result: r.results?.[id] || r.error || "not run", at: Date.now() });
  };
  const result = run?.result || t.result;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-mute">
      Latest result {result ? <Badge>{result}</Badge> : <span className="text-dim">not run yet</span>}
      {run && <span className="text-dim">ran just now</span>}
      {t.cmd && <code className="font-mono text-[11px] text-dim">{t.cmd}</code>}
      <span className="ml-auto"><Button onClick={again} disabled={!api.live || busy}><Play size={13} /> {busy ? "Running…" : "Run tests"}</Button></span>
    </div>
  );
}

export function Drawer({ api, t, onClose }: { api: Api; t: Target; onClose: () => void }) {
  const file = useFile(api, t.kind === "url" || t.kind === "work_order" || t.kind === "evidence" || t.kind === "simulation" ? undefined : t.path);
  const [evidence, setEvidence] = useState("");
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);
  useEffect(() => {
    if (t.kind === "evidence" && t.wo) api.text(`evidence?wo=${t.wo}`).then(setEvidence);
  }, [t, api]);

  let title: ReactNode, body: ReactNode, gh = githubUrl(api.gh, t);
  switch (t.kind) {
    case "code":
    case "scenario":
      title = <>{t.label} <span className="font-mono text-[12px] font-normal text-dim">{where(t)}</span></>;
      body = <FileBody api={api} t={t} file={file} />;
      break;
    case "test":
      title = <>{t.label} <span className="font-mono text-[12px] font-normal text-dim">{where(t)}</span></>;
      body = <><TestResult api={api} t={t} /><FileBody api={api} t={t} file={file} /></>;
      break;
    case "doc":
    case "clause":
      title = <>{t.label} <span className="font-mono text-[12px] font-normal text-dim">{where(t)}</span></>;
      body = <FileBody api={api} t={t} file={file} />;
      break;
    case "evidence":
      title = t.label;
      body = evidence ? <MarkdownDoc src={evidence} /> : <Notice>Opening the evidence pack…</Notice>;
      gh = "";
      break;
    case "url":
    case "work_order":
    case "simulation":
      title = t.label;
      body = <Notice>{t.url ? <a href={t.url} target="_blank" rel="noopener" className="text-acc hover:underline">{t.url}</a> : `Open ${t.wo} from Work Orders.`}</Notice>;
      gh = "";
      break;
    default: {
      const never: never = t.kind;
      throw new Error(`unknown trace target ${never}`);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label={t.label} onClick={e => e.stopPropagation()}
        className="flex h-full w-full max-w-[860px] flex-col border-l border-line bg-panel shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[.12em] text-dim">{t.kind.replace("_", " ")}{t.link ? ` · added by ${t.by} (${t.link})` : t.auto ? " · from safety.json" : ""}</div>
            <h2 className="truncate text-[15px] font-semibold">{title}</h2>
            {t.note && <div className="truncate text-[12px] text-mute">{t.note}</div>}
          </div>
          {t.wo && <a href={`#/p/${api.pid}/work-orders/${t.wo}`} onClick={onClose} className="text-[13px] text-acc hover:underline">Open {t.wo}</a>}
          <GithubLink href={gh} />
          <button onClick={onClose} aria-label="Close" className="text-mute hover:text-ink"><X size={16} /></button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">{body}</div>
      </aside>
    </div>
  );
}
