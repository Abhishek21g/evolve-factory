import type { World } from "@/lib/feed";

const W = 420, H = 230, PL = 34, PR = 10, PT = 10, PB = 26, MAX = 450;

/** Blood-glucose traces for each scenario. Grey = same patient on the base firmware. */
export function WorldChart({ world }: { world: World }) {
  const scenarios = [...new Set(world.results.map(r => r.scenario))];
  const labels = Object.fromEntries((world.scenarios || []).map(s => [s.id, s]));
  const mins = world.results[0].trace.length * world.step_min;
  const x = (m: number) => PL + (m / mins) * (W - PL - PR);
  const y = (g: number) => PT + (1 - Math.min(Math.max(g, 0), MAX) / MAX) * (H - PT - PB);
  const pts = (tr: number[]) => tr.map((g, i) => `${x(i * world.step_min).toFixed(1)},${y(g).toFixed(1)}`).join(" ");
  const whatif = !!world.question;

  return (
    <div className={`grid gap-4 ${scenarios.length > 1 ? "md:grid-cols-2" : ""}`}>
      {scenarios.map(sc => {
        const rs = world.results.filter(r => r.scenario === sc);
        const fresh = rs.filter(r => r.new_hypo).length;
        const old = rs.filter(r => r.preexisting).length;
        const hypo = rs.filter(r => r.hypo).length;
        const lowest = Math.min(...rs.map(r => r.min));
        return (
          <figure key={sc} className="rounded-lg border border-line bg-bg/60 p-3">
            <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-[13px] font-medium">{labels[sc]?.label || sc}</span>
              <span className="text-[11px] text-mute">
                {labels[sc]?.cohort ? `${labels[sc].cohort} cohort · ` : ""}lowest {lowest} mg/dL ·{" "}
                {whatif ? (
                  <b className={hypo ? "text-bad" : "text-ok"}>{hypo ? `${hypo}/10 severe hypo` : "no severe hypo"}</b>
                ) : fresh ? (
                  <b className="text-bad">{fresh} new severe hypo</b>
                ) : (
                  <span className="text-ok">no new harm</span>
                )}
                {!whatif && old ? <span className="text-warn"> · {old} pre-existing</span> : null}
              </span>
            </figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Blood glucose, ${sc}`}>
              <rect x={PL} y={y(180)} width={W - PL - PR} height={y(70) - y(180)} fill="#34d39912" />
              {[0, 100, 200, 300, 400].map(g => (
                <g key={g}>
                  <line x1={PL} x2={W - PR} y1={y(g)} y2={y(g)} stroke="#1a1d22" />
                  <text x={PL - 6} y={y(g) + 3} textAnchor="end" fontSize="9" fill="#5b616a">{g}</text>
                </g>
              ))}
              <line x1={PL} x2={W - PR} y1={y(world.threshold)} y2={y(world.threshold)} stroke="#f87171" strokeDasharray="3 3" opacity=".8" />
              <text x={W - PR - 2} y={y(world.threshold) - 4} textAnchor="end" fontSize="9" fill="#f87171">severe hypo · {world.threshold}</text>
              <line x1={x(world.meal_at)} x2={x(world.meal_at)} y1={PT} y2={H - PB} stroke="#2a2f36" strokeDasharray="2 3" />
              <text x={x(world.meal_at)} y={H - 10} textAnchor="middle" fontSize="9" fill="#8a9099">meal</text>
              <text x={W - PR} y={H - 10} textAnchor="end" fontSize="9" fill="#5b616a">{mins / 60} h</text>
              <text x={PL} y={H - 10} fontSize="9" fill="#5b616a">mg/dL</text>
              {!whatif && rs.map(r => <polyline key={"b" + r.patient} points={pts(r.base_trace)} fill="none" stroke="#3a3f47" strokeWidth="1" />)}
              {rs.map(r => (
                <polyline key={r.patient} points={pts(r.trace)} fill="none"
                  stroke={r.new_hypo || (whatif && r.hypo) ? "#f87171" : r.preexisting ? "#fbbf24" : "#34d399"}
                  strokeWidth={r.new_hypo || (whatif && r.hypo) ? 2.2 : 1.3} opacity={r.hypo ? 1 : 0.85}>
                  <title>{`${r.patient}: ${r.note}, min ${r.min} mg/dL`}</title>
                </polyline>
              ))}
            </svg>
          </figure>
        );
      })}
    </div>
  );
}
