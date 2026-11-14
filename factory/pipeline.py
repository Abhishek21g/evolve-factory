"""Certus Factory pipeline. Run by factory/server.py as its own process (one dashboard run per call).

  build  "<what you want>"   intent -> memory recall -> safety analysis -> coding agent + gate + world model
                              -> evidence pack -> memory + external actions
  whatif "<question>"        plain English -> simulation agent writes scenarios -> world model answers

LLM steps call $AGENT_JSON_CMD (default: claude -p). If it fails, a deterministic fallback keeps the run going,
and the dashboard says so. Approval itself is never an LLM decision: gate tests + world model decide.
"""
import json
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "dashboard"))
sys.path.insert(0, os.path.join(ROOT, "factory"))
import emit  # noqa: E402
import memory  # noqa: E402
import actions  # noqa: E402

PY = os.path.join(ROOT, ".venv/bin/python")
RUNS = os.path.join(ROOT, ".runs")
JSON_AGENT = os.environ.get("AGENT_JSON_CMD", "claude -p")


WO = None  # work order this run belongs to (stamped on every event)


def ev(agent, state, msg, **kw):
    if WO and "wo" not in kw:
        kw["wo"] = WO
    try:
        emit.emit(agent, state, msg, **kw)
    except Exception:
        pass


def ask_json(prompt):
    """One LLM call that must return a JSON object. Returns (obj, None) or (None, error)."""
    try:
        p = subprocess.run(JSON_AGENT, shell=True, input=prompt, capture_output=True, text=True, timeout=180, cwd=ROOT)
        m = re.search(r"\{.*\}", p.stdout, re.S)
        if not m:
            return None, (p.stderr or p.stdout or "no JSON")[-300:]
        return json.loads(m.group(0)), None
    except Exception as e:
        return None, str(e)


def next_wo():
    os.makedirs(RUNS, exist_ok=True)
    n = [int(m.group(1)) for f in os.listdir(RUNS) if (m := re.match(r"WO-(\d+)\.md$", f))]
    return f"WO-{max(n + [99]) + 1}"


SAFETY_PROMPT = """You are the Safety Analyst (hazard analysis, ISO 14971 / IEC 62304) in a software factory for an insulin pump.
Requested change: {intent}

Hazard log and safety requirements (safety.json):
{spec}

Organization memory that may matter:
{mem}

Return ONLY a JSON object:
{{"requirements": ["SR-.."], "hazards": ["H-.."], "risk": "one sentence on how this change could hurt a patient",
  "guidance": "one sentence telling the coding agent how to implement it safely",
  "new_hazard": "a hazard not yet in the log that this change raises, or empty string"}}"""


def safety_analysis(intent, spec, hits):
    ev("safety", "working", "Hazard analysis: mapping the request to hazards and requirements")
    mem = "\n".join(f"- [{h['kind']}] {h['title']}: {h['text']}" for h in hits) or "(none)"
    out, err = ask_json(SAFETY_PROMPT.format(intent=intent, spec=json.dumps(spec)[:6000], mem=mem))
    if not out:  # deterministic fallback: everything on the bolus path
        out = {"requirements": ["SR-1", "SR-2", "SR-3"], "hazards": ["H-1", "H-2", "H-3"],
               "risk": "Changes to the bolus path can overdose the patient.",
               "guidance": "Do not raise any limit in pump.h; deliver large doses over time within existing limits.",
               "new_hazard": "", "fallback": f"LLM unavailable ({err[:80]}); used bolus-path default"}
    ev("safety", "done", f"In scope: {', '.join(out.get('hazards', []))} ({', '.join(out.get('requirements', []))}). {out.get('risk', '')}",
       analysis=out)
    return out


