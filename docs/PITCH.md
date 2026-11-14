# Pitch: Safety Gate (Certus Factory)

Exact clicks and commands live in [docs/DEMO.md](DEMO.md). This file is what we say.
Demo beats used below:

- **D1** Work Order arrives.
- **D2** The obvious patch (raise the bolus cap 10 to 25 U) is BLOCKED by the gate and the world model.
- **D3** The agent builds the safe version (extended bolus under the 10 U/h cap).
- **D4** Green: requirement tests, world model, evidence pack, PR/WO link.

## 0. Truth table (read before every rehearsal)

Only say what is in the "Built" column. Items marked *(if built by freeze)* get cut from the script unless someone shows them working on `main`.

| Claim | Status on `origin/main` | Say it like this |
|---|---|---|
| Deterministic gate: diff → affected requirements → run each requirement's test → matrix | **Built** (`gate/gate.py`). Blocks the 25 U patch on SR-1 in under 1 s | "The gate runs the test for every requirement the change touches." |
| World model: candidate `pump.c` compiled and put in the loop with 10 simulated T1D adults (simglucose, UVA/Padova), compared to `main` | **Built** (`sim/world.py`). 25 U patch: 4 new severe-hypo runs (min BG 0, 22, 44, 51 mg/dL; 12 simulated hours), about 20 s | "Four simulated patients crash below 54." |
| Protected evidence: agents cannot edit `safety.json`, tests, `gate/`, `sim/` | **Built** (`gate/check_protected.py`, spec read from trusted checkout) | "The agent can't touch the tests or the hazard log." |
| Real coding agent in its own git worktree, retry with the gate report on BLOCKED | **Built** (`gate/runner.py`, Claude Code headless). Real runs WO-13 and WO-101 passed on the **first** attempt | "Claude Code writes it in its own worktree." |
| Blocked-then-fixed story (stage replay = recorded run WO-304, PR #30) | **Attempt 1 patch is scripted** (`demo/obvious_patch.sh`; real Claude Code refuses to write it). Gate and world-model verdicts are real. Attempts 2 and 3 are real Claude Code: its first extended bolus (25 U) passes every unit test but the world model blocks it (2 late lows); the second caps it at 15 U and passes. PR #30 is real (into `demo-base`, main before the extended bolus merged) | "Here's the obvious patch," **not** "the agent wrote this." |
| Safety Analyst (LLM) maps request to hazards, gives guidance, proposes new hazards | **Built** (`factory/pipeline.py`, deterministic fallback) | "Proposed H-6 for human review." |
| Evidence pack (hazards, requirement → test matrix, simulation table, context used; IEC 62304 / ISO 14971) | **Built**. Real one: `web/public/evidence-WO-101.md` | "Every change ships with its evidence pack." |
| No LLM in the approval path | **Built** (tests + world model decide) | Say it. Judges will like it. |
| Software Factory: fetch WO, set status In Progress → In Review / Blocked, link PR | **Built**, over the SF **External REST API** (`gate/sf.py`), not MCP. Only on `runner.py` path | "Pulled from Software Factory through its API." Never say "over MCP." |
| Opens a PR with the checks report | **Built** in `runner.py --pr` (PRs #10, #12) and in the web UI when the server runs with `FACTORY_PR=1` (PR #17 from WO-200). Replay shows the recorded run's **Pull request** button | "No pass, no PR." |
| Blocks merge | No PR is opened and the WO goes to Blocked. **No GitHub required check / commit status** | "Nothing gets to review unless it passes." Don't say "GitHub blocks the merge." |
| `safety-gate` commit status next to `drift-bot` | **Not built** *(if built by freeze)* | Q&A only: "next step." |
| Claude + Codex in parallel | **Scripted lanes only** *(if built by freeze)* | Don't claim. |
| SF Automation trigger (WO → Ready starts a run) | **Not built** *(if built by freeze)* | "Next: run as an SF Automation." |
| HydraDB memory, Composio GitHub/Slack actions | **Live** when keys are set, also in replay: Context recalls from HydraDB (~0.5 s), Plan recalls a past lesson, each run saves a lesson; Composio files a real GitHub issue with the evidence pack ~4 s after the verdict (needs Connect GitHub once) | "Recalled from our org memory in HydraDB." Each rehearsal files a real issue: close them. |
| Deterministic gate in Rust | **Built** (`gate-rs/`, `#![forbid(unsafe_code)]`, built by `demo/go.sh` when cargo is present; Python fallback otherwise). Property tests: 40,000 generated cases. The Requirement tests step shows "Deterministic gate: Rust (forbid unsafe) · verdict digest ..." | "The verdict comes from a small Rust checker, tested against 40,000 generated cases." Never "proven" or "formally verified." |
| Org memory (tickets, meetings, Slack, email) | **Example data** written for the demo (`factory/seed_memory.jsonl`) | "Example org memory." |
| Pump code | **Demo controller** (~45 lines of C, "not a medical device") | "A small pump controller in C." Never say "real pump firmware." |
| ISO 26262 | **Not in code** (IEC 62304 / ISO 14971 only) | CertusAI / roadmap only. |
| Hosted backup site | **Public** at https://certus-factory-ten.vercel.app: read-only snapshot of the 25 U run (WO-345, end state, older UI until `demo/deploy.sh` is re-run), Run disabled, first paint ~0.3 s | Backup only. Demo from `localhost:8787` (`demo/go.sh replay`). |
| Tree-sitter call graph | **Not built** | Q&A: "next step." |
| Supply pages (Control Tower, Suppliers, Supply Chain, Finance) | **Built** on **sample data** (fictional suppliers, prices, budget; the UI says so). Supplier deliverables become real trace links | "Sample suppliers." Never name them as partners. |
| Safety hotline (Incidents), "Hear the pump / cockpit" callouts | **Built**; alarms and callouts are derived from the simulation trace by code, voiced by ElevenLabs. Clips and a real recorded hotline call (Boeing project) are committed (#86), so **Play** works with no key. On the stage server the hotline is live: **Call safety hotline** starts a real ElevenLabs agent session | Play the recorded call (Boeing → Incidents → Recorded sample call). Never press **Call safety hotline** on stage or in the video. |
| Sign-in | **Built**: demo workspace, email sign-in with a signed session, audit trail entries. SSO / GitHub buttons only explain what an admin must configure | "Enter demo workspace." Don't click SSO. |
| Certus Factory as an MCP server, Integrations page | **Built**: read-only tools `get_trace`, `get_verdict`, `list_gaps`, `recall_memory`, `list_projects`; stdio and HTTP `/mcp`. Composio catalog Connect links are real | "Any agent can ask the factory for a requirement's trace or a verdict over MCP." |
| World model vs simulation | Simulation = the physics running the candidate's code. World model = diagnosis on top (requirement, hazard, causal chain, code lines) that goes back to the coder, then re-simulation. No LLM | Keep the two words apart. |
| Connected card "8090 Software Factory · work orders via MCP" | UI label; the factory talks to SF over its REST API (row above) | Don't read the label aloud. |

---

## 1. Three-minute pitch (spoken)

About 440 spoken words. That's about 2:55 at 150 wpm, so there is little silence: if a run-through goes over, cut from the list in section 6.
**A** = Abhishek, **M** = Murali.

**[0:00] Hook. A, no slides, Home on screen.**

> A: This is a one-line change to an insulin pump. Raise the max dose from 10 units to 25, so adults can cover a big meal. Looks harmless. In our simulator, it sends four patients into severe hypoglycemia.

**[0:12] Problem. A.**

> A: Agents can write that line in seconds. In medical devices, cars and aircraft, nobody can merge it without safety evidence. Today that evidence is weeks of manual traceability in DOORS and Jama. Speed is not the bottleneck. Proof is.
>
> A: 8090 already traces every change back to intent. We built the next stage: before an agent's change can merge, it has to prove it's safe. Murali.

**[0:35] [DEMO D1] M drives: types "Raise the single-bolus limit to 25 U" in the Home composer, Enter at 0:40.**

> M: I ask the factory for exactly that: raise the single-bolus limit to 25 units. The Safety Analyst maps it to hazards: overdose, daily overdose, low blood sugar. It already says this breaks SR-1.

**[0:50] [DEMO D2] The obvious patch. Screen: BLOCKED; M scrolls down one screen to the "15 g snack, dose typed 10x" card (4 / 10) and SR-1 FAIL under it (holds 30 s).**

> M: Here's the obvious patch: bump the cap to 25. The Safety Gate runs the test behind every requirement the diff touches. SR-1 fails. Blocked.
>
> M: Then the world model. We compile the candidate's actual C code and put it in the loop with ten simulated type 1 diabetics. A patient means to type 1.5 units and types 15. On main, the pump rejects it. With this patch, it delivers it. Four patients crash below 54. Blocked.

**[1:21] [DEMO D3] The fix. Screen: "Attempt 2", then at 1:29 BLOCKED again with all 5 tests PASS; M scrolls up to the "120 g meal, correct dose" card (2 / 10, holds 15 s). "Attempt 3" at 1:43.**

> M: Blocked work goes back to the agent with the report. Claude Code, in its own worktree, keeps the 10 unit cap and delivers big meals as an extended bolus, never faster than 10 units an hour. Every unit test passes. The world model blocks it anyway: two patients crash hours after a big meal. So the agent caps the extended bolus at 15 units. It can't touch the tests or the hazard log.

**[1:55] [DEMO D4] Green. Screen: Approved, both scenario cards PASS; click Code change (Esc), Evidence (Esc), Pull request (PR #30).**

> M: All five requirement tests pass. World model: zero new hypoglycemia. It also flags two patients who already crash on main: a new hazard for a human to review.
>
> M: Every change ships with an evidence pack: hazards, requirement to test, every simulated patient, and the context the agent used. No pass, no PR. On pass, the PR goes up with the matrix and the Software Factory Work Order moves to In Review.

*The stage replay shows the **Pull request** button (real PR #30), so "No pass, no PR" holds. Say the Software Factory "In Review" clause only if the SF board is on screen; otherwise stop after "the PR goes up with the matrix."*

**[2:20] Why it matters. A. M clicks World model loop (failure -> diagnosis -> fix -> PASS), then Traceability > Graph > H-1.**

> A: No LLM decides approval. Tests and physics do. An LLM comment is an opinion. A failing test in a simulated patient is evidence an auditor accepts.
>
> A: 8090's customers are hospitals, insurers, aerospace, government. They can't let agents ship until the agents can prove what they shipped. This is that proof, plugged into Software Factory.

**[2:45] Close. A.**

> A: Chamath asked what one person can do with a team of AI agents. In a regulated industry the honest answer is nothing, unless the agents can prove it's safe. Now they can. Thank you.

### Timing marks for the stopwatch

| Mark | Should be at | If late |
|---|---|---|
| End of hook | 0:12 | Re-read the hook. It must be automatic. |
| Hand to Murali | 0:35 | Cut the DOORS/Jama sentence. |
| Enter in the Home composer | 0:40 | Type faster; the replay timings below follow Enter. |
| D2 BLOCKED on screen | 0:50 | (set by the replay) Skip the hazard list in D1. |
| D3 BLOCKED again on screen | 1:29 | (set by the replay) Drop "Every unit test passes." |
| D4 green on screen | 1:55 | (set by the replay) Drop the "already crash on main" line. |
| Close starts | 2:45 | Drop the customer list sentence. |

---

## 2. Sixty-second version (about 150 words)

> This is a one-line change to an insulin pump: raise the max dose from 10 to 25 units so adults can cover a big meal. Looks harmless. In our simulator it sends four patients into severe hypoglycemia.
>
> Agents write code in seconds, but in medical devices, cars and aircraft nobody can merge without safety evidence. That's the bottleneck.
>
> We built a Safety Gate for Software Factory. A Work Order comes in. A Safety Analyst maps it to hazards. Claude Code writes the change in its own worktree. Then two deterministic checks: the tests behind every affected safety requirement, and a world model that runs the real C code in ten simulated diabetic patients. Fail, and the report goes back to the agent. Pass, and the PR ships with a full evidence pack.
>
> No LLM decides approval. Tests and physics do. That's how agents ship into regulated industries.

## 3. Thirty-second elevator version (about 75 words)

> Agents can change an insulin pump in seconds. Nobody can merge it without safety evidence. We built the Safety Gate for 8090's Software Factory: every agent change is mapped to the hazards it touches, then checked by the tests behind each safety requirement and by running the real code in simulated patients. Fail, it goes back to the agent. Pass, the PR ships with its evidence pack. No LLM decides. Tests and physics do.

---

## 4. Who says what

| Part | Who | Why |
|---|---|---|
| Hook, problem, "why it matters", close | **Abhishek** | Safety lead; built the world model and evidence pack; this is the CertusAI voice Chamath should remember |
| D1 to D4 demo narration, driving the laptop | **Murali** | Built the runner, SF link and PR publishing; knows the run path cold |
| Handoff | A says "Murali." M starts on the first word, no "thanks" | Saves 3 s |
| Q&A: Software Factory, runner, PRs, latency, scale, agent behavior | **Murali** | |
| Q&A: hazards, standards, world model, regulatory validity, CertusAI, business | **Abhishek** | |
| Failure call (switch to replay) | **Murali** decides, says nothing about it; **Abhishek** keeps talking | See section 6 |

Rule: one voice at a time. The person not speaking looks at the screen, not the judges.

---

## 5. Judge Q&A (15)

1. **How do you map a diff to requirements?** (M) `safety.json` links each requirement to files, symbols and a test. Any changed file or changed line naming a symbol triggers it. We over-approximate on purpose, so every pump change runs every pump requirement's test. A tree-sitter call graph to tighten it is the next step.

2. **Why not just Drift Bot?** (A) Drift Bot is an LLM reading the PR against the Blueprint. That's an opinion. We execute: requirement tests plus the code running in simulated patients. They're complementary: we'd sit next to `drift-bot` as a second status. That status isn't built yet.

3. **Is there an LLM in the approval path?** (A) No. LLMs plan, write code and suggest hazards. Approval comes only from exit codes of the requirement tests and the world model, both deterministic.

4. **Can the agent cheat by editing the tests?** (M) No. Any diff that touches `safety.json`, `test_*.c`, `gate/` or `sim/` is blocked, and the gate reads the safety spec from the trusted checkout, not the agent's worktree.

5. **What did the real agent do with the unsafe ticket?** (M) When we gave Claude Code the bare "larger bolus" ticket, it refused to raise the cap and asked for a human decision on SR-1. With the Safety Analyst's guidance, it built the extended bolus and passed on the first attempt. The blocked patch in the demo is the obvious patch, scripted, with real verdicts.

6. **How does it connect to Software Factory?** (M) Through SF's External REST API: the runner fetches the Work Order by number, sets In Progress, opens the PR with `WO-xx` in the title, links it, and sets In Review, or Blocked if it never passes. Next step: trigger it from an SF Automation on WO → Ready.

7. **Is the simulator credible?** (A) simglucose is an open-source version of the UVA/Padova type 1 diabetes model. The FDA accepted the original simulator in 2008 as a substitute for animal trials in preclinical closed-loop testing. Ours is the open reimplementation, so it's a credible model, not a qualified tool.

8. **Would a regulator accept this evidence?** (A) The structure matches what IEC 62304 change control and ISO 14971 traceability ask for: hazard, requirement, test, result, who changed what. To submit it, the tool would need qualification and a human still signs. We automate the evidence, not the accountability.

9. **What if a change touches code no requirement covers?** (A) The Safety Analyst proposes a new hazard for human review, like H-6 for stacked extended boluses in our WO-101 run. The world model also flags risk that already exists on main as a new hazard ticket, not as this change's fault.

10. **How long does it take?** (M) Gate: under a second. World model: about 20 seconds on a laptop (10 patients, 12 simulated hours, candidate and main). The coding agent takes a few minutes. That's a fraction of the weeks a manual review takes.

11. **What if the live demo fails?** (M) The gate and world model are deterministic, so a recorded run is the same run. We switch to it. LLM steps also have deterministic fallbacks, so the pipeline still finishes offline.

12. **How does it scale?** (M) Each Work Order gets its own git worktree, and checks are a plug-in list in `checks.json`. Simulated patients are independent, so they parallelize. The hard part of scaling is a world model per device, not compute.

13. **Does this generalize beyond insulin pumps?** (A) The gate is device-agnostic: any `safety.json` plus tests. The world model is per device: a vehicle sim for ISO 26262, a claims engine for CMS rules. Same contract: run the candidate, compare it to main, block on new harm.

14. **Is that real pump firmware?** (A) No. It's a small C controller we wrote for the demo, with real clinical limits. The point is the loop: real compiled code deciding every dose in a physiological model, not a mock.

15. **Business: what's this to 8090?** (A) 8090 traces software intent. My company CertusAI traces safety evidence: living hazard analysis for IEC 62304 and ISO 26262, replacing DOORS and Jama. This is the bridge: Software Factory for the regulated half of your customer list.

---

## 6. Rehearsal drill

### Pre-flight (T-15 min, every time)

- `demo/go.sh replay` ends with **READY** (~2 s warm, ~30 s in a fresh worktree). It starts the server in replay mode, seeds a draft work order and warms everything. `demo/go.sh check` re-checks any time.
- The stage demo is replay only: no live runs, no LLM calls on stage.
- `python3 gate/sf.py health` returns OK if we show the SF beat. If not, cut the SF sentence.
- Tabs open in this order: (1) Home `localhost:8787/?demo#/p/insulin-pump-firmware/overview` (`?demo` skips the sign-in page), (2) hosted backup https://certus-factory-ten.vercel.app, (3) backup video, (4) PR #30 page.
- Type exactly `Raise the single-bolus limit to 25 U` in the Home composer (any text plays the same recording).
- Font size up, notifications off, phone on silent, laptop on power.

### Three timed run-throughs

| Run | Goal | Pass criteria |
|---|---|---|
| **1. Full run, stopwatch** | Find real timings | Under 3:00. Write down every mark from the timing table |
| **2. Forced failure** | Practice the switch | Partner kills the server at D2 without warning. Hosted backup tab is up in under 3 s, narration never stops, no apology |
| **3. Final pace + Q&A** | Lock it | Under 2:50. Then 5 minutes of rapid-fire Q&A from section 5, partner picks at random, every answer under 15 s |

After each run: one change only, then go again.

### What to cut if over time (in this order)

1. "Today that evidence is weeks of manual traceability in DOORS and Jama." (−5 s)
2. The hazard list in D1 ("overdose, daily overdose, low blood sugar"). (−3 s)
3. "It also flags two patients who already crash on main" in D4. (−6 s)
4. Customer list sentence in "why it matters". (−6 s)
5. The decimal-slip explanation in D2: keep only "Four patients crash below 54." (−8 s)

Never cut: the hook, BLOCKED on screen, green on screen, "No LLM decides approval," the close.

### Failure plan if the live demo stalls

- **Trigger:** nothing visibly moves for 5 s, or any error on screen.
- **Action:** Murali switches to tab 2 (hosted backup, same pages, read-only) or tab 3 (video). No comment on the switch.
  The hosted backup holds the 25 U run as WO-345 (Approved, both BLOCKED attempts in Activity) but only its end
  state, and on the older UI until `demo/deploy.sh` is re-run, so prefer the video for D2-D3.
- **Line (only if someone asks):** "This is the same run, recorded earlier. The checks are deterministic, so it's identical." Then keep going from the same beat.
- **Never:** apologize, debug on stage, retype a command, say "it worked earlier."
- If the projector dies: Abhishek gives the 60-second version from memory, then goes straight to Q&A.

---

## 7. Demo video script (about 2:50, replay only)

One continuous screen recording of `localhost:8787` running `demo/go.sh replay` (no live runs, no LLM calls), plus a
title and an end card. Voice: Abhishek. Calm, slow. The clicks and the measured timings are in
[DEMO.md](DEMO.md) ("Click path"); times below are from the same measurement (Enter at 0:22).

**Honesty rules for the edit.** The 25 U work order replays the recorded real run WO-304; the UI says so in small
grey text ("replayed from real run WO-304 · Nov 14, 2:45 AM"): leave it visible. Attempt 1's patch is scripted
(`demo/obvious_patch.sh`): say "here's the obvious patch", never "the agent wrote this". Lower-third at 0:32:
*"Recorded real run. Attempt 1 patch scripted; gate, world model and attempts 2-3 are real."* Supply and finance
numbers are sample data; Boeing is not a customer ("Boeing asked CertusAI about DO-254" at most). The Rust gate is
"tested against 40,000 generated cases", never "proven".

| Time | Screen | Say |
|---|---|---|
| 0:00-0:05 | Title card: "Certus Factory: agents write the change, deterministic checks decide if it ships" | (music only) |
| 0:05-0:22 | Sign in → **Enter demo workspace** → **Insulin Pump Firmware** → Home; type `Raise the single-bolus limit to 25 U`, Enter at 0:22 | "This is a one-line change to an insulin pump: raise the max dose from 10 units to 25. An agent can write it in seconds. In medical devices, nobody may merge it without safety evidence." |
| 0:22-0:32 | Work order opens; Context recalls from HydraDB; Hazard analysis "breaks SR-1" | "The factory recalls what the organization knows from HydraDB, and the Safety Analyst maps the request to hazards. It already sees it breaks SR-1." |
| 0:32-1:10 | **BLOCKED**; scroll to "15 g snack, dose typed 10x" (4 / 10) and **SR-1 FAIL** | "Here's the obvious patch. The gate runs the test behind every requirement it touches: SR-1 fails. Then the simulation runs the real compiled C code in ten virtual patients. A dose typed ten times too big is now delivered. Four patients crash below 54. Blocked. The verdict comes from a small Rust checker, tested against 40,000 generated cases. No LLM decides." |
| 1:10-1:34 | "Attempt 2: BLOCKED"; scroll up to "120 g meal, correct dose" (2 / 10), all 5 tests PASS | "The report goes back to Claude Code, in its own worktree. It keeps the 10 unit cap and spreads big meals over time. Every unit test passes, and the world model still catches two patients crashing hours later. Blocked again." |
| 1:34-1:52 | **Approved**; **Code change** (`MAX_EXTENDED_U 15.0`), Esc; **Evidence**, Esc | "Capped at 15 units, everything passes: five requirement tests, zero new severe lows. It ships with its evidence pack: hazards, requirement to test, every simulated patient. No pass, no PR." |
| 1:52-2:12 | **World model loop**; Play **Before** (No alarm, LOW GLUCOSE, URGENT LOW), Play **After** (BOLUS EXCEEDS LIMIT); loop strip | "This is the difference you can hear. Before: the pump takes the typo silently, and hours later, urgent low. After: it refuses the dose. The world model found the failure, diagnosed it down to SR-1 and the line of code, sent it to the coder, and re-ran it until it passed. Alarms come from the trace by code; the voices are ElevenLabs." |
| 2:12-2:24 | **Traceability** → **Graph** → click **H-1** | "Every hazard traces to its requirement, the code, the test, the simulated patients and the work orders that touched it." |
| 2:24-2:36 | **Boeing Flight Controls** → **Incidents** → **Recorded sample call** → **Play recorded call**, Stop after ~8 s | "Boeing asked CertusAI about DO-254, so the same factory runs flight controls. Safety reports come in by voice: a pilot calls our ElevenLabs hotline, and the report becomes a traced work order and a hazard link." |
| 2:36-2:45 | **Control Tower** | "One view of software, safety, suppliers and spend. Supplier data here is sample data." |
| 2:45-2:52 | User menu → **Integrations** → **Test connection** on Certus Factory as an MCP server | "And any agent, in Claude Code or Cursor, can ask the factory for a trace or a verdict over MCP." |
| 2:52-2:55 | End card: "Approval is never an LLM decision." | "Agents write the change. Tests and physics decide if it ships. Certus Factory." |

If over time, cut the Control Tower (2:36-2:45) first, then the Evidence click. Never cut BLOCKED, Approved, or the World model loop.
