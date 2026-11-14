"""World-model check for flight controls: fly a candidate's real fcc.c in a simulated 737-class airliner.

Usage: python3 sim/flight.py --repo PATH [--base main] [--json out.json] [--wo WO-12] [--scenarios what-if.json]
Exit 0 = change adds no new envelope exceedance, 1 = BLOCKED.

Aircraft: plain-Python longitudinal model (point mass + pitch dynamics, 50 Hz): lift with a stall break at 15 deg
AoA and the nacelle pitch-up near stall that motivated MCAS, drag, thrust, pitch damping. Two fuselage AoA vanes
feed the candidate's demo/aircraft/fcc.c, compiled with sim/fcc_shim.c against its own fcc.h; whatever stabilizer
trim the code commands is what the aircraft flies. Deterministic: fixed configs, fixed gusts, no randomness.
It is a teaching model with textbook-scale coefficients, not certification data.

Scenarios (fixed by the safety engineer, agents cannot edit this file):
  sideslip-stall  idle thrust, the pilot pulls toward 16 deg AoA in a sideslip gust that splits the two vanes
                  by 5.3 deg. Stall protection must keep the wing below the stall.
  vane-failure    the left AoA vane fails high (22 deg) in a climb. Nothing may push the nose down.
  turbulence      moderate vertical gusts at cruise. No nuisance nose-down trim, no altitude excursion.
Each scenario runs on 6 aircraft configs (58, 66, 74 t, forward and aft CG).
Verdict (non-regression, like sim/world.py): BLOCKED if the change makes any run leave its safe envelope (true AoA
above 15 deg = stall, or altitude loss beyond the scenario's limit) that stayed inside on the base branch.
Exceedances that already happen on base are reported as PRE-EXISTING RISK. Result rows use the same keys as
sim/world.py (`hypo` = envelope exceedance) so the factory and the UI treat both world models alike.
"""
import argparse
import ctypes
import json
import math
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "dashboard"))
import emit  # noqa: E402  dashboard event feed

SHIM = os.path.join(HERE, "fcc_shim.c")
DT, SAMPLE = 0.02, 0.5          # 50 Hz control cycle; trace every 0.5 s
STALL_DEG = 15.0                # the aircraft's stall AoA, independent of whatever the candidate's header says
G, RHO, S, CHORD = 9.81, 1.056, 124.6, 4.17   # 5,000 ft air density; 737-800 wing area and mean chord
CL0, CLA, CD0, K = 0.25, 5.5, 0.025, 0.045
CM0, CMD, CMQ = 0.063, -1.4, -25.0            # pitching moment: trim, stabilizer/elevator power, pitch damping
PITCH_UP = 0.8                                # extra nose-up moment per rad of AoA above 12 deg (nacelle lift)
KT, FT = 0.514444, 0.3048

CONFIGS = [  # (name, mass kg, Cm_alpha: forward CG = more stable)
    ("58 t fwd CG", 58000, -1.4), ("58 t aft CG", 58000, -1.0), ("66 t fwd CG", 66000, -1.4),
    ("66 t aft CG", 66000, -1.0), ("74 t fwd CG", 74000, -1.4), ("74 t aft CG", 74000, -1.0),
]

# Fixed gate scenarios (protected). A what-if run passes its own list in the same shape via --scenarios.
#   speed_kt: start speed; pull: AoA (deg) the pilot's column pull aims for from event_at (0 = holds trim);
#   idle: thrust to idle at event_at; split: vane split from sideslip (deg, left reads high); stuck: left vane
#   fails at this reading at event_at (null = healthy); gust: vertical gust amplitude (m/s);
#   max_alt_loss_ft: envelope limit on altitude loss (null = none); seconds: run length.
SCENARIOS = [
    {"id": "sideslip-stall", "label": "Stall approach in a sideslip gust (vanes split 5.3 deg)", "speed_kt": 200,
     "pull": 16.0, "idle": True, "split": 5.3, "stuck": None, "gust": 0.0, "event_at": 5, "max_alt_loss_ft": None, "seconds": 60},
    {"id": "vane-failure", "label": "Left AoA vane fails at 22 deg in a climb", "speed_kt": 220,
     "pull": 0, "idle": False, "split": 0.0, "stuck": 22.0, "gust": 0.0, "event_at": 10, "max_alt_loss_ft": 300, "seconds": 60},
    {"id": "turbulence", "label": "Moderate turbulence at cruise", "speed_kt": 250,
     "pull": 0, "idle": False, "split": 0.0, "stuck": None, "gust": 7.0, "event_at": 5, "max_alt_loss_ft": 300, "seconds": 60},
]


