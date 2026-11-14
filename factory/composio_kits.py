"""Composio toolkits for the Integrations page. Runs as its own process (the SDK import is slow):
  composio_kits.py status            connection status of GitHub + the catalog toolkits -> .runs/integrations.json
  composio_kits.py connect <toolkit> prints a fresh Composio Connect Link
"""
import json
import os
import sys
import time

from composio import Composio

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USER = os.environ.get("COMPOSIO_USER_ID", "certus-factory")
STATUS = os.path.join(ROOT, ".runs", "integrations.json")


def session(kits):
    return Composio().create(user_id=USER, toolkits=kits)


def status(kits):
    try:
        items = session(kits).toolkits(toolkits=kits).items
        st = {"state": "ok", "at": time.time(),
              "toolkits": {it.slug: {"connected": bool(it.connection and it.connection.is_active), "logo": getattr(it, "logo", "")} for it in items}}
    except Exception as e:
        st = {"state": "error", "at": time.time(), "detail": str(e).splitlines()[0][:160], "toolkits": {}}
    json.dump(st, open(STATUS, "w"))
    return st


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "status":
        print(status(sys.argv[2:]))
    elif len(sys.argv) == 3 and sys.argv[1] == "connect":
        print(session([sys.argv[2]]).authorize(sys.argv[2]).redirect_url)
    else:
        sys.exit("usage: composio_kits.py status <toolkit>... | connect <toolkit>")
