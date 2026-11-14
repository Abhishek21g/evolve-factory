"""Simulation Agent: ask the world model a question in plain English; Claude plans and runs the simulations.

Usage: .venv/bin/python sim/agent.py "What happens if an adult enters 10x their meal dose by mistake?"
       [--repo .] [--pump worktree|main|<git ref>|<worktree path>]
From code: sys.path.insert(0, "sim"); import agent; agent.ask(question, repo, ref) -> result dict

Claude (Anthropic Messages API, tool use) turns the question into scenarios and calls deterministic tools backed
by sim/world.py: the real pump.c compiled and in the loop with 10 virtual patients (simglucose, UVA/Padova).
Every number in the answer comes from a tool result. Claude never approves a change: the gate does.
Progress goes to the dashboard feed (dashboard/emit.py); the full result is written to .runs/whatif-<ts>.json in
the world-model shape the web app already renders (World + question), plus the answer and the tool calls.
Key: $ANTHROPIC_API_KEY, else ANTHROPIC_API_KEY in <repo>/.env or the main checkout's .env. Never printed.
"""
import argparse
import hashlib
import json
import multiprocessing
import os
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool

import anthropic

SIM = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SIM)
sys.path.insert(0, SIM)
sys.path.insert(0, os.path.join(ROOT, "dashboard"))
import world  # noqa: E402
import emit  # noqa: E402

MODEL = os.environ.get("SIM_AGENT_MODEL", "claude-fable-5-2")
MAX_TOOL_CALLS, DEADLINE_S = 8, 150
AGENT = "simulation"  # the web app's World model lane listens to "simulation" and "world"

SCENARIO_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string", "description": "short-kebab-id"},
        "label": {"type": "string", "description": "short human description"},
        "cohort": {"type": "string", "enum": ["adult", "adolescent", "child"]},
        "carbs": {"type": "number", "description": "grams the user doses for (dose = carbs / carb ratio), 0-200"},
        "eaten": {"type": "number", "description": "grams actually eaten (default = carbs; 0 = dosed then skipped the meal)"},
        "typo": {"type": "number", "description": "user types the correct dose times this factor (1 = correct, 10 = decimal slip), 1-20"},
        "dose_u": {"type": "number", "description": "exact units the user types; overrides carbs/CR*typo, 0-50"},
        "fallback": {"type": "string", "enum": ["reenter", "extended"],
                     "description": "if the pump rejects: re-enter the intended dose, or try extended bolus"},
        "meal_at": {"type": "integer", "description": "minute of the meal/bolus, 0-600 (default 30)"},
        "minutes": {"type": "integer", "description": "simulated minutes, 120-720 (default 360)"},
        "bg_start": {"type": "number", "description": "starting blood glucose mg/dL, 40-400 (default: the patient's "
                     "fasting BG, ~100-160); without food or insulin BG drifts back toward fasting over hours"},
        "sensitivity": {"type": "number",
                        "description": "multiplier 0.5-3 on insulin action above basal (Vmx; 1 = normal). 1.5-2 approximates "
                        "the raised insulin sensitivity after exercise. Exercise's insulin-independent glucose uptake "
                        "is NOT modeled, so with no bolus BG does not change"},
    },
    "required": ["id", "carbs"],
}
PUMP_DESC = ('pump firmware to run: "worktree" (the code on disk in the repo, default), "main", any git branch/ref, '
             "or a path to a git worktree")
TOOLS = [
    {"name": "list_patients", "description": "Virtual patients in a cohort (10 each) with weight, carb ratio, basal and fasting BG.",
     "input_schema": {"type": "object", "properties": {"cohort": {"type": "string", "enum": ["adult", "adolescent", "child"]}}}},
    {"name": "get_safety_requirements",
     "description": "Hazards and safety requirements (safety.json), the pump's limits (pump.h) and the fixed gate scenarios.",
     "input_schema": {"type": "object", "properties": {"pump": {"type": "string", "description": PUMP_DESC}}}},
    {"name": "run_scenario",
     "description": "Run 1-3 scenarios on one pump build. Each scenario runs the real pump.c with 10 virtual patients, "
                    "one step per minute. Returns per patient: pump decision, min/max BG, time in range 70-180, severe "
                    "hypo (<54 mg/dL), minute of the lowest BG.",
     "input_schema": {"type": "object", "properties": {
         "scenarios": {"type": "array", "items": SCENARIO_SCHEMA, "minItems": 1, "maxItems": 3},
         "pump": {"type": "string", "description": PUMP_DESC}}, "required": ["scenarios"]}},
    {"name": "compare_to_main",
     "description": "Run the same 1-3 scenarios on a candidate build and on main (or another base), patient by patient. "
                    "Reports severe hypos the candidate causes that main does not (what the gate blocks on).",
     "input_schema": {"type": "object", "properties": {
         "scenarios": {"type": "array", "items": SCENARIO_SCHEMA, "minItems": 1, "maxItems": 3},
         "pump": {"type": "string", "description": PUMP_DESC},
         "base": {"type": "string", "description": 'base build, default "main"'}}, "required": ["scenarios"]}},
]

