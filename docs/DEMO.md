# Demo: 3 minutes on stage + backup video

Kept current by `demo/watch.sh` (a headless agent updates this file when `main` moves). Edit freely; it keeps your structure.

## Before going on stage (T-10 min)

```bash
demo/go.sh replay        # ~2 s warm (first time ~30 s: npm ci + UI build). Ends with READY or what is broken.
demo/go.sh check         # health check only, any time
```

1. Open Home: `http://localhost:8787/#/p/insulin-pump-firmware/overview`. Browser full screen, zoom 125%.
   `go.sh` also prints the URL of a fresh draft work order with the same request (fallback click path: **Run** there).
2. In replay mode, type the recorded request exactly: **Raise the single-bolus limit to 25 U**. Any other text still
   plays the recorded run (it never hangs), but the messages will be about the 25 U request.
   The work order on screen gets the next free number (WO-305, WO-306, ...); the PR it links is the recording's
   [PR #30](https://github.com/Abhishek21g/evolve-factory/pull/30), titled WO-304. Don't read WO numbers aloud.
3. Backup if the laptop or server dies: **https://certus-factory.vercel.app** (read-only snapshot, first paint ~0.3 s,
   no server needed). The snapshot on `main` (Nov 14 03:42) holds the 25 U run as WO-345: badge **Approved**, its
   Activity shows both BLOCKED attempts, **Code change** / **Evidence** / **Pull request** (PR #30) work, plus the
   recorded what-if. It is the end state only; the blocks do not animate. The old WO-101/WO-102 runs are gone. If the
   site still shows WO-101/WO-102, it has not been redeployed: run `demo/deploy.sh`.
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
| `demo/go.sh` to READY (warm / cold fresh worktree) | 2.3-2.7 s | 1.9 s / 30 s |
| Context recall (local memory) | <0.1 s | <0.1 s |
| Safety Analyst (`claude -p`) | 14-16 s | 4 s |
| Claude Code implements in a worktree | 85-134 s | 4 s |
| Gate: protected files + requirement tests | <0.2 s | in the 4 s below |
| World model, 20 sims candidate + 20 on main | 45-51 s | 4 s |
| Open PR (`git push` + `gh pr create`) | 4 s | 0 s (links the recorded PR) |
| **Whole work order** | **143-200 s** (block, block, green: 202 s) | **72 s from Enter**: page jumps to the work order in 0.1 s, BLOCKED at 10 s (held 30 s), BLOCKED again at 48 s (held 15 s), green at 72 s. The pipeline's own clock reads 8 s / 46 s / 69 s |
| What-if (Simulation Agent + 30 sims) | 45 s | 7 s |

Replay pacing: `REPLAY_SPEED=4 REPLAY_MAX_GAP=4 REPLAY_HOLD=30,15 demo/go.sh replay` are the defaults.
`REPLAY_HOLD` is how long each BLOCKED stays on screen before the next attempt starts (first block, second block):
match it to your D2/D3 narration (`REPLAY_HOLD=0` plays the whole run in 25 s). Raise `REPLAY_MAX_GAP` (e.g. 8) to
slow every other step.

## The 3-minute script

Words are in [PITCH.md](PITCH.md) section 1; this is what is on screen at each beat. Times assume Enter at 0:40
(measured Nov 14 on `main`, replay defaults). The work order page has the **Pipeline** on the left (Context,
Hazard analysis, Plan, Implementation, Requirement tests, World model, Evidence pack, Decision, each with its
seconds), the **World model** charts top right ("120 g meal, correct dose" left, "15 g snack, dose typed 10x" right;
grey = main), the **Requirement tests** table under them, and **Activity** at the bottom. Nothing spins: steps
appear as they land.

| Time | Beat | Screen | Do |
|---|---|---|---|
| 0:00-0:35 | Hook, problem (A) | Home: "Good morning, Abhishek.", composer, "Your agent team" (10 cards), Recent work orders (the draft), Connected | nothing |
| 0:35-0:50 | D1 (M) | Home composer (**Build** selected), then the work order page | type `Raise the single-bolus limit to 25 U`, Enter at 0:40. The page jumps to the work order at once (badge **Running**); at 0:44 **Hazard analysis** fills in: "In scope: H-1, H-2, H-3 (SR-1, SR-2, SR-3). Raising MAX_BOLUS_U to 25.0 breaks SR-1 ..." |
| 0:50-1:20 | D2 BLOCKED | Implementation "Attempt 1: committed". At 0:50: Requirement tests "Attempt 1: BLOCKED" (red), World model "BLOCKED: 4 new severe-hypo runs caused by this change; 2 pre-existing", table row **SR-1 FAIL** | point at the SR-1 FAIL row, then the right chart "15 g snack, dose typed 10x" (header "4 new severe hypo"; red traces fall below the dashed 54 line, grey main traces stay up). Holds 30 s |
| 1:20-1:42 | D3 the fix, blocked again | 1:20 Implementation "Attempt 2: fixing what the gate blocked", 1:24 "Attempt 2: committed". At 1:28: "Attempt 2: BLOCKED", World model "BLOCKED: 2 new severe-hypo runs ...", all 5 table rows PASS | point at the left chart "120 g meal, correct dose" (header "2 new severe hypo"): the agent's extended bolus passes every unit test, and two patients still crash hours after the meal. Holds 15 s |
| 1:42-1:52 | D3 final fix | 1:42 "Attempt 3: fixing what the gate blocked", 1:46 "Attempt 3: committed" | nothing; keep talking |
| 1:52-2:20 | D4 green | Badge **Approved**. Requirement tests "Attempt 3: all checks passed", World model "PASS: 0 new severe-hypo runs caused by this change; 2 pre-existing" (2 yellow traces on the 10x chart), Decision "approved by deterministic checks: ready to merge with evidence". Top right: **Evidence**, **Code change**, **Pull request**, Run again | click **Code change**: `request_extended_bolus`, `MAX_EXTENDED_U 15.0` "24 U caused severe hypo in the world model", `MAX_BOLUS_U` stays 10. Close with **×** (Escape does not close it). Click **Evidence**, scroll to the world model table, **×**. Click **Pull request** (PR #30 opens in a new tab) |
| 2:20-3:00 | Why it matters, close (A) | Traceability, then back to Home | click **Traceability** (hazards -> requirements -> code -> tests -> this work order -> "20 simulations" and "Evidence pack"), click **H-1** to light its chain; leave it |

Optional if ahead of time: click the Home suggestion chip `What if a child eats 80 g and the parent types the dose 10x?`
(7 s, lands on World Model). If the hosted backup is all you have, walk the same pages on
https://certus-factory.vercel.app (Run is disabled there): open WO-345 from Recent work orders, narrate D2/D3 over
its Activity entries, then do the D4 clicks as written; the what-if is already on World Model.

## Backup video shot list (record replay mode, 1440p, ~2:40)

| # | Length | Shot | Capture |
|---|---|---|---|
| 1 | 0:10 | Title card: "Certus Factory: safety-verified software factory for physical AI" | static |
| 2 | 0:15 | Home: greeting, composer, agent team cards, Connected list, slow scroll | screen |
| 3 | 0:10 | Requirements: hazards H-1 to H-5, safety requirements SR-1 to SR-5 with code and tests | screen |
| 4 | 0:15 | Home composer: type the 25 U request, Enter; page jumps to the work order, Hazard analysis fills in ("breaks SR-1") | screen, zoom on the composer, then the Pipeline |
| 5 | 0:20 | **BLOCKED**: Implementation "Attempt 1: committed", Requirement tests table **SR-1 FAIL**, World model "BLOCKED: 4 new" | screen, hold on SR-1 FAIL |
| 6 | 0:15 | "15 g snack, dose typed 10x" chart while blocked: red traces cross the 54 line, grey main traces stay up | screen, zoom on the chart |
| 7 | 0:15 | **BLOCKED again**: "Attempt 2: BLOCKED" with all 5 tests PASS; "120 g meal, correct dose" chart shows 2 late crashes | screen, zoom on the chart |
| 8 | 0:15 | "Attempt 3: committed", then **Approved**: "all checks passed", World model "PASS: 0 new ...; 2 pre-existing" | screen |
| 9 | 0:15 | **Code change** modal: `request_extended_bolus`, `MAX_EXTENDED_U 15.0` and its comment, `MAX_BOLUS_U` still 10 | screen, zoom on `pump.h` |
| 10 | 0:15 | **Evidence** modal: hazard analysis, requirement -> test table, world model table | screen, scroll |
| 11 | 0:10 | GitHub [PR #30](https://github.com/Abhishek21g/evolve-factory/pull/30) ("WO-304: Raise the single-bolus limit to 25 U", checks report in the body) | browser |
| 12 | 0:15 | Traceability graph, click H-1 to light its chain; end on the card "Approval is never an LLM decision." | screen, then static |

Shots 5-7: each BLOCKED state holds for `REPLAY_HOLD` seconds (default 30, then 15). Record with
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
