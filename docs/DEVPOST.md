# Certus Factory: Devpost submission

**Tagline:** A software factory for safety-critical code. Agents write the change; deterministic tests and simulated patients decide whether it ships.

Repo: https://github.com/Abhishek21g/evolve-factory · Hosted backup (read-only): https://certus-factory.vercel.app

## Inspiration

Coding agents can change an insulin pump in seconds. In medical devices, cars and aircraft, nobody can merge that change without safety evidence: which hazards it touches, which requirements cover them, which tests prove they still hold. Today that evidence is weeks of manual traceability work. Speed isn't the bottleneck. Proof is.

8090's Software Factory traces every change back to intent: requirements, blueprints, work orders. CertusAI (our startup) traces safety evidence: hazards, requirements and tests under IEC 62304 and ISO 14971. We wanted the stage between them: before an agent's change can merge, it has to prove it is safe, and the proof can't come from another LLM's opinion.

## What it does

You type what you want into one box on Home ("What should we work on?") and pick **Build** or **Simulate**.

**Build** turns the request into a work order (`WO-n`) and runs an agent team on it:

1. **Context layer** recalls related org memory: tickets, meeting notes, chats, emails, code notes and past runs.
2. **Safety Analyst** (LLM) maps the request to hazards and safety requirements in `demo/pump/safety.json` (for example H-1 "insulin overdose" and SR-1 "single bolus never exceeds 10 U"), gives the coding agent guidance, and can propose a new hazard for a human to review.
3. **Claude Code** implements the change headless in its own git worktree.
4. **Deterministic gate**, with no LLM involved:
   - **Protected files:** blocks any diff that touches `safety.json`, the safety tests, `gate/` or `sim/`. The safety spec is always read from the trusted checkout, not the agent's worktree.
   - **Requirement tests:** maps the diff to every requirement whose files or symbols it touches and runs that requirement's C unit test.
   - **World model:** compiles the candidate's actual `pump.c`, puts it in the loop with 10 simulated type 1 diabetic adults (simglucose, UVA/Padova), runs a large-meal scenario and a 10x dose-typo scenario for 12 simulated hours, and blocks if any patient falls below 54 mg/dL who didn't on `main`. Risk that already exists on `main` is reported separately as a new hazard, not blamed on the change.
5. If the change is blocked, the report goes back to the agent, which tries again (up to three attempts in total).
6. Every run writes an **evidence pack**: hazards in scope, a requirement-to-test matrix, every simulated patient's result, and the org context the agent used. A pull request is only opened if all checks pass.

**Simulate** answers a what-if question in plain English ("What if a child eats 80 g and the parent types the dose 10x?"). The Simulation Agent turns it into scenarios and the world model runs them on the current firmware. Every number in the answer comes from a simulation.

The demo run: the request "Raise the single-bolus limit to 25 U".

