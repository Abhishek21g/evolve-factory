"""External actions through Composio: after every verdict the factory files the evidence pack as a GitHub issue.

Needs COMPOSIO_API_KEY and, once, a GitHub account connected for COMPOSIO_USER_ID (default certus-factory):
click "Connect GitHub" on Home (or open the link printed by `actions.py connect`) and authorize.
Always runs as its own process, so the slow SDK import and the GitHub call never delay a run:
  actions.py post '<json>'   pipeline, after the verdict (fire-and-forget); reports back as an "actions" event
  actions.py supplier '<json>' server, after a supplier deliverable is recorded (fire-and-forget): files a GitHub issue
  actions.py status          server, every 30 s; writes .runs/composio.json for the Home card
  actions.py connect         prints a fresh Composio Connect Link for GitHub
"""
import json
import os
import re
import subprocess
import sys

from composio import Composio

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "dashboard"))
import emit  # noqa: E402

USER = os.environ.get("COMPOSIO_USER_ID", "certus-factory")
STATUS = os.path.join(ROOT, ".runs", "composio.json")


def _session():
    return Composio().create(user_id=USER, toolkits=["github"])


def _repo():
    url = subprocess.run(["git", "-C", ROOT, "remote", "get-url", "origin"], capture_output=True, text=True).stdout
    m = re.search(r"github\.com[:/]([^/]+)/([^/.\s]+)", url)
    return m.group(1), m.group(2)


def _find(d, key):
    """First value for key anywhere in a nested tool result (providers nest it differently)."""
    if isinstance(d, dict):
        if key in d:
            return d[key]
        d = list(d.values())
    if isinstance(d, list):
        for v in d:
            if (r := _find(v, key)) is not None:
                return r
    return None


def post(job):
    wo, verdict = job["wo"], job["verdict"]
    emit.emit("actions", "working", "Composio: filing the evidence pack as a GitHub issue", wo=wo)
    owner, repo = _repo()
    ev = os.path.join(ROOT, ".runs", f"{wo}.evidence.md")
    body = (f"**{verdict}**\n\n" + (open(ev).read() if os.path.exists(ev) else job.get("headline", ""))
            + "\n\n_Filed by the Certus Factory agent through Composio._")[:60000]
    decision = "APPROVED" if job["passed"] else "BLOCKED"
    try:
        r = _session().execute("GITHUB_CREATE_AN_ISSUE", arguments={
            "owner": owner, "repo": repo, "title": f"{wo} {decision}: {job['intent'][:90]}", "body": body})
        if r.result_type != "completed":
            raise RuntimeError(r.error or r.result_type)
        data = r.model_dump(mode="json").get("data")
        n, url = _find(data, "number"), _find(data, "html_url")
        emit.emit("actions", "done", f"Composio filed GitHub issue #{n} with the {wo} evidence pack ({decision})", wo=wo, link=url)
    except Exception as e:
        why = str(e).splitlines()[0][:140]
        if re.search(r"no active connection|not connected|auth", why, re.I):
            why = "GitHub is not connected yet (Home, Connected, Connect GitHub)"
        emit.emit("actions", "blocked", f"Composio could not file the {wo} evidence on GitHub: {why}. The verdict stands.", wo=wo)


def supplier(d):
    """A supplier deliverable was recorded: file a GitHub issue so the supplier-quality team sees it."""
    owner, repo = _repo()
    body = (f"**{d['supplier_name']}** submitted **{d['title']}** ({d['kind']}) for **{d['item']}**.\n\n"
            f"Document: {d['url'] or '(no link)'}\nTrace link: {d['link']}\n\n_Filed by the Certus Factory agent through Composio._")
    r = _session().execute("GITHUB_CREATE_AN_ISSUE", arguments={
        "owner": owner, "repo": repo, "title": f"Supplier deliverable for {d['item']}: {d['title'][:80]}", "body": body})
    print(r.result_type)


def status():
    if not os.environ.get("COMPOSIO_API_KEY"):
        st = {"state": "missing key"}
    else:
        try:
            conn = _session().toolkits(toolkits=["github"]).items[0].connection
            st = {"state": "connected" if conn.is_active else "not connected"}
        except Exception as e:
            st = {"state": "error", "detail": str(e).splitlines()[0][:120]}
    json.dump(st, open(STATUS, "w"))
    return st


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "post":
        post(json.loads(sys.argv[2]))
    elif cmd == "supplier":
        supplier(json.loads(sys.argv[2]))
    elif cmd == "status":
        print(status())
    elif cmd == "connect":
        print(_session().authorize("github").redirect_url)
    else:
        sys.exit("usage: actions.py post '<json>' | supplier '<json>' | status | connect")
