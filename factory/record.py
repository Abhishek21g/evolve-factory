"""Living source of record: the project's requirements (safety.json) are the single source of truth, and every resync
re-derives each requirement's status against code, tests, trace links and simulation evidence, and flags drift:

  test       its requirement test fails, or it has none
  spec       the code no longer carries the value the requirement states (or the requirement text changed)
  links      its hazards or code symbols are missing
  sim        a simulated run violates it, or the simulation evidence is older than the code
  proposals  hazards the Safety Analyst proposed and requirement gaps the world model found, not yet in the record

State per project: .runs/record-<project>.json (last sync, the spec/code baseline, and the drift history).
Deterministic: no LLM. Called by the Requirements drift monitor (factory/monitors.py) and the Resync button.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "factory"))
import store  # noqa: E402
import tracelinks  # noqa: E402
import worldmodel  # noqa: E402

RUNS = os.path.join(ROOT, ".runs")
# Hazards each gate scenario exercises (sim/flight.py, sim/world.py): a requirement is simulation-covered if it mitigates one.
SCENARIO_HAZARDS = {"sideslip-stall": ["H-2"], "vane-failure": ["H-1"], "turbulence": ["H-5", "H-4"],
                    "large-meal": ["H-1", "H-3"], "decimal-slip": ["H-1", "H-3"]}
SIM_FILES = {"flight-controls": ["sim/flight.py", "sim/fcc_shim.c"], "insulin-pump": ["sim/world.py", "sim/shim.c"]}
NUM = r"(-?\d+(?:\.\d+)?)"


def path(pid):
    return os.path.join(RUNS, f"record-{pid}.json")


def load(pid):
    p = path(pid)
    return json.load(open(p)) if os.path.exists(p) else None


def fingerprint(dev):
    """Content hash of the device code and its simulator: same fingerprint = same simulation result."""
    files = subprocess.run(["git", "-C", ROOT, "ls-files", dev["repo"]], capture_output=True, text=True).stdout.split()
    h = hashlib.sha1()
    for f in sorted(files + SIM_FILES[dev["id"]]):
        p = os.path.join(ROOT, f)
        h.update(f.encode() + (open(p, "rb").read() if os.path.exists(p) else b"<missing>"))
    return h.hexdigest()[:12]


def locate(repo, symbol, files):
    """Where a code symbol is defined: #define, function or struct field definition; else its first use."""
    first = None
    for f in files:
        p = os.path.join(ROOT, f)
        if not os.path.exists(p) or not f.endswith((".c", ".h")):
            continue
        for i, line in enumerate(open(p), 1):
            if not re.search(rf"\b{symbol}\b", line):
                continue
            if re.match(rf"\s*#define\s+{symbol}\b", line) or re.match(rf"\s*[\w\s\*]+\b{symbol}\s*\([^;]*\)\s*\{{?\s*$", line) \
                    or re.match(rf"\s*(double|int|float|unsigned|long)\s+{symbol}\s*;", line):
                return {"symbol": symbol, "file": f, "line": i, "text": line.strip()}
            first = first or {"symbol": symbol, "file": f, "line": i, "text": line.strip()}
    return first


def run_test(cmd):
    m = re.match(r"make -s -C (\S+) (\S+)", cmd)
    if m:  # make compares whole seconds: a binary built in the same second as a source edit would never rebuild
        d, binary = os.path.join(ROOT, m.group(1)), os.path.join(ROOT, m.group(1), m.group(2))
        srcs = [os.path.join(d, f) for f in os.listdir(d) if f.endswith((".c", ".h"))]
        if os.path.exists(binary) and any(os.stat(s).st_mtime_ns >= os.stat(binary).st_mtime_ns for s in srcs):
            os.remove(binary)
    t = time.time()
    try:
        p = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True, timeout=60)
        ok, log = p.returncode == 0, (p.stdout + p.stderr).strip()[-400:]
    except subprocess.TimeoutExpired:
        ok, log = False, "timed out after 60 s"
    return {"result": "PASS" if ok else "FAIL", "ms": int((time.time() - t) * 1000), "log": log}


def spec_numbers(text):
    return [float(n) for n in re.findall(NUM + r"\s*(?:deg|U\b|mg/dL|kPa|ms)", text)]


def last_sim(pid):
    """Latest reliability-monitor simulation of this project's main code (factory/monitors.py writes it)."""
    p = os.path.join(RUNS, "monitors", f"sim-{pid}.json")
    return json.load(open(p)) if os.path.exists(p) else None


