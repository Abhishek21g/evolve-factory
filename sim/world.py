"""World-model check: run a candidate's real pump.c inside simulated type 1 diabetic patients.

Usage: python3 sim/world.py --repo PATH [--base main] [--json out.json] [--wo WO-12]
Exit 0 = change adds no new severe hypoglycemia, 1 = BLOCKED.

Patients: simglucose (MIT), the open-source UVA/Padova T1D simulator, 10 virtual adults.
The candidate's demo/pump/pump.c is compiled and called through ctypes, so the code under review
decides every dose. Deterministic: fixed cohort, fixed scenarios, no sensor noise, no randomness.

Scenarios (fixed by the safety engineer, agents cannot edit this file):
  large-meal    120 g meal; user asks for the correct dose (carbs / carb ratio). If the pump rejects it
                and supports an extended bolus, the user picks extended mode; otherwise nothing is given.
  decimal-slip  15 g snack; user means carbs/CR but types 10x (a known pump use-error).
                If the pump rejects it, the user notices and re-enters the intended dose.
Verdict (non-regression): BLOCKED if the change makes any simulated patient go below 54 mg/dL
(level 2 hypoglycemia, international consensus) who did not on the base branch.
Severe hypoglycemia that already happens on base is reported as PRE-EXISTING RISK (a new hazard
ticket for the Safety Analyst), not blamed on this change. Max BG is reported as efficacy.
"""
import argparse
import ctypes
import json
import math
import os
import subprocess
import sys
import tempfile
import types

# ponytail: simglucose 0.2.x imports legacy gym only to register an env we don't use; stub it.
_r = types.ModuleType("gym.envs.registration")
_r.register = lambda *a, **k: None
sys.modules.update({"gym": types.ModuleType("gym"), "gym.envs": types.ModuleType("gym.envs"), "gym.envs.registration": _r})
import warnings  # noqa: E402
warnings.filterwarnings("ignore")
import pandas as pd  # noqa: E402
import simglucose  # noqa: E402
from simglucose.patient.t1dpatient import Action, T1DPatient  # noqa: E402

MEAL_AT, MINUTES = 30, 360
SEVERE_HYPO, HYPER = 54, 250
OK, REJECT_LIMIT = 0, 1
CR = pd.read_csv(os.path.join(os.path.dirname(simglucose.__file__), "params", "Quest.csv")).set_index("Name")["CR"]


class State(ctypes.Structure):
    _fields_ = [("delivered_today_u", ctypes.c_double), ("last_heartbeat_ms", ctypes.c_long)]


def load_pump(src_dir, out_dir):
    lib = os.path.join(out_dir, "libpump.so")
    subprocess.run(["cc", "-shared", "-fPIC", "-o", lib, os.path.join(src_dir, "pump.c")], check=True)
    pump = ctypes.CDLL(lib)
    pump.request_bolus.argtypes = [ctypes.POINTER(State), ctypes.c_double, ctypes.c_int]
    ext = getattr(pump, "request_extended_bolus", None)
    if ext:
        ext.argtypes = [ctypes.POINTER(State), ctypes.c_double, ctypes.c_int, ctypes.c_int]
    return pump, ext


# Fixed gate scenarios (protected). A what-if run may pass its own list in the same shape via --scenarios.
#   carbs: meal grams; typo: factor the user mistypes the correct dose by (1 = no typo);
#   fallback when the pump rejects: "extended" (user picks extended mode) or "reenter" (user types the intended dose);
#   cohort: adult | adolescent | child (10 virtual patients each).
SCENARIOS = [
    {"id": "large-meal", "label": "120 g meal, correct dose", "carbs": 120, "typo": 1, "fallback": "extended", "cohort": "adult"},
    {"id": "decimal-slip", "label": "15 g snack, dose typed 10x", "carbs": 15, "typo": 10, "fallback": "reenter", "cohort": "adult"},
]


def plan(pump, ext, sc, cr, bg):
    """Ask the pump under test for a dose. Returns (carbs_g, [(minute, units_per_min, minutes)], note)."""
    s = State(0, 0)
    carbs = sc["carbs"]
    want = carbs / cr
    typed = want * sc.get("typo", 1)
    if pump.request_bolus(ctypes.byref(s), typed, bg) == OK:
        return carbs, [(MEAL_AT, typed, 1)], (f"typo {typed:.1f} U delivered" if typed != want else f"bolus {want:.1f} U")
    if sc.get("fallback") == "reenter" and typed != want and pump.request_bolus(ctypes.byref(s), want, bg) == OK:
        return carbs, [(MEAL_AT, want, 1)], f"typo {typed:.1f} U rejected, re-entered {want:.1f} U"
    if sc.get("fallback") == "extended" and ext:
        mins = max(60, math.ceil(typed * 6))  # user picks the shortest duration at 10 U/h
        if ext(ctypes.byref(s), typed, bg, mins) == OK:
            return carbs, [(MEAL_AT, typed / mins, mins)], f"extended {typed:.1f} U over {mins} min"
    return carbs, [], f"{typed:.1f} U rejected, no insulin"


