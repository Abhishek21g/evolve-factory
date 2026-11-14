# EVOLVE: 8090 AI Hackathon — Brief + Game Plan

Team: Abhishek (GitHub `Abhishek21g`) + MuraliKrishna Inti (GitHub `Muralikinti`, approved on Luma Nov 10)
Sources: Luma page, organizer emails (Carina / Afifa / Vercel / Software Factory), 8090 docs, X.

## 0. DO NOW (on the plane, wifi)

1. **Vercel credits — time-sensitive.** Marc (Vercel) processes requests manually **tonight 6–9 PM PT only**. Go to credits.vercel.sh with the code from the Vercel email ("EVOLVE: redeem your $30 AI Gateway credits"), your EVOLVE email, and your Vercel **Team ID** (`team_...`, Settings → General). = $30 AI Gateway credits + Pro trial. Do not commit the code anywhere public.
2. **Hacker agreement** — both of us. Required for check-in. Link in Carina's "EVOLVE is tonight!" email. Make sure Murali signed too.
3. **Join Discord** (link in emails). Read `#🚀-evolve-start-here`. Rules, judging criteria, sponsor credits, judging slots, schedule all posted there — we missed the opening ceremony that covered them. Questions → `#evolve-help`.
4. **Late check-in:** you emailed Carina (Fri 3:08 PM) asking for late check-in — no reply yet. Also post in `#evolve-help` so staff expect us. Check-in officially closed 7:00 PM.
5. **Software Factory:** your account already exists (invite "Abhishek Enaguthi — EVOLVE Hackathon"). Log in at factory.8090.dev, make sure Murali is invited to the same org/project.
6. Murali GitHub = `Muralikinti` (found, mutual follow).

## 1. Event facts

| | |
|---|---|
| Address | **8090 HQ, 801 Jefferson Ave, Redwood City, CA** |
| Schedule | Check-in 5:30–7:00 PM · Opening ceremony 6:30 PM · hack overnight · ends Sat ~6:30–7:00 PM PST |
| Bring | **Government photo ID** (required), laptop, charger, adapters, headphones |
| Food | Dinner, late-night, breakfast, lunch |
| Overnight | Not required to stay. Building access may be limited overnight → **stay in or stay out**. Must be back for code freeze, judging, closing |
| Prizes | Top 3 share $10K+ (credits, Mac Minis, AirPods Max). 1st: 1:1 pitch(es) with Chamath |
| Ending | Live demos → judging → Q&A with 8090 technical staff; Chamath at ceremony |
| Sponsors | HydraDB, Composio, Vercel, ElevenLabs |
| Travel | No reimbursement (Carina confirmed) |
| Hosts | Carina Rastorgueva, Sahand Sojoodi, Afifa Siddiqua, Lei Wu (8090) |
| Size | ~86 going |

**Our arrival:** land 8:30–9:00 PM → venue ~9:45–10:15 PM. **~19h of build time left.**

## 2. Theme: "Build your own Software Factory"

Organizer prompts:
- Team of agents that takes a **ticket → pull request**
- Framework for **coordinating autonomous coding agents**
- Tools to **understand + modernize massive legacy codebases**

Chamath on X (Nov 13): pitch is "see what one person can do with a team of AI agents".

### 8090 Software Factory (we have access — use it)
Modules: **Requirements → Blueprints → Work Orders → Feedback**, all linked in a **Knowledge Graph**. Agents + **Drift Bot** flag when code/requirements no longer match. Also Knowledge Base, Skills, Automations, Codebase Connection (GitHub).

**It runs an MCP server** — this is the integration hook:

| | |
|---|---|
| URL | `https://api.factory.8090.dev/v2/mcp` |
| Header | `X-Sofa-Mcp-Project-Id: <project id>` |
| Auth | Browser OAuth |
| Clients | Cursor, Claude Code, Codex (setup tabs in Project Settings → Connections → Coding Agent) |

Agent loop it supports: list Work Orders → read linked Requirements/Blueprints → mark In Progress → implement → open PR with `WO-123` in title (auto-links) → mark In Review.
REST API also exists (docs.8090.ai/api-reference).

Their flagship story: CMS — 100K+ business rules extracted from 18M+ lines of COBOL, each traced to source line. Judges value **traceability, verification, governance**, not raw speed ("Control is the edge. Quality over speed.").

**Strategy:** don't rebuild Software Factory. Build the **autonomous engine underneath it**: SF holds intent (Requirements/Blueprints/Work Orders); our system pulls Work Orders over MCP, executes with a team of agents, verifies, and posts the PR + evidence back. Judges see their own product extended.

### Sponsor tools (pick 1–2 that fit, don't force all)
- **HydraDB** — knowledge-graph memory for agents, MCP plugin for Claude Code / Cursor / Codex. Fit: code graph + extracted rules.
- **Composio** — managed integrations (GitHub, Linear, Slack). Fit: PR/issue actions without OAuth glue.
- **Vercel** — deploy dashboard; AI Gateway credits = model access for our agents.
- **ElevenLabs** — voice. Fit: narrated demo / voice status from the factory. Low priority.

## 2b. Goal + CertusAI angle

**Goal: win 1st → Chamath 1:1 → pitch CertusAI in it.** Hackathon project = proof we can build what 8090 sells, in the regulated niche Certus owns.

Overlap: 8090 = AI SDLC for regulated enterprises, every change traced to intent, Knowledge Graph, Drift Bot. Certus = living safety evidence (HARA/ISO 26262/IEC 62304), every artifact traced, replaces Jama/DOORS. Same thesis ("traceability is the moat"), different layer: 8090 traces *software intent*, Certus traces *safety evidence*. Complementary, not competing.

