"""Certus Factory local server: the web UI talks to this; it runs agents and simulations on this machine.

  .venv/bin/python factory/server.py          # http://localhost:8787

GET  /api/state?project=ID         team, projects, hazards, requirements, work orders, audit trail, trace graph
GET  /api/events?since=N           live agent events from line N
GET  /api/evidence?wo=WO-x         evidence pack (markdown)      GET /api/diff?wo=WO-x   code change
GET  /api/worldmodel?wo=WO-x       world-model loop: every attempt's simulation, diagnosis, fix and re-simulation
GET  /api/memory?q=...             org memory and recall (HydraDB, local fallback)
GET  /api/trace/file?path=P        a git-tracked repo file, read-only (anything else is refused)
GET  /api/trace/search?q=&project= repo files, doc sections and code lines for the trace-link picker
GET  /api/record?project=ID        living source of record: each requirement's sync status against code, tests, links, simulation
GET  /api/monitors?project=ID      monitoring agents (automations) and their run history
GET  /api/monitors/evidence?run=R  one monitor run's evidence (report markdown + data)
GET  /api/supply?project=ID        suppliers, parts/BOM with risk flags, finance (factory/supply.py, sample data labelled)
GET  /api/supply/tower[?project=ID] control tower: one project, or every project
GET  /api/connect/composio         redirects to a Composio Connect Link to authorize GitHub (one time)
GET  /api/callouts?wo=WO-x         cockpit callouts / pump alarms of the work order's before/after runs (?project=ID: latest what-if)
GET  /api/hotline                  safety hotline agent id and whether live calls are possible
GET  /api/hotline/token            WebRTC token for one browser call with the hotline agent (the key stays here)
GET  /api/incidents?project=ID     incidents reported on the hotline
POST /api/incidents {project, what_happened, when, severity, context, caller, summary}   the agent's create_incident tool
POST /api/incidents/transcript {id, transcript, conversation_id}                       the call's transcript, after it ends
POST /api/projects   {name, device}                 create a project (imports its hazard log)
POST /api/workorders {project, title, description}  create a work order
POST /api/run        {wo}                           run a work order through the factory
POST /api/whatif     {text}                         ask the world model a plain-English question
POST /api/trace/links {project, item, kind, path|url, start, end, anchor, label}   add a trace link
POST /api/trace/links/delete {project, id}          remove a trace link
POST /api/trace/tests {project}                     rerun the project's requirement tests
POST /api/record/resync {project}                   resync the source of record now (simulation evidence first, cached)
POST /api/monitors/run {id, project}                run a monitor now (in the background)
POST /api/supply/suppliers {project, name, tier, parent, kind, supplies, contact, email, affects}   connect a supplier team
POST /api/supply/deliverables {project, supplier, deliverable, title, kind, url, item, expires}  a supplier submits a deliverable
/api/auth/*  sign-in, session, sign-out (factory/auth.py)
POST actions carry the acting person in the X-Actor header (recorded in the audit trail).
Everything else is served from web/out. Keys are read from .env and never sent to the browser.
"""
import json
import os
import re
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "factory"))
import auth  # noqa: E402
import callouts  # noqa: E402
import elevenlabs  # noqa: E402
import hotline  # noqa: E402
import incidents  # noqa: E402
import memory  # noqa: E402
import monitors  # noqa: E402
import record  # noqa: E402
import store  # noqa: E402
import supply  # noqa: E402
import worldmodel  # noqa: E402
import tracelinks  # noqa: E402

STATIC = os.path.join(ROOT, "web", "out")
PY = os.path.join(ROOT, ".venv/bin/python")
lock = threading.Lock()
job = {"proc": None, "kind": None, "wo": None, "project": None}
HUMANS = {m["id"] for m in store.TEAM if m["kind"] == "human"}


def load_env():
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p):
            m = re.match(r"\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$", line)
            if m and not line.lstrip().startswith("#"):
                os.environ.setdefault(m.group(1), m.group(2).strip('"\''))


def busy():
    return job["proc"] is not None and job["proc"].poll() is None


def composio_status():
    if not os.environ.get("COMPOSIO_API_KEY"):
        return "missing key"
    p = os.path.join(ROOT, ".runs", "composio.json")
    return json.load(open(p))["state"] if os.path.exists(p) else "checking"