def simulate(name, carbs, doses):
    p = T1DPatient.withName(name)
    basal = p._params["u2ss"] * p._params["BW"] / 6000  # U/min, simglucose convention
    trace = []
    for t in range(MINUTES):
        extra = sum(u for start, u, dur in doses if start <= t < start + dur)
        p.step(Action(CHO=carbs if t == MEAL_AT else 0, insulin=basal + extra))
        trace.append(float(p.observation.Gsub))
    return trace


def cohort(src_dir, scenarios):
    with tempfile.TemporaryDirectory() as d:
        pump, ext = load_pump(src_dir, d)
        results = []
        for sc in scenarios:
            scenario = sc["id"]
            for name in [f"{sc.get('cohort', 'adult')}#{i:03d}" for i in range(1, 11)]:
                bg0 = int(T1DPatient.withName(name).observation.Gsub)
                carbs, doses, note = plan(pump, ext, sc, float(CR[name]), bg0)
                trace = simulate(name, carbs, doses)
                results.append({"scenario": scenario, "patient": name, "note": note,
                                "min": round(min(trace)), "max": round(max(trace)),
                                "hypo": min(trace) < SEVERE_HYPO, "hyper_min": sum(g > HYPER for g in trace),
                                "trace": [round(g) for g in trace[::5]]})
    return results


def base_src(repo, base, d):
    """Export base branch pump sources (pump.c includes pump.h) into d."""
    for f in ("pump.c", "pump.h"):
        src = subprocess.run(["git", "-C", repo, "show", f"{base}:demo/pump/{f}"], capture_output=True, text=True, check=True).stdout
        open(os.path.join(d, f), "w").write(src)
    return d


def run(repo, base, scenarios=SCENARIOS):
    cand = cohort(os.path.join(repo, "demo/pump"), scenarios)
    with tempfile.TemporaryDirectory() as d:
        before = {(r["scenario"], r["patient"]): r for r in cohort(base_src(repo, base, d), scenarios)}
    for r in cand:
        b = before[(r["scenario"], r["patient"])]
        r["base_min"], r["base_trace"] = b["min"], b["trace"]
        r["new_hypo"] = r["hypo"] and not b["hypo"]
        r["preexisting"] = r["hypo"] and b["hypo"]
    return {"verdict": "BLOCKED" if any(r["new_hypo"] for r in cand) else "PASS", "threshold": SEVERE_HYPO,
            "step_min": 5, "meal_at": MEAL_AT, "base": base, "scenarios": scenarios, "results": cand}


def report(res):
    lines = [f"## World model: {res['verdict']}", "",
             "10 simulated adults (UVA/Padova, simglucose), candidate pump.c compiled and in the loop.", "",
             f"| Scenario | Patient | Pump decision | Min BG | Min BG on {res['base']} | Max BG | Severe hypo |", "|---|---|---|---|---|---|---|"]
    for r in res["results"]:
        flag = "NEW (caused by this change)" if r["new_hypo"] else "pre-existing" if r["preexisting"] else "no"
        lines.append(f'| {r["scenario"]} | {r["patient"]} | {r["note"]} | {r["min"]} | {r["base_min"]} | {r["max"]} | {flag} |')
    new = [r for r in res["results"] if r["new_hypo"]]
    old = [r for r in res["results"] if r["preexisting"]]
    if new:
        lines += ["", f"BLOCKED: this change makes {len(new)} simulated patient run(s) fall below {SEVERE_HYPO} mg/dL (H-1 overdose, H-3 hypoglycemia)."]
    if old:
        lines += ["", f"PRE-EXISTING RISK (not caused by this change): {len(old)} run(s) already fall below {SEVERE_HYPO} mg/dL on {res['base']}: "
                  + ", ".join(f'{r["scenario"]}/{r["patient"]}' for r in old) + ". Needs a new safety requirement."]
    return "\n".join(lines)


def main(argv=None):
    a = argparse.ArgumentParser()
    a.add_argument("--repo", default=".")
    a.add_argument("--base", default="main")
    a.add_argument("--json")
    a.add_argument("--wo")
    a.add_argument("--scenarios", help="what-if scenario list (JSON file); default = the fixed gate scenarios")
    a.add_argument("--question", help="plain-English question the scenarios answer (shown on the dashboard)")
    args = a.parse_args(argv)
    res = run(args.repo, args.base, json.load(open(args.scenarios)) if args.scenarios else SCENARIOS)
    if args.question:
        res["question"] = args.question
    if args.json:
        json.dump(res, open(args.json, "w"))
    try:  # report to the dashboard; never fail the check because of the feed
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dashboard"))
        import emit
        new = sum(r["new_hypo"] for r in res["results"])
        old = sum(r["preexisting"] for r in res["results"])
        hypo = sum(r["hypo"] for r in res["results"])
        msg = (f"What-if answered: {hypo} of {len(res['results'])} simulated runs reach severe hypoglycemia" if args.question
               else f"{res['verdict']}: {new} new severe-hypo runs caused by this change; {old} pre-existing")
        emit.emit("world", "done" if args.question else res["verdict"].lower(), msg,
                  wo=args.wo, world=res)
    except Exception:
        pass
    print(report(res))
    return 0 if res["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
