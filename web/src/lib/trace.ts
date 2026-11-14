/** Trace data from factory/tracelinks.py: every target is something you can open (code lines, doc section, test, page). */
export type TargetKind = "clause" | "code" | "doc" | "test" | "url" | "scenario" | "work_order" | "evidence" | "simulation";
export type Target = {
  kind: TargetKind; label: string; path?: string; start?: number; end?: number; anchor?: string; url?: string; note?: string;
  wo?: string; link?: string; by?: string; ts?: number; auto?: boolean; cmd?: string; result?: string; tone?: string;
};
export type TraceRow = { id: string; text: string; hazards: string[]; dal: string; targets: Target[]; gaps: string[] };
export type HazardRow = {
  id: string; title: string; severity: string; dal: string; fha: string; requirements: string[]; targets: Target[]; gaps: string[];
};
export type TraceNode = { id: string; kind: string; label: string; sub: string; tone: string; target?: Target | null };
export type Github = { repo: string; sha: string };
export type Trace = {
  device?: string; github?: Github; tests?: { ts: number; results: Record<string, string>; running?: boolean };
  requirements?: TraceRow[]; hazards?: HazardRow[]; untraced?: Target[];
  nodes: TraceNode[]; edges: { source: string; target: string }[];
};
export type RepoFile = { path: string; text: string; lines: number; repo: string; sha: string };
export type SearchHits = {
  files: string[]; sections: { path: string; anchor: string; text: string; line: number }[]; lines: { path: string; line: number; text: string }[];
};

/** GitHub's heading anchor (same rule as tracelinks.slug). */
export const slug = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, "").replace(/ /g, "-");

export function githubUrl(gh: Github | undefined, t: Pick<Target, "path" | "start" | "end" | "anchor">) {
  if (!gh?.repo || !t.path) return "";
  const base = `${gh.repo}/blob/${gh.sha}/${t.path}`;
  if (t.anchor) return `${base}#${t.anchor}`;
  if (!t.start) return base;
  return `${base}${t.path.endsWith(".md") ? "?plain=1" : ""}#L${t.start}${t.end && t.end !== t.start ? `-L${t.end}` : ""}`;
}

export const where = (t: Target) =>
  t.url || (t.anchor ? `${t.path}#${t.anchor}` : t.start ? `${t.path}:${t.start}${t.end && t.end !== t.start ? `-${t.end}` : ""}` : t.path || "");

const files = new Map<string, Promise<RepoFile | null>>();
/** Repo files are fetched once per page load (the server reads the working tree; links follow it on refresh). */
export function loadFile(getJSON: <T>(p: string) => Promise<T | null>, path: string) {
  if (!files.has(path)) {
    const p = getJSON<RepoFile>(`trace/file?path=${encodeURIComponent(path)}`);
    files.set(path, p);
    p.then(f => { if (!f) files.delete(path); });
  }
  return files.get(path)!;
}
