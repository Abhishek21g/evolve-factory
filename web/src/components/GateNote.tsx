"use client";
import { useState } from "react";
import { Code2 } from "lucide-react";
import type { State } from "@/lib/api";
import type { Checker } from "@/lib/feed";
import { Drawer, type Api } from "@/components/trace/Viewer";

/** Who decided a verdict: certus-gate (Rust) or its Python reference, parity on the recorded runs, the verdict digest.
 *  "Gate code" opens the deciding function in the trace viewer. */
export function GateNote({ checker, state, api }: { checker: Checker; state: State; api: Api }) {
  const [open, setOpen] = useState(false);
  const parity = state.status?.gate;
  const code = state.trace?.gate;
  const rust = checker.engine === "rust";
  return (
    <div className="text-sm text-dim">
      Verdict {checker.rechecked ? "re-checked from the recorded evidence by " : "computed by "}
      <span className="text-mute">{rust ? "certus-gate (Rust, no unsafe code)" : "the Python reference gate"}</span>
      {rust && parity?.cases ? ` · parity with Python: ${parity.same}/${parity.cases} recorded runs` : ""}
      {" · "}<span className="font-mono text-xs" title={`sha256:${checker.digest}`}>sha256:{checker.digest.slice(0, 12)}…</span>
      {code && <>{" · "}<button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-acc hover:underline"><Code2 size={12} /> Gate code</button></>}
      {open && code && <Drawer api={api} t={code} onClose={() => setOpen(false)} />}
    </div>
  );
}
