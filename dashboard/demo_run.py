"""Drive the WO-12 demo story into the dashboard feed.

Agent patches are scripted (stand-in until the runner calls claude/codex for real).
Gate verdicts are REAL: each candidate is committed in a throwaway worktree and checked by gate/gate.py.

  python3 dashboard/demo_run.py            # live, paced for the stage (open the dashboard first)
  python3 dashboard/demo_run.py --fast     # no pauses
  python3 dashboard/demo_run.py --record   # also save the run to dashboard/demo-run.jsonl for replay
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import emit as feed  # noqa: E402

FAST = "--fast" in sys.argv
WO = "WO-12"
TITLE = "Allow larger meal bolus for adult profile"

EXTENDED = '''
/* WO-12: meal doses above MAX_BOLUS_U are delivered as an extended bolus.
 * Rate never exceeds MAX_BOLUS_U per hour (SR-1); daily cap (SR-2) and low-BG lockout (SR-3) still apply. */
pump_status request_extended_bolus(pump_state *s, double units, int bg_mg_dl, int minutes) {
    if (units <= 0 || minutes <= 0 || units * 60.0 / minutes > MAX_BOLUS_U) return REJECT_LIMIT;
    if (bg_mg_dl < MIN_BG_FOR_BOLUS) return REJECT_LOW_BG;
    if (s->delivered_today_u + units > MAX_DAILY_U) return REJECT_DAILY;
    s->delivered_today_u += units;
    return OK;
}
'''

CANDIDATES = {
    "claude-1": [("demo/pump/pump.h", "MAX_BOLUS_U       10.0", "MAX_BOLUS_U       25.0")],
    "codex-1": [("demo/pump/pump.h", "MAX_DAILY_U       60.0", "MAX_DAILY_U       90.0")],
    "claude-2": [("demo/pump/pump.c", None, EXTENDED),
                 ("demo/pump/pump.h", "#endif", "pump_status request_extended_bolus(pump_state *s, double units, int bg_mg_dl, int minutes);\n\n#endif")],
}


def pause(s):
    if not FAST:
        time.sleep(s)


def ev(agent, state, msg, **kw):
    feed.emit(agent, state, msg, wo=WO, **kw)


def gate(name):
    """Commit candidate edits in a temp worktree off main, run the real gate, return its JSON result."""
    tmp = tempfile.mkdtemp(prefix=f"wo12-{name}-")
    git = lambda *a: subprocess.run(["git", "-C", tmp, *a], check=True, capture_output=True)  # noqa: E731
    subprocess.run(["git", "-C", REPO, "worktree", "add", "-q", "--detach", tmp, "main"], check=True)
    try:
        for path, old, new in CANDIDATES[name]:
            p = os.path.join(tmp, path)
            src = open(p).read()
            open(p, "w").write(src + new if old is None else src.replace(old, new))
        git("-c", "user.name=agent", "-c", "user.email=agent@local", "commit", "-qam", f"{WO}: {name}")
        out = os.path.join(tmp, "gate.json")
        subprocess.run([sys.executable, os.path.join(REPO, "gate/gate.py"), "--repo", tmp,
                        "--safety", os.path.join(tmp, "demo/pump/safety.json"), "--base", "main",
                        "--json", out], capture_output=True)
        return json.load(open(out))
    finally:
        subprocess.run(["git", "-C", REPO, "worktree", "remove", "--force", tmp], capture_output=True)
        shutil.rmtree(tmp, ignore_errors=True)


def failed(res):
    return ", ".join(f'{r["id"]} ({r["hazards"][0]["title"]})' for r in res["rows"] if r["result"] != "PASS")


def main():
    feed.reset()
    ev("planner", "working", f"Pulled {WO} \"{TITLE}\" from Software Factory (status: Ready)", title=TITLE)
    pause(2)
    ev("planner", "done", "Plan: change bolus path in demo/pump; 2 coders in parallel worktrees")
    ev("safety", "working", f"Mapping {WO} to hazard analysis")
    pause(2)
    ev("safety", "done", "Bolus path in scope: H-1 overdose, H-2 daily overdose, H-3 hypoglycemia (SR-1..SR-3)")

    ev("coder-claude", "working", "Attempt 1: raise MAX_BOLUS_U 10 to 25 U")
    ev("coder-codex", "working", "Attempt 1: raise MAX_DAILY_U 60 to 90 U")
    pause(3)
    for coder, name in (("coder-claude", "claude-1"), ("coder-codex", "codex-1")):
        ev(coder, "done", "Patch ready, sent to Safety Gate")
        ev("gate", "working", f"Checking {coder} candidate against safety.json")
        res = gate(name)
        pause(1.5)
        ev("gate", res["verdict"].lower(), f'{coder}: {res["verdict"]}  {failed(res)}', gate=res, candidate=coder)
        ev(coder, "blocked", f"Gate feedback: {failed(res)} failed. Revising.")
        pause(1.5)

    ev("coder-claude", "working", "Attempt 2: keep limits, add extended bolus (max 10 U/hour)")
    ev("coder-codex", "working", "Attempt 2: in progress")
    pause(3)
    ev("coder-claude", "done", "Patch ready, sent to Safety Gate")
    ev("gate", "working", "Checking coder-claude attempt 2")
    res = gate("claude-2")
    pause(1.5)
    ev("gate", res["verdict"].lower(), f'coder-claude: {res["verdict"]}, {len(res["rows"])} requirements tested',
       gate=res, candidate="coder-claude")
    ev("coder-codex", "done", "Stopped: coder-claude passed first")
    ev("reviewer", "working", "Drafting PR with traceability matrix and test evidence")
    pause(2)
    ev("reviewer", "done", f"PR \"{WO}: extended meal bolus\" ready, safety-gate {res['verdict']}, links to {WO}")

    if "--record" in sys.argv:
        shutil.copy(feed.FEED, os.path.join(HERE, "demo-run.jsonl"))
    return 0 if res["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
