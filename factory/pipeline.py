"""Certus Factory pipeline. Run by factory/server.py as its own process (one dashboard run per call).

  build  "<what you want>"   intent -> memory recall -> safety analysis -> coding agent + gate + world model
                              -> evidence pack -> memory + external actions
  whatif "<question>"        plain English -> simulation agent writes scenarios -> world model answers

LLM steps call $AGENT_JSON_CMD (default: claude -p). If it fails, a deterministic fallback keeps the run going,
and the dashboard says so. Approval itself is never an LLM decision: gate tests + world model decide.
"""
import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "dashboard"))
sys.path.insert(0, os.path.join(ROOT, "factory"))
sys.path.insert(0, os.path.join(ROOT, "gate"))
import emit  # noqa: E402
import memory  # noqa: E402
import store  # noqa: E402
import verdict  # noqa: E402

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


def project_device(wo=None):
    """Device config of the project this run is for: FACTORY_PROJECT (set by the server), else the work order's."""
    pid = os.environ.get("FACTORY_PROJECT") or next((w["project"] for w in store._load()["work_orders"] if w["id"] == wo), "")
    return store.device(pid)


SAFETY_PROMPT = """You are the Safety Analyst (hazard analysis, {standard}) in a software factory for: {device}.
Requested change: {intent}

Hazard log and safety requirements (safety.json):
{spec}

Organization memory that may matter:
{mem}

Return ONLY a JSON object:
{{"requirements": ["SR-.."], "hazards": ["H-.."], "risk": "how this change could hurt someone, at most 20 words",
  "guidance": "how the coding agent should implement it safely, at most 25 words",
  "new_hazard": "a hazard not yet in the log that this change raises (at most 15 words), or empty string"}}
Plain words, no preamble, no lists inside strings."""


FALLBACK = {  # deterministic hazard analysis when the LLM is unavailable: everything on the main safety path
    "insulin-pump": {"requirements": ["SR-1", "SR-2", "SR-3"], "hazards": ["H-1", "H-2", "H-3"],
                     "risk": "Changes to the bolus path can overdose the patient.",
                     "guidance": "Do not raise any limit in pump.h; deliver large doses over time within existing limits."},
    "flight-controls": {"requirements": ["SR-1", "SR-2", "SR-3"], "hazards": ["H-1", "H-2", "H-3"],
                        "risk": "Changes to the AoA monitor can push the nose down on bad data or switch off stall protection.",
                        "guidance": "Do not change any certified limit in fcc.h; add new behavior next to it."},
}


def safety_msg(lessons):
    return "Hazard analysis: mapping the request to hazards and requirements" + (
        f", checking {len(lessons)} past verdict{'s' if len(lessons) > 1 else ''} from {lessons[0]['source']}" if lessons else "")


def safety_analysis(intent, spec, hits, dev, lessons):
    ev("safety", "working", safety_msg(lessons), lessons=lessons)
    mem = "\n".join(f"- [{h['kind']}] {h['title']}: {h['text']}" for h in hits + lessons) or "(none)"
    out, err = ask_json(SAFETY_PROMPT.format(intent=intent, spec=json.dumps(spec)[:6000], mem=mem,
                                             device=dev["label"], standard=dev["standard"]))
    if not out:
        out = {**FALLBACK[dev["id"]], "new_hazard": "", "fallback": f"LLM unavailable ({err[:80]}); used safety-path default"}
    ev("safety", "done", f"In scope: {', '.join(out.get('hazards', []))} ({', '.join(out.get('requirements', []))}). {out.get('risk', '')}",
       analysis=out)
    return out


def _where(info):
    return f"HydraDB · {info['ms']} ms" if info["backend"] == "HydraDB" else "local memory (HydraDB unreachable)"


def _slim(h, info):
    return {**{k: h.get(k) for k in ("kind", "title", "text", "score", "collection", "synthetic")},
            "source": f"{'HydraDB' if info['backend'] == 'HydraDB' else 'local'} · {h.get('collection')}"}