SYSTEM = """You are the Simulation Agent of Certus Factory, a software factory for an insulin pump (demo firmware, not a
medical device). An operator asks a what-if question in plain English. Answer it by running the world model: the real
pump firmware (pump.c) compiled and in the loop with virtual type 1 diabetic patients from the UVA/Padova simulator
(simglucose). Deterministic: no sensor noise, fixed cohorts of 10.

How a scenario works: at `meal_at` the user asks the pump for a bolus (correct dose = carbs / the patient's carb
ratio, times `typo`, or exactly `dose_u`) and eats `eaten` grams. The pump code accepts or rejects (it has a single
bolus limit, a daily limit and a no-bolus-below-70 mg/dL rule). If it rejects, the user re-enters the intended dose
or tries extended mode. Basal insulin runs throughout. `sensitivity` > 1 approximates the extra insulin sensitivity
after exercise (it only scales bolus insulin's effect).

Plan first: say in one or two sentences which scenarios you will run and why, then call tools. Usually run the
scenario the question asks about plus a control (the same situation done correctly) in ONE run_scenario call, so you
can attribute the effect. Use follow-ups only if a result raises a real question. You have at most 8 tool calls.

Then answer in plain English for a clinical safety engineer:
- First line: "Verdict: SAFE", "Verdict: UNSAFE" or "Verdict: AT RISK", then a one-sentence answer.
  UNSAFE = any simulated patient falls below 54 mg/dL (level 2 hypoglycemia) in the asked scenario.
- Then the numbers that support it, taken only from tool results: pump decisions, how many of 10 patients hit severe
  hypo, lowest BG and who, max BG, time in range. Compare with the control. Quote the `counts` and patient lists the
  tools return; do not count patients yourself.
- Then one line on limits of the simulation (approximations, what was not modeled).
Be concise (under 200 words). Never invent numbers you did not get from a tool."""


def api_key(repo):
    if os.environ.get("ANTHROPIC_API_KEY"):
        return os.environ["ANTHROPIC_API_KEY"]
    common = subprocess.run(["git", "-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"],
                            capture_output=True, text=True).stdout.strip()
    for env in (os.path.join(repo, ".env"), os.path.join(os.path.dirname(common), ".env") if common else ""):
        if env and os.path.exists(env):
            for line in open(env):
                if line.startswith("ANTHROPIC_API_KEY="):
                    return line.split("=", 1)[1].strip().strip("'\"")
    raise RuntimeError("ANTHROPIC_API_KEY not set and not found in .env")


def clean(sc, i):
    """Never trust model output: clamp every field to the simulator's valid range."""
    def num(k, lo, hi, default=None):
        v = sc.get(k, default)
        return None if v is None else max(lo, min(hi, float(v)))
    out = {"id": re.sub(r"[^a-z0-9-]", "", str(sc.get("id", "")).lower())[:30] or f"what-if-{i + 1}",
           "label": str(sc.get("label", ""))[:80],
           "cohort": sc.get("cohort") if sc.get("cohort") in ("adult", "adolescent", "child") else "adult",
           "carbs": num("carbs", 0, 200, 60), "typo": num("typo", 1, 20, 1),
           "fallback": "extended" if sc.get("fallback") == "extended" else "reenter"}
    for k, lo, hi in (("eaten", 0, 200), ("dose_u", 0, 50), ("bg_start", 40, 400), ("sensitivity", 0.5, 3)):
        if sc.get(k) is not None:
            out[k] = num(k, lo, hi)
    for k, lo, hi in (("meal_at", 0, 600), ("minutes", 120, 720)):
        if sc.get(k) is not None:
            out[k] = int(num(k, lo, hi))
    if out.get("meal_at", world.MEAL_AT) >= out.get("minutes", world.MINUTES):
        out["meal_at"] = out.get("minutes", world.MINUTES) // 2
    if not out["label"]:
        out["label"] = out["id"]
    return out


