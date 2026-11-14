import type { State } from "@/lib/api";

/** Switch between projects (e.g. Insulin Pump / Boeing Flight Controls), staying on the same page. */
export function ProjectSwitcher({ state, project, page }: { state: State; project: string; page: string }) {
  if (state.projects.length < 2) return null;
  const go = (id: string) => { location.hash = `/p/${id}/${page}`; };
  return (
    <label className="block border-b border-line px-3 py-2">
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-dim">Project</span>
      <select aria-label="Project" value={project} onChange={e => go(e.target.value)}
        className="w-full cursor-pointer rounded-md border border-line bg-panel px-2 py-1.5 text-[13px] text-ink outline-none hover:border-white/20">
        {state.projects.map(p => <option key={p.id} value={p.id} className="bg-panel">{p.name}</option>)}
      </select>
    </label>
  );
}