def recall(intent, dev):
    hits, info = memory.search(intent, k=6, project=dev["id"])
    return (hits, f"Recalled {len(hits)} items from {_where(info)}: org memory and {dev['label'].lower()} regulatory knowledge",
            [_slim(h, info) for h in hits], info)


def past_runs(intent, dev):
    """Similar finished work orders from HydraDB's factory_lessons: the latest run of each request, best match first."""
    hits, info = memory.search(intent, k=8, project=dev["id"], collections=(memory.LESSONS,), recency=0.6)
    best = {}  # request -> (run time from the lesson id, hit); insertion order keeps HydraDB's ranking
    for h in hits:
        req, ts = (h.get("meta") or {}).get("request", h["title"]).lower(), h["id"].rsplit("-", 1)[-1]
        ts = int(ts) if ts.isdigit() else 0
        if h.get("score", 0) >= 0.3 and ts >= best.get(req, (-1, None))[0]:
            best[req] = (ts, h)
    lessons = [{**_slim(h, info), "summary": (h.get("meta") or {}).get("summary", h["title"])} for _, h in best.values()][:3]
    msg = (f"Recalled {len(lessons)} similar past work order{'s' if len(lessons) > 1 else ''} from {_where(info)}: {lessons[0]['summary']}"
           if lessons else f"No similar past work order in {_where(info)} yet; this run's lesson will be saved for the next one")
    return lessons, msg, info


def write_lesson(wo, intent, dev, passed, reason, headline, replay_of=None):
    """The factory learns: store what this work order taught (verdict, failed SRs and hazards, the fix) in HydraDB."""
    evs = [json.loads(l) for l in open(emit.FEED) if l.strip()]
    evs = [e for e in evs if e["run"] == emit.RUN and e.get("wo") == wo]
    item = memory.lesson_item(wo, dev["id"], intent, passed, reason, headline, evs, store.diff(wo), replay_of)
    info = memory.remember([item])
    ev("memory", "done", f"Saved lesson to {_where(info)} ({info['collection']}): {item['meta']['summary']}", wo=wo,
       lesson={"title": item["title"], "summary": item["meta"]["summary"], "source": f"{info['backend']} · {info['collection']}"},
       recall=info)