_LIBS = {}


def _job(lib, name, sc):
    """One patient run in a worker process (the compiled pump is loaded once per process)."""
    if lib not in _LIBS:
        _LIBS[lib] = world.bind_pump(lib)
    return world.row(sc, name, *world.simulate(_LIBS[lib], name, sc, float(world.CR[name])))


class Session:
    """Builds, caches and runs pump builds for one question. Results are cached on disk by firmware + scenario."""

    def __init__(self, repo, default_pump="worktree"):
        self.repo, self.default_pump = os.path.abspath(repo), default_pump
        self.cache = os.path.join(self.repo, ".runs", "sim-cache")
        os.makedirs(self.cache, exist_ok=True)
        self.pool = ProcessPoolExecutor(max_workers=min(10, os.cpu_count() or 2),
                                        mp_context=multiprocessing.get_context("spawn"))
        self.libs = {}

    def close(self):
        self.pool.shutdown(cancel_futures=True)

    def sources(self, pump):
        """(pump.c, pump.h) text for a build: worktree on disk, a worktree path, or a git ref."""
        pump = pump or self.default_pump
        d = self.repo if pump == "worktree" else pump if os.path.isdir(os.path.join(pump, "demo/pump")) else None
        if d:
            return tuple(open(os.path.join(d, "demo/pump", f)).read() for f in ("pump.c", "pump.h"))
        out = []
        for f in ("pump.c", "pump.h"):
            p = subprocess.run(["git", "-C", self.repo, "show", f"{pump}:demo/pump/{f}"], capture_output=True, text=True)
            if p.returncode:
                raise ValueError(f'unknown pump build "{pump}": {p.stderr.strip()[:200]}')
            out.append(p.stdout)
        return tuple(out)

    def lib(self, pump):
        src = self.sources(pump)
        key = hashlib.sha256("\0".join(src + (open(world.SHIM).read(),)).encode()).hexdigest()[:16]
        if key not in self.libs:
            lib = os.path.join(self.cache, f"libpump-{key}.so")
            if not os.path.exists(lib):
                with tempfile.TemporaryDirectory() as d:
                    for f, text in zip(("pump.c", "pump.h"), src):
                        open(os.path.join(d, f), "w").write(text)
                    world.compile_pump(d, lib)
            self.libs[key] = lib
        return key, self.libs[key]

    def run(self, scenarios, pump):
        """Rows for every patient of every scenario on one build (cached)."""
        key, lib = self.lib(pump)
        rows = []
        for sc in scenarios:
            f = os.path.join(self.cache, hashlib.sha256((key + json.dumps(sc, sort_keys=True)).encode()).hexdigest()[:20] + ".json")
            if os.path.exists(f):
                rows += json.load(open(f))
                continue
            try:
                got = list(self.pool.map(_job, [lib] * 10, world.names(sc), [sc] * 10))
            except BrokenProcessPool:  # e.g. the caller's __main__ cannot be re-imported: run in-process
                got = [_job(lib, n, sc) for n in world.names(sc)]
            json.dump(got, open(f, "w"))
            rows += got
        return rows


def summarize(rows, sc):
    rs = [r for r in rows if r["scenario"] == sc["id"]]
    worst = min(rs, key=lambda r: r["min"])
    return {"scenario": sc, "patients": len(rs), "severe_hypo": sum(r["hypo"] for r in rs),
            "no_insulin_given": sum(r["note"].endswith("no insulin") for r in rs),
            "typo_dose_delivered": sum("typo" in r["note"] and "delivered" in r["note"] for r in rs),
            "lowest_bg": {"patient": worst["patient"], "mg_dl": worst["min"], "at_minute": worst["nadir_at"]},
            "highest_bg": max(r["max"] for r in rs),
            "mean_time_in_range_pct": round(sum(r["tir"] for r in rs) / len(rs)),
            "per_patient": [{k: r[k] for k in ("patient", "note", "min", "max", "tir", "hypo")} for r in rs]}


