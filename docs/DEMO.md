# Demo: stage script + video (replay only, about 2:50)

Replay only: every run plays a recorded real run (`demo/go.sh replay`), nothing calls an LLM, nothing can hang.
Words to say are in [PITCH.md](PITCH.md) (section 1 on stage, section 7 for the video); this file is the clicks.
Timings were measured on Nov 14 (08:30) on `main` with the replay defaults, from the moment you press Enter.

## Before recording or going on stage (T-10 min)

```bash
demo/go.sh check         # must say "mode REPLAY" and READY. Do not restart a server that is already up.
demo/go.sh replay        # only if nothing is running: ~3 s warm, ~40 s in a fresh checkout. Ends with READY.
```

1. Browser: a fresh private window (so the **Sign in** page shows), 1440x900 or larger, zoom 110%, notifications
   off. Record system audio: the pump alarms and the hotline call are real audio.
2. Open `http://localhost:8787/`. You should see **Sign in** with "live factory" under it.
3. Never click on camera: **Call safety hotline** (starts a real ElevenLabs agent session), **Run again**,
   **New work order**, any **Connect** button, **Continue with SSO / GitHub**. They work, but they are not replay.
4. Backup if the server dies: the hosted read-only snapshot, https://certus-factory-ten.vercel.app (open with `?demo`).
   It shows end states only (the run does not animate).

What the replay shows (the recording is real run WO-304, Nov 14 03:00; the UI says "replayed from real run WO-304"):
attempt 1 is the obvious patch `MAX_BOLUS_U 10 -> 25`, applied by `demo/obvious_patch.sh` because real Claude Code
refuses to write it: **SR-1 FAIL**, 4 simulated patients newly below 54 mg/dL. Attempt 2 is real Claude Code (a 25 U
extended bolus): all 5 tests pass, the world model blocks it (2 late lows). Attempt 3 is real Claude Code capping
the extended total at 15 U: 5/5 PASS, 0 new severe lows, [PR #30](https://github.com/Abhishek21g/evolve-factory/pull/30).
Say "here's the obvious patch", never "the agent wrote this patch". Don't read WO numbers aloud (the new work
order gets the next free number).

## Click path (measured)

| Time | Beat | Do exactly this | On screen |
|---|---|---|---|
| 0:00-0:05 | Title | (title card in the edit) | "Certus Factory: agents write the change, deterministic checks decide if it ships" |
| 0:05-0:14 | Sign in | Click **Enter demo workspace**. On **Projects**, click **Insulin Pump Firmware** | Home: "Good morning, Abhishek.", the composer, "Your agent team", Recent work orders, Connected |
| 0:14-0:22 | D1 | Click the composer (**Build** is selected), type `Raise the single-bolus limit to 25 U`, press **Enter** at 0:22 | The page jumps to the new work order at once, badge **Running** |
| 0:22-0:32 | Context, hazards | Nothing | Pipeline fills in: Context "Recalled ... from HydraDB", Hazard analysis chips H-1 H-2 H-3 SR-1 SR-2 SR-3, "Risk: Raising MAX_BOLUS_U to 25.0 breaks SR-1" |
| 0:32-1:10 | D2 BLOCKED | At 0:32 (Enter + 10 s) the verdict turns **BLOCKED**. Scroll down one screen | The "15 g snack, dose typed 10x" card: red **BLOCKED**, "New severe hypo < 54: 4 / 10"; under it **Requirement tests** with **SR-1 FAIL**. Holds ~38 s |
| 1:10-1:34 | D3 blocked again | At 1:10 (Enter + 48 s) "Attempt 2: BLOCKED". Scroll back up | "120 g meal, correct dose" card red, 2 / 10: two patients crash hours after the meal; all 5 test rows PASS |
| 1:34-1:52 | D4 green | At 1:34 (Enter + 72 s) badge **Approved**, banner "Approved to merge: 5 requirements tested, 5 passed; world model PASS". Click **Code change**, then **Esc**. Click **Evidence**, scroll once, **Esc** | Code change: `request_extended_bolus`, `MAX_EXTENDED_U 15.0`, `MAX_BOLUS_U` stays 10. Evidence: Rust verdict digest, hazards, requirement → test, world model table, trace links |
| 1:52-2:12 | World model loop | Click **World model loop** (top of the work order). In "Hear the pump: before vs after" click **Play** on **Before: the blocked patch**; let it run ~13 s to URGENT LOW. Then click **Play** on **After: the fix that passed** (~3 s). Scroll to the loop strip | Before: "No alarm, typed 15.0 U ... the pump delivered it", LOW GLUCOSE, URGENT LOW. After: BOLUS EXCEEDS LIMIT. Strip: Scenario → Simulation 4/20 runs failed → Diagnosis SR-1 · H-1, H-3 → Sent to Claude Code → Fix → Re-simulation PASS |
| 2:12-2:24 | Traceability | Sidebar **Traceability**. Click **Graph**, then click the **H-1** node | H-1's chain lights up: SR-1, `MAX_BOLUS_U`, the SR-1 test, work orders, simulations, evidence |
| 2:24-2:36 | Hotline (Boeing) | Project switcher (top of the sidebar) → **Boeing Flight Controls**. Sidebar **Incidents**. Click **Recorded sample call**, then **Play recorded call**; after ~8 s click **Stop** | A captain reports an AOA DISAGREE alert with stick shaker on approach; the transcript highlights as it plays. "real conversation with the hotline agent ... voiced for replay" |
| 2:36-2:45 | Control Tower | Sidebar **Control Tower** | Boeing's one-sentence status ("At risk: 1 trace gap (H-3), 3 missing supplier deliverables ..."), Needs attention, four tiles. Supply and finance are sample data and the page says so |
| 2:45-2:52 | MCP | User menu (bottom left) → **Integrations**. Scroll to **Certus Factory as an MCP server**, click **Test connection** | "certus-factory 0.1.0" and its tools `get_trace`, `get_verdict`, `list_gaps`, `recall_memory` |
| 2:52-2:55 | Close | (end card in the edit) | "Approval is never an LLM decision." |

