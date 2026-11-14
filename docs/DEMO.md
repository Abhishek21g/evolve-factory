# Demo: 3 minutes on stage + backup video

Kept current by `demo/watch.sh` (a headless agent updates this file when `main` moves). Edit freely; it keeps your structure.

## Before going on stage (T-10 min)

```bash
demo/go.sh replay        # ~3 s warm (first time ~45 s: npm ci + UI build). Ends with READY or what is broken.
demo/go.sh check         # health check only, any time
```

1. Open the URL `go.sh` prints (`http://localhost:8787/#/p/insulin-pump-firmware/work-orders/WO-1xx`, the fresh draft).
   Browser full screen, zoom 125%. Second tab: `.../#/p/insulin-pump-firmware/world-model`.
2. Backup if the laptop or server dies: **https://certus-factory.vercel.app** (read-only snapshot of a real run,
   first paint ~0.3 s, no server needed).
3. Rehearsing? Just re-run `demo/go.sh replay`: it adds a fresh draft work order each time.

**Replay vs live.** `replay` plays a recorded real run (WO-200, recorded Nov 14 01:40: real Safety Analyst output,
real Claude Code commit, real gate and world-model results, real [PR #17](https://github.com/Abhishek21g/evolve-factory/pull/17))
with the gaps compressed. Nothing on stage can wait on an LLM or hang. The sidebar says `· replay`. `demo/go.sh live`
runs everything for real (~3.5 min per run; needs the `claude` CLI logged in and under its usage limit).

| Stage (measured Nov 14, M-series Mac) | Live | Replay |
|---|---|---|
| UI first paint, local / hosted | 0.07 s / 0.3 s (was a "Connecting…" screen until the server answered) | same |
| `demo/go.sh` to READY (warm) | 2.3-2.7 s | 2.3-2.7 s |
| Context recall (local memory) | <0.1 s | <0.1 s |
| Safety Analyst (`claude -p`) | 14-16 s | 4 s |
| Claude Code implements in a worktree | 85-134 s | 4 s |
| Gate: protected files + requirement tests | <0.2 s | in the 4 s below |
| World model, 20 sims candidate + 20 on main | 45-51 s | 4 s |
| Open PR (`git push` + `gh pr create`) | 4 s | 0 s (links the recorded PR) |
| **Whole work order** | **143-200 s** | **12-13 s** |
| What-if (Simulation Agent + 30 sims) | 45 s | 7 s |

Replay pacing: `REPLAY_SPEED=4 REPLAY_MAX_GAP=4 demo/go.sh replay` are the defaults; raise `REPLAY_MAX_GAP` (e.g. 8)
if you want more time to talk over the pipeline.

## The 3-minute script

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00-0:20 | Overview (`#/p/insulin-pump-firmware/overview`) | nothing | "Coding agents ship fast. In medical devices nobody may merge without safety evidence. Certus Factory is the stage Software Factory is missing: every change is verified before it can merge, and ships with its safety case." |
| 0:20-0:35 | Requirements | click **Requirements** | "This is an insulin pump. 5 hazards, 5 safety requirements, imported from the repo's hazard log. Agents cannot edit them." |
| 0:35-0:50 | Work order WO-1xx "Raise the single-bolus limit to 25 U" | click **Work Orders**, then the draft | "A clinician asks for a one-line config change: let adults take 25 units instead of 10. Looks harmless." Click **Run**. |
| 0:50-1:05 | Pipeline streams (12 s) | watch | "Context layer recalls tickets and meetings. The Safety Analyst flags it: raising the cap breaks SR-1. A 2.5 U dose mistyped as 25 would go straight in. It also found the Oct 28 clinical review that forbids raising it." |
| 1:05-1:30 | Pipeline done: **Approved** | point at Implementation, Requirement tests, World model | "So Claude Code didn't touch the cap. It built an extended bolus: 25 units over time, never more than 10 per hour. Then the deterministic gate ran every affected requirement's test: 5 of 5 pass." |
| 1:30-2:00 | World model chart | scroll to it | "Then the real firmware runs in 20 simulated type 1 patients, against main. Grey is main, green is the change: no patient newly drops below 54. And it found something nobody asked: two adults already go severely low on main after a 10x typo. That is a new hazard ticket." |
| 2:00-2:25 | Evidence, Code change, Pull request | click **Evidence**, close, click **Pull request** | "Every change ships with its evidence pack: hazards, requirement-to-test trace, simulations. And the PR, with the work order ID, ready to merge." |
| 2:25-2:45 | Traceability | click **Traceability**, click a hazard node | "Hazard to requirement to code to test to work order to simulation to evidence. One graph, the thing auditors ask for." |
| 2:45-3:00 | World Model tab | type `What if a child eats 80 g and the parent types the dose 10x?`, **Simulate** (7 s) | "Ask it anything in plain English. Approval is never an LLM decision: tests and the world model decide." |

If short on time, skip the what-if (2:45). If the hosted backup is all you have, walk the same pages on
https://certus-factory.vercel.app (Run is disabled there; narrate the recorded run instead).

## Backup video shot list (record replay mode, 1440p, ~2:30)

| # | Length | Shot | Capture |
|---|---|---|---|
| 1 | 0:10 | Title card: "Certus Factory: safety-verified software factory for physical AI" | static |
| 2 | 0:15 | Overview, slow scroll | screen |
| 3 | 0:10 | Requirements: hazard log + safety requirements | screen |
| 4 | 0:15 | Work order page, cursor clicks **Run** | screen, zoom on the button |
| 5 | 0:20 | Pipeline streaming step by step; zoom on the Safety Analyst message | screen, `REPLAY_MAX_GAP=8` for pacing |
| 6 | 0:25 | World model charts: pan from large-meal to decimal-slip, highlight the 2 pre-existing lows | screen |
| 7 | 0:15 | Requirement tests table: 5/5 PASS | screen |
| 8 | 0:15 | Evidence pack modal, scroll the tables | screen |
| 9 | 0:10 | GitHub PR #17 (title has the work order ID) | browser |
| 10 | 0:15 | Traceability graph, click a hazard to light its chain | screen |
| 11 | 0:15 | What-if: type the child question, charts appear | screen |
| 12 | 0:05 | Close card: "Approval is never an LLM decision." | static |

Optional cutaway for credibility: terminal running `demo/go.sh live` with the real run log (`.runs/server-job.log`), sped up.

## Recording a new run for replay

After a real live run you like (e.g. one where the gate blocks attempt 1 and the agent fixes it):

```bash
FACTORY_PR=1 .venv/bin/python factory/pipeline.py build "<request>" WO-2xx   # or click Run in live mode
.venv/bin/python demo/record.py WO-2xx      # -> demo/replay/build.*  (commit it)
.venv/bin/python demo/record.py whatif      # latest what-if -> demo/replay/whatif.jsonl
demo/deploy.sh                              # refresh the hosted snapshot (https://certus-factory.vercel.app)
```
