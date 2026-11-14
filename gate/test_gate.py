"""Self-check: python3 gate/test_gate.py  (builds throwaway git repos, runs the gate and the flight world model, and checks
the Rust verdict layer against the Python reference)."""
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, "sim"))
import gate  # noqa: E402
import flight  # noqa: E402
import verdict  # noqa: E402

FIXTURES = []  # (name, verdict input, expected verdict)

SRC = "#define MAX_BOLUS_U {}\nint cap(int u){{ return u > MAX_BOLUS_U ? MAX_BOLUS_U : u; }}\n"
TEST = 'grep -q "MAX_BOLUS_U 10$" bolus.c'  # stands in for a real unit test: max must stay 10 U


def sh(repo, *cmd):
    subprocess.run(cmd, cwd=repo, check=True, capture_output=True)


with tempfile.TemporaryDirectory() as d:
    sh(d, "git", "init", "-q", "-b", "main")
    sh(d, "git", "config", "user.email", "t@t")
    sh(d, "git", "config", "user.name", "t")
    open(f"{d}/bolus.c", "w").write(SRC.format(10))
    open(f"{d}/readme.txt", "w").write("hi\n")
    spec = {"hazards": [{"id": "H-1", "title": "Insulin overdose"}],
            "requirements": [{"id": "SR-1", "text": "Bolus <= 10 U", "hazards": ["H-1"],
                              "files": ["bolus.c"], "symbols": ["MAX_BOLUS_U"], "test": TEST}]}
    json.dump(spec, open(f"{d}/safety.json", "w"))
    sh(d, "git", "add", "-A"); sh(d, "git", "commit", "-qm", "base")

    # harmless change: gate passes, nothing affected
    sh(d, "git", "checkout", "-qb", "docs")
    open(f"{d}/readme.txt", "w").write("hello\n")
    sh(d, "git", "commit", "-qam", "docs")
    assert gate.main(["--repo", d, "--safety", f"{d}/safety.json", "--base", "main"]) == 0

    # unsafe change: raises bolus cap, gate must block
    sh(d, "git", "checkout", "-q", "main"); sh(d, "git", "checkout", "-qb", "bump")
    open(f"{d}/bolus.c", "w").write(SRC.format(25))
    sh(d, "git", "commit", "-qam", "bump")
    assert gate.main(["--repo", d, "--safety", f"{d}/safety.json", "--base", "main"]) == 1
    for branch, want in (("docs", "PASS"), ("bump", "BLOCKED")):
        sh(d, "git", "checkout", "-q", branch)
        gate.main(["--repo", d, "--safety", f"{d}/safety.json", "--base", "main", "--json", f"{d}/g.json"])
        FIXTURES.append((f"bolus fixture: {branch}", verdict.evidence(spec, [("protected-files", True)], json.load(open(f"{d}/g.json"))["rows"], None), want))

# Flight controls: the obvious AoA-alert patch (disagree monitor 5.5 -> 5 deg) fails SR-3 and stalls simulated aircraft.
with tempfile.TemporaryDirectory() as d:
    sh(d, "git", "init", "-q", "-b", "main")
    sh(d, "git", "config", "user.email", "t@t")
    sh(d, "git", "config", "user.name", "t")
    shutil.copytree(os.path.join(ROOT, "demo/aircraft"), f"{d}/demo/aircraft", ignore=shutil.ignore_patterns("test_fcc"))
    sh(d, "git", "add", "-A"); sh(d, "git", "commit", "-qm", "base")
    spec = os.path.join(ROOT, "demo/aircraft/safety.json")
    assert flight.run(d, "main")["verdict"] == "PASS"
    sh(d, "git", "checkout", "-qb", "obvious")
    subprocess.run(["sh", os.path.join(ROOT, "demo/aircraft/obvious_patch.sh")], cwd=d, input="Work Order WO-1",
                   capture_output=True, text=True, check=True, env={**os.environ, "EVENTS": os.devnull})
    sh(d, "git", "commit", "-qam", "obvious")
    assert gate.main(["--repo", d, "--safety", spec, "--base", "main", "--json", f"{d}/g.json"]) == 1
    res = flight.run(d, "main")
    assert res["verdict"] == "BLOCKED" and sum(r["new_hypo"] for r in res["results"]) == 6, res["verdict"]
    FIXTURES.append(("aircraft fixture: obvious AoA patch", verdict.evidence(
        json.load(open(spec)), [("protected-files", True)], json.load(open(f"{d}/g.json"))["rows"], res), "BLOCKED"))


# Deterministic verdict layer: the Rust binary (gate-rs/) and the Python reference (gate/verdict.py) must give identical
# output on every fixture above and on every recorded run (verdict.recorded()), and the same verdict the run showed.
if not os.access(verdict.BIN, os.X_OK) and shutil.which("cargo"):
    subprocess.run(["cargo", "build", "--release", "-q"], cwd=os.path.join(ROOT, "gate-rs"), check=True)
cases = FIXTURES + list(verdict.recorded())
assert len(cases) >= 12, len(cases)
rust = os.access(verdict.BIN, os.X_OK)
for name, inp, want in cases:
    py = verdict.reference(verdict.canonical(inp))
    assert py["verdict"] == want, (name, py["reasons"])
    if rust:
        rs = verdict.decide(inp)
        assert rs["engine"] == "rust", name
        assert {**rs, "engine": "python"} == py, (name, rs, py)
print(f"verdict parity: {len(cases)} cases, " + ("Rust == Python on all" if rust else "Python only (Rust gate not built)"))

print("ok")
