"use client";
import { useEffect, useState } from "react";
import { FileCode2, FileText, Hash, Search } from "lucide-react";
import { Button, Field, Modal, inputCls } from "@/components/ui";
import { slug, type SearchHits } from "@/lib/trace";
import { CodeLines, useFile, type Api } from "./Viewer";

export type Draft = { item?: string; kind?: Kind; path?: string; start?: number; end?: number };
type Kind = "code" | "doc" | "test" | "url";
const KINDS: [Kind, string][] = [["code", "Code lines"], ["doc", "Doc section"], ["test", "Test"], ["url", "External URL"]];

/** Link a requirement or hazard to repo code (file + lines), a doc section, a test or a URL. The server validates it. */
export function AddLink({ api, items, draft, onClose }: { api: Api; items: { id: string; text: string }[]; draft: Draft; onClose: () => void }) {
  const [item, setItem] = useState(draft.item || items[0]?.id || "");
  const [kind, setKind] = useState<Kind>(draft.kind || "code");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHits | null>(null);
  const [path, setPath] = useState(draft.path || "");
  const [start, setStart] = useState(draft.start ? String(draft.start) : "");
  const [end, setEnd] = useState(draft.end ? String(draft.end) : "");
  const [anchor, setAnchor] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");
  const file = useFile(api, kind === "url" ? undefined : path || undefined);

  useEffect(() => {
    const id = setTimeout(async () => setHits(await api.getJSON<SearchHits>(`trace/search?project=${api.pid}&q=${encodeURIComponent(q)}`)), 180);
    return () => clearTimeout(id);
  }, [q, api]);

  const pick = (p: string, line?: number, a?: string) => {
    setPath(p); setErr(""); setAnchor(a || "");
    if (a !== undefined) setKind("doc");
    setStart(line ? String(line) : ""); setEnd(line ? String(line) : "");
  };
  const sections = file && path.endsWith(".md") ? file.text.split("\n").filter(l => /^#{1,6}\s/.test(l)).map(l => l.replace(/^#+\s+/, "").trim()) : [];
  const s = Number(start) || undefined, e = Number(end) || s;
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const body = kind === "url" ? { url } : kind === "doc" ? { path, anchor } : { path, start: s, end: e };
    const r = await api.post("trace/links", { project: api.pid, item, kind, label, ...body });
    if (r.error) return setErr(r.error);
    onClose();
  };
  const ready = kind === "url" ? !!url.trim() : !!path;

  return (
    <Modal wide title="Add trace link" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Trace from">
            <select className={inputCls} value={item} onChange={x => setItem(x.target.value)}>
              {items.map(i => <option key={i.id} value={i.id}>{i.id} · {i.text}</option>)}
            </select>
          </Field>
          <Field label="To">
            <div className="flex overflow-hidden rounded-md border border-line text-sm">
              {KINDS.map(([k, l]) => (
                <button type="button" key={k} onClick={() => { setKind(k); setErr(""); }}
                  className={`whitespace-nowrap px-2.5 py-2 ${kind === k ? "bg-white/[.08] text-ink" : "text-mute hover:text-ink"}`}>{l}</button>
              ))}
            </div>
          </Field>
        </div>

        {kind === "url" ? (
          <Field label="URL"><input className={inputCls} value={url} onChange={x => setUrl(x.target.value)} placeholder="https://… (a Jira ticket, a standard, a design review)" autoFocus /></Field>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="min-w-0">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
                <input value={q} onChange={x => setQ(x.target.value)} autoFocus aria-label="Search the repository"
                  placeholder={kind === "doc" ? "Search docs and sections, e.g. traceability" : "Search files and code, e.g. extended_bolus"} className={inputCls + " pl-8"} />
              </div>
              <div className="scroll-thin mt-2 h-72 overflow-y-auto rounded-md border border-line text-sm">
                {hits?.sections.filter(() => kind === "doc" || kind === "code").map(h => (
                  <Hit key={`s${h.path}${h.anchor}`} on={path === h.path && anchor === h.anchor} onClick={() => pick(h.path, undefined, h.anchor)}
                    icon={<Hash size={12} />} main={h.text} sub={`${h.path}#${h.anchor}`} />
                ))}
                {kind !== "doc" && hits?.lines.map(h => (
                  <Hit key={`l${h.path}${h.line}`} on={path === h.path && s === h.line} onClick={() => pick(h.path, h.line)}
                    icon={<FileCode2 size={12} />} main={<code className="font-mono text-xs">{h.text}</code>} sub={`${h.path}:${h.line}`} />
                ))}
                {hits?.files.filter(f => kind !== "doc" || f.endsWith(".md")).map(f => (
                  <Hit key={`f${f}`} on={path === f && !s && !anchor} onClick={() => pick(f)}
                    icon={f.endsWith(".md") ? <FileText size={12} /> : <FileCode2 size={12} />} main={f} />
                ))}
                {hits === null && <p className="p-3 text-dim">{api.live ? "Searching…" : "Search needs the live factory."}</p>}
              </div>
            </div>
            <div className="min-w-0 space-y-3">
              <Field label="File"><input className={inputCls + " font-mono text-sm"} value={path} onChange={x => setPath(x.target.value)} placeholder="demo/pump/pump.c" /></Field>
              {kind === "doc" ? (
                <Field label="Section">
                  <select className={inputCls} value={anchor} onChange={x => setAnchor(x.target.value)}>
                    <option value="">Whole document</option>
                    {sections.map(h => <option key={h} value={slug(h)}>{h}</option>)}
                  </select>
                </Field>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From line"><input className={inputCls} inputMode="numeric" value={start} onChange={x => setStart(x.target.value)} placeholder="1" /></Field>
                  <Field label={file ? `To line (of ${file.lines})` : "To line"}><input className={inputCls} inputMode="numeric" value={end} onChange={x => setEnd(x.target.value)} placeholder={file ? String(file.lines) : ""} /></Field>
                </div>
              )}
              {file && kind !== "doc" && <CodeLines file={file} start={s || 1} end={e || file.lines} only context={1} />}
              {file === null && path && <p className="text-sm text-bad">Not a file in the repository.</p>}
            </div>
          </div>
        )}
        <Field label="Label (optional)"><input className={inputCls} value={label} onChange={x => setLabel(x.target.value)} placeholder="e.g. extended bolus applies the daily cap at every tick" /></Field>
        {err && <p className="text-sm text-bad">{err}</p>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button primary type="submit" disabled={!ready || !api.live}>Add link</Button></div>
      </form>
    </Modal>
  );
}

function Hit({ on, onClick, icon, main, sub }: { on: boolean; onClick: () => void; icon: React.ReactNode; main: React.ReactNode; sub?: string }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-start gap-2 border-b border-line px-3 py-1.5 text-left last:border-0 ${on ? "bg-white/[.07]" : "hover:bg-white/[.03]"}`}>
      <span className="mt-0.5 text-dim">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block truncate">{main}</span>{sub && <span className="block truncate font-mono text-2xs text-dim">{sub}</span>}</span>
    </button>
  );
}
