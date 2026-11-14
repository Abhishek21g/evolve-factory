# evolve-factory

Team entry for EVOLVE: 8090 AI Hackathon (Redwood City, Nov 13–14, 2026).

Theme: build your own Software Factory. Plan, research and ideas: [docs/PLAN.md](docs/PLAN.md).

Team: Abhishek Enaguthi (@Abhishek21g), Muralikrishna Inti (@Muralikinti).

## Dashboard (agent control room)

```bash
python3 -m http.server 8091 -d dashboard   # open http://localhost:8091
python3 dashboard/demo_run.py              # in another terminal: plays WO-12 live
```

- One lane per agent (Planner, Safety Analyst, Claude, Codex, Safety Gate, Reviewer), traceability matrix, event log.
- Agents report via `dashboard/emit.py` (Python import or shell: `python3 dashboard/emit.py gate working "msg"`). The runner should call it.
- `gate/gate.py --json out.json` gives the matrix data; pass it as `gate=` on the gate event.
- No live feed (or `?replay`) plays the recorded run `dashboard/demo-run.jsonl`. That is the stage fallback and what a static Vercel deploy shows. `&speed=2` speeds it up.
- `demo_run.py`: agent patches are scripted for now; gate verdicts are real (each candidate is checked in a throwaway worktree).
