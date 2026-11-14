"""Monitoring agents (automations): background checks on main that run on a schedule and on demand, with run history.

  Reliability monitor        re-runs the gate's simulation regression suite and every requirement test on main and
                             reports any change since its last run (cached per code fingerprint: unchanged code = instant)
  Requirements drift monitor resyncs the living source of record (factory/record.py)
  Fault-injection runner     world-model adversarial scenarios generated from the certified limits (vane splits around
                             the disagree threshold, failed vanes, gusts, dose typos, skipped meals), flown on main;
                             every failure is diagnosed by factory/worldmodel.py

Scheduler: one in-process timer thread (start()), one monitor run at a time, simulations niced and never written to the
dashboard feed. MONITORS=off disables the timer; "Run now" still works. History: .runs/monitors.json; evidence per run:
.runs/monitors/<run>.json and .md.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "factory"))
import record  # noqa: E402
import store  # noqa: E402
import worldmodel  # noqa: E402

RUNS = os.path.join(ROOT, ".runs")
DIR = os.path.join(RUNS, "monitors")
HIST = os.path.join(RUNS, "monitors.json")
PY = os.path.join(ROOT, ".venv/bin/python")
MONITORS = [
    {"id": "reliability", "name": "Reliability monitor", "every": 15 * 60, "schedule": "every 15 min",
     "what": "Re-runs the simulation regression suite and every requirement test on main; reports any change since its last run."},
    {"id": "drift", "name": "Requirements drift monitor", "every": 10 * 60, "schedule": "every 10 min",
     "what": "Resyncs the source of record: each requirement has a passing test, code that carries the stated value, trace links and fresh simulation evidence."},
    {"id": "fault-injection", "name": "Fault-injection runner", "every": 24 * 3600, "schedule": "nightly",
     "what": "World-model adversarial scenarios generated from the certified limits, flown on main; every failure is diagnosed."},
]
lock = threading.Lock()      # history file
worker = threading.Lock()    # one monitor run at a time
running = {}                 # (monitor, project) -> run id
paused = lambda: False       # noqa: E731  the server sets this to "a factory run is in progress": scheduled runs wait


def _hist():
    return json.load(open(HIST)) if os.path.exists(HIST) else {"runs": []}


def _save_run(run):
    with lock:
        h = _hist()
        h["runs"] = [run] + [r for r in h["runs"] if r["id"] != run["id"]]
        h["runs"] = h["runs"][:300]
        tmp = HIST + ".tmp"
        json.dump(h, open(tmp, "w"), indent=1)
        os.replace(tmp, HIST)


def simulate(dev, scenarios, tag):
    """Run the device's simulation on this checkout (base none: main as it is). Cached per code fingerprint + scenarios."""
    key = hashlib.sha1((record.fingerprint(dev) + json.dumps(scenarios, sort_keys=True)).encode()).hexdigest()[:12]
    cache = os.path.join(DIR, "cache", f"{tag}-{dev['id']}-{key}.json")
    if os.path.exists(cache):
        return json.load(open(cache)), True
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with tempfile.TemporaryDirectory() as d:
        args = ["nice", "-n", "10", PY, os.path.join(ROOT, record.SIM_FILES[dev["id"]][0]), "--repo", ROOT, "--base", "none", "--json", os.path.join(d, "w.json")]
        if scenarios:
            json.dump(scenarios, open(os.path.join(d, "s.json"), "w"))
            args += ["--scenarios", os.path.join(d, "s.json")]
        env = {**os.environ, "EVENTS": os.devnull}  # monitors never write to the dashboard feed
        subprocess.run(args, cwd=ROOT, env=env, capture_output=True, timeout=900)
        world = json.load(open(os.path.join(d, "w.json")))
    json.dump(world, open(cache, "w"))
    return world, False


def spec_of(dev):
    return json.load(open(os.path.join(ROOT, dev["repo"], "safety.json")))


def sources(dev):
    h, c = worldmodel.SOURCES[dev["id"]]
    return {"h": open(os.path.join(ROOT, dev["repo"], h)).read(), "c": open(os.path.join(ROOT, dev["repo"], c)).read()}


# ---------- the three monitors: each returns (status, summary, findings, evidence) ----------

def refresh_evidence(pid, dev):
    """Simulate main (cached per code fingerprint) and store it as the source of record's simulation evidence."""
    world, cached = simulate(dev, None, "gate")
    json.dump({"ts": time.time(), "fp": record.fingerprint(dev), "world": world}, open(os.path.join(DIR, f"sim-{pid}.json"), "w"))
    return world, cached


