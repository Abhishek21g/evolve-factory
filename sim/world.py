"""World-model check: run a candidate's real pump.c inside simulated type 1 diabetic patients.

Usage: python3 sim/world.py --repo PATH [--base main] [--json out.json] [--wo WO-12]
Exit 0 = change adds no new severe hypoglycemia, 1 = BLOCKED.

Patients: simglucose (MIT), the open-source UVA/Padova T1D simulator, 10 virtual adults.
The candidate's demo/pump/pump.c is compiled with sim/shim.c against the candidate's own pump.h and
stepped once per minute, so the code under review decides every dose, and insulin given is what the
code records as delivered. Deterministic: fixed cohort, fixed scenarios, no sensor noise, no randomness.

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


SHIM = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shim.c")


def load_pump(src_dir, out_dir):
    """Compile candidate pump.c + sim/shim.c against the candidate's own pump.h (no struct mirroring)."""
    lib = os.path.join(out_dir, "libpump.so")
    flags = ["-undefined", "dynamic_lookup"] if sys.platform == "darwin" else []  # weak optional symbols
    p = subprocess.run(["cc", "-shared", "-fPIC", *flags, "-I", src_dir, "-o", lib,
                        os.path.join(src_dir, "pump.c"), SHIM], capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError("pump does not match the world-model interface in pump.h:\n" + p.stderr[-1500:])
    pump = ctypes.CDLL(lib)
    pump.sim_new.restype = ctypes.c_void_p
    pump.sim_new.argtypes = [ctypes.c_int]
    pump.sim_free.argtypes = [ctypes.c_void_p]
    pump.sim_delivered.restype = ctypes.c_double
    pump.sim_delivered.argtypes = [ctypes.c_void_p]
    pump.sim_bolus.argtypes = [ctypes.c_void_p, ctypes.c_double, ctypes.c_int]
    pump.sim_ext.argtypes = [ctypes.c_void_p, ctypes.c_double, ctypes.c_int, ctypes.c_int]
    pump.sim_tick.argtypes = [ctypes.c_void_p, ctypes.c_int]
    return pump


# Fixed gate scenarios (protected). A what-if run passes its own list in the same shape via --scenarios.
#   carbs: meal grams; typo: factor the user mistypes the correct dose by (1 = no typo);
#   fallback when the pump rejects: "extended" (user picks extended mode) or "reenter" (user types the intended dose);
#   cohort: adult | adolescent | child (10 virtual patients each).
SCENARIOS = [
    {"id": "large-meal", "label": "120 g meal, correct dose", "carbs": 120, "typo": 1, "fallback": "extended", "cohort": "adult"},
    {"id": "decimal-slip", "label": "15 g snack, dose typed 10x", "carbs": 15, "typo": 10, "fallback": "reenter", "cohort": "adult"},
]


def decide(pump, s, sc, cr, bg):
    """User asks the pump under test for a meal dose. Returns (carbs_g, extended_active, note)."""
    carbs = sc["carbs"]
    want = carbs / cr
    typed = want * sc.get("typo", 1)
    if pump.sim_bolus(s, typed, bg) == OK:
        return carbs, False, (f"typo {typed:.1f} U delivered" if typed != want else f"bolus {want:.1f} U")
    if sc.get("fallback") == "reenter" and typed != want and pump.sim_bolus(s, want, bg) == OK:
        return carbs, False, f"typo {typed:.1f} U rejected, re-entered {want:.1f} U"
    if sc.get("fallback") == "extended" and pump.sim_has_ext():
        mins = max(60, math.ceil(typed * 6))  # user picks the shortest duration at 10 U/h
        if pump.sim_ext(s, typed, mins, bg) == OK:
            return carbs, True, f"extended {typed:.1f} U over {mins} min"
    return carbs, False, f"{typed:.1f} U rejected, no insulin"


def simulate(pump, name, scenario, cr):
    """Pump in the loop, one step per minute. Insulin given = what the pump code itself recorded as
    delivered (delivered_today_u delta), never what we assume it would deliver."""
    p = T1DPatient.withName(name)
    basal = p._params["u2ss"] * p._params["BW"] / 6000  # U/min, simglucose convention
    s = pump.sim_new(1)  # adult profile
    trace, carbs, ext, note = [], 0, False, ""
    try:
        for t in range(MINUTES):
            bg = int(p.observation.Gsub)
            before = pump.sim_delivered(s)
            if t == MEAL_AT:
                carbs, ext, note = decide(pump, s, scenario, cr, bg)
            elif ext:
                pump.sim_tick(s, bg)
            dose = max(0.0, pump.sim_delivered(s) - before)
            p.step(Action(CHO=carbs if t == MEAL_AT else 0, insulin=basal + dose))
            trace.append(float(p.observation.Gsub))
    finally:
        pump.sim_free(s)
    return note, trace


def cohort(src_dir, scenarios):
    with tempfile.TemporaryDirectory() as d:
        pump = load_pump(src_dir, d)
        results = []
        for sc in scenarios:
            scenario = sc["id"]
            for name in [f"{sc.get('cohort', 'adult')}#{i:03d}" for i in range(1, 11)]:
                note, trace = simulate(pump, name, sc, float(CR[name]))
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
    try:
        res = run(args.repo, args.base, json.load(open(args.scenarios)) if args.scenarios else SCENARIOS)
        if args.question:
            res["question"] = args.question
    except RuntimeError as e:  # candidate broke the interface contract: deterministic BLOCK with the reason
        print(f"## World model: BLOCKED\n\n{e}")
        return 1
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
