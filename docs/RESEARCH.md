# 8090 deep dive (for picking + pitching our project)

## Timing
- Luma: Fri Nov 13 5:30 PM → **Sat Nov 14 7:00 PM PST** (description says "around 6:30 PM").
- Opening ceremony was 6:30 PM Fri (rules, judging, credits, SF setup). We missed it.
- **Code freeze time not published anywhere public.** Judging + live demos + Q&A + Chamath ceremony must fit before ~6:30 PM, so assume **code freeze ~2:00–3:00 PM Sat** until Discord says otherwise. Judging slots are assigned on Discord.

## What Software Factory (SF) is
"AI-native software development control plane." Humans + agents in one governed workspace. Pitch line: *"As AI writes more of your software, speed stops being the edge. Control is."*

Modules:
- **Requirements** — product intent, testable behavior.
- **Blueprints** — Container / Component / Feature specs. Feature Blueprint = *how*, Requirements = *what*. Tracked suggestions, version history, Mermaid.
- **Work Orders (WO)** — ID `WO-123`, status (Backlog → Ready → In Progress → In Review → Completed), phases, dependencies, linked PRs. Agent skills: Extract Work Orders, Phase Planning, Review Current Phase, Duplication Check.
- **Feedback** — customer feedback → themes → work.
- **Knowledge Base**, **Skills** (reusable agent instructions, skill rules), **Knowledge Graph** linking everything.
- **Automations** — agent runs on triggers: Code Push, Requirement/Blueprint/WO created or edited, **WO status changed (e.g. → Ready)**, label added, schedule. Scoped permissions + granted MCP servers. REST API + MCP can manage them.
- **Drift detection** — "Detect Code Drift" automation (comments on blueprints after push) and **Drift Bot** (reviews PRs vs Blueprints/Requirements, posts comments, sets `drift-bot` commit status pass/fail).
- **Durable agents** run in the cloud.

Integration surface:
- **MCP server** per-org URL from SF Settings → Connections → Coding Agent (`https://api.factory.8090.dev/v3/mcp/org/<org-id>`), header `X-Sofa-Mcp-Project-Id`, browser OAuth. Works in Cursor, Claude Code, Codex. Tools: list/read WOs, read linked context, update status, link PR, search KB, manage automations.
- **REST API** (docs.8090.ai/api-reference) — drive agents/automations from our own pipeline.
- **Codebase Connection** — GitHub App indexes repo (5–10 min initial). PR auto-links to WO if title/body has `WO-123`.
- Model-agnostic: Claude (Fable/Opus/Sonnet), GPT-6.x, Gemini, Kimi K3, GLM.

## Customers / proof points
- **CMS ClaimsCore**: static-analysis pipeline over 154M+ lines of Assembly/COBOL, 857K+ business rules. Each rule written as **Given/When/Then**, every line traced to source lines or CMS docs ("if a statement cannot be sourced, it does not go in the record"). Rules matched across 4 systems (CWF, DME, FISS, MCS). Built a review app + searchable KB. Rules become the **baseline the replacement teams use to configure, test, and validate**.
- **BISSELL**: agents validate 10K+ part names, exceptions routed to humans.
- **IFS**: MCP layer on an ERP = "headless ERP".
- EY, Tie, Mach33, AdaptHealth, Dompé. Target buyers: banks, insurers, hospitals, aerospace, energy, government.
- $135M Series A (Salesforce Ventures).

## Gaps in SF = where our project adds value
1. Drift is **comments by an LLM**, not proof. Nothing *executes* the code to prove a requirement still holds.
2. WOs **don't update when Blueprints change** (docs say re-run extraction manually).
3. No domain-specific **compliance/safety** layer (ISO 26262, IEC 62304, DO-178C, FDA) even though their buyers are regulated.
4. CMS work stops at documenting rules; the "test and validate the replacement" step is left to other teams → **executable rules / behavioral equivalence** is the natural next step.
5. SF orchestrates; execution is "your coding agent in your IDE". An **autonomous WO runner** (WO → Ready triggers a fleet that ships a verified PR) is the "factory" part they invite us to build.

## What judges likely reward (inferred)
Uses SF for real (MCP / API / automations) · verification + traceability over raw speed · regulated-industry realism · working live demo · clear story tying back to 8090 customers. Chamath's framing: "what one person can do with a team of AI agents".