def reliability(pid, dev):
    spec = spec_of(dev)
    world, cached = refresh_evidence(pid, dev)
    fp = record.fingerprint(dev)
    last_path = os.path.join(DIR, f"reliability-{pid}.json")  # what this monitor saw last time: the regression baseline
    prev = json.load(open(last_path)) if os.path.exists(last_path) else None
    json.dump({"ts": time.time(), "fp": fp, "world": world}, open(last_path, "w"))
    tests = [{"id": r["id"], **record.run_test(r["test"])} for r in spec["requirements"] if r.get("test")]
    findings = [{"severity": "bad", "text": f"{t['id']} requirement test FAILS on main", "req": t["id"]} for t in tests if t["result"] != "PASS"]
    before = {(r["scenario"], r["patient"]): r for r in prev["world"]["results"]} if prev else {}
    key = lambda r: (r["scenario"], r["patient"])  # noqa: E731
    bad = [r for r in world["results"] if r["hypo"]]
    new = [r for r in bad if prev and key(r) in before and not before[key(r)]["hypo"]]
    recovered = [r for r in world["results"] if not r["hypo"] and before.get(key(r), {}).get("hypo")]
    diags = []
    if bad:  # diagnose against the committed code: an uncommitted or merged change to a certified limit shows up as the cause
        h, c = worldmodel.SOURCES[dev["id"]]
        committed = {"h": worldmodel.git_show("HEAD", f"{dev['repo']}/{h}"), "c": worldmodel.git_show("HEAD", f"{dev['repo']}/{c}")}
        d = worldmodel.diagnose({**world, "results": new or bad}, spec, dev["id"], dev["repo"], committed, sources(dev))
        diags = [d] if d else []
        what = d["headline"] if d else ""
        if new:
            findings.append({"severity": "bad", "text": f"REGRESSION: {len(new)} simulated run(s) newly leave the safe envelope since the last run: {what}", "link": "faults"})
        if len(bad) > len(new):
            text = f"{len(bad) - len(new)} of {len(world['results'])} simulated runs leave the envelope" + (" (also in the last run)" if prev else "")
            findings.append({"severity": "warn", "text": text if new else f"{text}: {what}", "link": "faults"})
    if recovered:
        findings.append({"severity": "info", "text": f"{len(recovered)} run(s) back inside the envelope since the last run"})
    code_changed = bool(prev) and prev["fp"] != fp
    status = "fail" if any(f["severity"] == "bad" for f in findings) else "warn" if any(f["severity"] == "warn" for f in findings) else "pass"
    summary = (f"{len(world['results'])} simulated runs ({'cached: same code as before' if cached else 'fresh simulation'}), "
               f"{sum(t['result'] == 'PASS' for t in tests)}/{len(tests)} requirement tests pass; "
               + (f"{len(new)} new exceedance(s), {len(recovered)} recovered since the last run" if prev else "first run: baseline recorded")
               + ("; code changed since the last run" if code_changed else ""))
    md = [f"# Reliability monitor: {status.upper()}", "", summary, "", "| Requirement test | Result | ms |", "|---|---|---|"]
    md += [f"| {t['id']} | {t['result']} | {t['ms']} |" for t in tests]
    md += ["", "| Scenario | Run | Outcome |", "|---|---|---|"] + [f"| {r['scenario']} | {r['patient']} | {r['note']} |" for r in world["results"]]
    md += [""] + [d["handoff"] for d in diags]
    return status, summary, findings, {"world": world, "tests": tests, "diagnoses": diags, "cached": cached, "fingerprint": fp, "md": "\n".join(md)}


def drift(pid, dev):
    rec = record.resync(pid, "drift-monitor")
    findings = [{"severity": i["severity"], "text": f"{r['id']}: {i['text']}", "req": r["id"], "link": "record"} for r in rec["rows"] for i in r["issues"]]
    findings += [{"severity": "info", "text": f"Proposed {'hazard' if p['kind'] == 'hazard' else 'requirement'} ({p['source']}): {p['text'][:180]}", "link": "record"} for p in rec["proposals"]]
    ch = rec["history"][0]
    n = len(rec["rows"])
    status = "fail" if ch["drift"] else "warn" if ch["stale"] else "pass"
    summary = (f"{n - ch['drift'] - ch['stale']}/{n} requirements in sync, {ch['drift']} drifted, {ch['stale']} stale; "
               f"{len(ch['added'])} new issue(s), {len(ch['resolved'])} resolved; {len(rec['proposals'])} proposal(s)")
    md = [f"# Requirements drift monitor: {status.upper()}", "", summary, ""] + [f"- **{r['id']}** {r['status']}: " + ("; ".join(i["text"] for i in r["issues"]) or "in sync") for r in rec["rows"]]
    return status, summary, findings, {"record": {"synced_at": rec["synced_at"], "history": ch}, "md": "\n".join(md)}


