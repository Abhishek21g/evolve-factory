# Certus Factory

**A software factory for physical AI.** Tell it what you want in plain English. Agents recall the organization's
memory, analyze hazards, write the code, and every change is verified by deterministic tests and a world model
(the real firmware running in simulated patients) before it can merge. Each change ships with a safety evidence pack.

```bash
python3 -m venv .venv && .venv/bin/pip install -r sim/requirements.txt -r factory/requirements.txt
cd web && npm install && npm run build && cd ..
.venv/bin/python factory/server.py          # open http://localhost:8787
```

- **Build it**: request, then shared memory (HydraDB), Safety Analyst (hazards), coding agent (Claude Code) in a git worktree, deterministic gate, world model, evidence pack, Composio actions.
- **Simulate**: ask a what-if question; the Simulation Agent turns it into scenarios and the world model answers on the current firmware.
- Approval is never an LLM decision: tests plus the world model decide.
- Optional keys in `.env` (gitignored): `HYDRADB_API_KEY`, `COMPOSIO_API_KEY`, `SF_API_KEY`. Without them it runs with local fallbacks.
- `web/` is a static Next.js app. Served locally by `factory/server.py`; on Vercel it plays a recorded run (replay mode).
- `factory/seed_memory.jsonl` is example organization knowledge (tickets, meeting notes, chats, emails) written for this demo.

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
## World model (simulated patients)

Every candidate change is also run in a world model before it can merge: the candidate's real `demo/pump/pump.c`
is compiled and put in the loop with 10 simulated adults with type 1 diabetes (simglucose, the open-source
UVA/Padova simulator). Two fixed scenarios: a large meal, and a 10x dose-entry typo. The check is deterministic
and judges the change against `main`: it blocks if the change makes any simulated patient fall below 54 mg/dL
who did not before, and reports risk that already exists on `main` separately.

```bash
python3 -m venv .venv && .venv/bin/pip install -r sim/requirements.txt
.venv/bin/python sim/world.py --repo . --base main      # ~1 min
```

It runs as the `world-model` check in `gate/checks.json`, and draws blood-sugar traces on the dashboard.

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
| simglucose 0.2.11 (UVA/Padova T1D simulator) | world model, simulated patients | MIT |
| numpy, pandas, scipy (simglucose deps) | simulation | BSD-3-Clause |
| Next.js 15, React 19, Tailwind CSS 4 | web UI | MIT |
| HydraDB (hydradb-sdk) | shared memory / context layer | proprietary SDK, hosted service (sponsor) |
| Composio (composio 0.32) | agent actions in GitHub / Slack | Apache-2.0 (sponsor) |
| Vercel | hosting the UI | service (sponsor) |

## Built before the event

Nothing. All code and commits in this repo were made during EVOLVE (hacking started Fri Nov 13, 7:10 PM PT). Ideas were planned beforehand, which the rules allow. CertusAI (our separate startup) code is not used.

## License

MIT, see [LICENSE](LICENSE).
