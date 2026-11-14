# Demo: 3 minutes on stage + backup video

Kept current by `demo/watch.sh` (a headless agent updates this file when `main` moves). Edit freely; it keeps your structure.

## Before going on stage (T-10 min)

```bash
demo/go.sh replay        # ~3 s warm (first time ~45 s: npm ci + UI build). Ends with READY or what is broken.
demo/go.sh check         # health check only, any time
```

1. Open Home: `http://localhost:8787/#/p/insulin-pump-firmware/overview`. Browser full screen, zoom 125%.
   `go.sh` also prints the URL of a fresh draft work order with the same request (fallback click path: **Run** there).
2. In replay mode, type the recorded request exactly: **Raise the single-bolus limit to 25 U**. Any other text still
   plays the recorded run (it never hangs), but the messages will be about the 25 U request.
3. Backup if the laptop or server dies: **https://certus-factory.vercel.app** (read-only snapshot of a real run,
   first paint ~0.3 s, no server needed).
4. Rehearsing? Just re-run `demo/go.sh replay`: it adds a fresh draft work order each time.

**Replay vs live.** `replay` plays a recorded real run with the gaps compressed, so nothing on stage can wait on an
LLM or hang. The recording is WO-304 (Nov 14 03:00, 12 h world model), built on `demo-base` (main before the
extended bolus landed):
1. Attempt 1 is the obvious one-line patch `MAX_BOLUS_U 10 -> 25`, applied by `demo/obvious_patch.sh` because real
   Claude Code refuses to write it. Gate **SR-1 FAIL**, world model **BLOCKED: 4 new severe-hypo runs** (10x typo).
2. Attempt 2 is real Claude Code: a 25 U extended bolus, 10 U per hour max. Tests pass, but the world model
   **BLOCKS** it: 2 adults crash hours after a large meal (late lows the 12 h window catches).
