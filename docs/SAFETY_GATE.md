# Safety Gate: build brief, demo script, pitch

> Original build brief, kept for the reasoning. What shipped is described in the README; the click path is [DEMO.md](DEMO.md).

## One line
8090 Software Factory lets agents ship code with traceable intent. Safety Gate lets them ship it into regulated systems: every change is mapped to the hazards it touches and checked by executed tests before it can merge.

## Architecture

```
SF Work Order (WO-12)
   │  `python3 gate/runner.py --wo WO-12 --pr` (SF REST API; an SF Automation on WO -> Ready is the next step)
   ▼
runner  ── pulls WO + linked Requirements/Blueprints
   │
   ├─ worktree A: Claude Code (headless)  ┐
   ├─ worktree B: Codex (headless)        ┘ implement WO in parallel
   │
   ▼
gate/gate.py  (per candidate branch)
   diff -> affected safety requirements (safety.json: hazards, reqs, files, symbols, tests)
   -> run each requirement's tests -> PASS / BLOCKED + traceability matrix
   │
   ├─ BLOCKED -> feed failing requirement + log back to the agent, retry (max 2)
   └─ PASS    -> gh pr create "WO-12: ..." body = matrix + evidence
                 commit status `safety-gate` = success
                 SF WO -> In Review, PR auto-linked
   ▼
dashboard (Vercel): WO lanes, agent progress, gate verdicts, hazard graph
```

Already built: `gate/gate.py` (+ `gate/test_gate.py` self-check, passes).

## Build order (cut from the bottom if late)
1. **Demo target repo** + `safety.json` (5–8 hazards, 8–12 safety requirements, each with a real unit test). Fork it into our GitHub, connect to SF.
2. **Gate on real repo**: run `gate.py` against a hand-made unsafe branch. Must block. (~1 h)
3. **Runner v0**: script takes WO text, runs `claude -p` in a worktree, runs gate, opens PR with matrix. (~2 h)
4. **SF wiring**: pull WO via MCP/API, set status, PR title `WO-xx`. (~1–2 h)
5. **Retry loop**: on BLOCKED, send failing req + log back to the agent. This is the "wow" beat. (~1 h)
6. **Parallel agents** (Codex in 2nd worktree, pick first passing). (~1 h)
7. **GitHub commit status** `safety-gate` next to their `drift-bot`. (~30 min)
8. **Dashboard** on Vercel. (~2 h) Fallback: terminal + GitHub PR page is enough.
9. Stretch: safety agent auto-drafts new hazard/req when diff touches code no requirement covers (Certus-style HARA). Stretch: Composio for GitHub actions, HydraDB for hazard graph.

## Demo script (3 min)
0:00 Problem (20s): "Agents write code fast. In an insulin pump, a ventilator, a car, nobody can merge without safety evidence. Today that's weeks of manual traceability in DOORS/Jama. Speed isn't the bottleneck, proof is."
0:20 Show SF board: WO-12 "Allow larger meal bolus for adult profile" (original plan; the built demo shows WO-2 In Review with its PR, see DEMO.md).
0:35 Runner picks it up. Two agents start (show terminal/dashboard lanes).
1:00 Agent's first patch raises `MAX_BOLUS_U`. **Safety Gate: BLOCKED** — SR-3 "single bolus ≤ max for profile, confirmed by user above threshold" → hazard H-1 overdose. Show matrix.
1:30 Gate feeds failure back. Agent revises: profile-scoped limit + confirmation step + test.
2:00 Gate PASS. PR opens: `WO-12`, traceability matrix, test evidence, `safety-gate ✓` beside `drift-bot ✓`. SF WO flips to In Review automatically.
2:30 Close: "8090 traces intent. We check safety. Together: agents that can ship into regulated systems, which is exactly 8090's customer base (CMS, healthcare, aerospace)."

Have a **recorded backup** of the full run.

## Pitch slides (5)
1. Problem: AI codes fast; regulated industries can't merge without evidence.
2. Insight: Drift Bot gives opinions. Regulators need proof: executed tests mapped to hazards.
3. Demo.
4. How it works (architecture above) + what's real vs stubbed (be honest).
5. Why us / what's next: compiler + safety background, CertusAI (living safety evidence, ISO 26262/IEC 62304), plug into SF as an automation + commit status.

## Likely judge questions
- *How do you map code to requirements?* safety.json links files/symbols to requirements; changed lines are matched; next step is call-graph reach (tree-sitter) so indirect changes count.
- *What if a change touches code no requirement covers?* Flag "uncovered safety-relevant change" and have the safety agent draft a new hazard/requirement for human review.
- *Why not just Drift Bot?* Drift Bot is an LLM reading the PR. We execute. A failing test is evidence an auditor accepts; an LLM comment isn't.
- *Can agents game the tests?* Tests and safety.json are protected paths: agents can't edit them; changes to them need human review.
- *Which standards?* IEC 62304 (medical software), ISO 14971 (risk), ISO 26262 (auto). Matrix mirrors what an auditor asks for.