class Agent:
    def __init__(self, question, repo, pump):
        self.question, self.repo, self.pump = question, os.path.abspath(repo), pump
        self.session = Session(repo, pump)
        self.scenarios, self.results, self.calls = [], [], []
        self.compared = None

    def label_pump(self, pump):
        return pump or self.pump

    def add(self, scenarios, rows, pump, base_rows=None, base=None):
        """Keep everything for the result file; scenario ids are made unique across tool calls and builds."""
        taken = {s["id"] for s in self.scenarios}
        for sc in scenarios:
            uid, n = sc["id"] + ("" if self.label_pump(pump) == self.pump else f"@{self.label_pump(pump)}"), 2
            while uid in taken:
                uid, n = f"{sc['id']}-{n}", n + 1
            taken.add(uid)
            self.scenarios.append({**sc, "id": uid, "pump": self.label_pump(pump), **({"base": base} if base else {})})
            before = {r["patient"]: r for r in (base_rows or []) if r["scenario"] == sc["id"]}
            for r in rows:
                if r["scenario"] != sc["id"]:
                    continue
                b = before.get(r["patient"], r)
                self.results.append({**r, "scenario": uid, "base_min": b["min"], "base_trace": b["trace"],
                                     "base_note": b["note"], "base_tir": b["tir"],
                                     "new_hypo": r["hypo"] and not b["hypo"], "preexisting": r["hypo"] and b["hypo"]})

    def tool(self, name, args):
        if name == "list_patients":
            cohort = args.get("cohort") if args.get("cohort") in ("adult", "adolescent", "child") else "adult"
            params = world.pd.read_csv(world.PATIENT_FILE).set_index("Name")
            return [{"patient": n, "weight_kg": round(float(params.loc[n, "BW"]), 1), "carb_ratio_g_per_u": float(world.CR[n]),
                     "basal_u_per_h": round(float(params.loc[n, "u2ss"] * params.loc[n, "BW"] / 6000 * 60), 2),
                     "fasting_bg_mg_dl": round(float(params.loc[n, "Gb"]))} for n in world.names({"cohort": cohort})]
        if name == "get_safety_requirements":
            spec = json.load(open(os.path.join(self.repo, "demo/pump/safety.json")))
            header = self.session.sources(args.get("pump"))[1]
            return {"hazards": spec["hazards"], "requirements": [{k: r[k] for k in ("id", "text", "hazards")} for r in spec["requirements"]],
                    "pump_limits": re.findall(r"#define\s+(\w+)\s+([\d.]+)", header),
                    "gate_scenarios": world.SCENARIOS, "severe_hypo_mg_dl": world.SEVERE_HYPO}
        scs = [clean(s, i) for i, s in enumerate((args.get("scenarios") or [])[:3])]
        if not scs:
            raise ValueError("give 1 to 3 scenarios")
        pump = args.get("pump") or None
        self.session.lib(pump)  # unknown ref or broken pump: fail before announcing a run
        if name == "compare_to_main":
            self.session.lib(args.get("base") or "main")
        if name == "run_scenario":
            emit_ev("working", f"Running {len(scs) * 10} simulated patients on {self.label_pump(pump)}: "
                    + "; ".join(s["label"] for s in scs))
            rows = self.session.run(scs, pump)
            self.add(scs, rows, pump)
            return {"pump": self.label_pump(pump), "results": [summarize(rows, s) for s in scs]}
        if name == "compare_to_main":
            base = args.get("base") or "main"
            emit_ev("working", f"Comparing {self.label_pump(pump)} against {base} on {len(scs) * 10} simulated patients: "
                    + "; ".join(s["label"] for s in scs))
            rows, base_rows = self.session.run(scs, pump), self.session.run(scs, base)
            self.add(scs, rows, pump, base_rows, base)
            self.compared = base
            out = []
            for s in scs:
                before = {r["patient"]: r for r in base_rows if r["scenario"] == s["id"]}
                pairs = [(r, before[r["patient"]]) for r in rows if r["scenario"] == s["id"]]
                keys = ("note", "min", "max", "tir")
                out.append({"scenario": s, "counts": {
                                "patients": len(pairs), "new_severe_hypo": sum(r["hypo"] and not b["hypo"] for r, b in pairs),
                                "severe_hypo_on_base": sum(b["hypo"] for _, b in pairs),
                                "no_insulin_given_candidate": sum(r["note"].endswith("no insulin") for r, _ in pairs),
                                "no_insulin_given_base": sum(b["note"].endswith("no insulin") for _, b in pairs),
                                "pump_decision_changed": sum(r["note"] != b["note"] for r, b in pairs),
                                "time_in_range_better": sum(r["tir"] > b["tir"] for r, b in pairs),
                                "time_in_range_worse": sum(r["tir"] < b["tir"] for r, b in pairs)},
                            "new_severe_hypo": [r["patient"] for r, b in pairs if r["hypo"] and not b["hypo"]],
                            "preexisting_severe_hypo": [r["patient"] for r, b in pairs if r["hypo"] and b["hypo"]],
                            "pump_decision_changed": [r["patient"] for r, b in pairs if r["note"] != b["note"]],
                            "time_in_range_better": [r["patient"] for r, b in pairs if r["tir"] > b["tir"]],
                            "time_in_range_worse": [r["patient"] for r, b in pairs if r["tir"] < b["tir"]],
                            "per_patient": [{"patient": r["patient"], "candidate": {k: r[k] for k in keys},
                                             "base": {k: b[k] for k in keys}} for r, b in pairs]})
            return {"candidate": self.label_pump(pump), "base": base, "results": out}
        raise ValueError(f"unknown tool {name}")

    def loop(self, client):
        messages = [{"role": "user", "content": self.question}]
        t0 = time.time()
        while True:
            over = len(self.calls) >= MAX_TOOL_CALLS or time.time() - t0 > DEADLINE_S
            r = client.messages.create(model=MODEL, max_tokens=2000, system=SYSTEM, tools=TOOLS, messages=messages,
                                       **({"tool_choice": {"type": "none"}} if over else {}))
            messages.append({"role": "assistant", "content": r.content})
            text = "\n".join(b.text for b in r.content if b.type == "text").strip()
            uses = [b for b in r.content if b.type == "tool_use"]
            if not uses:
                return text
            if text:
                emit_ev("working", text[:300])
            results = []
            for u in uses:
                if len(self.calls) >= MAX_TOOL_CALLS:
                    out, err = {"error": "tool budget used up; answer now with the results you have"}, True
                else:
                    try:
                        out, err = self.tool(u.name, u.input), False
                    except Exception as e:  # bad ref, bad scenario, broken pump: tell Claude, keep going
                        out, err = {"error": str(e)[:500]}, True
                    self.calls.append({"tool": u.name, "input": u.input, "error": out["error"] if err else None})
                results.append({"type": "tool_result", "tool_use_id": u.id, "content": json.dumps(out), "is_error": err})
            messages.append({"role": "user", "content": results})


