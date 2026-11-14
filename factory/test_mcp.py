"""Self-check: .venv/bin/python factory/test_mcp.py
An MCP client talks to the Certus MCP server the way Claude Code or Cursor would: over stdio (initialize, tools/list,
tools/call for every tool) and over HTTP at /mcp on the factory server (the Integrations page's Test connection probe)."""
import json
import os
import subprocess
import sys
import threading
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import integrations  # noqa: E402
import server  # noqa: E402
import store  # noqa: E402

ROOT = server.ROOT
proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "factory", "mcp_server.py")], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL, text=True, cwd=ROOT)


def rpc(method, params=None, mid=[0]):  # noqa: B006 (message counter)
    mid[0] += 1
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": mid[0], "method": method, "params": params or {}}) + "\n")
    proc.stdin.flush()
    r = json.loads(proc.stdout.readline())
    assert r["id"] == mid[0], r
    return r


def tool(name, **args):
    r = rpc("tools/call", {"name": name, "arguments": args})["result"]
    return r["isError"], (r["content"][0]["text"] if r["isError"] else json.loads(r["content"][0]["text"]))


init = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "0"}})["result"]
assert init["serverInfo"]["name"] == "certus-factory" and init["capabilities"] == {"tools": {}}, init
proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
names = [t["name"] for t in rpc("tools/list")["result"]["tools"]]
assert names == ["list_projects", "get_trace", "get_verdict", "list_gaps", "recall_memory"], names
print(f"stdio: initialize + tools/list -> {', '.join(names)}")

err, projects = tool("list_projects")
assert not err
if projects:
    pid = projects[0]["id"]
    err, trace = tool("get_trace", requirement_id="sr-1", project=pid)
    assert not err and trace[0]["requirement"] == "SR-1" and trace[0]["hazards"] and trace[0]["links"], trace
    print(f"get_trace SR-1 ({pid}): {len(trace[0]['links'])} links, hazards {trace[0]['hazards']}, gaps {trace[0]['gaps']}")
    err, gaps = tool("list_gaps", project=pid)
    assert not err and gaps[0]["project"] == pid
    print(f"list_gaps {pid}: {len(gaps[0]['requirements'])} requirements, {len(gaps[0]['hazards'])} hazards, "
          f"{len(gaps[0]['untraced_code'])} untraced functions")
    wos = store._load()["work_orders"]
    if wos:
        err, v = tool("get_verdict", work_order_id=wos[-1]["id"])
        assert not err and v["work_order"] == wos[-1]["id"] and v["status"], v
        print(f"get_verdict {v['work_order']}: {v['status']} · {v['decision']} · world model {v['world_model']}")
    assert tool("list_gaps", project="no-such-project")[0], "an unknown project is a tool error, not a crash"
err, mem = tool("recall_memory", query="bolus limit", k=3)
assert not err and "hits" in mem
print(f"recall_memory: {len(mem['hits'])} hits from {mem['backend']} in {mem['ms']} ms")
assert tool("get_trace", requirement_id="SR-999")[0] and tool("nope")[0]
assert rpc("nope/method")["error"]["code"] == -32601
proc.stdin.close()
proc.wait(5)

httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.H)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{httpd.server_port}/mcp"
p = integrations.probe(url)
assert p["ok"] and [t["name"] for t in p["tools"]] == names, p
r, _ = integrations._rpc(url, {"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": "list_projects", "arguments": {}}})
assert json.loads(r["result"]["content"][0]["text"]) == projects
print(f"http: {url} -> {p['server']}, protocol {p['protocol']}, {len(p['tools'])} tools in {p['ms']} ms; tools/call list_projects ok")
assert not integrations.probe(f"http://127.0.0.1:{httpd.server_port}/nope")["ok"]

print("ok")
