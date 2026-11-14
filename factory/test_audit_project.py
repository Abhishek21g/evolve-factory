"""Self-check: python3 factory/test_audit_project.py  (audit entries stay in their project; stdlib only).

A what-if asked in the pump project must never show in the Boeing project's audit trail, even when the entry predates
the project field and the event feed it could be derived from was reset."""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store  # noqa: E402

tmp = tempfile.mkdtemp()
store.PATH, store.FEED = os.path.join(tmp, "factory.json"), os.path.join(tmp, "events.jsonl")
PUMP, AIR = "insulin-pump-firmware", "boeing-flight-controls"
CHILD = "What if a child eats 80 g and the parent types the dose 10x?"
T = 1794651763.4


def save(audit, feed):
    d = {"projects": [{"id": PUMP, "name": "Insulin Pump Firmware", "device": "insulin-pump", "repo": "demo/pump"},
                      {"id": AIR, "name": "Boeing Flight Controls", "device": "flight-controls", "repo": "demo/aircraft"}],
         "work_orders": [{"id": "WO-101", "project": PUMP, "title": "Raise the single-bolus limit to 25 U"}], "audit": audit}
    json.dump(d, open(store.PATH, "w"))
    with open(store.FEED, "w") as f:
        f.writelines(json.dumps(e) + "\n" for e in feed)


def trail(pid):
    return [(a["action"], a["detail"]) for a in store.state(pid, None)["audit"] if a["actor"] == "abhishek"]


old = [{"ts": T, "actor": "abhishek", "action": "asked the world model", "object": "world model", "detail": CHILD},
       {"ts": T + 1, "actor": "abhishek", "action": "signed in", "object": "demo@certus.ai", "detail": "demo workspace"},
       {"ts": T + 2, "actor": "abhishek", "action": "created work order", "object": "WO-101", "detail": "Raise the single-bolus limit to 25 U"}]
run = [{"run": str(int(T)), "t": 0, "agent": "simulation", "state": "working", "msg": "", "title": CHILD, "project": PUMP}]

# Read: an old entry is attributed from its what-if run; sign-ins are workspace-wide.
save(old, run)
assert ("asked the world model", CHILD) in trail(PUMP)
assert ("asked the world model", CHILD) not in trail(AIR), "pump what-if leaked into Boeing"
assert ("signed in", "demo workspace") in trail(AIR) and ("signed in", "demo workspace") in trail(PUMP)
assert ("created work order", "Raise the single-bolus limit to 25 U") not in trail(AIR)

# Feed reset: the entry can no longer be attributed, so it shows in no project rather than in every one.
save(old, [])
assert all(a[1] != CHILD for p in (PUMP, AIR) for a in trail(p))

# Persisted at startup: once stamped, the entry stays in its project after the feed is reset.
save(old, run)
assert store.attribute_audit() == 2  # the what-if and the work order; the sign-in stays workspace-wide
open(store.FEED, "w").close()
assert ("asked the world model", CHILD) in trail(PUMP) and all(a[1] != CHILD for a in trail(AIR))
assert "project" not in store._load()["audit"][1]

# Write: entries logged without a project get it from their work order.
store.log("abhishek", "started run", "WO-101", "Raise the single-bolus limit to 25 U")
assert store._load()["audit"][-1]["project"] == PUMP
assert store.project_id("") == PUMP and store.project_id(AIR) == AIR and store.project_id("nope") == PUMP
print("audit entries stay in their project")
