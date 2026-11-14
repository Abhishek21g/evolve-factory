"""Certus Factory as an MCP server: read-only access to the safety record for Claude Code, Cursor or any MCP client.

  .venv/bin/python factory/mcp_server.py          stdio (newline-delimited JSON-RPC)
  POST http://localhost:8787/mcp                  Streamable HTTP, served by factory/server.py (JSON responses)

Tools: list_projects, get_trace(requirement_id), get_verdict(work_order_id), list_gaps(project), recall_memory(query).
Nothing here writes: answers come from the same functions the web UI uses (store.state, tracelinks, memory).
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "factory"))
import memory  # noqa: E402
import store  # noqa: E402

NAME, VERSION = "certus-factory", "0.1.0"
PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05")
_project = {"type": "string", "description": "Project id or name, e.g. insulin-pump-firmware or Boeing Flight Controls. Omit for all projects."}
TOOLS = [
    {"name": "list_projects", "description": "Projects in the factory: id, name, device, safety standard, world model.",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "get_trace", "description": "Trace of a safety requirement (e.g. SR-1): hazards it mitigates, regulation clauses, code lines, "
     "unit test and result, simulation scenarios, work orders and evidence, plus its coverage gaps.",
     "inputSchema": {"type": "object", "properties": {"requirement_id": {"type": "string"}, "project": _project}, "required": ["requirement_id"]}},
    {"name": "get_verdict", "description": "Merge verdict of a work order (e.g. WO-345): status, decision, requirement test results, "
     "world-model simulation verdict and the evidence-pack headline.",
     "inputSchema": {"type": "object", "properties": {"work_order_id": {"type": "string"}}, "required": ["work_order_id"]}},
    {"name": "list_gaps", "description": "Coverage gaps of a project: requirements without code or test links or with failing tests, "
     "hazards without a mitigating requirement, and safety code no requirement traces to.",
     "inputSchema": {"type": "object", "properties": {"project": _project}, "required": ["project"]}},
    {"name": "recall_memory", "description": "Search the factory's org memory, regulatory knowledge base and lessons from past verdicts "
     "(HydraDB, local fallback).",
     "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "project": _project, "k": {"type": "integer", "default": 5}},
                     "required": ["query"]}},
]


def _projects():
    return store._load()["projects"]


def _resolve(project):
    """Projects matching an id, name or device ('' = all)."""
    ps = _projects()
    if not project:
        return ps
    key = project.strip().lower()
    hit = [p for p in ps if key in (p["id"], p["name"].lower(), p["device"])]
    if not hit:
        raise ValueError(f"unknown project {project!r}; known: {', '.join(p['id'] for p in ps)}")
    return hit


def _where(t):
    if t.get("url"):
        return t["url"]
    if t.get("anchor"):
        return f"{t['path']}#{t['anchor']}"
    if t.get("start"):
        return f"{t['path']}:{t['start']}-{t.get('end', t['start'])}"
    return t.get("path") or t.get("wo") or ""


def list_projects():
    return [{k: p[k] for k in ("id", "name", "device", "standard", "world_model")} for p in _projects()]


def get_trace(requirement_id, project=""):
    rid = requirement_id.strip().upper()
    out = []
    for p in _resolve(project):
        trace = store.state(p["id"], None)["trace"]
        r = next((r for r in trace["requirements"] if r["id"] == rid), None)
        if r:
            out.append({"project": p["id"], "requirement": r["id"], "text": r["text"], "hazards": r["hazards"], "dal": r["dal"],
                        "gaps": r["gaps"], "links": [{"kind": t["kind"], "label": t["label"], "where": _where(t),
                                                      **({"result": t["result"]} if t.get("result") else {})} for t in r["targets"]]})
    if not out:
        raise ValueError(f"no requirement {rid}")
    return out


def get_verdict(work_order_id):
    wid = re.sub(r"[^A-Za-z0-9-]", "", work_order_id).upper()
    w = next((w for w in store._load()["work_orders"] if w["id"].upper() == wid), None)
    if not w:
        raise ValueError(f"no work order {wid}")
    st = store.state(w["project"], None)
    w = next(x for x in st["work_orders"] + st["archived_work_orders"] if x["id"] == w["id"])
    gate, world, ev = w.get("gate") or {}, w.get("world") or {}, w.get("evidence") or {}
    return {"work_order": w["id"], "project": w["project"], "title": w["title"], "status": w["status"],
            "decision": ev.get("decision"), "headline": ev.get("headline"),
            "requirement_tests": [{"id": r["id"], "result": r["result"], "hazards": [h["id"] for h in r.get("hazards", [])]} for r in gate.get("rows", [])],
            "world_model": world.get("verdict"), "commits": len(w["commits"]),
            "evidence": f"/api/evidence?wo={w['id']}" if ev else None}


def list_gaps(project):
    out = []
    for p in _resolve(project):
        t = store.state(p["id"], None)["trace"]
        out.append({"project": p["id"], "name": p["name"],
                    "requirements": [{"id": r["id"], "text": r["text"], "gaps": r["gaps"]} for r in t["requirements"] if r["gaps"]],
                    "hazards": [{"id": h["id"], "title": h["title"], "gaps": h["gaps"]} for h in t["hazards"] if h["gaps"]],
                    "untraced_code": [f"{c['label']} ({_where(c)})" for c in t["untraced"]]})
    return out


def recall_memory(query, project="", k=5):
    dev = _resolve(project)[0]["device"] if project else None
    hits, info = memory.search(query, k=max(1, min(int(k), 20)), project=dev, collections=memory.COLLECTIONS)
    return {"backend": info["backend"], "ms": info["ms"],
            "hits": [{"title": h["title"], "kind": h["kind"], "project": h.get("project", ""), "collection": h.get("collection", ""),
                      "score": h.get("score"), "text": h["text"][:600]} for h in hits]}


FNS = {"list_projects": list_projects, "get_trace": get_trace, "get_verdict": get_verdict, "list_gaps": list_gaps,
       "recall_memory": recall_memory}


def call(name, args):
    if name not in FNS:
        raise ValueError(f"unknown tool {name}")
    return FNS[name](**{k: v for k, v in (args or {}).items() if k in TOOLS[list(FNS).index(name)]["inputSchema"]["properties"]})


def handle(msg):
    """One JSON-RPC message in, the response out (None for notifications)."""
    mid, method, params = msg.get("id"), msg.get("method", ""), msg.get("params") or {}
    if mid is None:
        return None
    ok = lambda result: {"jsonrpc": "2.0", "id": mid, "result": result}  # noqa: E731
    if method == "initialize":
        v = params.get("protocolVersion")
        return ok({"protocolVersion": v if v in PROTOCOLS else PROTOCOLS[0], "capabilities": {"tools": {}},
                   "serverInfo": {"name": NAME, "version": VERSION},
                   "instructions": "Read-only safety record of Certus Factory: traceability, verdicts, coverage gaps, memory."})
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": TOOLS})
    if method == "tools/call":
        try:
            data = call(params.get("name", ""), params.get("arguments"))
            return ok({"content": [{"type": "text", "text": json.dumps(data, indent=1)}], "isError": False})
        except (ValueError, TypeError) as e:
            return ok({"content": [{"type": "text", "text": str(e)}], "isError": True})
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}}


def load_env():
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p):
            m = re.match(r"\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$", line)
            if m and not line.lstrip().startswith("#"):
                os.environ.setdefault(m.group(1), m.group(2).strip('"\''))


def main():
    load_env()
    out = sys.stdout
    sys.stdout = sys.stderr  # stdout carries the protocol only; module prints go to stderr
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            resp = handle(json.loads(line))
        except json.JSONDecodeError:
            resp = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}
        if resp is not None:
            out.write(json.dumps(resp) + "\n")
            out.flush()


if __name__ == "__main__":
    main()
