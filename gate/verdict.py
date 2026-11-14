"""Deterministic verdict: rule table + check outcomes + requirement test results + world-model results -> PASS/BLOCKED.

The Rust binary in gate-rs/ (#![forbid(unsafe_code)], built by demo/go.sh) decides when it is built; otherwise
reference() below, the same rules in Python, decides. gate/test_gate.py asserts both give identical output.
Digests: input_sha256 = SHA-256 of the exact evidence bytes, rules_sha256 = of the rule table inside them,
verdict_sha256 = of "<input_sha256>:<rules_sha256>:<verdict>". Any edit to the evidence changes all of them.
"""
import glob
import hashlib
import json
import os
import subprocess
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, "gate-rs/target/release/certus-gate")
MAX_INPUT_BYTES = 8 * 1024 * 1024
RUN_KEYS = ("scenario", "patient", "hypo", "new_hypo", "preexisting")
SOURCE = "gate-rs/src/lib.rs"


def evidence(rules, checks, rows, world):
    """Gate input: the rule table (safety.json) as is, plus the fields of the evidence the verdict depends on.
    checks: [(name, passed)]; rows: gate.py --json rows; world: sim/world.py or sim/flight.py --json output, or None."""
    return {"rules": rules,
            "checks": [{"name": n, "passed": p} for n, p in checks],
            "requirements": [{"id": r["id"], "result": r["result"], "why": r.get("why", [])} for r in rows],
            "world": None if world is None else {
                "verdict": world.get("verdict"), "results": [{k: r.get(k) for k in RUN_KEYS} for r in world.get("results", [])]}}


def canonical(inp):
    return json.dumps(inp, sort_keys=True, separators=(",", ":")).encode()


def decide(inp):
    """Verdict for one gate attempt: the Rust binary's if it is built and answers, else the Python reference."""
    raw = canonical(inp)
    if os.access(BIN, os.X_OK):
        try:
            p = subprocess.run([BIN], input=raw, capture_output=True, timeout=10)
            out = json.loads(p.stdout)
            if (p.returncode, out["verdict"]) in ((0, "PASS"), (1, "BLOCKED")):
                return out
        except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
            pass
    return reference(raw)


def label(out):
    engine = "Rust (forbid unsafe)" if out["engine"] == "rust" else "Python"
    return f"Deterministic gate: {engine} · verdict digest {out['digest']['verdict_sha256'][:12]}"


def sentence(chk, par):
    """One line for the evidence pack: who computed the verdict, its parity with the Python reference, its digest."""
    rust = chk["engine"] == "rust"
    who = "certus-gate (Rust, no unsafe code)" if rust else "the Python reference gate (gate/verdict.py)"
    parity = f", same verdict as the Python reference on {par['same']}/{par['cases']} recorded runs" if rust and par.get("cases") else ""
    how = "re-checked from the recorded evidence by" if chk.get("rechecked") else "computed by"
    return f"Verdict {chk['verdict']} {how} {who}{parity}; digest sha256:{chk['digest']} ({SOURCE})"


def checker(out):
    """What the dashboard and the evidence pack show about who decided."""
    return {"engine": out["engine"], "verdict": out["verdict"], "digest": out["digest"]["verdict_sha256"], "label": label(out)}


def recorded():
    """(name, verdict input, recorded verdict) of every recorded gate attempt: stage replays, the dashboard recording,
    the hosted snapshot and the local run cache. Recordings carry no per-check outcomes, so checks = []."""
    files = [os.path.join(ROOT, f) for f in ("demo/replay/build.jsonl", "demo/replay/aircraft/build.jsonl", "dashboard/demo-run.jsonl")]
    files += sorted(glob.glob(os.path.join(ROOT, ".runs/cache/build-*.jsonl")))
    streams = [(os.path.relpath(f, ROOT), [json.loads(line) for line in open(f) if line.strip()]) for f in files if os.path.exists(f)]
    snap = os.path.join(ROOT, "web/public/snapshot.json")
    if os.path.exists(snap):
        streams.append(("web/public/snapshot.json", json.load(open(snap))["events"]))
    for name, evs in streams:
        world = None
        for e in evs:
            if e["agent"] == "gate" and e["state"] == "working":
                world = None
            world = e.get("world") or world
            if e.get("gate") and e["state"] in ("pass", "blocked"):
                rows = e["gate"]["rows"]
                air = (world or {}).get("kind") == "aircraft" or any("demo/aircraft" in r.get("test", "") for r in rows)
                rules = json.load(open(os.path.join(ROOT, "demo/aircraft/safety.json" if air else "demo/pump/safety.json")))
                yield (f"{name}: {e['msg'][:40]}", evidence(rules, [], rows, world), "PASS" if e["state"] == "pass" else "BLOCKED")


_parity = {"engine": None, "cases": 0, "same": 0}


def _check_parity():
    cases = list(recorded())
    same = sum(1 for _, inp, _ in cases if {**decide(inp), "engine": "python"} == reference(canonical(inp)))
    _parity.update(cases=len(cases), same=same)


def status():
    """Which engine decides and, for the Rust one, how many recorded verdicts it reproduces exactly (Python reference).
    The first call starts the check in the background; it answers with cases = 0 until the check is done."""
    rust = os.access(BIN, os.X_OK)
    if _parity["engine"] is None:
        _parity["engine"] = "rust" if rust else "python"
        if rust:
            threading.Thread(target=_check_parity, daemon=True).start()
    return {**_parity, "source": SOURCE}


