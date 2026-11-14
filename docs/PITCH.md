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
| HydraDB memory, Composio GitHub/Slack actions | **Wired**, used only if keys are set; recorded replay ran on local fallback | Mention only if the status bar shows them live. |
| Org memory (tickets, meetings, Slack, email) | **Example data** written for the demo (`factory/seed_memory.jsonl`) | "Example org memory." |
| Pump code | **Demo controller** (~45 lines of C, "not a medical device") | "A small pump controller in C." Never say "real pump firmware." |
| ISO 26262 | **Not in code** (IEC 62304 / ISO 14971 only) | CertusAI / roadmap only. |
| Hosted backup site | **Public** at https://certus-factory.vercel.app: read-only snapshot of a recorded run, Run disabled, first paint ~0.3 s | Backup only. Demo from `localhost:8787` (`demo/go.sh replay`). |
| Tree-sitter call graph | **Not built** | Q&A: "next step." |

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

**[0:50] [DEMO D2] The obvious patch. Screen: SR-1 FAIL, World model BLOCKED: 4 new (holds 30 s).**

> M: Here's the obvious patch: bump the cap to 25. The Safety Gate runs the test behind every requirement the diff touches. SR-1 fails. Blocked.
>
> M: Then the world model. We compile the candidate's actual C code and put it in the loop with ten simulated type 1 diabetics. A patient means to type 1.5 units and types 15. On main, the pump rejects it. With this patch, it delivers it. Four patients crash below 54. Blocked.

**[1:20] [DEMO D3] The fix. Screen: "Attempt 2", then at 1:28 BLOCKED again with all 5 tests PASS (holds 15 s), "Attempt 3" at 1:42.**

> M: Blocked work goes back to the agent with the report. Claude Code, in its own worktree, keeps the 10 unit cap and delivers big meals as an extended bolus, never faster than 10 units an hour. Every unit test passes. The world model blocks it anyway: two patients crash hours after a big meal. So the agent caps the extended bolus at 15 units. It can't touch the tests or the hazard log.

**[1:52] [DEMO D4] Green. Screen: Approved; click Code change, Evidence, Pull request (PR #30).**

> M: All five requirement tests pass. World model: zero new hypoglycemia. It also flags two patients who already crash on main: a new hazard for a human to review.
>
> M: Every change ships with an evidence pack: hazards, requirement to test, every simulated patient, and the context the agent used. No pass, no PR. On pass, the PR goes up with the matrix and the Software Factory Work Order moves to In Review.

*The stage replay shows the **Pull request** button (real PR #30), so "No pass, no PR" holds. Say the Software Factory "In Review" clause only if the SF board is on screen; otherwise stop after "the PR goes up with the matrix."*

**[2:20] Why it matters. A.**

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
| D3 BLOCKED again on screen | 1:28 | (set by the replay) Drop "Every unit test passes." |
| D4 green on screen | 1:52 | (set by the replay) Drop the "already crash on main" line. |
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

> Agents can change an insulin pump in seconds. Nobody can merge it without safety evidence. We built the Safety Gate for 8090's Software Factory: every agent change is mapped to the hazards it touches, then proven by the tests behind each safety requirement and by running the real code in simulated patients. Fail, it goes back to the agent. Pass, the PR ships with its evidence pack. No LLM decides. Tests and physics do.

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

Bonus if asked "what did you build tonight vs before": everything in the repo was written during EVOLVE (see README "Built before the event"). No CertusAI code is used.

---

## 6. Rehearsal drill

### Pre-flight (T-15 min, every time)

- `demo/go.sh replay` ends with **READY** (~2 s warm, ~30 s in a fresh worktree). It starts the server in replay mode, seeds a draft work order and warms everything. `demo/go.sh check` re-checks any time.
- The stage demo is replay (no LLM on stage). Live (`demo/go.sh live`) needs `claude` logged in or `ANTHROPIC_API_KEY` in `.env`.
- `python3 gate/sf.py health` returns OK if we show the SF beat. If not, cut the SF sentence.
- Tabs open in this order: (1) Home `localhost:8787/#/p/insulin-pump-firmware/overview`, (2) hosted backup https://certus-factory.vercel.app, (3) backup video, (4) PR #30 page.
- Type exactly `Raise the single-bolus limit to 25 U` in the Home composer (any text plays the same recording).
- Font size up, notifications off, phone on silent, laptop on power.

### Three timed run-throughs

| Run | Goal | Pass criteria |
|---|---|---|
| **1. Full live, stopwatch** | Find real timings | Under 3:00. Write down every mark from the timing table |
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
  Until `demo/deploy.sh` is re-run, the hosted backup shows the older runs (WO-101 Approved, WO-102 Blocked), not
  the block beat, so prefer the video for D2-D4.
- **Line (only if someone asks):** "This is the same run, recorded earlier. The checks are deterministic, so it's identical." Then keep going from the same beat.
- **Never:** apologize, debug on stage, retype a command, say "it worked earlier."
- If the projector dies: Abhishek gives the 60-second version from memory, then goes straight to Q&A.

---

## 7. Backup demo video: narration (2:00)

Record from the real run (gate and world model verdicts are real). Voice: Abhishek. Calm, slow. Each cue is one shot.

| Time | Shot | Narration |
|---|---|---|
| 0:00–0:10 | `pump.h`, the `MAX_BOLUS_U 10.0` line highlighted, edited to `25.0` | "One line. Raise the insulin pump's max dose from 10 units to 25 so adults can cover a big meal." |
| 0:10–0:20 | Work Order view: "Raise the single-bolus limit to 25 U" | "It starts as a Work Order. The factory picks it up and assigns a team of agents." |
| 0:20–0:32 | Safety Analyst lane: H-1, H-2, H-3, SR-1 to SR-3 | "The Safety Analyst maps it to hazards: overdose, daily overdose, low blood sugar." |
| 0:32–0:45 | Gate matrix, SR-1 row red, **BLOCKED** | "The obvious patch goes to the Safety Gate. It runs the test behind every affected requirement. SR-1 fails. Blocked." |
| 0:45–1:02 | World model chart: four traces dropping under the 54 line, grey main traces flat | "Then the world model. The actual C code runs in ten simulated diabetic patients. A dose typed ten times too big used to be rejected. Now it's delivered. Four patients crash. Blocked." |
| 1:02–1:18 | "Attempt 2: BLOCKED": all 5 tests PASS, "120 g meal, correct dose" chart with 2 late crashes; then **Code change**: `request_extended_bolus`, `MAX_EXTENDED_U 15.0` | "Claude Code keeps the 10 unit cap and delivers big meals slowly. Its first try passes every test, and two patients still crash hours later. Blocked again. So it caps the extended bolus at 15 units." |
| 1:18–1:32 | **Approved**: "all checks passed", world model "PASS: 0 new" | "All five requirement tests pass. Zero new hypoglycemia across every simulated patient." |
| 1:32–1:48 | Evidence pack scrolling: hazard analysis with the proposed new hazard, requirement -> test table, world model table | "Every change ships with its evidence pack: hazards, requirement to test, every patient, and a new hazard proposed for a human." |
| 1:48–2:00 | PR #30 page (`WO-304` title, checks report); SF Work Order In Review only if recorded live | "No pass, no PR. Tests and physics decide, not an LLM. Safety Gate, for Software Factory." |

If the PR and SF In Review shots weren't captured from a real `runner.py --pr` run, end on the evidence pack and say: "Tests and physics decide, not an LLM. Safety Gate, for Software Factory." Don't show a PR we didn't open.