def build(intent, wo=None):
    global WO
    wo = WO = wo or next_wo()
    for ext in ("commits.json", "diff.txt"):  # left by an earlier replay of this work order; git is the truth now
        if os.path.exists(os.path.join(RUNS, f"{wo}.{ext}")):
            os.remove(os.path.join(RUNS, f"{wo}.{ext}"))
    ev("planner", "working", f'New request from the operator: "{intent}"', wo=wo, title=intent)
    dev = project_device(wo)
    hits, msg, mem, info = recall(intent, dev)
    ev("memory", "done", msg, wo=wo, memory=mem, recall=info)
    lessons, msg, info = past_runs(intent, dev)
    ev("planner", "done", msg, wo=wo, lessons=lessons, recall=info)
    spec = json.load(open(os.path.join(ROOT, dev["repo"], "safety.json")))
    analysis = safety_analysis(intent, spec, hits, dev, lessons)
    ev("planner", "done", f"Plan ready for {wo}; Claude Code works in its own git worktree", wo=wo, title=intent)

    text = (f"{intent}\n\nSafety Analyst guidance: {analysis.get('guidance', '')}\n\nRelevant organization memory:\n"
            + "\n".join(f"- [{h['kind']}] {h['title']}: {h['text']}" for h in hits + lessons))
    tf = os.path.join(RUNS, f"{wo}.request.txt")
    open(tf, "w").write(text)
    md = os.path.join(RUNS, f"{wo}.md")
    if os.path.exists(md):
        os.remove(md)
    pr = ["--pr"] if os.environ.get("FACTORY_PR") == "1" else []
    base = ["--base", os.environ["FACTORY_BASE"]] if os.environ.get("FACTORY_BASE") else []  # branch to build on and PR into
    rules = ["--rules", os.path.join(ROOT, dev["rules"])] if dev.get("rules") else []
    p = subprocess.run([PY, os.path.join(ROOT, "gate/runner.py"), "--wo", wo, "--text-file", tf, *pr, *base, *rules,
                        "--checks", os.path.join(ROOT, dev["checks"])],
                       cwd=ROOT, capture_output=True, text=True)
    open(os.path.join(RUNS, f"{wo}.runner.log"), "w").write(p.stdout + p.stderr)
    report = open(md).read() if os.path.exists(md) else ""
    if not report.startswith("## Checks:"):  # agent unavailable or runner crashed: nothing was checked, so nothing to judge
        why = report.split("\n\n")[1] if report.count("\n\n") else (p.stderr.strip().splitlines() or ["runner failed"])[-1][:200]
        ev("reviewer", "blocked", f"{wo} not run: {why}. No safety decision was made; run it again once fixed.",
           wo=wo, not_run=True)
        return 1
    passed = p.returncode in (0, 3)  # 3: checks passed, only opening the PR failed
    reason = "" if passed else block_reason(wo, report)

    ev("evidence", "working", "Generating safety evidence pack")
    path, summary = evidence_pack(wo, intent, analysis, hits + lessons, passed, reason, dev, spec)
    ev("evidence", "done", f"Evidence pack ready: {os.path.relpath(path, ROOT)}", wo=wo, evidence=summary)

    write_lesson(wo, intent, dev, passed, reason, summary["headline"])
    verdict = (f"{wo} approved by deterministic checks: ready to merge with evidence" if passed
               else f"{wo} BLOCKED: {reason}. Not mergeable; evidence attached")
    ev("reviewer", "done" if passed else "blocked", verdict, wo=wo)
    post_actions(wo, intent, passed, verdict, summary["headline"])
    return 0 if passed else 1


def post_actions(wo, intent, passed, verdict, headline):
    """Composio files the evidence on GitHub in its own process, after the verdict is on screen: never blocks a run."""
    if not os.environ.get("COMPOSIO_API_KEY"):
        return
    job = json.dumps({"wo": wo, "intent": intent, "passed": passed, "verdict": verdict, "headline": headline})
    subprocess.Popen([PY, os.path.join(ROOT, "factory/actions.py"), "post", job], cwd=ROOT, start_new_session=True,
                     stdout=open(os.path.join(RUNS, "actions.log"), "a"), stderr=subprocess.STDOUT)


def block_reason(wo, report):
    """Why the deterministic checks blocked the change, in one line a judge can read."""
    gate = _load(f"{wo}.gate.json") or {"rows": []}
    world = _load(f"{wo}.world.json") or {"results": []}
    bits = [f"{r['id']} failed ({r['text']}; {', '.join(h['id'] for h in r['hazards'])})" for r in gate["rows"] if r["result"] != "PASS"]
    new = [r for r in world.get("results", []) if r.get("new_hypo")]
    if new and world.get("kind") == "aircraft":
        bits.append(f"world model: {len(new)} simulated flights left the safe envelope (stall or altitude loss) that main keeps inside")
    elif new:
        bits.append(f"world model: {len(new)} simulated patients fell into severe hypoglycemia that main avoids")
    if "protected-files: BLOCKED" in report:
        bits.append("the change edited protected safety evidence")
    if "Agent made no code changes" in report:
        bits.append("the agent made no code changes")
    return "; ".join(bits) or "a check failed (see the evidence pack)"


