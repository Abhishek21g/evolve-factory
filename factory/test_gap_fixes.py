"""Self-check: python3 factory/test_gap_fixes.py  (demo data stays truthful; stdlib only).

- A run replayed into a work order that asked for something else (Run on a supplier draft in replay mode) gets its own
  work order title back at startup, and the supplier request moves to a new draft.
- A retired what-if (a typo) leaves the feed, the agents, the audit trail and the hosted replays.
- Older runs and drafts of the same request leave the work-order lists but still open by id.
- The Control Tower's simulation verdict is the one Simulations shows.
- The recorded sample call's incident is listed on its project, labelled a sample, and its id is never reused."""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import incidents  # noqa: E402
import store  # noqa: E402
import supply  # noqa: E402

tmp = tempfile.mkdtemp()
store.PATH, store.FEED = os.path.join(tmp, "factory.json"), os.path.join(tmp, "events.jsonl")
incidents.PATH = os.path.join(tmp, "incidents.json")
PUMP, AIR = "insulin-pump-firmware", "boeing-flight-controls"
BOLUS, AOA = "Raise the single-bolus limit to 25 U", "Add AoA disagree alert when the two sensors differ by more than 5 degrees"
SUPPLIER = "Supplier compliance: obtain DO-178C Software Accomplishment Summary from Flight control computer supplier (sample)"
T = 1794663774.0


def ev(run, agent, state, **kw):
    return {"run": str(run), "t": kw.pop("t", 0), "agent": agent, "state": state, "msg": kw.pop("msg", ""), **kw}


def world(question=None, hypo=(), new=(), n=10):
    return {"base": "none" if question else "origin/main", "step_min": 5, "threshold": 54, "verdict": "PASS",
            **({"question": question} if question else {}),
            "results": [{"hypo": i in hypo, "new_hypo": i in new, "trace": [120] * 10} for i in range(n)]}


wos = [{"id": "WO-101", "project": PUMP, "title": BOLUS, "description": "old draft", "created": T - 900, "requested_by": "abhishek"},
       {"id": "WO-102", "project": PUMP, "title": BOLUS, "description": "", "created": T - 800, "requested_by": "abhishek"},
       {"id": "WO-305", "project": PUMP, "title": BOLUS, "description": "", "created": T - 700, "requested_by": "abhishek"},
       {"id": "WO-345", "project": AIR, "title": SUPPLIER, "description": "Raised by the supplier compliance check.", "created": T, "requested_by": "abhishek"},
       {"id": "WO-346", "project": AIR, "title": "Let pilots silence the alert", "description": "", "created": T + 500, "requested_by": "abhishek"}]
audit = [{"ts": T, "actor": "abhishek", "action": "created work order", "object": "WO-345", "detail": SUPPLIER, "project": AIR},
         {"ts": T + 98, "actor": "abhishek", "action": "started run", "object": "WO-345", "detail": SUPPLIER, "project": AIR},
         {"ts": T + 300, "actor": "abhishek", "action": "asked the world model", "object": "world model", "detail": "trublanceh", "project": AIR},
         {"ts": T + 500, "actor": "abhishek", "action": "created work order", "object": "WO-346", "detail": wos[4]["title"], "project": AIR},
         {"ts": T + 500.2, "actor": "abhishek", "action": "started run", "object": "WO-346", "detail": wos[4]["title"], "project": AIR}]
feed = [ev(T - 800, "planner", "working", wo="WO-102", title=BOLUS, project=PUMP),
        ev(T - 800, "reviewer", "done", wo="WO-102", t=9, project=PUMP),
        ev(T - 700, "planner", "working", wo="WO-305", title=BOLUS, project=PUMP),
        ev(T - 700, "world", "pass", wo="WO-305", t=5, world=world(), project=PUMP),
        ev(T - 700, "reviewer", "done", wo="WO-305", t=9, project=PUMP),
        ev(T - 600, "simulation", "working", title="What if a child eats 80 g and the parent types the dose 10x?", project=PUMP),
        ev(T - 600, "world", "done", t=4, project=PUMP, world=world("What if a child eats 80 g and the parent types the dose 10x?", hypo={1, 2})),
        ev(T + 98, "planner", "working", wo="WO-345", title=AOA, project=AIR),
        ev(T + 98, "reviewer", "done", wo="WO-345", t=9, project=AIR),
        ev(int(T + 300), "simulation", "working", title="trublanceh", project=AIR),
        ev(int(T + 300), "world", "done", t=4, project=AIR, world={**world("trublanceh", hypo={0}), "kind": "aircraft", "axis": {}}),
        # a composer run: typed text differs from the recording it replays, created and started together
        ev(T + 500, "planner", "working", wo="WO-346", title=AOA, project=AIR),
        ev(T + 500, "reviewer", "done", wo="WO-346", t=9, project=AIR)]