If you run long, cut in this order: the Evidence scroll (−6 s), the Control Tower (−9 s), the After clip (−3 s).
Never cut BLOCKED, Approved, or the World model loop.

## Stage version (3:00, two speakers)

Same path, with the pitch from [PITCH.md](PITCH.md) section 1: Abhishek talks over Home (hook and problem, 0:00-0:35),
Murali presses Enter at 0:40 and narrates D1-D4 (BLOCKED at 0:50, BLOCKED again at 1:28, Approved at 1:52),
then **World model loop** and **Traceability** for the close. Skip the hotline, Control Tower and Integrations
on stage; they are good Q&A answers ("show me the supply chain", "can my agent ask the factory?").

## Q&A click paths

- **Supply chain / finance:** Boeing → **Suppliers** (tiers, certificates, deliverables), **Supply Chain** (parts, raw materials, imports, risk dots), **Finance**. All sample data, labelled.
- **Monitoring:** **Automations** (four monitoring agents, schedules, run history) and **Source of Record** (each requirement checked against test, code value, trace links, simulation evidence). Don't press **Run now** or **Resync** on stage.
- **Memory:** **Memory**, type `typing errors overdose`, Enter: HydraDB answers in under a second.
- **All projects:** sidebar **All projects** → **Control Tower**: both projects in one view.
- **Aircraft run:** Boeing → **Work Orders** shows what this server has run; the recorded AoA run is described in the README (PR #41).

## Backup video shot list (if editing from separate takes)

| # | Length | Shot |
|---|---|---|
| 1 | 0:05 | Title card |
| 2 | 0:09 | Sign in → Enter demo workspace → Projects → Insulin Pump Firmware |
| 3 | 0:18 | Home composer, type the 25 U request, Enter; Hazard analysis "breaks SR-1" |
| 4 | 0:38 | BLOCKED: "15 g snack, dose typed 10x" card (4 / 10) and SR-1 FAIL |
| 5 | 0:24 | BLOCKED again: "120 g meal" card (2 / 10), all 5 tests PASS |
| 6 | 0:18 | Approved; Code change (`MAX_EXTENDED_U 15.0`), Evidence |
| 7 | 0:20 | World model loop: Play Before (URGENT LOW), Play After (BOLUS EXCEEDS LIMIT), loop strip |
| 8 | 0:12 | Traceability Graph, click H-1 |
| 9 | 0:12 | Boeing → Incidents → Recorded sample call → Play, Stop |
| 10 | 0:09 | Boeing Control Tower (sample data) |
| 11 | 0:07 | Integrations → Certus Factory MCP server → Test connection |
| 12 | 0:03 | End card: "Approval is never an LLM decision." |

Recording new replays (a live run, not for the stage or the video) is described in the README and `demo/record.py`.
