# Demo: 3 minutes on stage + backup video

Kept current by `demo/watch.sh` (a headless agent updates this file when `main` moves). Edit freely; it keeps your structure.

## Before going on stage (T-10 min)

```bash
demo/go.sh replay        # ~3 s warm; ~38 s after a pull that changed web/ deps (npm ci + UI build). Ends with READY or what is broken.
demo/go.sh check         # health check only, any time
```

1. Open Home: `http://localhost:8787/#/p/insulin-pump-firmware/overview`. Browser full screen, zoom 125%.
   `go.sh` also prints the URL of a fresh draft work order with the same request (fallback click path: **Run** there).
2. In replay mode, type the recorded request exactly: **Raise the single-bolus limit to 25 U**. Any other text still
   plays the recorded run (it never hangs), but the messages will be about the 25 U request.
   The work order on screen gets the next free number (WO-305, WO-306, ...); the PR it links is the recording's
   [PR #30](https://github.com/Abhishek21g/evolve-factory/pull/30), titled WO-304. Don't read WO numbers aloud.
3. Backup if the laptop or server dies: **https://certus-factory.vercel.app** (read-only snapshot, first paint ~0.3 s,
   no server needed). It holds the 25 U run as WO-345 (badge **Approved**; Activity lists both BLOCKED attempts;
   **Code change** / **Evidence** / **Pull request** work) plus the recorded what-if. End state only: the blocks do
   not animate. As of Nov 14 05:30 it was deployed at 04:37, before the new design system, **World model loop**,
   **Source of Record** and **Automations** landed; run `demo/deploy.sh` (needs `vercel login`) to put the current UI there. From a clean checkout (no
   `.runs/factory.json`) it ships the committed `web/public/snapshot.json` (still has WO-345); it no longer deploys 0 projects.
4. Rehearsing? Just re-run `demo/go.sh replay`: it adds a fresh draft work order each time. Every run is real on
   the side: with GitHub connected, **Composio files a real GitHub issue** with the evidence pack ~4 s after the
   verdict, and a lesson is written to HydraDB. Close rehearsal issues afterwards (`gh issue list`).

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
| `demo/go.sh` to READY (warm / cold fresh worktree) | 2.3-2.7 s | 2.7 s / 36-38 s |
| Context recall (HydraDB) | 0.3-0.6 s | 0.5 s (live HydraDB call) |
| Safety Analyst (`claude -p`) | 14-16 s | 4 s |
| Claude Code implements in a worktree | 85-134 s | 4 s |
| Gate: protected files + requirement tests | <0.2 s | in the 4 s below |
| World model, 20 sims candidate + 20 on main | 45-51 s | 4 s |
| Open PR (`git push` + `gh pr create`) | 4 s | 0 s (links the recorded PR) |
| **Whole work order** | **143-200 s** (block, block, green: 202 s) | **75 s from Enter** (Nov 14 05:30, new UI): page jumps to the work order at once, BLOCKED at 10 s (held 30 s), BLOCKED again at 49-51 s (held 15 s), checks pass at 73 s, **Approved** at 75 s, Composio issue at 79 s. No spinner at any point |
| What-if (Simulation Agent + 30 sims) | 45 s | 7 s |

Replay pacing: `REPLAY_SPEED=4 REPLAY_MAX_GAP=4 REPLAY_HOLD=30,15 demo/go.sh replay` are the defaults.
`REPLAY_HOLD` is how long each BLOCKED stays on screen before the next attempt starts (first block, second block):
match it to your D2/D3 narration (`REPLAY_HOLD=0` plays the whole run in 25 s). Raise `REPLAY_MAX_GAP` (e.g. 8) to
slow every other step.

## The 3-minute script

Words are in [PITCH.md](PITCH.md) section 1; this is what is on screen at each beat. Times assume Enter at 0:40
(measured Nov 14 05:30 on `main`, replay defaults, new UI).