def warm():
    """Background, so the server answers at once: copy local memory into HydraDB and open the connection with a
    first recall; keep the Composio connection status fresh (it flips to connected soon after GitHub is authorized)."""
    memory.recall("bolus limit")  # first: an outage is detected within 2 s and every run after that skips HydraDB
    try:
        memory.seed()
    except Exception as e:
        print(f"[memory] HydraDB seed failed (local store still works): {e}", flush=True)
    threading.Thread(target=count_memory, daemon=True).start()
    if os.path.exists(os.path.join(ROOT, ".runs", "composio.json")):
        os.remove(os.path.join(ROOT, ".runs", "composio.json"))
    while os.environ.get("COMPOSIO_API_KEY"):
        try:
            subprocess.run([PY, os.path.join(ROOT, "factory/actions.py"), "status"], capture_output=True, timeout=60)
        except subprocess.TimeoutExpired:
            pass
        time.sleep(30)


def count_memory():
    """Keep the Memory page's per-collection counts (read from HydraDB) fresh, off the request path."""
    while True:
        memory.refresh_inventory()
        time.sleep(30)


def start(kind, *args, wo=None, project=""):
    with lock:
        if busy():
            return False
        env = {k: v for k, v in os.environ.items() if k not in ("RUN_ID", "RUN_T0")}  # fresh dashboard run
        env["FACTORY_PROJECT"] = project  # which project's code, safety spec, gate and world model
        env["HYDRADB_FAILED_AT"] = str(memory.failed_at())
        log = open(os.path.join(ROOT, ".runs", "server-job.log"), "w")
        job["proc"] = subprocess.Popen([PY, os.path.join(ROOT, "factory/pipeline.py"), kind, *args], cwd=ROOT, env=env,
                                       stdout=log, stderr=subprocess.STDOUT)
        job["kind"], job["wo"], job["project"] = kind, wo, project
        return True


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=STATIC, **k)

    def log_message(self, *a):
        pass

    def send(self, code, obj, ctype="application/json", headers=None):
        body = obj.encode() if isinstance(obj, str) else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Actor, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        wo = re.sub(r"[^A-Za-z0-9-]", "", q.get("wo", ""))
        if u.path == "/api/state":
            s = store.state(q.get("project", ""), job["wo"] if busy() else None)
            s["status"] = {"online": True, "busy": busy(), "job": job["kind"] if busy() else None, "running": job["wo"] if busy() else None, "project": job["project"] if busy() else None,
                           "memory": memory.backend(), "hydradb": memory.status(),
                           "composio": bool(os.environ.get("COMPOSIO_API_KEY")), "composio_status": composio_status(),
                           "software_factory": bool(os.environ.get("SF_API_KEY")), "replay": os.environ.get("FACTORY_REPLAY") == "1"}
            return self.send(200, s)
        if u.path == "/api/connect/composio":  # one-time: authorize GitHub for the factory's Composio user
            link = subprocess.run([PY, os.path.join(ROOT, "factory/actions.py"), "connect"], capture_output=True, text=True,
                                  timeout=30).stdout.strip()
            if not link.startswith("https://"):
                return self.send(502, {"error": "could not get a Composio connect link"})
            self.send_response(302)
            self.send_header("Location", link)
            self.end_headers()
            return
        if u.path.startswith("/api/auth/"):
            code, obj, h = auth.handle(u.path, {}, self.headers)
            return self.send(code, obj, headers=h)
        if u.path == "/api/events":
            since = int(q.get("since", "0"))
            evs = store.events()  # every event stamped with its project; the UI shows the selected project's
            return self.send(200, {"total": len(evs), "events": evs[since:]})
        if u.path == "/api/evidence":
            p = os.path.join(ROOT, ".runs", f"{wo}.evidence.md")
            if not os.path.exists(p):
                return self.send(404, {"error": "none"})
            w = next((w for w in store._load()["work_orders"] if w["id"] == wo), None)
            dev = store.device(w["project"] if w else "")
            gate = os.path.join(ROOT, ".runs", f"{wo}.gate.json")
            reqs = {r["id"] for r in json.load(open(gate))["rows"]} if os.path.exists(gate) else set()
            return self.send(200, open(p).read() + tracelinks.evidence_section(dev["id"], store.safety_spec(dev), reqs), "text/markdown")
        if u.path == "/api/trace/file":
            f = tracelinks.read_file(q.get("path", ""))
            return self.send(200, f) if f else self.send(404, {"error": "not a file in the repository"})
        if u.path == "/api/trace/search":
            return self.send(200, tracelinks.search(q.get("q", ""), store.device(q.get("project", ""))["repo"]))
        if u.path == "/api/memory":  # ?q=recall query &project=ID (scope to its device; omit for all)
            dev = store.device(q["project"])["id"] if q.get("project") else None
            hits, info = memory.search(q["q"], k=8, project=dev, collections=memory.COLLECTIONS) if q.get("q") else ([], None)
            return self.send(200, {"backend": memory.backend(), "items": memory.items(dev)[:300], "hits": hits, "recall": info,
                                   "inventory": memory.inventory(), "project": dev})
        if u.path == "/api/diff":
            return self.send(200, store.diff(wo) or "No code changes yet.", "text/plain")
        if u.path == "/api/callouts":
            evs = store.events()
            b = callouts.for_wo(evs, wo) if wo else callouts.latest_whatif([e for e in evs if e["project"] == q.get("project", "")])
            return self.send(200, b) if b else self.send(404, {"error": "no simulation to voice"})
        if u.path == "/api/hotline":
            return self.send(200, {"agent_id": hotline.agent_id(), "live": bool(elevenlabs.key() and hotline.agent_id())})
        if u.path == "/api/hotline/token":
            if not (elevenlabs.key() and hotline.agent_id()):
                return self.send(503, {"error": "hotline not configured (ELEVENLABS_API_KEY, factory/hotline.py setup)"})
            try:
                return self.send(200, {"token": elevenlabs.conversation_token(hotline.agent_id()), "agent_id": hotline.agent_id()})
            except Exception as e:
                return self.send(502, {"error": str(e)[:200]})
        if u.path == "/api/incidents":
            return self.send(200, {"incidents": incidents.listing(q.get("project"))})
        if u.path == "/api/worldmodel":
            loop = worldmodel.loop(wo)
            return self.send(200, loop or {"wo": None})  # drafts have no loop yet: not an error
        if u.path in ("/api/record", "/api/monitors"):
            pid = q.get("project", "")
            if not any(p["id"] == pid for p in store._load()["projects"]):
                return self.send(404, {"error": "unknown project"})
            if u.path == "/api/monitors":
                return self.send(200, monitors.view(pid))
            rec = record.load(pid) or record.resync(pid, "first sync")
            rec["resyncing"] = ("drift", pid) in monitors.running
            return self.send(200, rec)
        if u.path == "/api/monitors/evidence":
            ev = monitors.evidence(q.get("run", ""))
            return self.send(200, ev) if ev else self.send(404, {"error": "no evidence for this run"})
        if u.path == "/api/supply/tower" and not q.get("project"):
            return self.send(200, {"projects": supply.towers(job["wo"] if busy() else None)})
        if u.path in ("/api/supply", "/api/supply/tower"):
            v = supply.view(q["project"]) if u.path == "/api/supply" else supply.tower(q["project"], job["wo"] if busy() else None)
            return self.send(200, v) if v else self.send(404, {"error": "unknown project"})
        if u.path.startswith("/api/"):
            return self.send(404, {"error": "not found"})
        return super().do_GET()

    def do_POST(self):
        u = urlparse(self.path)
        actor = self.headers.get("X-Actor", "abhishek")
        actor = actor if actor in HUMANS else "abhishek"
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            clip = lambda k, n=300: str(body.get(k, "")).strip()[:n]  # noqa: E731
            if u.path.startswith("/api/auth/"):
                code, obj, h = auth.handle(u.path, body, self.headers)
                return self.send(code, obj, headers=h)
            if u.path == "/api/projects":
                if not clip("name", 80):
                    return self.send(400, {"error": "name required"})
                return self.send(201, store.create_project(actor, clip("name", 80), clip("device", 40)))
            if u.path == "/api/workorders":
                if not clip("title", 120):
                    return self.send(400, {"error": "title required"})
                return self.send(201, store.create_wo(actor, clip("project", 60), clip("title", 120), clip("description", 1000)))
            if u.path == "/api/run":
                w = next((w for w in store._load()["work_orders"] if w["id"] == clip("wo", 20)), None)
                if not w:
                    return self.send(404, {"error": "unknown work order"})
                text = w["title"] + ("\n\n" + w["description"] if w["description"] else "")
                if not start("build", text, w["id"], wo=w["id"], project=w["project"]):
                    return self.send(409, {"error": "factory busy"})
                store.log(actor, "started run", w["id"], w["title"], w["project"])
                return self.send(202, {"started": w["id"]})
            if u.path == "/api/memory":
                if not clip("text", 2000):
                    return self.send(400, {"error": "text required"})
                kind = clip("kind", 20) if clip("kind", 20) in ("meeting", "chat", "email", "ticket", "review", "work_order", "code", "safety_finding") else "meeting"
                item = {"id": f"mem-{int(time.time() * 1000)}", "kind": kind, "title": clip("title", 120) or "Untitled note",
                        "text": clip("text", 2000), "project": store.device(clip("project", 60))["id"]}
                threading.Thread(target=memory.remember, args=([item],), daemon=True).start()
                store.log(actor, "added to memory", item["title"], f"{kind} · {memory.backend()}")
                return self.send(201, item)
            if u.path == "/api/ask":  # Home composer: plain English becomes a work order run, or a world-model question
                t = clip("text", 500)
                if not t:
                    return self.send(400, {"error": "say what you want"})
                if clip("skill", 20) == "simulate" or re.match(r"\s*what (if|happens)", t, re.I):
                    if not start("whatif", t, project=clip("project", 60)):
                        return self.send(409, {"error": "factory busy"})
                    store.log(actor, "asked the world model", "world model", t, clip("project", 60))
                    return self.send(202, {"started": "whatif"})
                if busy():
                    return self.send(409, {"error": "factory busy"})
                w = store.create_wo(actor, clip("project", 60), t[:120], "")
                start("build", t, w["id"], wo=w["id"], project=w["project"])
                store.log(actor, "started run", w["id"], t[:120], w["project"])
                return self.send(202, {"started": w["id"], "id": w["id"]})
            if u.path == "/api/incidents":
                return self.send(201, incidents.create(body, actor))
            if u.path == "/api/incidents/transcript":
                inc = incidents.attach_transcript(clip("id", 20), body.get("transcript"), clip("conversation_id", 80))
                return self.send(200, inc) if inc else self.send(404, {"error": "unknown incident"})
            if u.path.startswith("/api/trace/"):
                if not any(p["id"] == clip("project", 60) for p in store._load()["projects"]):
                    return self.send(404, {"error": "unknown project"})
                dev = store.device(clip("project", 60))
                spec = store.safety_spec(dev)
                if u.path == "/api/trace/links":
                    link = tracelinks.add_link(dev["id"], spec, actor, body)
                    store.log(actor, "added trace link", link["item"], f"{link['kind']} {link.get('url') or link['path']}", clip("project", 60))
                    return self.send(201, link)
                if u.path == "/api/trace/links/delete":
                    link = tracelinks.remove_link(dev["id"], clip("id", 10))
                    store.log(actor, "removed trace link", link["item"], f"{link['kind']} {link.get('url') or link['path']}", clip("project", 60))
                    return self.send(200, link)
                if u.path == "/api/trace/tests":
                    return self.send(200, tracelinks.run_tests(dev["id"], spec))
            if u.path in ("/api/record/resync", "/api/monitors/run"):
                mid = "drift" if u.path == "/api/record/resync" else clip("id", 30)
                rid = monitors.trigger(mid, clip("project", 60))
                if rid:
                    store.log(actor, "ran monitor", next(m["name"] for m in monitors.MONITORS if m["id"] == mid), clip("project", 60))
                return self.send(202, {"run": rid, "already_running": rid is None})
            if u.path in ("/api/supply/suppliers", "/api/supply/deliverables"):
                if not any(p["id"] == clip("project", 60) for p in store._load()["projects"]):
                    return self.send(404, {"error": "unknown project"})
                dev = store.device(clip("project", 60))
                if u.path == "/api/supply/suppliers":
                    sup = supply.invite(dev["id"], store.safety_spec(dev), body)
                    store.log(actor, "connected supplier team", sup["id"], f"{sup['name']} (tier {sup['tier']}, {len(sup['deliverables'])} deliverables requested)", clip("project", 60))
                    return self.send(201, sup)
                d = supply.submit(dev["id"], store.safety_spec(dev), actor, body)
                store.log(actor, "recorded supplier deliverable", d["item"], f"{d['title']} from {d['supplier_name']} ({d['link']})", clip("project", 60))
                if composio_status() == "connected":  # fire-and-forget: never delays the response
                    subprocess.Popen([PY, os.path.join(ROOT, "factory/actions.py"), "supplier", json.dumps(d)],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return self.send(201, d)
            if u.path == "/api/whatif":
                if not clip("text") or not start("whatif", clip("text"), project=clip("project", 60)):
                    return self.send(409, {"error": "factory busy or empty question"})
                store.log(actor, "asked the world model", "world model", clip("text"), clip("project", 60))
                return self.send(202, {"started": "whatif"})
        except ValueError as e:
            return self.send(400, {"error": str(e)})
        return self.send(404, {"error": "not found"})


if __name__ == "__main__":
    load_env()
    os.makedirs(os.path.join(ROOT, ".runs"), exist_ok=True)
    store.ensure_projects()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    print(f"Certus Factory server on http://localhost:{port}  (UI from web/out, memory: {memory.backend()})", flush=True)
    threading.Thread(target=warm, daemon=True).start()
    for k, dev in store.DEVICES.items():  # requirement test results ready before anyone opens Traceability
        tracelinks.warm_tests(k, store.safety_spec(dev))
    monitors.paused = busy
    monitors.start()  # background monitoring agents on their schedules (MONITORS=off: only "Run now")
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