def _sha(b):
    return hashlib.sha256(b).hexdigest()


def _digests(raw, rules, verdict):
    i, r = _sha(raw), (_sha(rules) if rules else "")
    return {"input_sha256": i, "rules_sha256": r, "verdict_sha256": _sha(f"{i}:{r}:{verdict}".encode())}


def _typed(x, t):
    if type(x) is not t:
        raise TypeError(f"expected {t.__name__}, got {type(x).__name__}")
    return x


def _strs(xs):
    return [_typed(x, str) for x in _typed(xs, list)]


def _rejected(raw, why):
    return {"engine": "python", "verdict": "BLOCKED", "reasons": [f"input rejected: {why}"], "requirements": [],
            "checks": [], "world": {"provided": False, "runs": 0, "new_exceedances": 0, "preexisting": 0, "pass": False},
            "digest": _digests(raw, b"", "BLOCKED")}


def reference(raw):
    """The rules of gate-rs/src/lib.rs in Python: same reasons in the same order, same digests."""
    if len(raw) > MAX_INPUT_BYTES:
        return _rejected(raw, f"larger than {MAX_INPUT_BYTES} bytes")
    try:
        inp = _typed(json.loads(raw), dict)
        rules = _typed(inp["rules"], dict)
        hazards = [{"id": _typed(h["id"], str), "title": _typed(h["title"], str), "severity": _typed(h.get("severity", ""), str)}
                   for h in _typed(rules["hazards"], list)]
        table = [(_typed(r["id"], str), _typed(r["text"], str), _strs(r["hazards"])) for r in _typed(rules["requirements"], list)]
        checks = [{"name": _typed(c["name"], str), "passed": _typed(c["passed"], bool)} for c in _typed(inp.get("checks", []), list)]
        rows = [(_typed(t["id"], str), _typed(t["result"], str), _strs(t.get("why", []))) for t in _typed(inp.get("requirements", []), list)]
        world = inp.get("world")
        if world is not None:
            world = (_typed(world["verdict"], str), [
                (_typed(r["scenario"], str), _typed(r["patient"], str), _typed(r["hypo"], bool), _typed(r["new_hypo"], bool),
                 _typed(r["preexisting"], bool)) for r in _typed(world["results"], list)])
    except (ValueError, KeyError, TypeError) as e:
        return _rejected(raw, str(e))

    reasons, ids, srs = [], set(), set()
    for h in hazards:
        if h["id"] in ids:
            reasons.append(f"rule table: duplicate hazard {h['id']}")
        ids.add(h["id"])
    for sr, _, hz in table:
        if sr in srs:
            reasons.append(f"rule table: duplicate requirement {sr}")
        srs.add(sr)
        if not hz:
            reasons.append(f"rule table: {sr} links no hazard")
        reasons += [f"rule table: {sr} links unknown hazard {h}" for h in hz if h not in ids]

    reasons += [f"check {c['name']} failed" for c in checks if not c["passed"]]

    seen = set()
    for sr, _, _ in rows:
        if sr not in srs:
            reasons.append(f"test result for {sr} matches no requirement in the rule table")
        if sr in seen:
            reasons.append(f"duplicate test result for {sr}")
        seen.add(sr)

    out_reqs = []
    for sr, text, hz in table:
        links = [next((h for h in hazards if h["id"] == x), {"id": x, "title": "?", "severity": ""}) for x in hz]
        names = ", ".join(f"{h['id']} {h['title']}" for h in links)
        row = next((t for t in rows if t[0] == sr), None)
        if row is None:
            affected, result, ok, why = False, "NOT AFFECTED", True, "not affected by this change"
        elif row[1] == "PASS":
            affected, result, ok, why = True, row[1], True, f"test passed (triggered by: {'; '.join(row[2])})"
        else:
            reasons.append(f"{sr} {row[1]} ({text}; {', '.join(hz)})")
            affected, result, ok, why = True, row[1], False, f"test {row[1]}: hazard not mitigated: {names}"
        out_reqs.append({"id": sr, "text": text, "hazards": links, "affected": affected, "result": result, "pass": ok, "reason": why})

    if world is None:
        wv = {"provided": False, "runs": 0, "new_exceedances": 0, "preexisting": 0, "pass": True}
    else:
        reported, runs = world
        before = len(reasons)
        reasons += [f"world model: inconsistent flags for {s}/{p}" for s, p, hypo, new, pre in runs
                    if not (new == (hypo and not pre) and (hypo or not pre))]
        new = sum(1 for _, _, hypo, _, pre in runs if hypo and not pre)
        old = sum(1 for _, _, hypo, _, pre in runs if hypo and pre)
        if not runs:
            reasons.append("world model: no simulated runs")
        computed = "PASS" if new == 0 else "BLOCKED"
        if reported != computed:
            reasons.append(f"world model: reported {reported} but its runs say {computed}")
        if new:
            reasons.append(f"world model: {new} new exceedance(s) caused by this change")
        wv = {"provided": True, "runs": len(runs), "new_exceedances": new, "preexisting": old, "pass": len(reasons) == before}

    verdict = "BLOCKED" if reasons else "PASS"
    rules_raw = canonical(rules)
    return {"engine": "python", "verdict": verdict, "reasons": reasons, "requirements": out_reqs, "checks": checks,
            "world": wv, "digest": _digests(raw, rules_raw, verdict)}