def evidence_pack(wo, intent, analysis, hits, passed, reason, dev, spec):
    gate = _load(f"{wo}.gate.json") or {"rows": []}
    world = _load(f"{wo}.world.json") or {"results": []}
    rs = world.get("results", [])
    new = [r for r in rs if r.get("new_hypo")]
    old = [r for r in rs if r.get("preexisting")]
    air = world.get("kind") == "aircraft" or dev["id"] == "flight-controls"
    harm = "new envelope exceedances" if air else "new severe-hypo runs"
    headline = (f"{len(gate['rows'])} requirements tested, {sum(r['result'] == 'PASS' for r in gate['rows'])} passed; "
                f"world model {world.get('verdict', 'n/a')}: {len(new)} {harm} in {len(rs)} simulations, "
                f"{len(old)} pre-existing")
    md = [f"# Safety evidence pack: {wo}", "", f"**Request:** {intent}", f"**Decision:** {'APPROVED' if passed else 'BLOCKED'} "
          "(deterministic: unit tests + world model; no LLM in the approval path)"]
    md += [gate["checker"]["label"]] if gate.get("checker") else []
    md += [f"**Blocked because:** {reason}"] if reason else []
    md += [f"**Summary:** {headline}", "",
          "## 1. Hazard analysis (Safety Analyst)", f"- Hazards in scope: {', '.join(analysis.get('hazards', []))}",
          f"- Requirements in scope: {', '.join(analysis.get('requirements', []))}", f"- Risk: {analysis.get('risk', '')}",
          f"- Guidance given to coding agent: {analysis.get('guidance', '')}"]
    if analysis.get("new_hazard"):
        md.append(f"- New hazard proposed for the log: {analysis['new_hazard']}")
    if air:
        req = {r["id"]: r for r in spec["requirements"]}
        md += ["", "## 2. Traceability (hazard to requirement to test, DO-178C trace data)", "",
               "| Requirement | Hazards | DAL | DO-178C objectives | Test | Result |", "|---|---|---|---|---|---|"]
        md += [f"| {r['id']}: {r['text']} | {', '.join(h['id'] for h in r['hazards'])} | {req.get(r['id'], {}).get('dal', '')} | "
               f"{'; '.join(req.get(r['id'], {}).get('objectives', []))} | `{r['test']}` | {r['result']} |" for r in gate["rows"]]
        md += ["", "## 3. World model verification (simulated 737-class aircraft, longitudinal flight model)", "",
               "| Scenario | Config | Outcome | Peak AoA | Peak AoA on main | Alt loss ft | Result |", "|---|---|---|---|---|---|---|"]
        md += [f"| {r['scenario']} | {r['patient']} | {r['note']} | {r['peak_aoa']} | {r['base_min']} | {r['alt_loss_ft']} | "
               f"{'NEW exceedance' if r['new_hypo'] else 'pre-existing' if r['preexisting'] else 'inside envelope'} |" for r in rs]
        md += ["", "Not claimed: MC/DC structural coverage (DO-178C A-7), DO-330 qualification of this gate, independence of verification."]
    else:
        md += ["", "## 2. Traceability (requirement to test)", "", "| Requirement | Hazards | Test | Result |", "|---|---|---|---|"]
        md += [f"| {r['id']}: {r['text']} | {', '.join(h['id'] for h in r['hazards'])} | `{r['test']}` | {r['result']} |" for r in gate["rows"]]
        md += ["", "## 3. World model verification (simulated patients, UVA/Padova via simglucose)", "",
               "| Scenario | Patient | Pump decision | Min BG | Min BG on main | Result |", "|---|---|---|---|---|---|"]
        md += [f"| {r['scenario']} | {r['patient']} | {r['note']} | {r['min']} | {r['base_min']} | "
               f"{'NEW severe hypo' if r['new_hypo'] else 'pre-existing' if r['preexisting'] else 'ok'} |" for r in rs]
    md += ["", "## 4. Organization context used", ""] + [f"- [{h['kind']}] {h['title']}" for h in hits]
    md += ["", f"_Generated by Certus Factory, {time.strftime('%Y-%m-%d %H:%M %Z')}. Standards: {dev['standard'].replace(' · ', ', ')}._"]
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
"typo": 1-20, "fallback": "reenter" or "extended", "cohort": "adult"|"adolescent"|"child"}}],
"explain": "what the scenarios compare, at most 15 words"}}
Use 1 to 3 scenarios: the one asked about, plus a correctly dosed control when it helps attribute the effect.
Labels under 8 words. Do not predict results: the simulation answers."""


def whatif(question):
    if project_device()["id"] == "flight-controls":
        return flight_whatif(question)
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


FLIGHT_WHATIF_PROMPT = """You are the Simulation Agent of a software factory for airliner flight controls (AoA stall
protection). Turn the operator's question into world-model scenarios for a 737-class longitudinal flight model (6 weight/CG
configs each). Each scenario: `speed_kt` start speed; `pull` the AoA in degrees the pilot's column pull aims for
(0 = holds level trim, 16 = deliberate stall approach); `idle` thrust to idle; `split` the AoA vane split from
sideslip in degrees; `stuck` the reading in degrees a failed left AoA vane sticks at (null = healthy); `gust` vertical
gust amplitude m/s (7 = moderate turbulence).

