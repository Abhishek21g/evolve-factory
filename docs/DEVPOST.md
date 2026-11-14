# Certus Factory: Devpost submission

**Tagline:** A software factory for safety-critical code. Claude is the builder; we're the inspector. Deterministic tests and simulation decide whether a change ships.

Repo: https://github.com/Abhishek21g/evolve-factory · Hosted backup (read-only): https://certus-factory-ten.vercel.app

Demo video: (link coming)

## Inspiration

Coding agents can change an insulin pump or a flight control law in seconds. In medical devices, cars and aircraft, nobody can merge that change without safety evidence: which hazards it touches, which requirements cover them, which tests show they still hold. Today that evidence is weeks of manual traceability work. Speed isn't the bottleneck. Evidence is.

8090's Software Factory traces every change back to intent: requirements, blueprints, work orders. CertusAI (our startup) traces safety evidence: hazards, requirements and tests under IEC 62304, ISO 14971 and, next, aerospace standards. Boeing asked CertusAI about DO-254, and mentors asked to see the factory on aerospace software. We wanted the stage between intent and evidence: before an agent's change can merge, it has to pass deterministic safety checks, and the verdict can't come from another LLM's opinion.

## What it does

You sign in (or open the app with `?demo` to enter the demo workspace) and pick a project. There are two: **Insulin Pump Firmware** and **Boeing Flight Controls**, an aerospace demo project (Boeing asked CertusAI about DO-254; Boeing is not a customer and none of this is Boeing code or data). Then you type what you want into one box on Home ("What should we work on?") and pick **Build** or **Simulate**.

**Build** turns the request into a work order (`WO-n`) and runs an agent team on it:

1. **Context layer** recalls related org memory from HydraDB: tickets, meeting notes, chats, emails, code notes and past runs.
2. **Safety Analyst** (LLM) maps the request to hazards and safety requirements in the project's `safety.json`, gives the coding agent guidance, and can propose a new hazard for a human to review.
3. **Claude Code** implements the change headless in its own git worktree.
4. **Deterministic gate**, with no LLM involved. The final verdict comes from a small Rust binary (`#![forbid(unsafe_code)]`, tested against 40,000 generated cases; a Python reference must agree with it on every recorded run):
   - **Protected files:** blocks any diff that touches the safety spec, the requirement tests, the coding rules, `gate/` or `sim/`. The spec is always read from the trusted checkout, not the agent's worktree.
   - **Requirement tests:** maps the diff to every requirement whose files or symbols it touches and runs that requirement's C test.
   - **World model:** compiles the candidate's actual C code, runs it in simulation, and blocks if it causes harm that `main` doesn't. Risk that already exists on `main` is reported as a new hazard, not blamed on the change.
5. If the change is blocked, the report goes back to the agent, which tries again (up to three attempts in total).
6. Every run writes an **evidence pack**: hazards in scope, a requirement-to-test matrix, every simulated run, and the org context the agent used. A PR is only opened if all checks pass. After the verdict, Composio files the evidence pack as a GitHub issue in the background.

**Simulate** answers a what-if question in plain English ("What if a child eats 80 g and the parent types the dose 10x?"). The Simulation Agent turns it into scenarios, and the world model runs them on the current code. Every number in the answer comes from a simulation.

**The two projects:**

- **Insulin pump.** A small C controller (not a medical device). Hazards include H-1 "insulin overdose", covered by requirements like SR-1 "single bolus never exceeds 10 U", with IEC 62304 / ISO 14971 framing. The world model is simglucose: 10 virtual type 1 diabetic adults per cohort. The gate runs a large meal and a 10x dose typo for 12 simulated hours, and blocks if anyone newly falls below 54 mg/dL.
- **Boeing Flight Controls.** AoA stall protection in C, written at the hackathon (not flight software, not Boeing data). Hazards H-1..H-5 carry severity, DAL and a probability budget, as in an ARP4761 FHA. Requirements SR-1..SR-5 are DAL A/B, with DO-178C objectives. Standards context (Part 25, ARP4754A, ARP4761, DO-178C, DO-254) is in `docs/BOEING.md`. The world model is a plain-Python longitudinal flight model with the candidate's `fcc.c` in the loop: 3 scenarios on 6 aircraft configs, blocking on any new stall or altitude-loss exceedance.

