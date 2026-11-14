"""Self-check: python3 gate/test_gate.py  (builds a throwaway git repo, runs the gate twice)."""
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
import gate  # noqa: E402

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

print("ok")
