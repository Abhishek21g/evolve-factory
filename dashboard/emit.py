"""Append one agent event to the dashboard feed (dashboard/events.jsonl).

Python:  from emit import emit; emit("coder-claude", "working", "Editing pump.c", wo="WO-12")
Shell:   python3 dashboard/emit.py coder-claude working "Editing pump.c"

Agents:  planner, coder-claude, coder-codex, safety, gate, world, reviewer
States:  idle, working, blocked, pass, done
A gate event may carry gate=<gate.py --json output> to fill the traceability matrix.
A world event may carry world=<sim/world.py --json output> to draw the blood-sugar chart.
Child processes (checks run by the runner) inherit RUN_ID/RUN_T0, so their events join the same run.
"""
import json
import os
import sys
import time

FEED = os.environ.get("EVENTS", os.path.join(os.path.dirname(os.path.abspath(__file__)), "events.jsonl"))
RUN = os.environ.setdefault("RUN_ID", str(int(time.time())))
T0 = float(os.environ.setdefault("RUN_T0", str(time.time())))


def emit(agent, state, msg, **data):
    ev = {"run": RUN, "t": round(time.time() - T0, 2), "agent": agent, "state": state, "msg": msg, **data}
    with open(FEED, "a") as f:
        f.write(json.dumps(ev) + "\n")
    print(f"[{agent}] {state}: {msg}", flush=True)
    return ev


def reset():
    open(FEED, "w").close()


if __name__ == "__main__":
    emit(*sys.argv[1:4])