Question: {q}

Return ONLY JSON: {{"scenarios": [{{"id": "short-kebab-id", "label": "short description", "speed_kt": 140-320,
"pull": 0-20, "idle": true|false, "split": 0-20, "stuck": null or -10-40, "gust": 0-15}}], "explain": "one sentence"}}
Use 1 to 3 scenarios."""


def flight_scenario(i, s, label):
    """Clamp a what-if scenario to the flight model's valid range (never trust model output)."""
    num = lambda k, lo, hi, d: max(lo, min(hi, float(s.get(k) if s.get(k) is not None else d)))  # noqa: E731
    pull = num("pull", 0, 20, 0)
    return {"id": re.sub(r"[^a-z0-9-]", "", str(s.get("id", f"what-if-{i + 1}")).lower())[:30] or f"what-if-{i + 1}",
            "label": str(s.get("label") or label)[:80], "speed_kt": num("speed_kt", 140, 320, 200), "pull": pull,
            "idle": bool(s.get("idle")), "split": num("split", 0, 20, 0),
            "stuck": None if s.get("stuck") is None else num("stuck", -10, 40, 22), "gust": num("gust", 0, 15, 0),
            "event_at": 5, "seconds": 60, "max_alt_loss_ft": None if pull else 300}


def flight_whatif(question):
    ev("simulation", "working", f'Simulation Agent: turning "{question}" into flight scenarios', title=question)
    out, err = ask_json(FLIGHT_WHATIF_PROMPT.format(q=question))
    clean = [flight_scenario(i, s, question) for i, s in enumerate(((out or {}).get("scenarios") or [])[:3])]
    if not clean:
        q, nums = question.lower(), [float(n) for n in re.findall(r"\d+(?:\.\d+)?", question)]
        n = nums[0] if nums else None
        if re.search(r"fail|stuck|jam|frozen", q):
            s = {"stuck": n if n is not None else 22, "speed_kt": 220}
        elif re.search(r"turbulen|gust", q):
            s = {"gust": n if n is not None else 10, "speed_kt": 250}
        else:
            s = {"pull": 16, "idle": True, "split": n if n is not None and re.search(r"disagree|split|sideslip|differ", q) else 0}
        clean = [flight_scenario(0, {"id": "what-if", **s}, question)]
        ev("simulation", "done", f"LLM unavailable, parsed the question directly ({err[:60] if err else ''})", scenarios=clean)
    else:
        ev("simulation", "done", (out or {}).get("explain", "Scenarios ready"), scenarios=clean)
    sf = os.path.join(RUNS, f"whatif-{int(time.time())}.json")
    os.makedirs(RUNS, exist_ok=True)
    json.dump(clean, open(sf, "w"))
    ev("world", "working", f"Flying {len(clean) * 6} simulated aircraft on the current flight control software")
    subprocess.run([PY, os.path.join(ROOT, "sim/flight.py"), "--repo", ROOT, "--base", "none", "--scenarios", sf,
                    "--question", question], cwd=ROOT, capture_output=True)
    return 0


