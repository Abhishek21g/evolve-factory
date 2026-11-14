"""Export the current factory state as a read-only snapshot for the hosted UI (Vercel).

  .venv/bin/python factory/snapshot.py      # writes web/public/snapshot.json + evidence/diff files

One state per project (`states`), so the hosted UI shows each project its own work orders and runs;
`state` (the first project's) keeps older UI builds working. Events carry their project.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "factory"))
import memory  # noqa: E402
import store  # noqa: E402
import worldmodel  # noqa: E402

pub = os.path.join(ROOT, "web", "public")
status = {"online": False, "busy": False, "job": None, "running": None, "memory": "HydraDB" if os.environ.get("HYDRADB_API_KEY") else "local",
          "composio": False, "software_factory": False}
states = {}
for p in store._load()["projects"]:
    s = store.state(p["id"], None)
    s["status"], s["memory"] = status, memory.items()
    states[p["id"]] = s
first = next(iter(states.values()), {**store.state("", None), "status": status})
evs = store.events()
json.dump({"state": first, "states": states, "events": evs}, open(os.path.join(pub, "snapshot.json"), "w"))
wos = [w for s in states.values() for w in s.get("work_orders", [])]
for w in wos:
    ev = os.path.join(ROOT, ".runs", f"{w['id']}.evidence.md")
    if os.path.exists(ev):
        open(os.path.join(pub, f"evidence-{w['id']}.md"), "w").write(open(ev).read())
    d = store.diff(w["id"])
    if d:
        open(os.path.join(pub, f"diff-{w['id']}.txt"), "w").write(d)
    loop = worldmodel.loop(w["id"]) if w.get("world") else None
    if loop:
        json.dump(loop, open(os.path.join(pub, f"worldmodel-{w['id']}.json"), "w"))
print(f"snapshot: {len(states)} projects, {len(wos)} work orders, {len(evs)} events")
