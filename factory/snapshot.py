"""Export the current factory state as a read-only snapshot for the hosted UI (Vercel).

  .venv/bin/python factory/snapshot.py [project-id]     # writes web/public/snapshot.json + evidence/diff files
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "factory"))
import store  # noqa: E402

pub = os.path.join(ROOT, "web", "public")
s = store.state(sys.argv[1] if len(sys.argv) > 1 else "", None)
s["status"] = {"online": False, "busy": False, "job": None, "running": None, "memory": "HydraDB" if os.environ.get("HYDRADB_API_KEY") else "local",
               "composio": False, "software_factory": False}
evs = store.events()
import memory  # noqa: E402
s["memory"] = memory.items()
json.dump({"state": s, "events": evs}, open(os.path.join(pub, "snapshot.json"), "w"))
for w in s.get("work_orders", []):
    ev = os.path.join(ROOT, ".runs", f"{w['id']}.evidence.md")
    if os.path.exists(ev):
        open(os.path.join(pub, f"evidence-{w['id']}.md"), "w").write(open(ev).read())
    d = store.diff(w["id"])
    if d:
        open(os.path.join(pub, f"diff-{w['id']}.txt"), "w").write(d)
print(f"snapshot: {len(s.get('work_orders', []))} work orders, {len(evs)} events, {len(s['audit'])} audit rows")
