"""Self-check: python3 gate/test_gate.py  (builds throwaway git repos, runs the gate and the flight world model)."""
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
    assert gate.main(["--repo", d, "--safety", spec, "--base", "main"]) == 1
    res = flight.run(d, "main")
    assert res["verdict"] == "BLOCKED" and sum(r["new_hypo"] for r in res["results"]) == 6, res["verdict"]

print("ok")
