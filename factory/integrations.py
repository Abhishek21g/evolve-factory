"""Integrations page backend: what is connected, the plugin catalog (connected through Composio), and MCP servers.

  GET  /api/integrations                    connected tools, catalog with Composio status, MCP servers, this MCP server
  GET  /api/integrations/connect?toolkit=   redirects to a Composio Connect Link for that toolkit
  POST /api/integrations/mcp     {name, transport, url|command}   add an MCP server (.runs/mcp.json, Cursor's format)
  POST /api/integrations/mcp/delete {name}
  POST /api/integrations/mcp/test   {name}  HTTP servers: initialize + tools/list, returns the tools

Composio calls run in a child process (factory/composio_kits.py, slow SDK import) and are cached, so the page never
waits on them. stdio MCP servers are listed but never started from here: the browser must not run local commands.
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "factory"))
import mcp_server  # noqa: E402
import store  # noqa: E402

PY = os.path.join(ROOT, ".venv/bin/python")
KITS = os.path.join(ROOT, "factory", "composio_kits.py")
CONFIG = os.path.join(ROOT, ".runs", "mcp.json")
STATUS = os.path.join(ROOT, ".runs", "integrations.json")
VERCEL_URL = "https://certus-factory-ten.vercel.app"
# (Composio toolkit, name, category, what the factory would use it for)
CATALOG = [
    ("slack", "Slack", "Communication", "Post verdicts and blocked merges to the safety channel"),
    ("linear", "Linear", "Issues", "Turn Linear issues into work orders and close them with evidence"),
    ("jira", "Jira", "Issues", "Sync work orders and change requests with Jira"),
    ("notion", "Notion", "Docs", "Pull design reviews and meeting notes into org memory"),
    ("googledrive", "Google Drive", "Docs", "Import hazard analyses and test protocols"),
    ("sentry", "Sentry", "Monitoring", "Field errors become hazards to review"),
    ("datadog", "Datadog", "Monitoring", "Fleet telemetry for the world model"),
    ("neon", "Neon", "Database", "Postgres for the audit trail and evidence index"),
]
SLUGS = [c[0] for c in CATALOG]
REQUIREMENTS_TOOLS = [
    ("Jama Connect", "Requirements, hazards and trace links"),
    ("IBM DOORS Next", "Requirements modules and link types"),
    ("Polarion ALM", "Work items, test runs and risk records"),
    ("Ketryx", "IEC 62304 design controls and SOUP"),
]
_cache = {"vercel": None, "claude": None, "refreshing": False}


# ---------- Composio (child process) ----------
def connect_link(toolkit):
    if toolkit not in SLUGS + ["github"]:
        return ""
    r = subprocess.run([PY, KITS, "connect", toolkit], capture_output=True, text=True, timeout=45)
    return r.stdout.strip() if r.stdout.strip().startswith("https://") else ""


# ---------- status (cached, refreshed off the request path) ----------
def _refresh():
    try:
        if os.environ.get("COMPOSIO_API_KEY"):
            subprocess.run([PY, KITS, "status", "github", *SLUGS], capture_output=True, timeout=60)
        try:
            urllib.request.urlopen(urllib.request.Request(VERCEL_URL, method="HEAD"), timeout=5)
            _cache["vercel"] = True
        except (urllib.error.URLError, TimeoutError):
            _cache["vercel"] = False
        if _cache["claude"] is None:
            exe = shutil.which("claude")
            v = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=10).stdout.strip() if exe else ""
            _cache["claude"] = v.split(" ")[0] if v else ""
    except (subprocess.TimeoutExpired, OSError):
        pass
    finally:
        _cache["refreshing"] = False


def warm():
    """At server start, so the Integrations page opens with real status instead of "checking"."""
    _cache["refreshing"] = True
    _refresh()


def _composio_cached():
    st = json.load(open(STATUS)) if os.path.exists(STATUS) else None
    if (not st or time.time() - st["at"] > 60) and not _cache["refreshing"]:
        _cache["refreshing"] = True
        threading.Thread(target=_refresh, daemon=True).start()
    return st


def overview(status):
    """status: the /api/state status block (HydraDB, Composio GitHub, Software Factory) so both pages agree."""
    comp = _composio_cached()
    kits = (comp or {}).get("toolkits", {})
    claude = _cache["claude"]
    hydra, gh = status["hydradb"], status["composio_status"]
    connected = [
        {"id": "claude-code", "name": "Claude Code", "tone": "ok" if claude else "warn" if claude is None else "off",
         "detail": f"coding agent · CLI {claude}" if claude else "checking the CLI…" if claude is None else "CLI not found on this machine",
         "use": "Writes each change in its own git worktree"},
        {"id": "software-factory", "name": "8090 Software Factory", "tone": "ok" if status["software_factory"] else "off",
         "detail": "work orders and reports via REST" if status["software_factory"] else "add SF_API_KEY to connect",
         "use": "Requirements, blueprints and work orders come from Software Factory"},
        {"id": "hydradb", "name": "HydraDB", "tone": {"connected": "ok", "missing key": "off"}.get(hydra, "warn"),
         "detail": {"connected": "shared memory, live recall", "connecting": "connecting…", "falling back": "unreachable: using local memory",
                    "missing key": "add HYDRADB_API_KEY to connect"}.get(hydra, hydra),
         "use": "Org memory, regulatory knowledge base, lessons from every verdict"},
        {"id": "composio", "name": "Composio · GitHub", "tone": {"connected": "ok", "missing key": "off"}.get(gh, "warn"),
         "detail": {"connected": "files evidence as GitHub issues", "not connected": "GitHub not authorized yet", "checking": "checking…",
                    "error": "unreachable: runs continue", "missing key": "add COMPOSIO_API_KEY to connect"}.get(gh, gh),
         "use": "Files the evidence pack on GitHub after every verdict", "connect": "github" if gh == "not connected" else None},
        {"id": "elevenlabs", "name": "ElevenLabs", "tone": {"connected": "ok", "no agent": "warn"}.get(status["elevenlabs"], "off"),
         "detail": {"connected": "voice agent and callout voices", "no agent": "run factory/hotline.py setup",
                    "missing key": "add ELEVENLABS_API_KEY to connect"}[status["elevenlabs"]],
         "use": "Cockpit callouts from the simulation, the safety hotline voice agent"},
        {"id": "vercel", "name": "Vercel", "tone": "ok" if _cache["vercel"] else "warn" if _cache["vercel"] is None else "off",
         "detail": "certus-factory-ten.vercel.app is up" if _cache["vercel"] else "checking…" if _cache["vercel"] is None else "site unreachable",
         "use": "Hosts the read-only snapshot of the factory", "url": VERCEL_URL},
    ]
    catalog = [{"id": s, "name": n, "category": c, "use": u, "via": "Composio",
                "connected": bool(kits.get(s, {}).get("connected")), "logo": kits.get(s, {}).get("logo") or f"https://logos.composio.dev/api/{s}"}
               for s, n, c, u in CATALOG]
    return {"connected": connected, "catalog": catalog,
            "composio": {"key": bool(os.environ.get("COMPOSIO_API_KEY")), "checked": (comp or {}).get("at"), "error": (comp or {}).get("detail")},
            "requirements_tools": [{"name": n, "use": u} for n, u in REQUIREMENTS_TOOLS],
            "mcp": {"servers": servers(), "self": {"tools": [{"name": t["name"], "description": t["description"]} for t in mcp_server.TOOLS],
                                                    "python": os.path.relpath(PY, ROOT), "script": "factory/mcp_server.py"}}}


# ---------- MCP servers ----------
def _load():
    return json.load(open(CONFIG)) if os.path.exists(CONFIG) else {"mcpServers": {}}


def servers():
    return [{"name": k, "transport": "http" if v.get("url") else "stdio", "url": v.get("url", ""),
             "command": " ".join([v.get("command", ""), *v.get("args", [])]).strip(), "added": v.get("added")}
            for k, v in _load()["mcpServers"].items()]


def add_server(name, transport, target):
    name, target = name.strip()[:60], target.strip()[:500]
    if not name or not target:
        raise ValueError("name and URL or command required")
    if transport == "http" and not target.startswith(("http://", "https://")):
        raise ValueError("an HTTP server needs an http(s):// URL")
    d = _load()
    if transport == "http":
        entry = {"url": target}
    else:
        cmd, *args = target.split()
        entry = {"command": cmd, "args": args}
    d["mcpServers"][name] = {**entry, "added": time.time()}
    os.makedirs(os.path.dirname(CONFIG), exist_ok=True)
    json.dump(d, open(CONFIG, "w"), indent=1)
    return next(s for s in servers() if s["name"] == name)


def remove_server(name):
    d = _load()
    if d["mcpServers"].pop(name, None) is None:
        raise ValueError("unknown MCP server")
    json.dump(d, open(CONFIG, "w"), indent=1)


def _rpc(url, msg, sid=None):
    """POST one JSON-RPC message (Streamable HTTP): the reply is JSON or an SSE stream; returns (reply, session id)."""
    h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": mcp_server.PROTOCOLS[0]}
    if sid:
        h["Mcp-Session-Id"] = sid
    with urllib.request.urlopen(urllib.request.Request(url, json.dumps(msg).encode(), h, method="POST"), timeout=10) as r:
        sid = r.headers.get("Mcp-Session-Id") or sid
        if "id" not in msg:
            return None, sid
        if "text/event-stream" in r.headers.get("Content-Type", ""):
            for raw in r:
                line = raw.decode().strip()
                if line.startswith("data:"):
                    data = json.loads(line[5:])
                    if data.get("id") == msg["id"]:
                        return data, sid
            raise ValueError("stream ended without a reply")
        return json.loads(r.read()), sid


def probe(url):
    """initialize + tools/list against an HTTP MCP server."""
    t0 = time.time()
    try:
        init, sid = _rpc(url, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": mcp_server.PROTOCOLS[0], "capabilities": {}, "clientInfo": {"name": "certus-factory", "version": mcp_server.VERSION}}})
        if "error" in init:
            return {"ok": False, "error": init["error"].get("message", "initialize failed")}
        _rpc(url, {"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
        tl, _ = _rpc(url, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, sid)
        tools = tl.get("result", {}).get("tools", [])
        info = init["result"].get("serverInfo", {})
        return {"ok": True, "ms": round((time.time() - t0) * 1000), "server": f"{info.get('name', '?')} {info.get('version', '')}".strip(),
                "protocol": init["result"].get("protocolVersion"),
                "tools": [{"name": t["name"], "description": (t.get("description") or "")[:200]} for t in tools]}
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}" + (": the server needs OAuth or a token" if e.code in (401, 403) else f" {e.reason}")}
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError) as e:
        return {"ok": False, "error": str(getattr(e, "reason", e))[:200]}


def test_server(name, port):
    s = next((s for s in servers() if s["name"] == name), None)
    if not s and name == mcp_server.NAME:  # this factory's own /mcp endpoint, over real HTTP
        return probe(f"http://127.0.0.1:{port}/mcp")
    if not s:
        raise ValueError("unknown MCP server")
    if s["transport"] != "http":
        return {"ok": False, "error": "stdio servers run inside your MCP client (Cursor, Claude Code). "
                "The factory never starts local commands from the browser."}
    return probe(s["url"])


def post(path, body, actor, port):
    """(status, json) for POST /api/integrations/mcp*. port: the factory server's, for testing its own /mcp."""
    if path == "/api/integrations/mcp":
        s = add_server(str(body.get("name", "")), "http" if body.get("transport") == "http" else "stdio", str(body.get("target", "")))
        store.log(actor, "added MCP server", s["name"], s["url"] or s["command"])
        return 201, s
    if path == "/api/integrations/mcp/delete":
        remove_server(str(body.get("name", "")))
        store.log(actor, "removed MCP server", str(body.get("name", "")))
        return 200, {"ok": True}
    if path == "/api/integrations/mcp/test":
        return 200, test_server(str(body.get("name", "")), port)
    return 404, {"error": "not found"}
