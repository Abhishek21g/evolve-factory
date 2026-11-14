import type { Member, State } from "@/lib/api";
import type { Ev } from "@/lib/feed";

/** What every page gets from the app shell (web/src/app/page.tsx). */
export type Ctx = {
  state: State; events: Ev[]; live: boolean;
  /** Still finding out whether a factory server answers (first ~20 ms); `live` is false meanwhile. */
  checking: boolean;
  post: (p: string, b: object) => Promise<{ error?: string; id?: string; started?: string }>;
  text: (p: string) => Promise<string>; getJSON: <T>(p: string) => Promise<T | null>;
  team: Record<string, Member>; me: string; base: string | null;
};

export const go = (h: string) => { location.hash = h; };

/** Why the factory can't start a job right now, or null when it can. */
export function blocked(state: State, live: boolean): string | null {
  const st = state.status;
  if (!live && !st?.hosted) return "Read-only snapshot: run demo/go.sh locally to start work.";
  if (!st?.busy) return null;
  const where = st.project && st.project !== state.project?.id ? ` in ${state.projects.find(p => p.id === st.project)?.name || st.project}` : "";
  return `The factory is busy with ${st.running || "a simulation"}${where}. It takes the next job when that finishes.`;
}