def emit_ev(state, msg, **kw):
    try:
        emit.emit(AGENT, state, msg, **kw)
    except Exception:
        pass


def ask(question, repo=ROOT, ref="worktree"):
    """Answer a what-if question with the world model. Returns the result dict (also written to .runs/)."""
    t0 = time.time()
    emit_ev("working", f'Simulation Agent ({MODEL}): planning simulations for "{question}"', title=question)
    agent = Agent(question, repo, ref)
    try:
        answer = agent.loop(anthropic.Anthropic(api_key=api_key(repo), max_retries=3))
    except Exception as e:
        emit_ev("blocked", f"Simulation Agent failed: {type(e).__name__}: {str(e)[:200]}")
        raise
    finally:
        agent.session.close()
    rs = agent.results
    res = {"verdict": "UNSAFE" if any(r["hypo"] for r in rs) else "SAFE", "threshold": world.SEVERE_HYPO, "step_min": 5,
           "meal_at": agent.scenarios[0].get("meal_at", world.MEAL_AT) if agent.scenarios else world.MEAL_AT,
           "base": agent.compared or "none", "question": question, "pump": ref, "scenarios": agent.scenarios,
           "results": rs, "answer": answer, "model": MODEL, "tool_calls": agent.calls, "elapsed_s": round(time.time() - t0, 1)}
    runs = os.path.join(os.path.abspath(repo), ".runs")
    os.makedirs(runs, exist_ok=True)
    res["file"] = os.path.join(runs, f"whatif-{int(time.time())}.json")
    json.dump(res, open(res["file"], "w"))
    emit_ev("done", (answer.splitlines() or ["No answer"])[0][:300], answer=answer)
    try:
        emit.emit("world", "done", f"What-if answered: {sum(r['hypo'] for r in rs)} of {len(rs)} simulated runs "
                  "reach severe hypoglycemia", world=res)
    except Exception:
        pass
    return res


def main(argv=None):
    a = argparse.ArgumentParser(description="Ask the world model a what-if question in plain English.")
    a.add_argument("question")
    a.add_argument("--repo", default=ROOT)
    a.add_argument("--pump", default="worktree", help='default build: "worktree", "main", a git ref, or a worktree path')
    args = a.parse_args(argv)
    res = ask(args.question, args.repo, args.pump)
    print(f"\n{res['answer']}\n\n({len(res['tool_calls'])} tool calls, {len(res['results'])} patient results, "
          f"{res['elapsed_s']} s, {res['model']}; full result: {os.path.relpath(res['file'])})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