3. Attempt 3, real Claude Code: same design, extended total capped at 15 U. 5/5 PASS, 0 new severe hypos, real
   [PR #30](https://github.com/Abhishek21g/evolve-factory/pull/30) into `demo-base`. Claude's own note: the 25 U goal
   is not met; that needs a clinical review of SR-1.

Same story as PITCH D2-D4: say "here's the obvious patch," never "the agent wrote this patch."
`demo/go.sh live` runs everything for real (~3.5 min per run; needs the `claude` CLI logged in, or
`ANTHROPIC_API_KEY` in `.env`). `go.sh` loads only `KEY=value` lines from `.env`; any other line (e.g. a stray
pasted key) prints `warning: .env line(s) N are not KEY=value and were skipped` and the start continues. Fix that
line before a live run if it was meant to be the key.

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
| **Whole work order** | **143-200 s** (block, block, green: 202 s) | **70 s**: BLOCKED at 8 s (held 30 s), BLOCKED again at 46 s (held 15 s), green at 69 s |
| What-if (Simulation Agent + 30 sims) | 45 s | 7 s |

Replay pacing: `REPLAY_SPEED=4 REPLAY_MAX_GAP=4 REPLAY_HOLD=30,15 demo/go.sh replay` are the defaults.
`REPLAY_HOLD` is how long each BLOCKED stays on screen before the next attempt starts (first block, second block):
match it to your D2/D3 narration (`REPLAY_HOLD=0` plays the whole run in 25 s). Raise `REPLAY_MAX_GAP` (e.g. 8) to
slow every other step.

## The 3-minute script

Words are in [PITCH.md](PITCH.md) section 1; this is what is on screen at each beat. Times assume Enter at ~0:40.

| Time | Beat | Screen | Do |
|---|---|---|---|
| 0:00-0:35 | Hook, problem (A) | Home: greeting, composer, "Your agent team" | nothing |
| 0:35-0:55 | D1 (M) | Home composer (**Build** selected), then the work order page | type `Raise the single-bolus limit to 25 U`, Enter. Page jumps to the work order; **Hazard analysis** fills in at 4 s (H-1, H-2, H-3; "directly violates SR-1") |
| 0:48-1:18 | D2 BLOCKED | Implementation: "Attempt 1: the obvious one-line patch, MAX_BOLUS_U 10 -> 25 U". At 8 s: **World model BLOCKED: 4 new severe-hypo runs**, Requirement tests **SR-1 FAIL** | point at the SR-1 FAIL row, then the "15 g snack, dose typed 10x" chart (patients crash below the 54 line). Holds 30 s |
| 1:18-1:45 | D3 the fix, blocked again | "Attempt 2: fixing what the gate blocked", committed; at 1:26 **World model BLOCKED: 2 new** with all 5 tests PASS | point at the "120 g meal, correct dose" chart: the agent's extended bolus passes every unit test, and two patients still crash hours later. Holds 15 s |
| 1:45-1:50 | D3 final fix | "Attempt 3: fixing what the gate blocked", committed | (after green) click **Code change**: `request_extended_bolus`, `MAX_EXTENDED_U 15.0` with the comment "24 U caused severe hypo in the world model"; `MAX_BOLUS_U` stays 10 |
| 1:50-2:20 | D4 green | **Approved**: Requirement tests 5/5 PASS, World model "0 new severe-hypo runs; 2 pre-existing" | point at the green row, the 2 pre-existing lows, click **Evidence** (scroll), close, click **Pull request** (PR #30 opens in a new tab) |
| 2:20-3:00 | Why it matters, close (A) | Traceability (optional), then back to Home | click **Traceability**, click a hazard node; leave it |

Optional if ahead of time: click the Home suggestion chip `What if a child eats 80 g and the parent types the dose 10x?`
(7 s, lands on World Model). If the hosted backup is all you have, walk the same pages on
https://certus-factory.vercel.app (Run is disabled there; narrate the recorded run instead).

## Backup video shot list (record replay mode, 1440p, ~2:30)

| # | Length | Shot | Capture |
|---|---|---|---|
| 1 | 0:10 | Title card: "Certus Factory: safety-verified software factory for physical AI" | static |
| 2 | 0:15 | Home: greeting, composer, agent team cards, slow scroll | screen |
| 3 | 0:10 | Requirements: hazard log + safety requirements | screen |
| 4 | 0:15 | Home composer: type the 25 U request, Enter; page jumps to the work order | screen, zoom on the composer |
| 5 | 0:10 | Hazard analysis message: "directly violates SR-1" | screen, zoom |
| 6 | 0:20 | **BLOCKED**: "Attempt 1: the obvious one-line patch", Requirement tests SR-1 FAIL, World model BLOCKED | screen, hold on SR-1 FAIL |
| 7 | 0:15 | Decimal-slip chart while blocked: 4 patients cross the 54 line, grey main traces stay up | screen, zoom on the chart |
| 8 | 0:15 | **BLOCKED again**: attempt 2 passes all 5 tests, large-meal chart shows 2 late crashes | screen, zoom on the chart |
| 9 | 0:15 | "Attempt 3", then **Code change**: `request_extended_bolus`, `MAX_EXTENDED_U 15.0` and its comment, `MAX_BOLUS_U` still 10 | screen |
| 10 | 0:15 | **Approved**: Requirement tests 5/5 PASS, World model 0 new, 2 pre-existing lows highlighted | screen |
| 11 | 0:15 | Evidence pack modal, scroll the tables | screen |
| 12 | 0:10 | GitHub PR #30 (title has the work order ID, checks report in the body) | browser |
| 13 | 0:10 | Traceability graph, click a hazard to light its chain | screen |
| 14 | 0:05 | Close card: "Approval is never an LLM decision." | static |

Shots 6-8: each BLOCKED state holds for `REPLAY_HOLD` seconds (default 30, then 15). Record with
`REPLAY_HOLD=40,25` for slack.

Optional cutaway for credibility: terminal running `demo/go.sh live` with the real run log (`.runs/server-job.log`), sped up.

## Recording a new run for replay

After a real live run you like:

```bash
FACTORY_PR=1 FACTORY_CACHE=0 .venv/bin/python factory/pipeline.py build "<request>" WO-3xx   # or Run in live mode
.venv/bin/python demo/record.py WO-3xx      # -> demo/replay/build.*  (commit it)
.venv/bin/python demo/record.py whatif      # latest what-if -> demo/replay/whatif.jsonl
demo/deploy.sh                              # refresh the hosted snapshot (https://certus-factory.vercel.app)
```

How the current block-then-fix recording was made (`main` already has the extended bolus, so it builds on
`demo-base`, main as of commit 22853f1; keys come from `.env`):

```bash
set -a; . ./.env; set +a
FACTORY_PR=1 FACTORY_CACHE=0 FACTORY_BASE=demo-base AGENT_CMD="$PWD/demo/obvious_patch.sh" \
  .venv/bin/python factory/pipeline.py build "$(head -1 demo/replay/build.jsonl | python3 -c 'import json,sys; print(json.load(sys.stdin)["title"])')" WO-3xx
FACTORY_BASE=demo-base .venv/bin/python demo/record.py WO-3xx
```
