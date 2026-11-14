"""Export a running factory server as the read-only snapshot the hosted UI (Vercel) shows.

  python3 factory/snapshot.py [http://localhost:8787]

Asks the server every GET the UI makes (GETs only: the server's state is not touched) and writes the answers to web/public:
  snapshot.json               every project's state, the all-projects state and the event feed (bundled: first paint)
  snapshot/<key>.json|.txt    every other answer. With no server, web/src/lib/api.ts reads /snapshot/<key> instead of
                              /api/<path>; key = the decoded path and query with anything but [A-Za-z0-9.-] as "_".
  supply-<project>.json, tower-<project>.json, tower-all.json   the files the supply pages read (web/src/lib/supply.ts)
Waits for running jobs and monitors to finish first, so the hosted site never shows one frozen mid-run.
Absolute paths on the exporting machine become <repo>; status is marked offline (the hosted site cannot run anything).
"""
import glob
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import quote, unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "web", "public")
OUT = os.path.join(PUB, "snapshot")
URL = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8787").rstrip("/")
LOCAL_PATH = re.compile(r"(/Users|/home)/[^/\"'\s]+/[^/\"'\s]+")
OFFLINE = {"online": False, "busy": False, "job": None, "running": None, "project": None}


def get(path):
    """The server's answer to GET /api/<path>: text, or None if it has nothing (404)."""
    try:
        with urllib.request.urlopen(f"{URL}/api/{path}", timeout=60) as r:
            return LOCAL_PATH.sub("<repo>", r.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def key(path):
    return re.sub(r"[^A-Za-z0-9.-]", "_", unquote(path))


def save(path, body, ext="json"):
    if body is not None:
        open(os.path.join(OUT, f"{key(path)}.{ext}"), "w").write(body if isinstance(body, str) else json.dumps(body))


def idle(pids):
    busy = json.loads(get("state"))["status"]["busy"]
    return not busy and not any(m["running"] for p in pids for m in json.loads(get(f"monitors?project={p}"))["monitors"])


projects = [p["id"] for p in json.loads(get("state"))["projects"]]
for _ in range(60):
    if idle(projects):
        break
    print("snapshot: waiting for a running job or monitor to finish...", flush=True)
    time.sleep(3)
else:
    sys.exit("snapshot: the factory stayed busy for 3 minutes; try again when it is idle")

shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
for f in glob.glob(os.path.join(PUB, "*.json")) + glob.glob(os.path.join(PUB, "*.md")) + glob.glob(os.path.join(PUB, "*.txt")):
    if re.match(r"(evidence|diff|worldmodel|record|monitors?|supply|tower)-", os.path.basename(f)):  # older exports
        os.remove(f)

def state(pid):
    s = json.loads(get(f"state?project={quote(pid, safe='')}"))
    s["status"].update(OFFLINE)
    return s


states = {p: state(p) for p in projects}
events = json.loads(get("events?since=0"))["events"]
json.dump({"state": state(""), "states": states, "events": events}, open(os.path.join(PUB, "snapshot.json"), "w"))

wos = [w for s in states.values() for w in s.get("work_orders") or []]
for w in wos:
    q = quote(w["id"], safe="")
    save(f"evidence?wo={w['id']}", get(f"evidence?wo={q}"), "txt")
    save(f"diff?wo={w['id']}", get(f"diff?wo={q}"), "txt")
    save(f"worldmodel?wo={q}", get(f"worldmodel?wo={q}"))
    save(f"callouts?wo={q}", get(f"callouts?wo={q}"))

files = set()
for p, s in states.items():
    q = quote(p, safe="")
    for path in (f"callouts?project={q}", f"incidents?project={q}", f"record?project={q}", f"memory?q=&project={q}"):
        save(path, get(path))
    mv = json.loads(get(f"monitors?project={q}"))
    for m in mv["monitors"]:
        m["next"] = None  # schedules do not run on a static host
        for r in m["runs"]:
            save(f"monitors/evidence?run={r['id']}", get(f"monitors/evidence?run={quote(r['id'], safe='')}"))
    save(f"monitors?project={q}", mv)
    json.dump(json.loads(get(f"supply?project={q}")), open(os.path.join(PUB, f"supply-{p}.json"), "w"))
    json.dump(json.loads(get(f"supply/tower?project={q}")), open(os.path.join(PUB, f"tower-{p}.json"), "w"))
    files |= set(re.findall(r'"path": "([^"]+)"', json.dumps(s.get("trace") or {})))
json.dump(json.loads(get("supply/tower")), open(os.path.join(PUB, "tower-all.json"), "w"))
save("memory?q=", get("memory?q="))
integ = json.loads(get("integrations"))
integ["composio"]["checked"] = None  # "checked 3 h ago" says nothing on a static host
save("integrations", integ)
for f in sorted(files):  # repo files the traceability viewer opens
    path = f"trace/file?path={quote(f, safe='')}"
    save(path, get(path))

n = len(os.listdir(OUT))
print(f"snapshot from {URL}: {len(states)} projects, {len(wos)} work orders, {len(events)} events, {n} files in web/public/snapshot")
