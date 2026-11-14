"""Self-check: python3 factory/test_worldmodel.py  (diagnoses the recorded Boeing and pump beats from their sim data)."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "factory"))
import worldmodel  # noqa: E402


def recorded(path):
    evs = [json.loads(line) for line in open(os.path.join(ROOT, path)) if line.strip()]
    return [e["world"] for e in evs if e.get("world")], [e["gate"] for e in evs if e.get("gate")]


# Boeing: the obvious AoA-alert patch (AOA_DISAGREE_DEG 5.5 -> 5.0, demo/aircraft/obvious_patch.sh) stalls 6 of 18 flights.
spec = json.load(open(os.path.join(ROOT, "demo/aircraft/safety.json")))
h, c = (open(os.path.join(ROOT, "demo/aircraft", f)).read() for f in ("fcc.h", "fcc.c"))
cand = {"h": h.replace("#define AOA_DISAGREE_DEG    5.5", "#define AOA_DISAGREE_DEG    5.0"),
        "c": c + "\nint fcc_aoa_disagree(const fcc_state *s) { return !s->aoa_valid; }\n"}
worlds, gates = recorded("demo/replay/aircraft/build.jsonl")
d = worldmodel.diagnose(worlds[0], spec, "flight-controls", "demo/aircraft", {"h": h, "c": c}, cand, gates[0])
sc = d["scenarios"][0]
assert (d["failing"], d["total"], sc["scenario"]) == (6, 18, "sideslip-stall"), d["headline"]
assert [r["id"] for r in d["requirements"]] == ["SR-3"] and d["requirements"][0]["unit_test"] == "FAIL"
assert [h["id"] for h in d["hazards"]] == ["H-2"]
assert sc["violations"][0]["req"] == "SR-3" and sc["violations"][0]["at"] == 21.5, sc["violations"]
assert sc["facts"]["t_stall"] == 25.5 and sc["moment"]["t"] == 25.5
assert d["changed"][0]["symbol"] == "AOA_DISAGREE_DEG" and (d["changed"][0]["base"], d["changed"][0]["cand"]) == ("5.5", "5.0")
assert {r["line"] for r in d["refs"]} >= {17, 19, 20}, d["refs"]
assert d["headline"].startswith("vane disagree 5.3° > 5.0° threshold → stall protection inhibited"), d["headline"]
assert worldmodel.diagnose(worlds[1], spec, "flight-controls", "demo/aircraft", {"h": h, "c": c}, {"h": h, "c": c}) is None

# Insulin pump: the recorded WO-304 run. Attempt 1 breaks SR-1; attempt 2 harms patients with every unit test passing.
spec = json.load(open(os.path.join(ROOT, "demo/pump/safety.json")))
worlds, gates = recorded("demo/replay/build.jsonl")
ph = open(os.path.join(ROOT, "demo/pump/pump.h")).read()
d = worldmodel.diagnose(worlds[0], spec, "insulin-pump", "demo/pump", {"h": ph}, {"h": ph.replace("MAX_BOLUS_U       10.0", "MAX_BOLUS_U       25.0")}, gates[0])
assert [r["id"] for r in d["requirements"]] == ["SR-1"] and d["scenarios"][0]["scenario"] == "decimal-slip", d["headline"]
d = worldmodel.diagnose(worlds[1], spec, "insulin-pump", "demo/pump", None, None, gates[1])
assert d["scenarios"][0]["scenario"] == "large-meal" and d["failing"] == 2, d["headline"]
print("ok")
