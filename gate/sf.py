"""Software Factory (8090) REST client: fetch a Work Order, set its status, link a PR.

Needs SF_API_KEY (a `sofa-ext-...` External API key) in the environment or in .env at the repo root.
The key selects the project, so no project id is sent. Stdlib only.

  python3 gate/sf.py health            # confirm the key works (read-only)
  python3 gate/sf.py get WO-12         # print the WO the runner would receive (read-only)
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get("SF_BASE_URL", "https://api.factory.8090.dev/v2/external-api")
STATUSES = ["backlog", "ready", "in_progress", "in_review", "blocked", "completed", "cancelled"]


class SFError(Exception):
    pass


def load_env():
    """Read KEY=VALUE lines from .env into os.environ (existing variables win)."""
    try:
        for line in open(os.path.join(ROOT, ".env")):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


def _send(req):
    """The one network call. Tests replace this."""
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read()


def request(method, path, body=None):
    load_env()
    key = os.environ.get("SF_API_KEY", "")
    if not key:
        raise SFError("SF_API_KEY is not set. Put it in .env (see .env.example).")
    req = urllib.request.Request(
        BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        status, raw = _send(req)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        hint = " (is the key expired, or not a sofa-ext- key?)" if e.code == 401 else ""
        raise SFError(f"{method} {path} -> HTTP {e.code}{hint}: {detail}") from None
    except urllib.error.URLError as e:
        raise SFError(f"{method} {path} -> network error: {e.reason}") from None
    return json.loads(raw) if raw else {}


def health():
    return request("GET", "/health")


def wo_number(wo):
    """'WO-12' or '12' -> 12"""
    m = re.fullmatch(r"(?:WO-)?(\d+)", str(wo).strip(), re.I)
    if not m:
        raise SFError(f"not a Work Order id: {wo!r} (expected like WO-12)")
    return int(m.group(1))


def get_wo(wo):
    """Return {id (uuid), number, title, status, text (markdown description), context}."""
    d = request("GET", f"/work_orders/by_number/{wo_number(wo)}")["data"]
    return {"id": d["id"], "number": d["work_order_number"], "title": d["title"], "status": d["status"],
            "text": d["markdown_content"], "context": d.get("connectedContext") or []}


def set_status(wo_id, status):
    """wo_id is the UUID from get_wo. One all-or-nothing UpdateStatus batch."""
    if status not in STATUSES:
        raise SFError(f"unknown status {status!r}; use one of {STATUSES}")
    return request("POST", "/work_orders/batch_update", {
        "request_id": str(uuid.uuid4()),
        "operations": [{"operation_id": "status", "operation_type": "UpdateStatus",
                        "target": {"work_order_id": wo_id}, "patch": {"status": status}}],
    })


def link_pr(wo_id, url):
    return request("POST", f"/work_orders/{wo_id}/pull_requests", {"url": url})


if __name__ == "__main__":
    try:
        if sys.argv[1:2] == ["health"]:
            print(health())
        elif sys.argv[1:2] == ["get"] and len(sys.argv) == 3:
            w = get_wo(sys.argv[2])
            print(f"{sys.argv[2]}  [{w['status']}]  {w['title']}\n\n{w['text']}")
        else:
            sys.exit(__doc__)
    except SFError as e:
        sys.exit(f"SF error: {e}")