CACHE = os.path.join(RUNS, "cache")


def _title(text):
    return " ".join(text.splitlines()[0].lower().split()) if text.strip() else ""


def _cached(kind, text, wo=None):
    """Cache path for this request on the code that produces it: the project's device code (builds start from
    origin/<base>, what-ifs simulate this checkout) plus this checkout's simulator, gate and pipeline. Any change to
    them gives a new key, so a cached run is never older than the code it describes."""
    rev = f"origin/{os.environ.get('FACTORY_BASE') or 'main'}" if kind == "build" else "HEAD"
    code = subprocess.run(["git", "-C", ROOT, "rev-parse", f"{rev}:{project_device(wo)['repo']}", "HEAD:sim", "HEAD:gate",
                           "HEAD:factory/pipeline.py"], capture_output=True, text=True).stdout
    return os.path.join(CACHE, f"{kind}-{hashlib.sha1((_title(text) + code).encode()).hexdigest()[:12]}")


def recorded(kind, text, wo=None):
    """A real earlier run of the same request (same title): this machine's cache first, then the stage recording.
    Live mode replays it in seconds instead of waiting minutes on agents; new requests still run for real."""
    p = _cached(kind, text, wo)
    if os.path.exists(p + ".jsonl"):
        return p
    stage = os.path.join(ROOT, project_device(wo)["replay"], kind)
    first = json.loads(open(stage + ".jsonl").readline()) if os.path.exists(stage + ".jsonl") else {}
    return stage if _title(first.get("title", "")) == _title(text) else None


def save(kind, text, wo=None, p=None):
    """Cache this process's finished live run so the same request answers instantly next time."""
    evs = [json.loads(line) for line in open(emit.FEED) if line.strip()]
    rec = [e for e in evs if e["run"] == emit.RUN and (not wo or e.get("wo") == wo) and e["agent"] != "actions"]
    done = rec and (rec[-1]["agent"] == "reviewer" and not rec[-1].get("not_run") if wo else any(e.get("world") for e in rec))
    if not done:
        return
    os.makedirs(CACHE, exist_ok=True)
    p = p or _cached(kind, text, wo)
    if wo:
        open(p + ".diff.txt", "w").write(store.diff(wo))
        json.dump(store.git_changes(wo), open(p + ".commits.json", "w"))
        if os.path.exists(os.path.join(RUNS, f"{wo}.evidence.md")):
            open(p + ".evidence.md", "w").write(open(os.path.join(RUNS, f"{wo}.evidence.md")).read())
    open(p + ".jsonl", "w").write("".join(json.dumps(e) + "\n" for e in rec))


