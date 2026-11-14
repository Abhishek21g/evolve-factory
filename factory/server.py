"""Certus Factory local server: the web UI talks to this; it runs agents and simulations on this machine.

  .venv/bin/python factory/server.py          # http://localhost:8787

GET  /api/status            what is configured (keys present, busy)
GET  /api/events?since=N    dashboard events from line N
POST /api/build  {"text"}   start a build pipeline (one at a time)
POST /api/whatif {"text"}   ask the world model a plain-English question
GET  /api/evidence?wo=WO-x  evidence pack markdown
Everything else is served from web/out (the built UI). Keys are read from .env and never sent to the browser.
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
FEED = os.path.join(ROOT, "dashboard", "events.jsonl")
STATIC = os.path.join(ROOT, "web", "out")
PY = os.path.join(ROOT, ".venv/bin/python")
lock = threading.Lock()
job = {"proc": None, "kind": None}


def load_env():
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p):
            m = re.match(r"\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$", line)
            if m and not line.lstrip().startswith("#"):
                os.environ.setdefault(m.group(1), m.group(2).strip('"\''))


def busy():
    return job["proc"] is not None and job["proc"].poll() is None


def start(kind, text):
    with lock:
        if busy():
            return False
        env = {k: v for k, v in os.environ.items() if k not in ("RUN_ID", "RUN_T0")}  # fresh dashboard run
        log = open(os.path.join(ROOT, ".runs", "server-job.log"), "w")
        job["proc"] = subprocess.Popen([PY, os.path.join(ROOT, "factory/pipeline.py"), kind, text], cwd=ROOT, env=env,
                                       stdout=log, stderr=subprocess.STDOUT)
        job["kind"] = kind
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
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/api/status":
            return self.send(200, {"online": True, "busy": busy(), "job": job["kind"] if busy() else None,
                                   "memory": "HydraDB" if os.environ.get("HYDRADB_API_KEY") else "local",
                                   "composio": bool(os.environ.get("COMPOSIO_API_KEY")),
                                   "software_factory": bool(os.environ.get("SF_API_KEY"))})
        if u.path == "/api/events":
            since = int(q.get("since", ["0"])[0])
            lines = open(FEED).read().splitlines() if os.path.exists(FEED) else []
            return self.send(200, {"total": len(lines), "events": [json.loads(l) for l in lines[since:] if l.strip()]})
        if u.path == "/api/evidence":
            wo = re.sub(r"[^A-Za-z0-9-]", "", q.get("wo", [""])[0])
            p = os.path.join(ROOT, ".runs", f"{wo}.evidence.md")
            return self.send(200, open(p).read(), "text/markdown") if os.path.exists(p) else self.send(404, {"error": "none"})
        if u.path.startswith("/api/"):
            return self.send(404, {"error": "not found"})
        return super().do_GET()

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get("Content-Length", 0))
        try:
            text = str(json.loads(self.rfile.read(n) or b"{}").get("text", "")).strip()[:500]
        except ValueError:
            return self.send(400, {"error": "bad json"})
        kind = {"/api/build": "build", "/api/whatif": "whatif"}.get(u.path)
        if not kind or not text:
            return self.send(400, {"error": "need text"})
        return self.send(202, {"started": kind}) if start(kind, text) else self.send(409, {"error": "factory busy"})


if __name__ == "__main__":
    load_env()
    os.makedirs(os.path.join(ROOT, ".runs"), exist_ok=True)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    print(f"Certus Factory server on http://localhost:{port}  (UI from web/out, memory: "
          f"{'HydraDB' if os.environ.get('HYDRADB_API_KEY') else 'local'})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