def compile_fcc(src_dir, lib):
    p = subprocess.run(["cc", "-shared", "-fPIC", "-I", src_dir, "-o", lib, os.path.join(src_dir, "fcc.c"), SHIM, "-lm"],
                       capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError("flight controls do not match the world-model interface in fcc.h:\n" + p.stderr[-1500:])
    return lib


def bind(lib):
    f = ctypes.CDLL(lib)
    f.sim_new.restype = ctypes.c_void_p
    f.sim_free.argtypes = [ctypes.c_void_p]
    f.fcc_step.restype = ctypes.c_double
    f.fcc_step.argtypes = [ctypes.c_void_p, ctypes.c_double, ctypes.c_double, ctypes.c_double]
    alert = getattr(f, "fcc_aoa_disagree", None)  # optional crew alert interface (fcc.h)
    if alert is not None:
        alert.restype, alert.argtypes = ctypes.c_int, [ctypes.c_void_p]
    return f, alert


def cl(a):
    """Lift coefficient with a stall break: lift falls off past 15 deg."""
    s = math.radians(STALL_DEG)
    return CL0 + CLA * a if a <= s else max(0.6, CL0 + CLA * s - 3.0 * (a - s))


def cm_static(a, cma):
    return CM0 + cma * a + PITCH_UP * max(0.0, a - math.radians(12))


def gust(t, amp):
    return amp * (math.sin(0.7 * t) + 0.6 * math.sin(1.9 * t + 1.0) + 0.3 * math.sin(4.1 * t + 2.0)) / 1.9


def fly(fcc, alert, sc, cfg):
    """Fly one scenario on one config with the candidate's FCC in the loop. Returns the result row."""
    name, m, cma = cfg
    v = sc.get("speed_kt", 200) * KT
    qbar = 0.5 * RHO * v * v
    a0 = (m * G / (qbar * S) - CL0) / CLA                 # level-flight trim AoA
    d0 = -cm_static(a0, cma) / CMD                       # elevator for zero pitching moment
    t0 = qbar * S * (CD0 + K * cl(a0) ** 2)              # thrust = drag
    pull = math.radians(sc.get("pull", 0) or 0)
    d_pull = -cm_static(pull, cma) / CMD if pull else d0  # column the pilot aims at (ignores pitch-up: he is surprised)
    theta, gamma, q, h = a0, 0.0, 0.0, 0.0
    s = fcc.sim_new()
    tr = {"aoa": [], "pitch": [], "alt": [], "trim": []}
    peak, max_trim, alert_at, stall_s = -99.0, 0.0, None, 0.0
    ev, n = sc.get("event_at", 5), int(sc.get("seconds", 60) / DT)
    try:
        for i in range(n):
            t = i * DT
            wg = gust(t, sc.get("gust", 0.0))
            a = theta - gamma + wg / v                    # aerodynamic AoA the wing and both vanes feel
            ad = math.degrees(a)
            left = ad + sc.get("split", 0.0) / 2 + 0.08 * math.sin(3.0 * t)
            right = ad - sc.get("split", 0.0) / 2 - 0.08 * math.sin(2.3 * t + 1.0)
            if sc.get("stuck") is not None and t >= ev:
                left = sc["stuck"]
            trim = fcc.fcc_step(s, left, right, DT)
            if alert is not None and alert_at is None and alert(s):
                alert_at = round(t, 2)
            ramp = min(1.0, max(0.0, (t - ev) / 20.0))
            elev = d0 + (d_pull - d0) * ramp
            thrust = 0.08 * t0 if sc.get("idle") and t >= ev else t0
            qbar = 0.5 * RHO * v * v
            c_l = cl(a)
            lift, drag = qbar * S * c_l, qbar * S * (CD0 + K * c_l ** 2 + (0.6 * (a - math.radians(STALL_DEG)) if ad > STALL_DEG else 0))
            cm = cm_static(a, cma) + CMD * (elev + math.radians(trim)) + CMQ * q * CHORD / (2 * v)
            v += DT * ((thrust * math.cos(a) - drag) / m - G * math.sin(gamma))
            gamma += DT * (lift + thrust * math.sin(a) - m * G * math.cos(gamma)) / (m * v)
            q += DT * qbar * S * CHORD * cm / (m * 52.0)  # Iyy ~ m * 52 m^2 (737-800: ~3.4e6 kg m^2)
            theta += DT * q
            h += DT * v * math.sin(gamma)
            v = max(v, 30.0)
            true_aoa = math.degrees(theta - gamma)
            peak, max_trim = max(peak, true_aoa), max(max_trim, trim)
            stall_s += DT if true_aoa > STALL_DEG else 0
            if i % int(SAMPLE / DT) == 0:
                tr["aoa"].append(round(true_aoa, 2))
                tr["pitch"].append(round(math.degrees(theta), 2))
                tr["alt"].append(round(h / FT))
                tr["trim"].append(round(trim, 2))
    finally:
        fcc.sim_free(s)
    loss = -min(tr["alt"])
    limit = sc.get("max_alt_loss_ft")
    bad = peak > STALL_DEG or (limit is not None and loss > limit)
    why = (f"stalled: AoA {peak:.1f} deg for {stall_s:.1f} s" if peak > STALL_DEG
           else f"lost {loss:.0f} ft" if bad else f"peak AoA {peak:.1f} deg")
    note = f"{why}; protection trim max {max_trim:.1f} deg" + (f"; AOA DISAGREE alert at {alert_at:.1f} s" if alert_at is not None else "")
    return {"scenario": sc["id"], "patient": name, "note": note, "min": round(peak, 1), "max": round(peak, 1),
            "hypo": bad, "peak_aoa": round(peak, 1), "alt_loss_ft": max(0, round(loss)), "max_trim": round(max_trim, 2),
            "alert_at": alert_at, "trace": tr["aoa"], "series": tr}


def cohort(src_dir, scenarios):
    with tempfile.TemporaryDirectory() as d:
        fcc, alert = bind(compile_fcc(src_dir, os.path.join(d, "libfcc.so")))
        return [fly(fcc, alert, sc, cfg) for sc in scenarios for cfg in CONFIGS]


def base_src(repo, base, d):
    for f in ("fcc.c", "fcc.h"):
        src = subprocess.run(["git", "-C", repo, "show", f"{base}:demo/aircraft/{f}"], capture_output=True, text=True, check=True).stdout
        open(os.path.join(d, f), "w").write(src)
    return d


def run(repo, base, scenarios=SCENARIOS):
    cand = cohort(os.path.join(repo, "demo/aircraft"), scenarios)
    if base == "none":  # what-if: no comparison, just answer the question on this software
        before = {(r["scenario"], r["patient"]): r for r in cand}
    else:
        with tempfile.TemporaryDirectory() as d:
            before = {(r["scenario"], r["patient"]): r for r in cohort(base_src(repo, base, d), scenarios)}
    for r in cand:
        b = before[(r["scenario"], r["patient"])]
        r["base_min"], r["base_trace"] = b["min"], b["trace"]
        r["new_hypo"] = r["hypo"] and not b["hypo"]
        r["preexisting"] = r["hypo"] and b["hypo"]
    return {"kind": "aircraft", "verdict": "BLOCKED" if any(r["new_hypo"] for r in cand) else "PASS",
            "threshold": STALL_DEG, "step_min": SAMPLE, "meal_at": scenarios[0].get("event_at", 5), "base": base,
            "axis": {"unit": "deg AoA", "min": -5, "max": 30, "band": [-2, 12], "threshold_label": "stall AoA",
                     "event_label": "event", "above": True, "time_unit": "s", "subject": "aircraft configs"},
            "scenarios": scenarios, "results": cand}


def report(res):
    lines = [f"## World model: {res['verdict']}", "",
             "6 simulated 737-class aircraft configs (longitudinal flight model), candidate fcc.c compiled and in the loop.", "",
             f"| Scenario | Config | Outcome | Peak AoA | Peak AoA on {res['base']} | Alt loss ft | Envelope |", "|---|---|---|---|---|---|---|"]
    for r in res["results"]:
        flag = "NEW exceedance (caused by this change)" if r["new_hypo"] else "pre-existing" if r["preexisting"] else "inside"
        lines.append(f'| {r["scenario"]} | {r["patient"]} | {r["note"]} | {r["peak_aoa"]} | {r["base_min"]} | {r["alt_loss_ft"]} | {flag} |')
    new = [r for r in res["results"] if r["new_hypo"]]
    old = [r for r in res["results"] if r["preexisting"]]
    if new:
        lines += ["", f"BLOCKED: this change makes {len(new)} simulated flight(s) leave the safe envelope "
                      f"(stall above {STALL_DEG:.0f} deg AoA: H-2; altitude loss: H-1)."]
    if old:
        lines += ["", f"PRE-EXISTING RISK (not caused by this change): {len(old)} flight(s) already leave the envelope on {res['base']}: "
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
        new = sum(r["new_hypo"] for r in res["results"])
        old = sum(r["preexisting"] for r in res["results"])
        bad = sum(r["hypo"] for r in res["results"])
        msg = (f"What-if answered: {bad} of {len(res['results'])} simulated flights leave the safe envelope" if args.question
               else f"{res['verdict']}: {new} new envelope exceedances caused by this change; {old} pre-existing")
        emit.emit("world", "done" if args.question else res["verdict"].lower(), msg, wo=args.wo, world=res)
    except Exception:
        pass
    print(report(res))
    return 0 if res["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