projects = [{"id": PUMP, "name": "Insulin Pump Firmware", "device": "insulin-pump", "repo": "demo/pump"},
            {"id": AIR, "name": "Boeing Flight Controls", "device": "flight-controls", "repo": "demo/aircraft"}]
json.dump({"projects": projects, "work_orders": wos, "audit": audit}, open(store.PATH, "w"))
with open(store.FEED, "w") as f:
    f.writelines(json.dumps(e) + "\n" for e in feed)

# 1. The AoA run keeps WO-345 (its files, events and links) under its own title; the supplier request is a new draft.
moved = store.split_misplayed_runs()
assert len(moved) == 1 and moved[0] != "WO-345", moved
air = store.state(AIR, None)
by_id = {w["id"]: w for w in air["work_orders"]}
assert by_id["WO-345"]["title"] == AOA and by_id["WO-345"]["status"] == "Approved", by_id["WO-345"]
assert "supplier" not in by_id["WO-345"]["description"].lower()
sup = by_id[moved[0]]
assert sup["title"] == SUPPLIER and sup["status"] == "Draft" and sup["description"].startswith("Raised by the supplier")
assert by_id["WO-346"]["title"] == "Let pilots silence the alert", "a composer run must keep the typed title"
trail = [(a["action"], a["object"], a["detail"]) for a in air["audit"] if a["actor"] == "abhishek"]
assert ("created work order", moved[0], SUPPLIER) in trail and ("started run", "WO-345", AOA) in trail, trail
assert store.split_misplayed_runs() == [], "the migration runs once"

# 2. Replay mode refuses to play the recorded build into the supplier draft; the recorded request (or a rerun) is fine.
assert not store.replayable(sup)
assert store.replayable({"id": "WO-999", "project": AIR, "title": AOA}) and store.replayable(by_id["WO-346"])

# 3. Retiring the typo what-if hides it everywhere it showed; a work order run cannot be retired.
assert any(e["run"] == str(int(T + 300)) for e in store.events(AIR))
assert store.retire_run("abhishek", str(int(T + 300)), "typo") == 2
assert not any(e["run"] == str(int(T + 300)) for e in store.events())
air = store.state(AIR, None)
assert not any("trublanceh" in json.dumps(a) for a in air["audit"]), "the typo is gone from the audit trail"
assert ("retired what-if", "typo") in [(a["action"], a["detail"]) for a in air["audit"]]
assert "simulation" not in air["agents"], "the Agents page no longer shows the typo run"
try:
    store.retire_run("abhishek", str(int(T + 98)))
    raise AssertionError("a work order run was retired")
except ValueError:
    pass

# 4. Older runs and the stale draft of the same request leave the lists; they still open by id.
pump = store.state(PUMP, None)
assert [w["id"] for w in pump["work_orders"]] == ["WO-305"], pump["work_orders"]
assert {w["id"]: w["superseded_by"] for w in pump["archived_work_orders"]} == {"WO-101": "WO-305", "WO-102": "WO-305"}
assert store.superseded([{"id": "A", "title": BOLUS, "status": "Approved", "created": 1},
                         {"id": "B", "title": BOLUS, "status": "Draft", "created": 2}]) == {}, "a newer draft stays"

# 5. The Control Tower leads with the latest what-if, judged like Simulations: any harm in a what-if is UNSAFE.
assert supply.sim_verdict(world("q", hypo={1})) == "UNSAFE" and supply.sim_verdict(world("q")) == "SAFE"
assert supply.sim_verdict(world(new={1})) == "BLOCKED" and supply.sim_verdict(world(hypo={1})) == "PASS"
assert supply.sim_verdict({**world("q"), "results": [{"hypo": False, "trace": [300] * 30}]}) == "AT RISK"
t = supply.tower(PUMP)
assert t["safety"]["sim"]["verdict"] == "UNSAFE" and t["safety"]["sim"]["harmed"] == 2 and t["safety"]["sim"]["question"], t["safety"]
assert t["software"]["total"] == 1, "the tower counts the work orders the list shows"

# 6. The recorded sample call's incident is on its project's list, labelled; its id is never handed out again.
s = incidents.sample()
assert s and s["sample"] and s["source"] == "recorded"
assert [x["id"] for x in incidents.listing(s["project"])] == [s["id"]]
assert not incidents.listing(PUMP if s["project"] != PUMP else AIR)
n = int(s["id"][4:])
assert incidents.next_id([{"id": f"INC-{i}"} for i in range(1, n)]) == f"INC-{n + 1}"
print("demo data stays truthful")
