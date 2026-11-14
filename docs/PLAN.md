# Build plan: Certus Factory at EVOLVE (8090 AI Hackathon)

Team: Abhishek Enaguthi (GitHub `Abhishek21g`) and Muralikrishna Inti (GitHub `Muralikinti`).
Built Nov 13–14, 2026. Background on 8090's Software Factory is in [RESEARCH.md](RESEARCH.md).

## Theme: "Build your own Software Factory"

Organizer prompts:
- Team of agents that takes a **ticket → pull request**
- Framework for **coordinating autonomous coding agents**
- Tools to **understand + modernize massive legacy codebases**

### 8090 Software Factory
Modules: **Requirements → Blueprints → Work Orders → Feedback**, all linked in a **Knowledge Graph**. Agents + **Drift Bot** flag when code/requirements no longer match. Also Knowledge Base, Skills, Automations, Codebase Connection (GitHub).

Integration hooks: a per-org **MCP server** (Cursor, Claude Code, Codex) and a **REST API** (docs.8090.ai/api-reference). Agent loop: list Work Orders → read linked Requirements/Blueprints → mark In Progress → implement → open PR with `WO-123` in title (auto-links) → mark In Review.

Their flagship story: CMS — 100K+ business rules extracted from 18M+ lines of COBOL, each traced to source line. The thesis is **traceability, verification, governance**, not raw speed ("Control is the edge. Quality over speed.").

**Strategy:** don't rebuild Software Factory. Build the **autonomous engine underneath it**: SF holds intent (Requirements/Blueprints/Work Orders); our system pulls Work Orders, executes with a team of agents, verifies, and posts the PR + evidence back.

## Chosen idea: "Safety Gate", a compliance-aware Software Factory

Overlap: 8090 = AI SDLC for regulated enterprises, every change traced to intent. CertusAI (our startup) = living safety evidence (HARA / ISO 26262 / IEC 62304), every artifact traced. 8090 traces *software intent*, Certus traces *safety evidence*. Complementary, not competing.

Agents ship code fast; in medical/auto/aero nobody can merge without safety evidence. Build the missing stage:
1. A Software Factory Work Order arrives (e.g. "raise insulin bolus max to 25U").
2. A builder agent (Claude Code, own git worktree) implements it on a small safety-critical C codebase.
3. A **Safety Analyst** maps the request to hazards + safety requirements (IEC 62304 / ISO 14971).
4. A **deterministic gate** runs the test behind every affected safety requirement, plus a world model that runs the candidate code in simulation.
5. Output: PR with `WO-xxx` + traceability matrix + evidence pack. **Blocked** if a hazard mitigation broke; the report goes back to the agent.

Demo beat: the obvious "harmless" change → Safety Gate catches it → agent fixes → green PR with evidence. 3 minutes.

Drift Bot already compares PRs against Blueprints with an LLM. We don't rebuild it: we **execute** (tests and simulation) and sit next to it.

Other options considered: executable COBOL rules (behavior-locked modernization), a Blueprint-change propagator, an autonomous Work Order fleet.

## Working rules

- Shared `AGENTS.md` / `CLAUDE.md` in the repo, so every agent gets the same context.
- One agent per worktree/branch. Never two agents on the same files.
- Small PRs, merge often, `main` always demo-able.
- Keys in `.env` (gitignored). Never commit sponsor codes or keys.
- End-to-end happy path first; everything after is polish. Record a backup demo.