Layout of the work order page: title with a small grey "replayed from real run WO-304 · Nov 14, 2:45 AM" (leave it),
buttons top right (**Code change**, **World model loop**, Run again; after green also **Evidence** and **Pull
request**). Left: **Pipeline** (Context "Recalled 6 items from HydraDB · ~500 ms: org memory and insulin pump regulatory knowledge", Hazard analysis with H-/SR- chips,
Plan "Recalled 1 similar past work order from HydraDB" (the lesson a past run saved), Implementation, Requirement tests with "Deterministic gate:
Rust (forbid unsafe) · verdict digest", World model, Evidence pack, Decision). Right: **Simulation: candidate
firmware vs main** (verdict strip, legend), then one card per scenario, stacked: **"120 g meal, correct dose"**
first, **"15 g snack, dose typed 10x"** below it (scroll ~650 px), each with a chart (grey = main), a stats panel
("New severe hypo < 54: n / 10", lowest BG and patient) and a per-patient table. Under them the **Requirement tests**
table, then **Activity**. Nothing spins: steps appear as they land.

| Time | Beat | Screen | Do |
|---|---|---|---|
| 0:00-0:35 | Hook, problem (A) | Home: "Good morning, Abhishek.", composer, "Your agent team" (10 live cards), Recent work orders, Connected (Claude Code, 8090 Software Factory, HydraDB, Composio, Vercel) | nothing |
| 0:35-0:50 | D1 (M) | Home composer (**Build** selected), then the work order page | type `Raise the single-bolus limit to 25 U`, Enter at 0:40. The page jumps to the new work order at once (badge **Running**); at 0:45 **Hazard analysis** fills in: chips H-1 H-2 H-3 SR-1 SR-2 SR-3, "Risk: Raising MAX_BOLUS_U to 25.0 breaks SR-1 ..." |
| 0:50-1:21 | D2 BLOCKED | Implementation "Attempt 1: committed". At 0:50: Requirement tests "Attempt 1: BLOCKED" (red), World model "BLOCKED: 4 new severe-hypo runs caused by this change; 2 pre-existing"; verdict strip **BLOCKED** | scroll down one screen: the **"15 g snack, dose typed 10x"** card (red **BLOCKED**, "New severe hypo < 54: 4 / 10", lowest BG 0 mg/dL) and right under it the Requirement tests table with **SR-1 FAIL**. Point at both. Holds 30 s |
| 1:21-1:43 | D3 the fix, blocked again | 1:21 "Attempt 2: fixing what the gate blocked", 1:27 "Attempt 2: committed". At 1:29-1:31: "Attempt 2: BLOCKED", World model "BLOCKED: 2 new ...", all 5 test rows PASS | scroll back up: the **"120 g meal, correct dose"** card is now red **BLOCKED**, "2 / 10", two red traces crash hours after the meal (adult#009, adult#010 in the table). Holds 15 s |
| 1:43-1:55 | D3 final fix | 1:43 "Attempt 3: fixing what the gate blocked", 1:48 "Attempt 3: committed", 1:53 "Attempt 3: all checks passed" | nothing; keep talking |
| 1:55-2:20 | D4 green | Badge **Approved** (1:55). World model "PASS: 0 new severe-hypo runs caused by this change; 2 pre-existing", both scenario cards green **PASS**, Decision "approved by deterministic checks". At ~1:59 Activity adds "Composio filed GitHub issue #N with the WO evidence pack (APPROVED)" | click **Code change**: `request_extended_bolus`, `MAX_EXTENDED_U 15.0` "24 U caused severe hypo in the world model", `MAX_BOLUS_U` stays 10; **Esc**. **Evidence** (Rust verdict digest, hazard analysis, requirement -> test, world model table, trace links), scroll, **Esc**. **Pull request** (PR #30 opens in a new tab) |
| 2:20-3:00 | Why it matters, close (A) | World model loop, then Traceability | click **World model loop** (sidebar **World Model** opens the same page): on top "Hear the pump: before vs after" (blocked patch: "No alarm, typed 15.0 U ... the pump delivered it", then URGENT LOW; the fix: BOLUS EXCEEDS LIMIT), then the loop strip "Scenario -> Simulation 4/20 runs failed -> Diagnosis SR-1 · H-1, H-3 -> Sent to Claude Code -> Fix -> Re-simulation PASS", and the deterministic **Diagnosis** with the causal chain and the responsible `pump.h` line. Then sidebar **Traceability** (opens on **Matrix**: 5/5 requirements -> code, 5/5 -> tests, 3 untraced functions in red), click **Graph**, click **H-1** to light its chain; leave it |

Optional if ahead of time: click the Home suggestion chip `What if a child eats 80 g and the parent types the dose 10x?`
(~7 s, lands on **Simulations**). Avoid **Source of Record** on stage: its "Simulation evidence" card reads
"20 runs · UNSAFE" for main's pre-existing lows, which invites a question you don't have time for. Also skip
**Incidents** (the hotline needs `ELEVENLABS_API_KEY` and `factory/hotline.py setup`, docs/HOTLINE.md) and the
**Play** buttons on "Hear the pump" (silent until `.venv/bin/python factory/callouts.py audio` has synthesized
`web/public/audio/`). **Control Tower**, **Suppliers**, **Supply Chain** and **Finance** are labelled sample data:
fine for Q&A, not part of the 3 minutes.
If the hosted backup is all you have: open WO-345 from Recent work orders, narrate D2/D3 over its Activity
entries, then do the D4 clicks; Run is disabled there.

## Backup video shot list (record replay mode, 1440p, ~2:45)

| # | Length | Shot | Capture |
|---|---|---|---|
| 1 | 0:10 | Title card: "Certus Factory: safety-verified software factory for physical AI" | static |
| 2 | 0:15 | Home: greeting, composer, live agent team cards, Connected list (HydraDB, Composio), slow scroll | screen |
| 3 | 0:12 | **Memory**: HydraDB collections (org memory, regulatory KB, lessons), search `typing errors overdose`, top hit "Clinical safety review, Oct 28" | screen |
| 4 | 0:15 | Home composer: type the 25 U request, Enter; the work order opens, Context "Recalled 6 items from HydraDB", Hazard analysis "breaks SR-1" | screen, zoom on the composer, then the Pipeline |
| 5 | 0:20 | **BLOCKED**: scroll to the "15 g snack, dose typed 10x" card (4 / 10 new severe hypo) and **SR-1 FAIL** under it | screen, hold on SR-1 FAIL |
| 6 | 0:15 | **BLOCKED again**: "Attempt 2: BLOCKED", all 5 tests PASS; "120 g meal, correct dose" card shows 2 late crashes | screen, zoom on the chart |
| 7 | 0:15 | "Attempt 3: committed", then **Approved**: both scenario cards PASS, "0 new ...; 2 pre-existing"; Activity "Composio filed GitHub issue" | screen |
| 8 | 0:15 | **Code change**: `request_extended_bolus`, `MAX_EXTENDED_U 15.0` and its comment, `MAX_BOLUS_U` still 10 | screen, zoom on `pump.h` |
| 9 | 0:15 | **Evidence**: Rust verdict digest, hazard analysis, requirement -> test table, world model table, trace links | screen, scroll |
| 10 | 0:15 | **World model loop**: "Hear the pump: before vs after" (no alarm vs BOLUS EXCEEDS LIMIT; with sound once the clips exist), loop strip, Diagnosis causal chain and responsible code | screen, slow scroll |
| 11 | 0:10 | GitHub [PR #30](https://github.com/Abhishek21g/evolve-factory/pull/30) ("WO-304: Raise the single-bolus limit to 25 U", checks report in the body) | browser |
| 12 | 0:15 | **Traceability** Matrix (5/5, untraced code in red), click `MAX_BOLUS_U` (code viewer, line highlighted), **Graph**, click H-1 to light its chain; end on the card "Approval is never an LLM decision." | screen, then static |

Shots 5-6: each BLOCKED state holds for `REPLAY_HOLD` seconds (default 30, then 15). Record with
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