def sim_checks(world, spec, dev_id, cert):
    """Run the world model's requirement monitors over every simulated run: per requirement, runs checked and violations."""
    out = {}
    scen = {s["id"]: s for s in world.get("scenarios") or []}
    monitors = worldmodel.DEVICE[dev_id][0]
    for r in world.get("results", []):
        viol, _ = monitors(r, scen.get(r["scenario"], {"id": r["scenario"]}), world, cert)
        for req in spec["requirements"]:
            if set(req["hazards"]) & set(SCENARIO_HAZARDS.get(r["scenario"], [])) or any(v["req"] == req["id"] for v in viol):
                o = out.setdefault(req["id"], {"runs": 0, "violations": [], "scenarios": []})
                o["runs"] += 1
                o["scenarios"] = list(dict.fromkeys(o["scenarios"] + [r["scenario"]]))
                o["violations"] += [f"{r['scenario']}/{r['patient']} at t={v['at']:g}: {v['evidence']}" for v in viol if v["req"] == req["id"]]
    return out


def proposals(pid, spec):
    """Hazards the Safety Analyst proposed in this project's runs, and requirement gaps the fault-injection runner found."""
    wos = {w["id"] for w in store._load()["work_orders"] if w["project"] == pid}
    out, seen = [], set()
    for e in store.events():
        nh = (e.get("analysis") or {}).get("new_hazard")
        if e.get("wo") in wos and nh and nh not in seen:
            seen.add(nh)
            out.append({"kind": "hazard", "source": e["wo"], "text": nh})
    fi = os.path.join(RUNS, "monitors", f"faults-{pid}.json")
    if os.path.exists(fi):
        for d in json.load(open(fi)).get("diagnoses", []):
            if d.get("uncovered"):
                s = d["scenarios"][0]
                out.append({"kind": "requirement-gap", "source": "Fault-injection runner",
                            "text": f"{s['label']}: {s['failing']} of {s['total']} simulated runs leave the safe envelope ({d['headline']}) "
                                    f"while every requirement test passes. No requirement covers this scenario.",
                            "hazards": [h["id"] for h in d["hazards"]]})
    return out


