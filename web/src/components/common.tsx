"use client";
import type { Member, State } from "@/lib/api";
import { Who, Table, ago } from "@/components/ui";

/* Small renderers shared by several pages. */
export const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-base text-dim">{children}</p>;

export function Diff({ src }: { src: string }) {
  return (
    <pre className="scroll-thin overflow-x-auto rounded-md bg-bg p-3 font-mono text-xs leading-relaxed">
      {src.split("\n").map((l, i) => (
        <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "text-ok" : l.startsWith("-") && !l.startsWith("---") ? "text-bad" : l.startsWith("@@") ? "text-acc" : "text-mute"}>{l || " "}</div>
      ))}
    </pre>
  );
}

export function Markdown({ src }: { src: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
    p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith("`") ? <code key={i} className="font-mono text-xs text-acc">{p.slice(1, -1)}</code> : p);
  const out: React.ReactNode[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[-|\s]+\|$/.test(lines[i])) rows.push(lines[i].slice(1, -1).split("|").map(c => c.trim()));
        i++;
      }
      i--;
      out.push(<div key={i} className="my-3 overflow-x-auto"><table className="w-full text-sm"><tbody>
        {rows.map((r, j) => <tr key={j} className={j ? "border-t border-line" : "text-dim"}>{r.map((c, k) => <td key={k} className="py-1.5 pr-3 align-top">{inline(c)}</td>)}</tr>)}
      </tbody></table></div>);
    } else if (l.startsWith("# ")) out.push(<h1 key={i} className="mb-3 text-lg font-semibold">{l.slice(2)}</h1>);
    else if (l.startsWith("## ")) out.push(<h2 key={i} className="mb-1 mt-5 text-base font-semibold text-mute">{l.slice(3)}</h2>);
    else if (l.startsWith("- ")) out.push(<li key={i} className="ml-4 list-disc text-base">{inline(l.slice(2))}</li>);
    else if (l.trim()) out.push(<p key={i} className="my-1 text-base">{inline(l.replace(/^_|_$/g, ""))}</p>);
  }
  return <div>{out}</div>;
}

export function AuditTable({ rows, team, pid }: { rows: State["audit"]; team: Record<string, Member>; pid: string }) {
  return (
    <Table head={["When", "Who", "Action", "Object", "Detail"]} empty="No activity yet."
      rows={rows.map(a => [
        <span key="t" className="whitespace-nowrap text-mute" title={new Date(a.ts * 1000).toLocaleString()}>{ago(a.ts)}</span>,
        team[a.actor]?.kind === "agent" ? <a key="w" href={`#/p/${pid}/agents/${a.actor}`} className="hover:underline"><Who m={team[a.actor]} /></a>
          : <Who key="w" m={team[a.actor] || { id: a.actor, name: a.actor, role: "", kind: "human" }} />,
        <span key="a" className="whitespace-nowrap">{a.action === "done" || a.action === "pass" ? "completed" : a.action}</span>,
        <span key="o" className="whitespace-nowrap font-mono text-sm">{a.object}</span>,
        <span key="d" className="line-clamp-2 text-sm text-mute">{a.detail}</span>])} />
  );
}