**Stage runs** (recorded from real runs, and replayable):

- **Pump: "Raise the single-bolus limit to 25 U".**
  - Attempt 1 is the obvious one-line patch (`MAX_BOLUS_U 10 -> 25`). It's scripted, because Claude Code wouldn't write it. SR-1 fails, and 4 simulated patients newly crash below 54 mg/dL. **Blocked.**
  - Attempt 2 is Claude Code's extended bolus. It passes all 5 tests, but 2 patients crash hours after a large meal. **Blocked.**
  - Attempt 3 is Claude Code capping the extended total. 5/5 pass and there are 0 new severe lows, so it's **approved** ([PR #30](https://github.com/Abhishek21g/evolve-factory/pull/30)).
- **Aircraft: "Add AoA disagree alert when the two sensors differ by more than 5 degrees".**
  - Attempt 1 is the obvious patch: it reuses the certified 5.5 deg AoA monitor and lowers it to 5 deg. It's scripted. SR-3 fails, and the world model shows all 6 aircraft stall in a sideslip approach, because the protection switches off. **Blocked.**
  - Attempt 2 is Claude Code adding a separate, alert-only 5 deg threshold. 5/5 pass and there are 0 new exceedances, so it's **approved** ([PR #41](https://github.com/Abhishek21g/evolve-factory/pull/41)).

**World model vs simulation.** The simulation is the physics (simglucose patients, a 737-class flight model) running the candidate's compiled code. The world model is the layer on top: it finds where a run left the safe envelope and diagnoses it from the trace and the code (which requirement and hazard, when, through which causal chain, which code lines), sends that to the coding agent, and re-simulates the fix. The **World Model** page shows that loop, and "Hear the pump / cockpit: before vs after" plays the alarms or cockpit callouts of the failing and the fixed run: events derived from the trace by code, voiced by ElevenLabs.

**Monitoring agents** (Automations) keep checking after merge, deterministically: a reliability monitor re-runs the simulation suite and every requirement test on `main`, a requirements drift monitor resyncs the **Source of Record** (`safety.json` as the single source of truth, checked against tests, code values, trace links and simulation evidence), a nightly fault-injection runner flies adversarial scenarios from the certified limits, and a supplier compliance monitor checks certificates and deliverables.

**Safety hotline** (Incidents). An ElevenLabs voice agent takes an incident report; its `create_incident` tool turns the call into a draft work order, a HydraDB memory item and a trace link to the most likely hazard. A real recorded call plays on the Boeing project.

**Supply chain and finance** (Control Tower, Supply Chain with its suppliers, Finance) run on **sample data, labelled as such in the UI**: supplier tiers, certificates and deliverables, parts, raw materials and imports with risk flags, spend vs budget. A supplier deliverable that gets submitted becomes a real trace link in the evidence pack. The Control Tower shows every project's software, safety, supply and finance status in one deterministic sentence.

**Integrations.** Connected tools, a Composio plugin catalog with real Connect links, and MCP servers you can add and test. Certus Factory is itself a read-only MCP server (`list_projects`, `get_trace`, `get_verdict`, `list_gaps`, `recall_memory`) for Claude Code, Cursor or any MCP client, over stdio or HTTP.

**Other pages:**

- **Simulations:** real charts for every simulated run. For the pump, each virtual patient's glucose trace is shown, with candidate and `main` side by side, the 70–180 mg/dL target band, and the 54 and 250 lines. The page also shows the insulin the pump code actually delivered, and pass/fail per patient. The verdict matches the gate's. For the aircraft, the same view shows AoA traces against the stall line.
- **Agents:** a working team view. Each agent has its own page with what it's doing now, a live log, its output, its skills and its history.
- **Memory:** search and add org memory.
- **Work Orders:** each order with its full run.
- **Requirements:** the hazard log.
- **Traceability:** a matrix and a graph per project, regulation clause → hazard → requirement → code lines → test → simulation scenario → work order → evidence. Code opens at the exact lines, docs at the section; people add and remove links; gaps are flagged red.
- **Audit trail:** who (human or agent) did what.

## Why not just Claude Code?