def build(intent, wo=None):
    global WO
    wo = WO = wo or next_wo()
    for ext in ("commits.json", "diff.txt"):  # left by an earlier replay of this work order; git is the truth now
        if os.path.exists(os.path.join(RUNS, f"{wo}.{ext}")):
            os.remove(os.path.join(RUNS, f"{wo}.{ext}"))
    ev("planner", "working", f'New request from the operator: "{intent}"', wo=wo, title=intent)
    hits = memory.recall(intent, k=5)
    ev("memory", "done", f"Recalled {len(hits)} items from {memory.backend()} (tickets, meetings, chats, emails, code)",
       wo=wo, memory=[{k: h.get(k) for k in ("kind", "title", "text", "score")} for h in hits])
    spec = json.load(open(os.path.join(ROOT, "demo/pump/safety.json")))
    analysis = safety_analysis(intent, spec, hits)
    ev("planner", "done", f"Plan ready for {wo}; Claude Code works in its own git worktree", wo=wo, title=intent)

    text = (f"{intent}\n\nSafety Analyst guidance: {analysis.get('guidance', '')}\n\nRelevant organization memory:\n"
            + "\n".join(f"- [{h['kind']}] {h['title']}: {h['text']}" for h in hits))
    tf = os.path.join(RUNS, f"{wo}.request.txt")
    open(tf, "w").write(text)
    pr = ["--pr"] if os.environ.get("FACTORY_PR") == "1" else []
    p = subprocess.run([PY, os.path.join(ROOT, "gate/runner.py"), "--wo", wo, "--text-file", tf, *pr],
                       cwd=ROOT, capture_output=True, text=True)
    open(os.path.join(RUNS, f"{wo}.runner.log"), "w").write(p.stdout + p.stderr)
    passed = p.returncode == 0

    ev("evidence", "working", "Generating safety evidence pack")
    path, summary = evidence_pack(wo, intent, analysis, hits, passed)
    ev("evidence", "done", f"Evidence pack ready: {os.path.relpath(path, ROOT)}", wo=wo, evidence=summary)

    memory.remember([{"id": f"run-{wo}", "kind": "run", "title": f"{wo}: {intent}",
                      "text": f"Result {'PASS' if passed else 'BLOCKED'}. {summary['headline']}"}])
    acted = actions.after_run(wo, intent, passed, summary)
    if acted:
        ev("actions", "done", acted, wo=wo)
    ev("reviewer", "done" if passed else "blocked",
       f"{wo} {'approved by deterministic checks: ready to merge with evidence' if passed else 'BLOCKED: not mergeable, evidence attached'}", wo=wo)
    return 0 if passed else 1


def evidence_pack(wo, intent, analysis, hits, passed):
    gate = _load(f"{wo}.gate.json") or {"rows": []}
    world = _load(f"{wo}.world.json") or {"results": []}
    rs = world.get("results", [])
    new = [r for r in rs if r.get("new_hypo")]
    old = [r for r in rs if r.get("preexisting")]
    headline = (f"{len(gate['rows'])} requirements tested, {sum(r['result'] == 'PASS' for r in gate['rows'])} passed; "
                f"world model {world.get('verdict', 'n/a')}: {len(new)} new severe-hypo runs in {len(rs)} simulations, "
                f"{len(old)} pre-existing")
    md = [f"# Safety evidence pack: {wo}", "", f"**Request:** {intent}", f"**Decision:** {'APPROVED' if passed else 'BLOCKED'} "
          "(deterministic: unit tests + world model; no LLM in the approval path)", f"**Summary:** {headline}", "",
          "## 1. Hazard analysis (Safety Analyst)", f"- Hazards in scope: {', '.join(analysis.get('hazards', []))}",
          f"- Requirements in scope: {', '.join(analysis.get('requirements', []))}", f"- Risk: {analysis.get('risk', '')}",
          f"- Guidance given to coding agent: {analysis.get('guidance', '')}"]
    if analysis.get("new_hazard"):
        md.append(f"- New hazard proposed for the log: {analysis['new_hazard']}")
    md += ["", "## 2. Traceability (requirement to test)", "", "| Requirement | Hazards | Test | Result |", "|---|---|---|---|"]
    md += [f"| {r['id']}: {r['text']} | {', '.join(h['id'] for h in r['hazards'])} | `{r['test']}` | {r['result']} |" for r in gate["rows"]]
    md += ["", "## 3. World model verification (simulated patients, UVA/Padova via simglucose)", "",
           "| Scenario | Patient | Pump decision | Min BG | Min BG on main | Result |", "|---|---|---|---|---|---|"]
    md += [f"| {r['scenario']} | {r['patient']} | {r['note']} | {r['min']} | {r['base_min']} | "
           f"{'NEW severe hypo' if r['new_hypo'] else 'pre-existing' if r['preexisting'] else 'ok'} |" for r in rs]
    md += ["", "## 4. Organization context used", ""] + [f"- [{h['kind']}] {h['title']}" for h in hits]
    md += ["", f"_Generated by Certus Factory, {time.strftime('%Y-%m-%d %H:%M %Z')}. Standards: IEC 62304, ISO 14971._"]
    path = os.path.join(RUNS, f"{wo}.evidence.md")
    open(path, "w").write("\n".join(md) + "\n")
    return path, {"wo": wo, "decision": "APPROVED" if passed else "BLOCKED", "headline": headline,
                  "requirements": len(gate["rows"]), "simulations": len(rs), "new_hypo": len(new), "preexisting": len(old)}


def _load(name):
    p = os.path.join(RUNS, name)
    return json.load(open(p)) if os.path.exists(p) else None