def replay(src, wo=None):
    """Play the real run recorded at <src>.jsonl (demo/record.py for the stage, save() for the cache) instead of
    calling agents, so a demo never waits on an LLM. Gaps are divided by REPLAY_SPEED and capped at
    REPLAY_MAX_GAP seconds; each BLOCKED gate verdict stays on screen so it can be narrated, for the next value of
    REPLAY_HOLD (seconds, comma-separated, last one repeats).
    Messages, gate rows, simulations, evidence and PR link are the recorded ones."""
    speed, cap = float(os.environ.get("REPLAY_SPEED", "4")), float(os.environ.get("REPLAY_MAX_GAP", "4"))
    holds = [float(h) for h in os.environ.get("REPLAY_HOLD", "30,15").split(",")]
    rec = [e for line in open(src + ".jsonl") if line.strip() and (e := json.loads(line))["agent"] != "actions"]
    old = rec[0].get("wo")
    sub = (lambda s: s.replace(old, wo)) if old and wo else (lambda s: s)  # noqa: E731
    os.makedirs(RUNS, exist_ok=True)
    # The recorded code change appears as the run reaches it: each attempt's commit with its "committed" event, the
    # final diff and evidence pack with the evidence step. Copied up front, they would give away the ending.
    out = lambda ext: os.path.join(RUNS, f"{wo}.{ext}")  # noqa: E731
    later = sorted(json.load(open(src + ".commits.json")), key=lambda c: int(c["ts"])) if os.path.exists(src + ".commits.json") else []
    shown = []
    if wo:
        for ext in ("evidence.md", "diff.txt"):
            if os.path.exists(out(ext)):
                os.remove(out(ext))
        json.dump(shown, open(out("commits.json"), "w"))
    prev, world, checked = 0.0, None, None
    dev, intent, live = project_device(wo), rec[0].get("title", ""), {}
    for e in rec:
        time.sleep(min(max(e["t"] - prev, 0) / speed, cap))
        prev = e["t"]
        if e.get("lesson"):  # memory recall and the lesson write-back happen live, not from the recording
            continue
        kw = {k: v for k, v in e.items() if k not in ("run", "t", "agent", "state", "msg", "wo")}
        kw.setdefault("replay", {"wo": old, "at": int(float(rec[0]["run"]))})  # the UI says which real run this is
        if e["agent"] == "gate" and e["state"] == "working":
            world = None
        world = kw.get("world") or world
        if kw.get("gate") and "checker" not in kw["gate"]:
            # Recorded before the verdict layer existed: re-verify the recorded evidence for display. The recorded
            # state stays the verdict; gate/test_gate.py asserts the two agree on every recording.
            rules = json.load(open(os.path.join(ROOT, project_device(wo)["repo"], "safety.json")))
            kw["gate"] = {**kw["gate"], "checker": verdict.checker(verdict.decide(verdict.evidence(rules, [], kw["gate"]["rows"], world)))}
        checked = (kw.get("gate") or {}).get("checker") or checked
        if wo:
            kw["wo"] = wo
            for key in ("gate", "world"):
                if key in kw:
                    json.dump(kw[key], open(os.path.join(RUNS, f"{wo}.{key}.json"), "w"))
            if "evidence" in kw:
                kw["evidence"] = {**kw["evidence"], "wo": wo}
            if e["agent"].startswith("coder") and e["msg"].endswith("committed") and later:
                c = later.pop(0)
                shown.insert(0, {**c, "subject": sub(c["subject"])})
                json.dump(shown, open(out("commits.json"), "w"))
            if e["agent"] == "evidence" and e["state"] == "done":
                for ext in ("evidence.md", "diff.txt", "commits.json"):
                    if os.path.exists(f"{src}.{ext}"):
                        body = sub(open(f"{src}.{ext}").read())
                        if ext == "evidence.md" and checked and "Deterministic gate:" not in body:
                            body = re.sub(r"^(\*\*Decision:\*\*.*)$", lambda m: m.group(1) + "\n" + checked["label"], body, count=1, flags=re.M)
                        open(out(ext), "w").write(body)
        msg = sub(e["msg"])
        if e["agent"] == "memory" and e["state"] == "done":
            _, msg, kw["memory"], kw["recall"] = recall(intent, dev)
            live["lessons"], live["msg"], live["info"] = past_runs(intent, dev)
        if "lessons" in e or (e["agent"] == "safety" and e["state"] == "working" and "lessons" in live):
            kw["lessons"], kw["recall"] = live.get("lessons", []), live.get("info")
            msg = live.get("msg", msg) if e["agent"] == "planner" else safety_msg(kw["lessons"])
        emit.emit(e["agent"], e["state"], msg, **kw)
        if e["agent"] == "memory" and e["state"] == "done" and not any("lessons" in r for r in rec):  # recorded before the planner recalled past runs
            emit.emit("planner", "done", live["msg"], lessons=live["lessons"], recall=live["info"], **({"wo": wo} if wo else {}))
        if e["agent"] == "evidence" and e["state"] == "done" and wo:
            last = rec[-1]
            reason = re.search(r"BLOCKED: (.*?)\. Not mergeable", sub(last["msg"]))
            write_lesson(wo, intent, dev, last["agent"] == "reviewer" and last["state"] == "done", reason.group(1) if reason else "",
                         (kw.get("evidence") or {}).get("headline", ""), replay_of=old)
        if e["agent"] == "gate" and e["state"] == "blocked":
            time.sleep(holds.pop(0) if len(holds) > 1 else holds[0])
    last, evd = rec[-1], next((e["evidence"] for e in reversed(rec) if e.get("evidence")), {})
    if wo and last["agent"] == "reviewer" and not last.get("not_run"):
        post_actions(wo, rec[0].get("title", "").split("\n")[0], last["state"] == "done", sub(last["msg"]), evd.get("headline", ""))
    return 0 if not wo or rec[-1]["state"] == "done" else 1


