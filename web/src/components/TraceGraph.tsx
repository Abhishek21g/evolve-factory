"use client";
import { useMemo, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Target, TraceNode } from "@/lib/trace";

const COLS: Record<string, { col: number; label: string }> = {
  clause: { col: 0, label: "Regulation" }, hazard: { col: 1, label: "Hazard" }, requirement: { col: 2, label: "Safety requirement" },
  code: { col: 3, label: "Code" }, test: { col: 4, label: "Test" }, doc: { col: 4, label: "Doc" }, url: { col: 4, label: "Link" },
  scenario: { col: 5, label: "Sim scenario" }, work_order: { col: 6, label: "Work order" },
  simulation: { col: 7, label: "World model" }, evidence: { col: 7, label: "Evidence" },
};
const TONE: Record<string, string> = { ok: "#34d399", fail: "#f87171", warn: "#fbbf24" };
type D = { n: TraceNode; on: boolean; dim: boolean };

function TNode({ data }: NodeProps<Node<D>>) {
  const { n, on, dim } = data;
  return (
    <div style={{ opacity: dim ? 0.28 : 1, borderColor: on ? "#e7e9ec" : n.target?.link ? "rgba(165,243,252,.35)" : "#262a31" }}
      className="w-[196px] cursor-pointer rounded-md border bg-[#111317] px-2.5 py-2 text-left transition-opacity">
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-[#3a3f47]" />
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[.12em] text-[#5b616a]">
        {n.tone && <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE[n.tone] }} />}
        {COLS[n.kind]?.label}{n.target?.link ? " · added" : ""}
      </div>
      <div className="mt-0.5 truncate text-[12px] font-semibold text-[#e7e9ec]">{n.label}</div>
      {n.sub && <div className="line-clamp-2 text-[10.5px] leading-snug text-[#8a9099]">{n.sub}</div>}
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-[#3a3f47]" />
    </div>
  );
}
const TYPES = { t: TNode };

/** Regulation -> hazard -> requirement -> code / test -> scenario -> work order -> verification.
 *  Click a node to light up its chain and open it (code lines, doc section, test); requirements and hazards open their page. */
export function TraceGraph({ nodes, edges, pid, onOpen }: { nodes: TraceNode[]; edges: { source: string; target: string }[]; pid: string; onOpen: (t: Target) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const chain = useMemo(() => {
    if (!sel) return null;
    const keep = new Set([sel]);
    for (const dir of ["down", "up"] as const) {
      const q = [sel];
      while (q.length) {
        const cur = q.pop()!;
        for (const e of edges) {
          const [a, b] = dir === "down" ? [e.source, e.target] : [e.target, e.source];
          if (a === cur && !keep.has(b)) { keep.add(b); q.push(b); }
        }
      }
    }
    return keep;
  }, [sel, edges]);

  const rf = useMemo(() => {
    const rows: Record<number, number> = {};
    const ns: Node<D>[] = nodes.map(n => {
      const c = COLS[n.kind]?.col ?? 0;
      const r = (rows[c] = (rows[c] ?? -1) + 1);
      return { id: n.id, type: "t", position: { x: c * 250, y: r * 84 }, data: { n, on: sel === n.id, dim: !!chain && !chain.has(n.id) } };
    });
    const es: Edge[] = edges.map(e => {
      const active = !!chain && chain.has(e.source) && chain.has(e.target);
      return { id: `${e.source}>${e.target}`, source: e.source, target: e.target, animated: active,
        style: { stroke: active ? "#a5f3fc" : "#2a2f36", strokeWidth: active ? 1.6 : 1, opacity: chain && !active ? 0.25 : 1 } };
    });
    return { ns, es };
  }, [nodes, edges, sel, chain]);
  const selNode = nodes.find(n => n.id === sel);

  return (
    <div className="relative h-[680px] overflow-hidden rounded-lg border border-line bg-[#0b0c0e]">
      {selNode && (selNode.kind === "requirement" || selNode.kind === "hazard") && (
        <a href={`#/p/${pid}/traceability/${selNode.id}`} className="absolute left-3 top-3 z-10 rounded-md border border-line bg-panel2 px-3 py-1.5 text-[12px] hover:border-white/25">
          Open {selNode.id} details →
        </a>
      )}
      <ReactFlow nodes={rf.ns} edges={rf.es} nodeTypes={TYPES} fitView minZoom={0.2} proOptions={{ hideAttribution: true }}
        nodesConnectable={false} colorMode="dark" onPaneClick={() => setSel(null)}
        onNodeClick={(_, n) => {
          const tn = nodes.find(x => x.id === n.id);
          setSel(s => (s === n.id ? null : n.id));
          if (tn?.kind === "work_order") location.hash = `/p/${pid}/work-orders/${tn.id}`;
          else if (tn?.target?.kind === "url") window.open(tn.target.url, "_blank", "noopener");
          else if (tn?.target) onOpen(tn.target);
        }}>
        <Background gap={18} color="rgba(255,255,255,0.05)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
