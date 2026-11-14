"""Certus Factory local server: the web UI talks to this; it runs agents and simulations on this machine.

  .venv/bin/python factory/server.py          # http://localhost:8787

GET  /api/state?project=ID         team, projects, hazards, requirements, work orders, audit trail, trace graph
GET  /api/events?since=N           live agent events from line N
GET  /api/evidence?wo=WO-x         evidence pack (markdown)      GET /api/diff?wo=WO-x   code change
POST /api/projects   {name, device}                 create a project (imports its hazard log)
POST /api/workorders {project, title, description}  create a work order
POST /api/run        {wo}                           run a work order through the factory
POST /api/whatif     {text}                         ask the world model a plain-English question
POST actions carry the acting person in the X-Actor header (recorded in the audit trail).
Everything else is served from web/out. Keys are read from .env and never sent to the browser.
"""
import json
import os
import re
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "factory"))
import memory  # noqa: E402
import store  # noqa: E402

FEED = store.FEED
STATIC = os.path.join(ROOT, "web", "out")
PY = os.path.join(ROOT, ".venv/bin/python")
lock = threading.Lock()
job = {"proc": None, "kind": None, "wo": None}
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


def start(kind, *args, wo=None):
    with lock:
        if busy():
            return False
        env = {k: v for k, v in os.environ.items() if k not in ("RUN_ID", "RUN_T0")}  # fresh dashboard run
        log = open(os.path.join(ROOT, ".runs", "server-job.log"), "w")
        job["proc"] = subprocess.Popen([PY, os.path.join(ROOT, "factory/pipeline.py"), kind, *args], cwd=ROOT, env=env,
                                       stdout=log, stderr=subprocess.STDOUT)
        job["kind"], job["wo"] = kind, wo
        return True


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=STATIC, **k)

    def log_message(self, *a):
        pass

    def send(self, code, obj, ctype="application/json"):
        body = obj.encode() if isinstance(obj, str) else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Actor")
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        wo = re.sub(r"[^A-Za-z0-9-]", "", q.get("wo", ""))
        if u.path == "/api/state":
            s = store.state(q.get("project", ""), job["wo"] if busy() else None)
            s["status"] = {"online": True, "busy": busy(), "job": job["kind"] if busy() else None, "running": job["wo"] if busy() else None,
                           "memory": "HydraDB" if os.environ.get("HYDRADB_API_KEY") else "local",
                           "composio": bool(os.environ.get("COMPOSIO_API_KEY")), "software_factory": bool(os.environ.get("SF_API_KEY")),
                           "replay": os.environ.get("FACTORY_REPLAY") == "1"}
            return self.send(200, s)
        if u.path == "/api/events":
            since = int(q.get("since", "0"))
            lines = open(FEED).read().splitlines() if os.path.exists(FEED) else []
            return self.send(200, {"total": len(lines), "events": [json.loads(l) for l in lines[since:] if l.strip()]})
        if u.path == "/api/evidence":
            p = os.path.join(ROOT, ".runs", f"{wo}.evidence.md")
            return self.send(200, open(p).read(), "text/markdown") if os.path.exists(p) else self.send(404, {"error": "none"})
        if u.path == "/api/memory":
            hits = memory.recall(q["q"], k=6) if q.get("q") else []
            return self.send(200, {"backend": memory.backend(), "items": memory.items(), "hits": hits})
        if u.path == "/api/diff":
            return self.send(200, store.diff(wo) or "No code changes yet.", "text/plain")
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
                if not start("build", text, w["id"], wo=w["id"]):
                    return self.send(409, {"error": "factory busy"})
                store.log(actor, "started run", w["id"], w["title"])
                return self.send(202, {"started": w["id"]})
            if u.path == "/api/memory":
                if not clip("text", 2000):
                    return self.send(400, {"error": "text required"})
                kind = clip("kind", 20) if clip("kind", 20) in ("meeting", "chat", "email", "work_order", "code", "safety_finding") else "meeting"
                item = {"id": f"mem-{int(__import__('time').time() * 1000)}", "kind": kind, "title": clip("title", 120) or "Untitled note",
                        "text": clip("text", 2000)}
                memory.remember([item])
                store.log(actor, "added to memory", item["title"], f"{kind} · {memory.backend()}")
                return self.send(201, item)
            if u.path == "/api/ask":  # Home composer: plain English becomes a work order run, or a world-model question
                t = clip("text", 500)
                if not t:
                    return self.send(400, {"error": "say what you want"})
                if clip("skill", 20) == "simulate" or re.match(r"\s*what (if|happens)", t, re.I):
                    if not start("whatif", t):
                        return self.send(409, {"error": "factory busy"})
                    store.log(actor, "asked the world model", "world model", t)
                    return self.send(202, {"started": "whatif"})
                if busy():
                    return self.send(409, {"error": "factory busy"})
                w = store.create_wo(actor, clip("project", 60), t[:120], "")
                start("build", t, w["id"], wo=w["id"])
                store.log(actor, "started run", w["id"], t[:120])
                return self.send(202, {"started": w["id"], "id": w["id"]})
            if u.path == "/api/whatif":
                if not clip("text") or not start("whatif", clip("text")):
                    return self.send(409, {"error": "factory busy or empty question"})
                store.log(actor, "asked the world model", "world model", clip("text"))
                return self.send(202, {"started": "whatif"})
        except ValueError as e:
            return self.send(400, {"error": str(e)})
        return self.send(404, {"error": "not found"})


if __name__ == "__main__":
    load_env()
    os.makedirs(os.path.join(ROOT, ".runs"), exist_ok=True)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    print(f"Certus Factory server on http://localhost:{port}  (UI from web/out, memory: "
          f"{'HydraDB' if os.environ.get('HYDRADB_API_KEY') else 'local'})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