Claude is the builder; we're the inspector. Claude Code writes good code, but in a regulated domain the question isn't whether the code looks right. It's whether it passes the safety checks, with evidence an auditor can read. The factory wraps Claude Code in four things it can't provide for itself:

- **A deterministic gate it can't talk past.** Requirement tests and exit codes decide. The agent can't edit the tests, the safety spec or the gate.
- **Simulation evidence before merge.** The candidate's real compiled code runs in simulated patients or aircraft.
- **Traceability** from request to hazard to requirement to test to simulated run to PR.
- **An evidence pack** for every change, including the blocked ones.

In the pump run, Claude Code's own first fix passed every unit test and was still blocked by the simulation.

## How we built it

- **Claude Code (Anthropic).** It's the coding agent in the loop: `gate/runner.py` runs `claude -p` in a fresh git worktree per work order. It gets per-project coding rules, retries with the gate report when blocked, and opens the PR with `gh` when the checks pass. The Safety Analyst and the Simulation Agent are Claude calls too, each with a deterministic fallback if the call fails. `sim/agent.py` is a standalone Simulation Agent on the Anthropic API with tool use. We also used Claude Code and Cursor to build the project.
- **8090 Software Factory.** The app follows Software Factory's model: projects with requirements, work orders with `WO-n` IDs, traceability and an audit trail. `gate/sf.py` talks to Software Factory's External REST API (not MCP). It fetches a work order, sets it to In Progress, links the PR, then sets In Review, or Blocked if the gate never passes. That path is `gate/runner.py --wo WO-n --pr`. The web UI keeps its own local work-order store.
- **HydraDB.** `factory/memory.py` keeps three collections: `org_memory` (tickets, meetings, chats, emails, code notes, hotline incidents), `regulatory_kb` (standards and each project's hazard log) and `factory_lessons` (one lesson per finished work order). The Context step and the Safety Analyst recall from it, the Plan step recalls lessons from similar past work orders, the Memory page searches it, and the MCP server's `recall_memory` tool uses it. On server start, local memory is seeded into HydraDB in the background. Recall gives up after 2 s and falls back to a local JSONL store for the next minute, so a network blip never stalls a run. Every finished run is written back to memory. The org memory is example data we wrote for the demo (`factory/seed_memory.jsonl`).
- **Composio.** After each verdict, `factory/actions.py` runs in its own process (fire-and-forget) and files the evidence pack as a GitHub issue through Composio's `GITHUB_CREATE_AN_ISSUE` tool. A recorded supplier deliverable is filed the same way. The verdict never waits on it, and a failure is reported without changing the verdict. The Integrations page's plugin catalog uses Composio Connect Links.
- **ElevenLabs.** A fixed catalog of short voice clips for pump alarms and cockpit callouts (committed, so any run plays instantly), and the safety hotline: an ElevenLabs Agents agent with one client tool, `create_incident`, run from the browser over WebRTC (`@elevenlabs/client`), so it works from a laptop with no public URL.
- **Rust.** `gate-rs/` decides PASS/BLOCKED from the check outcomes and returns a SHA-256 verdict digest. `#![forbid(unsafe_code)]`, no panics; property tests run it against 40,000 generated cases.
- **MCP.** `factory/mcp_server.py` exposes the safety record read-only over stdio and Streamable HTTP (`/mcp`).
- **simglucose** (open-source UVA/Padova type 1 diabetes simulator). This is the pump's world model. `sim/shim.c` binds the candidate's compiled `pump.c` through `ctypes` and steps it once per simulated minute, so the code under review decides every dose. It's deterministic: fixed cohort, fixed scenarios, no sensor noise. Patients run in parallel.
- **Flight world model** (`sim/flight.py`, plain Python). A 50 Hz longitudinal model with a stall break at 15 deg AoA and nacelle pitch-up, and two AoA vanes feeding the candidate's compiled `fcc.c`. It uses textbook-scale coefficients, not certification data.
- **Vercel.** It hosts a read-only snapshot of recorded runs at https://certus-factory-ten.vercel.app (`demo/deploy.sh`), our stage backup.
- **QA.** A Playwright suite (`web/qa/`) opens every page of both projects, clicks every button, tab and link (side effects answered by the test), and fails on console errors, failed requests, dead controls, layout overflow or one project's content leaking into the other.
- **Stack.** Python stdlib server (`factory/server.py`), a static Next.js 15 / React 19 / Tailwind 4 / shadcn UI, C code built with `make`, and git worktrees.
- **Always live.** `demo/go.sh replay` plays the recorded real runs with the gaps compressed, so nothing on stage waits on an LLM. In live mode, `go.sh` pre-warms every Home suggestion on the current pump code, and a request that has already run answers instantly from its cached real run.

## Challenges we ran into

- **The agent wouldn't write the unsafe patch.** Given the bare "25 U" ticket, Claude Code refused to raise the cap and asked for a human decision on SR-1. Good behavior, but it broke our "gate catches the agent" beat. We now apply the obvious patch with a script, label it as scripted on screen, and let real Claude Code do the fixes.
- **Unit tests weren't enough.** The agent's first extended bolus passed every requirement test, but in simulation it caused severe lows about 11 hours after the meal. Our world model watched 6 hours and missed them. We extended the window to 12 hours and parallelized patients to keep it around 20 s.
- **A world model that "always said PASS".** What-ifs compared the firmware with itself, so they reported PASS even with severe lows on screen. We now report SAFE/UNSAFE for what-ifs, record the insulin the code actually delivered, and draw it under the glucose traces, so the chart and the verdict always agree.
- **A second domain without a second factory.** Adding aerospace meant per-project specs, checks, coding rules, world models and replay recordings behind the same pipeline and gate, not a fork.
- **Stopping agents from gaming the gate.** We added protected-file checks, and made the gate read the spec, tests and checks from the trusted checkout.
- **Live demos and LLM latency.** A real work order takes minutes. We built replay from recorded runs, a per-request cache, pre-warm, and a health check (`demo/go.sh`), so the stage never shows a spinner. Sponsor calls run in the background with timeouts and fallbacks.

## Accomplishments that we're proud of

- No LLM is in the approval path. Exit codes from requirement tests and the world model decide, and a small Rust checker, tested against 40,000 generated cases, turns them into the verdict.
- The same gate and pipeline work on two very different safety domains: an insulin pump under IEC 62304, and flight controls under DO-178C / ARP4761.
- The blocked-then-fixed runs are real. Claude Code's first pump fix was caught by physiology, not by a unit test, and the half-degree aircraft patch was caught by a sideslip stall.
- The world models run the actual compiled candidate code, not a mock.
- Every change has an evidence pack that traces request to hazard to requirement to test to simulated run to PR.
- We filed real PRs from the factory with `WO-n` titles (for example [#17](https://github.com/Abhishek21g/evolve-factory/pull/17), [#30](https://github.com/Abhishek21g/evolve-factory/pull/30) and [#41](https://github.com/Abhishek21g/evolve-factory/pull/41)).

## What we learned

- An LLM review is an opinion. A failing test in a simulated patient or aircraft is evidence. The two are complementary, but only one belongs in the merge decision.
- Simulation finds failures that requirement tests don't, especially delayed ones (late lows) and coupled ones (sideslip plus a lowered threshold). The observation window matters as much as the scenario.
- Well-guided agents behave more safely than expected. The Safety Analyst's guidance changed what Claude Code built.
- For a live demo, recorded real runs plus caching beat trying to make LLM calls fast, and every external call needs a timeout and a fallback.

## What's next

- Trigger runs from a Software Factory Automation (work order moved to Ready), and post a `safety-gate` commit status next to Drift Bot.
- Make the gate a required GitHub check, so a blocked change can't be merged by hand.
- Run Claude Code and Codex in parallel worktrees and keep the best passing diff.
- Narrow diff-to-requirement mapping with a tree-sitter call graph (today it over-approximates on purpose).
- In aerospace: structural coverage (MC/DC), DO-330 tool qualification for the gate, and the DO-254 hardware side. None of these are claimed today.
- Add more world models: a vehicle simulator for ISO 26262, and a claims engine for CMS rules. Same contract: run the candidate, compare it to `main`, block on new harm.

## Built with

python · c · rust · typescript · next.js · react · tailwind-css · shadcn-ui · claude-code · anthropic-api · 8090-software-factory · mcp · simglucose · numpy · pandas · scipy · hydradb · composio · elevenlabs · vercel · playwright · git · github-cli · make