# Every one-click request on Home, per device (SUGGEST and SUGGEST_BY_DEVICE in web/src/app/page.tsx); keep in sync.
HOME = {"insulin-pump": [("whatif", "What if a child eats 80 g and the parent types the dose 10x?"),
                         ("whatif", "What if an adult eats 150 g of carbs?"),
                         ("build", "Let adults take larger meal boluses"),
                         ("build", "Add an alarm when the extended bolus is interrupted")],
        "flight-controls": [("build", "Add AoA disagree alert when the two sensors differ by more than 5 degrees"),
                            ("whatif", "What if the left AoA vane fails at 30 degrees?"),
                            ("whatif", "What if the pilot pulls to a stall in heavy turbulence?")]}


def prewarm():
    """Run each Home suggestion without a recording for real, once per code version (demo/go.sh live starts this in the
    background), so a click on stage replays a real run in seconds. Own feed, no PRs, no Composio side effects; one
    pre-warm at a time."""
    lock = open(os.path.join(RUNS, "prewarm.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("pre-warm already running")
        return 0
    env = {k: v for k, v in os.environ.items() if k not in ("RUN_ID", "RUN_T0", "FACTORY_PR", "COMPOSIO_API_KEY")}
    env.update(FACTORY_CACHE="0", EVENTS=os.path.join(RUNS, "prewarm-events.jsonl"))
    projects = {p["device"]: p["id"] for p in store._load()["projects"]}
    tag = hashlib.sha1(ROOT.encode()).hexdigest()[:4]  # wo/* branches are shared by every checkout
    for i, (device, kind, text) in enumerate([(d, k, t) for d, items in HOME.items() for k, t in items], 1):
        if device not in projects:
            continue
        os.environ["FACTORY_PROJECT"] = env["FACTORY_PROJECT"] = projects[device]
        src = recorded(kind, text)
        if src:
            print(f"{'cached' if src.startswith(CACHE) else 'recorded'}: {text}", flush=True)
            continue
        print(f"warming: {text}", flush=True)
        subprocess.run([PY, os.path.abspath(__file__), kind, text, *([f"WO-WARM{i}-{tag}"] if kind == "build" else [])], env=env)
        print(f"{'ready' if os.path.exists(_cached(kind, text) + '.jsonl') else 'FAILED'}: {text}", flush=True)
    return 0


if __name__ == "__main__":
    # pipeline.py build "<request>" [WO-101]   |   pipeline.py whatif "<question>"   |   pipeline.py prewarm
    # FACTORY_REPLAY=1 always plays the stage recording; FACTORY_CACHE=0 forces a fresh live run.
    if sys.argv[1] == "prewarm":
        sys.exit(prewarm())
    kind, text, wo = sys.argv[1], sys.argv[2], (sys.argv[3:4] or [None])[0]
    src = os.path.join(ROOT, project_device(wo)["replay"], kind) if os.environ.get("FACTORY_REPLAY") == "1" else \
        None if os.environ.get("FACTORY_CACHE") == "0" else recorded(kind, text, wo)
    if src:
        sys.exit(replay(src, wo))
    key = _cached(kind, text, wo)  # before the run: the runner's fetch may move origin/main
    rc = build(text, wo) if kind == "build" else whatif(text)
    save(kind, text, wo, key)
    sys.exit(rc)