- Attempt 1 is the obvious one-line patch (`MAX_BOLUS_U 10 -> 25`). It's scripted, because Claude Code wouldn't write it. SR-1 fails, and the world model shows 4 new severe-hypoglycemia runs. **Blocked.**
- Attempt 2 is Claude Code's extended bolus (10 U/h). It passes all 5 unit tests, but 2 simulated patients crash hours after a large meal. **Blocked.**
- Attempt 3 is Claude Code capping the extended total. 5/5 tests pass and there are 0 new severe lows, so the change is **approved**, with an evidence pack and a real PR ([#30](https://github.com/Abhishek21g/evolve-factory/pull/30)).

Other pages:

- **Agents:** the team and what each agent is doing.
- **Memory:** search and add org memory.
- **Work Orders:** each order with its full run.
- **Requirements:** the hazard log.
- **World Model:** blood-glucose traces.
- **Traceability:** a graph from hazard to requirement to test to work order.
- **Audit trail:** who (human or agent) did what.

## How we built it

- **Claude Code (Anthropic).** It's the coding agent in the loop: `gate/runner.py` runs `claude -p` in a fresh git worktree per work order, retries with the gate report when blocked, and opens the PR with `gh` when the checks pass. The Safety Analyst and the Simulation Agent are Claude calls too (`claude -p`, with a deterministic fallback if the call fails). `sim/agent.py` is a standalone Simulation Agent on the Anthropic API with tool use. We also used Claude Code and Cursor to build the project.
- **8090 Software Factory.** The app follows Software Factory's model: a project with requirements, work orders with `WO-n` IDs, traceability and an audit trail. `gate/sf.py` talks to Software Factory's External REST API (not MCP). It fetches a work order, sets it to In Progress, links the PR, then sets In Review, or Blocked if the gate never passes. That path is `gate/runner.py --wo WO-n --pr`. The web UI keeps its own local work-order store.
- **simglucose** (open-source UVA/Padova type 1 diabetes simulator). This is the world model. `sim/shim.c` binds the candidate's compiled `pump.c` through `ctypes` and steps it once per simulated minute, so the code under review decides every dose. It's deterministic: fixed cohort, fixed scenarios, no sensor noise. Patients run in parallel, one process per CPU.
- **HydraDB.** `factory/memory.py` uses HydraDB as the org-memory context layer (ingest plus semantic recall) when `HYDRADB_API_KEY` is set. Without a key, or if a HydraDB call fails, it falls back to a local JSONL store with keyword scoring. The recorded demo run used the local fallback. The org memory is example data we wrote for the demo (`factory/seed_memory.jsonl`).
- **Composio.** `factory/actions.py` runs after each work order when `COMPOSIO_API_KEY` is set. It can file a GitHub issue for pre-existing risk the world model found, and post the verdict to Slack. Only a fixed allow-list of tools is executed. It needs a one-time account connection (`factory/actions.py connect`). The recorded demo run didn't use it.
- **Vercel.** It hosts a read-only snapshot of a recorded run at https://certus-factory.vercel.app (`demo/deploy.sh`), our stage backup.
- **Stack.** Python stdlib server (`factory/server.py`), a static Next.js 15 / React 19 / Tailwind 4 UI, a C pump controller with `make`, and git worktrees.
- **Always live.** `demo/go.sh replay` plays a recorded real run with the gaps compressed (about 70 s), so nothing on stage waits on an LLM. In live mode, a request that has already run answers instantly from its cached real run.

## Challenges we ran into

- **The agent wouldn't write the unsafe patch.** Given the bare "25 U" ticket, Claude Code refused to raise the cap and asked for a human decision on SR-1. Good behavior, but it broke our "gate catches the agent" beat. We now apply the obvious patch with a script, label it as scripted on screen, and let real Claude Code do the fixes.
- **Unit tests weren't enough.** The agent's first extended bolus passed every requirement test, but in simulation it caused severe lows about 11 hours after the meal. Our world model watched 6 hours and missed them. We extended the window to 12 hours and parallelized patients to keep it around 20 s.
- **Keeping the C code honest in the loop.** We had to pin a stable pump interface (`pump.h` plus the extended-bolus hooks) so that every candidate compiles against the same contract and "insulin delivered" is whatever the code records.
- **Stopping agents from gaming the gate.** We added protected-file checks, and made the gate read the spec, tests and checks from the trusted checkout.
- **Live demos and LLM latency.** A real work order takes 2.5 to 3.5 minutes. We built replay from recorded runs, a per-request cache, and a pre-warm and health check (`demo/go.sh`) so the stage never shows a spinner.

## Accomplishments that we're proud of

- No LLM is in the approval path. Exit codes from requirement tests and the world model decide.
- The blocked-then-fixed run is real. Claude Code's first fix was caught by physics, not by a unit test.
- The world model runs the actual compiled candidate code, not a mock or a model of the code.
- Every change has an evidence pack that traces request to hazard to requirement to test to simulated patient to PR.
- We filed real PRs from the factory itself, with `WO-n` titles (for example [#17](https://github.com/Abhishek21g/evolve-factory/pull/17) and [#30](https://github.com/Abhishek21g/evolve-factory/pull/30)).

## What we learned

- An LLM review is an opinion. A failing test in a simulated patient is evidence. The two are complementary, but only one belongs in the merge decision.
- Simulation finds failures that requirement tests don't, especially delayed ones, and the observation window matters as much as the scenario.
- Well-guided agents behave more safely than expected. The Safety Analyst's guidance changed what Claude Code built.
- For a live demo, recorded real runs plus caching beat trying to make LLM calls fast.

## What's next

- Trigger runs from a Software Factory Automation (work order moved to Ready), and post a `safety-gate` commit status next to Drift Bot.
- Make the gate a required GitHub check, so a blocked change can't be merged by hand.
- Run Claude Code and Codex in parallel worktrees and keep the best passing diff.
- Narrow diff-to-requirement mapping with a tree-sitter call graph (today it over-approximates on purpose).
- Add more world models per domain: a vehicle simulator for ISO 26262, and a claims engine for CMS rules. Same contract: run the candidate, compare it to `main`, block on new harm.

## Built with

python · c · typescript · next.js · react · tailwind-css · claude-code · anthropic-api · 8090-software-factory · simglucose · numpy · pandas · scipy · hydradb · composio · vercel · git · github-cli · make