def fault_scenarios(dev):
    """Adversarial scenarios generated from the certified limits in main's header (boundary values and sensor faults)."""
    lim = worldmodel.defines(sources(dev)["h"])
    v = lambda k, d: worldmodel.num(lim, k, d)  # noqa: E731
    if dev["id"] == "flight-controls":
        dis, hi = v("AOA_DISAGREE_DEG", 5.5), v("AOA_MAX_VALID_DEG", 30.0)
        base = {"speed_kt": 200, "pull": 0, "idle": False, "split": 0.0, "stuck": None, "gust": 0.0, "event_at": 5, "max_alt_loss_ft": 300, "seconds": 60}
        stall = {**base, "pull": 16.0, "idle": True, "max_alt_loss_ft": None}
        return [
            {**stall, "id": "split-under-limit", "label": f"Stall approach, vanes split {dis - 0.3:.1f}° (under the {dis:g}° disagree limit)", "split": round(dis - 0.3, 2)},
            {**stall, "id": "split-over-limit", "label": f"Stall approach, vanes split {dis + 0.3:.1f}° (just over the {dis:g}° limit)", "split": round(dis + 0.3, 2)},
            {**base, "id": "vane-fails-high", "label": "Left AoA vane fails at 25° in a climb", "speed_kt": 220, "stuck": 25.0, "event_at": 10},
            {**base, "id": "vane-out-of-range", "label": f"Left AoA vane fails at {hi + 5:g}° (out of range)", "speed_kt": 220, "stuck": hi + 5, "event_at": 10},
            {**stall, "id": "stall-in-gusts", "label": "Stall approach in moderate turbulence", "gust": 7.0},
            {**base, "id": "severe-turbulence", "label": "Severe turbulence at cruise", "speed_kt": 250, "gust": 12.0},
        ]
    return [
        {"id": "child-typo", "label": "Child, 80 g meal, dose typed 10x", "carbs": 80, "typo": 10, "fallback": "reenter", "cohort": "child"},
        {"id": "teen-typo", "label": "Adolescent, 15 g snack, dose typed 10x", "carbs": 15, "typo": 10, "fallback": "reenter", "cohort": "adolescent"},
        {"id": "skipped-meal", "label": "Adult boluses for 60 g, then skips the meal", "carbs": 60, "eaten": 0, "typo": 1, "fallback": "reenter", "cohort": "adult"},
        {"id": "after-exercise", "label": "Adult, 60 g meal after exercise (1.5x sensitivity)", "carbs": 60, "typo": 1, "sensitivity": 1.5, "fallback": "reenter", "cohort": "adult"},
    ]


def fault_injection(pid, dev):
    spec = spec_of(dev)
    scs = fault_scenarios(dev)
    world, cached = simulate(dev, scs, "faults")
    src = sources(dev)
    diags = []
    for sc in scs:
        sub = {**world, "results": [r for r in world["results"] if r["scenario"] == sc["id"]]}
        d = worldmodel.diagnose(sub, spec, dev["id"], dev["repo"], src, src)
        if d:
            diags.append(d)
    json.dump({"ts": time.time(), "world": world, "diagnoses": diags}, open(os.path.join(DIR, f"faults-{pid}.json"), "w"))
    findings = []
    for d in diags:
        s = d["scenarios"][0]
        what = f"violates {', '.join(r['id'] for r in d['requirements'])}" if d["requirements"] else "no requirement covers it: propose one"
        findings.append({"severity": "bad" if d["requirements"] else "warn", "text": f"{s['label']}: {s['failing']}/{s['total']} runs fail, {what}. {d['headline']}", "link": "faults"})
    bad = sum(d["failing"] for d in diags)
    status = "fail" if any(f["severity"] == "bad" for f in findings) else "warn" if findings else "pass"
    summary = (f"{len(scs)} adversarial scenarios, {len(world['results'])} simulated runs ({'cached' if cached else 'fresh'}): "
               f"{bad} leave the envelope in {len(diags)} scenario(s)")
    md = [f"# Fault-injection runner: {status.upper()}", "", summary, ""]
    for d in diags:
        md += [d["handoff"], ""]
    return status, summary, findings, {"world": world, "diagnoses": diags, "cached": cached, "md": "\n".join(md)}