### NEW RECOMMENDED — "Safety Gate": compliance-aware Software Factory
Agents ship code fast; in medical/auto/aero nobody can merge without safety evidence. Build the missing stage:
1. Software Factory Work Order arrives over MCP (e.g. "raise insulin bolus max to 25U").
2. Builder agents (Claude Code + Codex, parallel worktrees) implement on a real safety-critical C codebase (open-source pump / automotive controller).
3. **Safety agent** maps the diff to hazards + safety requirements (HARA, IEC 62304 / ISO 26262) via code graph (tree-sitter) + standards taxonomy.
4. **Verifier** reruns/generates tests per affected safety requirement; flags any requirement that lost coverage.
5. Output: PR with `WO-xxx` + auto-updated traceability matrix + impact analysis. **Blocks merge** if a hazard mitigation broke; posts back to SF ("drift" on safety).
Demo beat: agent makes a "harmless" change → Safety Gate catches it violates hazard H-3 → agent fixes → green PR with evidence. 3 minutes.
Why it wins: uses SF MCP (judges' product), shows verification + control (their thesis), hits 8090's real customers (healthcare/CMS), deep tech (parsing + graph), a story Chamath remembers.
Rule check: ask on Discord whether reusing our own MIT `standards-library` is allowed; else rebuild minimal taxonomy fresh tonight.

## 3. Project ideas (earlier options)

### A. RECOMMENDED — "Legacy Lens": traced legacy modernization on top of Software Factory
1. **Ingest** legacy repo (COBOL / old C / Java). Parse with tree-sitter → code graph (HydraDB). Edge: our compilers background — real parsing, not "LLM reads the file".
2. **Extract rules** → push into SF Knowledge Base / Requirements, each traced to `file:line`.
3. **Work Order** created in SF ("change late-fee rule to X").
4. **Orchestrator** pulls WO via SF MCP, uses graph to find affected code, writes plan.
5. **Parallel agents** (Claude Code + Codex headless), each in its own git worktree; pick best diff.
6. **Verify**: characterization tests generated from old code, run on old vs new; must match except intended change.
7. **PR** opened with `WO-xxx`, rule trace + test evidence in body → WO auto-links, moved to In Review.
Demo: live WO → verified PR in ~3 min on real COBOL sample.
Why: hits all 3 prompts, extends SF, mirrors CMS story, shows verification.

### B. "Agent Foreman": multi-agent executor for SF Work Orders
Generic orchestrator: pulls all ready WOs, dispatches to Claude Code / Codex / Cursor, handles conflicts, retries, tests, posts back. Dashboard of agent lanes. Easier, but many teams will do it.

### C. "Behavior Diff": migration equivalence checker
Auto-generate inputs, prove old vs new behavior matches. Narrow + technical. Hard to demo visually. Good as a component inside A.

**Scope rule:** end-to-end happy path by 9 AM Sat. Everything after = polish.

## 4. Timeline (PST)

| Time | Work |
|---|---|
| Plane | §0 checklist. Read this. Decide idea. Sketch architecture. Pick COBOL sample. |
| ~10:00 PM | Check in (ID), food, read Discord for rubric/judging slot/code-freeze time. Ask staff for SF help. |
| 10:30 PM | Lock idea (15 min max). Repo + SF project + MCP connected in all agents. |
| 11 PM–3 AM | Core: ingest → rules → WO via MCP → agents → PR (hardcode where needed) |
| 3–4 AM | Sleep in shifts; one person always shipping. (Building access limited — stay in.) |
| 4–9 AM | Verification step, parallel agents, dashboard on Vercel |
| 9 AM | **Core feature freeze.** Full end-to-end run on demo repo |
| 9 AM–1 PM | UI polish, sponsor integrations, record backup demo video |
| 1 PM–code freeze | Pitch (5 slides), demo script, rehearse 3x. Confirm code-freeze time on Discord |

## 5. Team split

- **Abhishek** — parsing, code graph, rule extraction, verification.
- **Murali** — orchestration (SF MCP → agents → PR), GitHub/Composio, dashboard, Vercel deploy.
- Both — demo script. Review each other's PRs.

## 6. AI tooling

| Tool | Role |
|---|---|
| **Cursor** | Main IDE. Cursor agent for UI + quick edits. SF MCP via `.cursor/mcp.json` |
| **Claude Code** | Heavy multi-file work, plan-then-implement. SF MCP via `claude mcp add --transport http ...` (exact cmd from SF settings) |
| **Codex CLI** | Parallel implementer + reviewer of Claude diffs. **Not installed:** `npm i -g @openai/codex`. SF MCP via script from SF Codex tab |
| **Grok** | Fast research / brainstorm, backup when rate-limited |
| **Vercel AI Gateway** | Model API for our own agents (sponsor credits) |

Rules:
- Shared `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` in repo → every agent gets same context.
- One agent per worktree/branch. Never two agents on same files.
- Small PRs, merge often, `main` always demo-able.
- Keys in `.env` (gitignored). Never commit sponsor codes or keys.

## 7. GitHub

- Repo: `Abhishek21g/evolve-factory`, private until demo.
- Invite Murali (write). Username: `Muralikinti`.
- Connect repo to SF project (Codebase Connection) so WO ↔ PR links work.

```bash
gh repo create Abhishek21g/evolve-factory --private --clone
gh api -X PUT repos/Abhishek21g/evolve-factory/collaborators/Muralikinti -f permission=push
```

## 8. Ask at the venue / on Discord
- Judging rubric + weights? Demo length? Submission format?
- Exact code-freeze time?
- Separate sponsor prizes (HydraDB / Composio / ElevenLabs / Vercel)?
- Credits for HydraDB / Composio / ElevenLabs (none in email yet — likely announced at opening)?