def resync(pid, actor="drift-monitor"):
    """Re-derive every requirement's status and the drift against the last sync. Returns the new record."""
    proj = next((p for p in store._load()["projects"] if p["id"] == pid), None)
    if not proj:
        raise ValueError("unknown project")
    dev = store.device(pid)
    repo, (h_name, _) = dev["repo"], worldmodel.SOURCES[dev["id"]]
    spec = json.load(open(os.path.join(ROOT, repo, "safety.json")))
    prev = load(pid) or {}
    base = prev.get("baseline", {})
    h_src = open(os.path.join(ROOT, repo, h_name)).read()
    defs = worldmodel.defines(h_src)
    haz = {h["id"] for h in spec["hazards"]}
    sim = last_sim(pid)
    fp_now = fingerprint(dev)
    cert = dict(defs)  # judge the simulation against the certified values (the record), not a drifted header
    for b in base.values():
        cert.update({s: (v, 0, f"{v:g}") for s, v in b.get("spec", {}).items()})
    checks = sim_checks(sim["world"], spec, dev["id"], cert) if sim else {}
    evs = store.events()
    approved = {}
    for w in (w for w in store._load()["work_orders"] if w["project"] == pid):
        if store.wo_status(w["id"], evs, None)[0] == "Approved":
            g = store._load_run(f"{w['id']}.gate.json") or {}
            for row in g.get("rows", []):
                if row["result"] == "PASS":
                    approved[row["id"]] = {"wo": w["id"], "ts": w["created"]}
    rows, new_base = [], {}
    for r in spec["requirements"]:
        issues = []
        b = base.get(r["id"], {})
        text_hash = hashlib.sha1(r["text"].encode()).hexdigest()[:10]
        if b.get("text") and b["text"] != text_hash:
            issues.append({"severity": "warn", "kind": "spec", "text": "Requirement text changed since the last sync: re-verify"})
        code = [loc or {"symbol": s, "missing": True} for s in r.get("symbols", []) for loc in [locate(repo, s, r.get("files", []))]]
        issues += [{"severity": "bad", "kind": "links", "text": f"Code symbol {c['symbol']} not found in {', '.join(r.get('files', []))}"} for c in code if c.get("missing")]
        issues += [{"severity": "bad", "kind": "links", "text": f"Hazard {h} is not in the hazard log"} for h in r["hazards"] if h not in haz]
        test = run_test(r["test"]) if r.get("test") else {"result": "MISSING", "ms": 0, "log": ""}
        if test["result"] != "PASS":
            issues.append({"severity": "bad", "kind": "test", "text": "No requirement test" if test["result"] == "MISSING" else f"Requirement test fails: {test['log'][-120:]}"})
        nums = spec_numbers(r["text"])
        spec_map = dict(b.get("spec", {}))
        if not spec_map:  # first sync: learn which code limit carries which number in the requirement text
            spec_map = {s: defs[s][0] for s in r.get("symbols", []) if s in defs and isinstance(defs[s][0], float) and defs[s][0] in nums}
        values = []
        for s, want in list(spec_map.items()):
            have = defs.get(s, (None,))[0]
            ok = have in nums  # the code carries a value the requirement states (both changed together = still in sync)
            values.append({"symbol": s, "spec": have if ok else want, "code": have, "file": f"{repo}/{h_name}", "line": defs.get(s, (0, 0))[1], "ok": ok})
            if ok:
                spec_map[s] = have
            elif want in nums:
                issues.append({"severity": "bad", "kind": "spec", "text": f"Code drifted from the requirement: {s} = {have} in {h_name}, the requirement says {want:g}"})
            else:
                issues.append({"severity": "bad", "kind": "spec", "text": f"Requirement no longer states {want:g} and {s} = {have} matches nothing in it: update the code or the requirement"})
        c = checks.get(r["id"])
        covered = bool(set(r["hazards"]) & {h for v in SCENARIO_HAZARDS.values() for h in v})
        simrow = {"covered": covered, "runs": c["runs"] if c else 0, "violations": c["violations"][:5] if c else [],
                  "scenarios": c["scenarios"] if c else [], "ts": sim["ts"] if sim else None, "fresh": bool(sim) and sim["fp"] == fp_now}
        if covered and not sim:
            issues.append({"severity": "warn", "kind": "sim", "text": "No simulation evidence yet: the Reliability monitor has not run"})
        elif covered and not simrow["fresh"]:
            issues.append({"severity": "warn", "kind": "sim", "text": "Code changed since the last simulation evidence"})
        if simrow["violations"]:
            issues.append({"severity": "bad", "kind": "sim", "text": f"Violated in {len(c['violations'])} simulated run(s): {c['violations'][0]}"})
        status = "drift" if any(i["severity"] == "bad" for i in issues) else "stale" if issues else "in-sync"
        rows.append({"id": r["id"], "text": r["text"], "dal": r.get("dal"), "hazards": r["hazards"], "objectives": r.get("objectives", []),
                     "code": code, "test": {**test, "cmd": r.get("test")}, "values": values, "sim": simrow,
                     "evidence": approved.get(r["id"]), "issues": issues, "status": status})
        new_base[r["id"]] = {"text": text_hash, "spec": spec_map}
    props = proposals(pid, spec)
    now = time.time()
    key = lambda i: f"{i[0]}: {i[1]}"  # noqa: E731
    before = {key((r["id"], i["text"])) for r in prev.get("rows", []) for i in r["issues"]}
    after = {key((r["id"], i["text"])) for r in rows for i in r["issues"]}
    change = {"ts": now, "actor": actor, "added": sorted(after - before), "resolved": sorted(before - after),
              "drift": sum(r["status"] == "drift" for r in rows), "stale": sum(r["status"] == "stale" for r in rows)}
    rec = {"project": pid, "synced_at": now, "synced_by": actor, "standard": proj["standard"], "fingerprint": fp_now,
           "sim": {"ts": sim["ts"], "verdict": sim["world"]["verdict"], "runs": len(sim["world"]["results"]), "fresh": sim["fp"] == fp_now} if sim else None,
           "rows": rows, "proposals": props, "baseline": {**base, **new_base},
           "history": ([change] + prev.get("history", []))[:50]}
    tracelinks.TESTS[dev["id"]] = {"ts": now, "running": False,  # Traceability shows the same, fresh test results
                                   "results": {r["id"]: r["test"]["result"] for r in rows if r["test"]["result"] != "MISSING"}}
    os.makedirs(RUNS, exist_ok=True)
    tmp = path(pid) + ".tmp"
    json.dump(rec, open(tmp, "w"), indent=1)
    os.replace(tmp, path(pid))
    return rec


if __name__ == "__main__":
    r = resync(sys.argv[1])
    for row in r["rows"]:
        print(row["id"], row["status"], [i["text"] for i in row["issues"]])
    print("proposals:", len(r["proposals"]), "history:", r["history"][0])