WHATIF_PROMPT = """You are the Simulation Agent of a software factory for an insulin pump. Turn the operator's question into
world-model scenarios. Each scenario: a meal of `carbs` grams; the user asks for the correct dose (carbs / carb ratio)
multiplied by `typo` (1 = typed correctly, 10 = decimal slip); if the pump rejects it the user either "reenter"s the
intended dose or picks "extended" mode; `cohort` is adult, adolescent or child (10 virtual patients each).

Question: {q}

Return ONLY JSON: {{"scenarios": [{{"id": "short-kebab-id", "label": "short description", "carbs": 0-200,
"typo": 1-20, "fallback": "reenter" or "extended", "cohort": "adult"|"adolescent"|"child"}}], "explain": "one sentence"}}
Use 1 to 3 scenarios."""


def whatif(question):
    ev("simulation", "working", f'Simulation Agent: turning "{question}" into world-model scenarios', title=question)
    out, err = ask_json(WHATIF_PROMPT.format(q=question))
    scs = (out or {}).get("scenarios") or []
    clean = []
    for i, s in enumerate(scs[:3]):  # never trust model output: clamp to the simulator's valid range
        clean.append({"id": re.sub(r"[^a-z0-9-]", "", str(s.get("id", f"what-if-{i + 1}")).lower())[:30] or f"what-if-{i + 1}",
                      "label": str(s.get("label", ""))[:80], "carbs": max(0, min(200, float(s.get("carbs", 60)))),
                      "typo": max(1, min(20, float(s.get("typo", 1)))),
                      "fallback": "extended" if s.get("fallback") == "extended" else "reenter",
                      "cohort": s.get("cohort") if s.get("cohort") in ("adult", "adolescent", "child") else "adult"})
    if not clean:
        nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", question)]
        clean = [{"id": "what-if", "label": question[:80], "carbs": nums[0] if nums else 60,
                  "typo": 10 if re.search(r"typo|slip|mistype|10x|ten times", question, re.I) else 1, "fallback": "reenter",
                  "cohort": next((c for c in ("child", "adolescent") if c in question.lower()), "adult")}]
        ev("simulation", "done", f"LLM unavailable, parsed the question directly ({err[:60] if err else ''})", scenarios=clean)
    else:
        ev("simulation", "done", (out or {}).get("explain", "Scenarios ready"), scenarios=clean)
    sf = os.path.join(RUNS, f"whatif-{int(time.time())}.json")
    os.makedirs(RUNS, exist_ok=True)
    json.dump(clean, open(sf, "w"))
    ev("world", "working", f"Running {len(clean) * 10} simulated patients on the current pump firmware")
    subprocess.run([PY, os.path.join(ROOT, "sim/world.py"), "--repo", ROOT, "--base", "none", "--scenarios", sf,
                    "--question", question], cwd=ROOT, capture_output=True)
    return 0


REPLAY = os.path.join(ROOT, "demo", "replay")


def replay(kind, text, wo=None):
    """FACTORY_REPLAY=1: play the recorded real run demo/replay/<kind>.jsonl (made by demo/record.py) instead of
    calling agents, so a stage demo can never wait on an LLM. Gaps are divided by REPLAY_SPEED and capped at
    REPLAY_MAX_GAP seconds; messages, gate rows, simulations, evidence and PR link are the recorded ones."""
    speed, cap = float(os.environ.get("REPLAY_SPEED", "4")), float(os.environ.get("REPLAY_MAX_GAP", "4"))
    rec = [json.loads(line) for line in open(os.path.join(REPLAY, f"{kind}.jsonl")) if line.strip()]
    old = rec[0].get("wo")
    sub = (lambda s: s.replace(old, wo)) if old and wo else (lambda s: s)  # noqa: E731
    os.makedirs(RUNS, exist_ok=True)
    if wo:
        for ext in ("evidence.md", "diff.txt", "commits.json"):
            src = os.path.join(REPLAY, f"{kind}.{ext}")
            if os.path.exists(src):
                open(os.path.join(RUNS, f"{wo}.{ext}"), "w").write(sub(open(src).read()))
    prev = 0.0
    for e in rec:
        time.sleep(min(max(e["t"] - prev, 0) / speed, cap))
        prev = e["t"]
        kw = {k: v for k, v in e.items() if k not in ("run", "t", "agent", "state", "msg", "wo")}
        if wo:
            kw["wo"] = wo
            for key in ("gate", "world"):
                if key in kw:
                    json.dump(kw[key], open(os.path.join(RUNS, f"{wo}.{key}.json"), "w"))
            if "evidence" in kw:
                kw["evidence"] = {**kw["evidence"], "wo": wo}
        emit.emit(e["agent"], e["state"], sub(e["msg"]), **kw)
    return 0 if not wo or rec[-1]["state"] == "done" else 1


if __name__ == "__main__":
    # pipeline.py build "<request>" [WO-101]   |   pipeline.py whatif "<question>"
    if os.environ.get("FACTORY_REPLAY") == "1":
        sys.exit(replay(*sys.argv[1:4]))
    sys.exit({"build": build, "whatif": whatif}[sys.argv[1]](*sys.argv[2:4]))