RUN = {"reliability": reliability, "drift": drift, "fault-injection": fault_injection}


def execute(mid, pid, trigger, rid):
    run = {"id": rid, "monitor": mid, "project": pid, "trigger": trigger, "started": time.time(), "status": "running", "summary": "", "findings": []}
    _save_run(run)
    with worker:
        try:
            dev = store.device(pid)
            if mid == "drift" and trigger != "schedule":  # a manual resync refreshes the simulation evidence first (cached when unchanged)
                refresh_evidence(pid, dev)
            status, summary, findings, ev = RUN[mid](pid, dev)
        except Exception as e:  # a broken monitor reports itself; it never takes the server down
            status, summary, findings, ev = "error", f"{type(e).__name__}: {e}"[:300], [], {"md": f"# Error\n\n{e}"}
        run.update(status=status, summary=summary, findings=findings[:40], duration=round(time.time() - run["started"], 2), cached=ev.get("cached"))
        os.makedirs(DIR, exist_ok=True)
        open(os.path.join(DIR, f"{rid}.md"), "w").write(ev.pop("md", ""))
        json.dump(ev, open(os.path.join(DIR, f"{rid}.json"), "w"))
        _save_run(run)
    running.pop((mid, pid), None)


def trigger(mid, pid, how="manual"):
    """Start a monitor run in the background. Returns the run id, or None if this monitor is already running for the project."""
    if mid not in RUN or not any(p["id"] == pid for p in store._load()["projects"]):
        raise ValueError("unknown monitor or project")
    if (mid, pid) in running:
        return None
    rid = f"{mid}-{pid}-{int(time.time() * 1000)}"
    running[(mid, pid)] = rid
    threading.Thread(target=execute, args=(mid, pid, how, rid), daemon=True).start()
    return rid


def view(pid):
    runs = [r for r in _hist()["runs"] if r["project"] == pid]
    out = []
    for m in MONITORS:
        mine = [r for r in runs if r["monitor"] == m["id"]]
        done = [r for r in mine if r["status"] != "running"]
        last = mine[0]["started"] if mine else None
        out.append({**m, "running": (m["id"], pid) in running, "last": done[0] if done else None,
                    "next": (last + m["every"]) if last and os.environ.get("MONITORS") != "off" else None, "runs": mine[:25]})
    return {"monitors": out, "scheduler": "off" if os.environ.get("MONITORS") == "off" else "on"}


def evidence(rid):
    rid = "".join(ch for ch in rid if ch.isalnum() or ch in "-_.")
    p = os.path.join(DIR, f"{rid}.json")
    if not os.path.exists(p):
        return None
    out = json.load(open(p))
    md = os.path.join(DIR, f"{rid}.md")
    out["md"] = open(md).read() if os.path.exists(md) else ""
    return out


def _loop():
    """The scheduler: every 20 s, start any monitor whose period has passed (first runs staggered after startup)."""
    time.sleep(30)
    while True:
        runs = _hist()["runs"]
        for p in ([] if paused() else store._load()["projects"]):
            for m in MONITORS:
                last = next((r["started"] for r in runs if r["project"] == p["id"] and r["monitor"] == m["id"]), 0)
                if time.time() - last >= m["every"] and (m["id"], p["id"]) not in running:
                    trigger(m["id"], p["id"], "schedule")
                    time.sleep(5)
        time.sleep(20)


def start():
    os.makedirs(DIR, exist_ok=True)
    with lock:  # runs cut off by a server restart
        h = _hist()
        for r in h["runs"]:
            if r["status"] == "running":
                r.update(status="error", summary="interrupted by a server restart")
        if h["runs"]:
            json.dump(h, open(HIST, "w"), indent=1)
    if os.environ.get("MONITORS") != "off":
        threading.Thread(target=_loop, daemon=True).start()


if __name__ == "__main__":
    # monitors.py <monitor> <project>: run one monitor in the foreground
    rid = f"{sys.argv[1]}-{sys.argv[2]}-{int(time.time() * 1000)}"
    execute(sys.argv[1], sys.argv[2], "cli", rid)
    print(json.dumps(next(r for r in _hist()["runs"] if r["id"] == rid), indent=1))
