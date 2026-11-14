"""Check: agents may not edit the evidence (tests, safety spec, the gate and its config).
Usage: python3 gate/check_protected.py --repo PATH --base main     Exit 1 if a protected file changed.
"""
import argparse
import fnmatch
import subprocess
import sys

PROTECTED = ["demo/pump/safety.json", "demo/pump/test_*.c", "gate/*", "sim/*", "AGENTS.md", "CLAUDE.md"]

a = argparse.ArgumentParser()
a.add_argument("--repo", default=".")
a.add_argument("--base", default="main")
args = a.parse_args()
files = subprocess.run(["git", "-C", args.repo, "diff", "--name-only", f"{args.base}..HEAD"],
                       capture_output=True, text=True, check=True).stdout.split()
bad = [f for f in files if any(fnmatch.fnmatch(f, p) for p in PROTECTED)]
if bad:
    print("Protected files were edited (revert them):\n" + "\n".join(f"- {f}" for f in bad))
    sys.exit(1)
print("No protected files changed.")
