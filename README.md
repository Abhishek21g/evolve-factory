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
- `gate/runner.py` already reports to the feed (planner, coder, gate, reviewer events, plus the gate matrix). Set `AGENT_NAME=coder-codex` to label a Codex run; set `EVENTS=path` to write the feed elsewhere.
- `gate/gate.py --json out.json` gives the matrix data; pass it as `gate=` on the gate event.
- No live feed (or `?replay`) plays the recorded run `dashboard/demo-run.jsonl`. That is the stage fallback and what a static Vercel deploy shows. `&speed=2` speeds it up.
- `demo_run.py`: agent patches are scripted for now; gate verdicts are real (each candidate is checked in a throwaway worktree).
## Tools, libraries and licenses

Keep this list current; judges require it.

| Tool / library | Use | License |
|---|---|---|
| Python 3 standard library | gate, dashboard scripts | PSF |
| git | diffs, worktrees | GPL-2.0 (tool only, not bundled) |
| make, C compiler (clang/gcc) | build demo pump tests | tool only, not bundled |
| 8090 Software Factory (MCP) | Work Orders, requirements | 8090 service (event access) |
| Claude Code (Anthropic) | coding agent, used to build this project | Anthropic commercial terms |
| Codex CLI (OpenAI) | coding agent | Apache-2.0 CLI |
| Cursor | IDE | proprietary |

## Built before the event

Nothing. All code and commits in this repo were made during EVOLVE (hacking started Fri Nov 13, 7:10 PM PT). Ideas were planned beforehand, which the rules allow. CertusAI (our separate startup) code is not used.

## License

MIT, see [LICENSE](LICENSE).
