"""Demo health check: prints READY, or exactly what is broken. Exit 0 = ready.

  .venv/bin/python demo/health.py [port] [--deep]      # --deep also checks the coding agent CLI is logged in (~10 s)
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = next((a for a in sys.argv[1:] if a.isdigit()), "8787")
HOSTED = os.environ.get("DEMO_URL", "https://certus-factory-ten.vercel.app")
problems, notes = [], []


def get(url, timeout=2):
    t = time.time()
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read(), (time.time() - t) * 1000


def check(name, fn, required=True):
    try:
        msg = fn()
        print(f"  ok    {name}{': ' + msg if msg else ''}")
    except Exception as e:
        if required:
            problems.append(name)
        print(f"  {'FAIL' if required else 'warn'}  {name}: {e}")


def server():
    body, ms = get(f"http://localhost:{PORT}/api/state")
    s = json.loads(body)
    st = s["status"]
    if st["busy"]:
        notes.append(f"a {st['job']} job is running right now ({st['running'] or ''})")
    proj = s.get("project")
    if not proj:
        raise RuntimeError("no project (run demo/go.sh)")
    drafts = [w["id"] for w in s.get("work_orders", []) if w["status"] == "Draft"]
    if not drafts:
        raise RuntimeError("no draft work order to run (re-run demo/go.sh)")
    mode = "REPLAY (recorded real run)" if st.get("replay") else "LIVE (real agents)"
    return f"{ms:.0f} ms, mode {mode}, open http://localhost:{PORT}/#/p/{proj['id']}/work-orders/{drafts[-1]}"


def ui():
    body, ms = get(f"http://localhost:{PORT}/")
    if b"<html" not in body:
        raise RuntimeError("web/out not built (run demo/go.sh)")
    return f"{ms:.0f} ms"


def recordings():
    missing = [f for f in ("build.jsonl", "whatif.jsonl") if not os.path.exists(os.path.join(ROOT, "demo/replay", f))]
    if missing:
        raise RuntimeError("missing " + ", ".join(missing) + " (record one with demo/record.py)")


def agent():
    if not shutil.which("claude"):
        raise RuntimeError("claude CLI not on PATH")
    t = time.time()
    p = subprocess.run(["claude", "-p", "Reply with just: OK"], capture_output=True, text=True, timeout=60)
    if "OK" not in p.stdout:
        raise RuntimeError((p.stdout + p.stderr).strip()[-200:] or "no reply; run `claude` then /login")
    return f"answered in {time.time() - t:.1f} s"


def github():
    p = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError("gh not logged in: live runs with FACTORY_PR=1 cannot open PRs")


def hosted():
    _, ms = get(HOSTED, timeout=5)
    return f"{HOSTED} ({ms:.0f} ms)"


print(f"Certus Factory demo health (port {PORT})")
check("factory server", server)
check("web UI", ui)
check("replay recordings", recordings)
if "--deep" in sys.argv:
    check("coding agent (claude)", agent)
check("GitHub CLI", github, required=False)
check("hosted UI (backup)", hosted, required=False)
for n in notes:
    print(f"  note  {n}")
print("READY" if not problems else "NOT READY: " + ", ".join(problems))
sys.exit(1 if problems else 0)
