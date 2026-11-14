"""Factory state: projects, work orders, team and the audit trail, in one JSON file (.runs/factory.json).

Only factory/server.py writes it (under one lock). Agent activity is not stored here: it comes from the
dashboard event feed and git, and is merged into the audit trail when read.
"""
import json
import os
import re
import subprocess
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, ".runs", "factory.json")
FEED = os.path.join(ROOT, "dashboard", "events.jsonl")
lock = threading.Lock()

TEAM = [
    {"id": "abhishek", "name": "Abhishek Enaguthi", "role": "Safety lead", "kind": "human"},
    {"id": "murali", "name": "Muralikrishna Inti", "role": "Firmware engineer", "kind": "human"},
    {"id": "planner", "name": "Planner", "role": "Breaks requests into work", "kind": "agent"},
    {"id": "memory", "name": "Context layer", "role": "Recalls tickets, meetings, chats, code", "kind": "agent"},
    {"id": "safety", "name": "Safety Analyst", "role": "Hazard analysis, ISO 14971", "kind": "agent"},
    {"id": "coder-claude", "name": "Claude Code", "role": "Writes the change in a worktree", "kind": "agent"},
    {"id": "coder-codex", "name": "Codex", "role": "Parallel coder", "kind": "agent"},
    {"id": "gate", "name": "Safety Gate", "role": "Runs requirement tests (deterministic)", "kind": "agent"},
    {"id": "world", "name": "World Model", "role": "Firmware in simulated patients", "kind": "agent"},
    {"id": "simulation", "name": "Simulation Agent", "role": "Turns questions into scenarios", "kind": "agent"},
    {"id": "evidence", "name": "Evidence", "role": "Writes the safety case", "kind": "agent"},
    {"id": "reviewer", "name": "Reviewer", "role": "Merge decision from checks", "kind": "agent"},
    {"id": "actions", "name": "Composio", "role": "Acts in GitHub and Slack", "kind": "agent"},
]
DEVICES = {
    "insulin-pump": {"label": "Insulin pump", "world_model": "UVA/Padova type 1 diabetes simulator (simglucose), 30 virtual patients",
                     "repo": "demo/pump", "standard": "IEC 62304 Class C · ISO 14971"},
}


def _load():
    if os.path.exists(PATH):
        return json.load(open(PATH))
    return {"projects": [], "work_orders": [], "audit": []}


def _save(d):
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    tmp = PATH + ".tmp"
    json.dump(d, open(tmp, "w"), indent=1)
    os.replace(tmp, PATH)


def _audit(d, actor, action, obj, detail=""):
    d["audit"].append({"ts": time.time(), "actor": actor, "action": action, "object": obj, "detail": detail})


def safety_spec(project):
    return json.load(open(os.path.join(ROOT, project["repo"], "safety.json")))


def create_project(actor, name, device):
    dev = DEVICES.get(device)
    if not dev:
        raise ValueError("no world model for this device yet")
    with lock:
        d = _load()
        pid = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "project"
        if any(p["id"] == pid for p in d["projects"]):
            pid += f"-{len(d['projects']) + 1}"
        p = {"id": pid, "name": name, "device": device, "repo": dev["repo"], "standard": dev["standard"],
             "world_model": dev["world_model"], "created": time.time(), "owner": actor}
        d["projects"].append(p)
        spec = safety_spec(p)
        _audit(d, actor, "created project", name, f"{dev['label']}, {dev['standard']}")
        _audit(d, "planner", "imported hazard log", name,
               f"{len(spec['hazards'])} hazards and {len(spec['requirements'])} safety requirements from {dev['repo']}/safety.json")
        _save(d)
        return p


def create_wo(actor, project, title, description):
    with lock:
        d = _load()
        if not any(p["id"] == project for p in d["projects"]):
            raise ValueError("unknown project")
        n = [int(w["id"][3:]) for w in d["work_orders"]]
        wo = {"id": f"WO-{max(n + [100]) + 1}", "project": project, "title": title, "description": description,
              "created": time.time(), "requested_by": actor}
        d["work_orders"].append(wo)
        _audit(d, actor, "created work order", wo["id"], title)
        _save(d)
        return wo


def log(actor, action, obj, detail=""):
    with lock:
        d = _load()
        _audit(d, actor, action, obj, detail)
        _save(d)


def events():
    if not os.path.exists(FEED):
        return []
    return [json.loads(l) for l in open(FEED) if l.strip()]


def wo_status(wo_id, evs, running):
    mine = [e for e in evs if e.get("wo") == wo_id]
    if not mine:
        return "Draft", None
    rev = [e for e in mine if e["agent"] == "reviewer"]
    if rev:
        if rev[-1].get("not_run"):
            return "Not run", rev[-1]["t"]
        return ("Approved" if rev[-1]["state"] == "done" else "Blocked"), rev[-1]["t"]
    return ("Running" if running == wo_id else "Stopped"), None


def git_changes(wo_id):
    """Commits on the work order's branch (who changed what in code). A replayed run has the recording instead."""
    rec = _load_run(f"{wo_id}.commits.json")
    if rec is not None:
        return rec
    out = subprocess.run(["git", "-C", ROOT, "log", "--format=%H%x09%an%x09%at%x09%s", f"origin/main..wo/{wo_id}"],
                         capture_output=True, text=True).stdout
    return [dict(zip(("sha", "author", "ts", "subject"), l.split("\t"))) for l in out.splitlines() if l.count("\t") == 3]


def diff(wo_id):
    p = os.path.join(ROOT, ".runs", f"{wo_id}.diff.txt")
    if os.path.exists(p):
        return open(p).read()
    return subprocess.run(["git", "-C", ROOT, "diff", "--stat", "-p", f"origin/main...wo/{wo_id}", "--", "demo/"],
                          capture_output=True, text=True).stdout[:60000]


def _load_run(name):
    p = os.path.join(ROOT, ".runs", name)
    return json.load(open(p)) if os.path.exists(p) else None


def state(project_id, running):
    d = _load()
    evs = events()
    proj = next((p for p in d["projects"] if p["id"] == project_id), d["projects"][0] if d["projects"] else None)
    out = {"team": TEAM, "devices": {k: v["label"] for k, v in DEVICES.items()}, "projects": d["projects"], "project": proj}
    if not proj:
        out["audit"] = sorted(d["audit"], key=lambda a: -a["ts"])
        return out
    spec = safety_spec(proj)
    wos = []
    for w in (w for w in d["work_orders"] if w["project"] == proj["id"]):
        st, _ = wo_status(w["id"], evs, running)
        gate, world, ev = _load_run(f"{w['id']}.gate.json"), _load_run(f"{w['id']}.world.json"), None
        evd = [e for e in evs if e.get("wo") == w["id"] and e.get("evidence")]
        if evd:
            ev = evd[-1]["evidence"]
        wos.append({**w, "status": st, "gate": gate, "world": world, "evidence": ev,
                    "commits": git_changes(w["id"]) if st != "Draft" else []})
    # audit: humans (store) + agents (event feed, one line per finished step) + code commits (git)
    t0 = {}
    audit = list(d["audit"])
    for e in evs:
        if e["state"] in ("done", "pass", "blocked") and e.get("wo") in {w["id"] for w in wos} | {None}:
            base = t0.setdefault(e["run"], float(e["run"]))
            audit.append({"ts": base + e["t"], "actor": e["agent"], "action": e["state"], "object": e.get("wo") or "world model", "detail": e["msg"]})
    for w in wos:
        for c in w["commits"]:
            audit.append({"ts": float(c["ts"]), "actor": "coder-claude",  # wo/ branches are written by the coding agent
                          "action": "committed code", "object": w["id"], "detail": f"{c['sha'][:7]} {c['subject']}"})
    out["agents"] = agent_roster(evs)
    out.update({"hazards": spec["hazards"], "requirements": spec["requirements"], "work_orders": wos,
                "audit": sorted(audit, key=lambda a: -a["ts"])[:300], "trace": trace(spec, wos)})
    return out


def agent_roster(evs):
    """Per agent: what it is doing now (latest run), how many steps it has finished, last action."""
    last_run = evs[-1]["run"] if evs else None
    out = {}
    for e in evs:
        a = out.setdefault(e["agent"], {"id": e["agent"], "done": 0, "blocked": 0, "msg": "", "state": "idle", "ts": 0, "wo": None})
        a["done"] += e["state"] in ("done", "pass")
        a["blocked"] += e["state"] == "blocked"
        a["msg"], a["ts"], a["wo"] = e["msg"], float(e["run"]) + e["t"], e.get("wo")
        a["state"] = e["state"] if e["run"] == last_run else "idle"
    return out


def trace(spec, wos):
    """Graph: hazard -> requirement -> code symbol / test -> work order -> verification."""
    nodes, edges = [], []
    add = lambda i, kind, label, sub="", tone="": nodes.append({"id": i, "kind": kind, "label": label, "sub": sub, "tone": tone})  # noqa: E731
    for h in spec["hazards"]:
        add(h["id"], "hazard", h["id"], h["title"], "fail" if h.get("severity") == "S3" else "warn")
    syms = {}
    for r in spec["requirements"]:
        add(r["id"], "requirement", r["id"], r["text"])
        for h in r["hazards"]:
            edges.append((h, r["id"]))
        tid = f"test:{r['id']}"
        add(tid, "test", f"test {r['id']}", "test_safety.c", "ok")
        edges.append((r["id"], tid))
        for s in r.get("symbols", [])[:2]:
            syms.setdefault(s, []).append(r["id"])
    for s, rs in syms.items():
        add(f"code:{s}", "code", s, "pump.h / pump.c")
        for r in rs:
            edges.append((r, f"code:{s}"))
    for w in wos:
        if w["status"] == "Draft":
            continue
        add(w["id"], "work_order", w["id"], w["title"], {"Approved": "ok", "Blocked": "fail"}.get(w["status"], ""))
        for row in (w.get("gate") or {}).get("rows", []):
            edges.append((f"test:{row['id']}", w["id"]))
            for why in row.get("why", []):  # code this work order changed
                if why.startswith("symbol ") and f"code:{why[7:]}" in {n["id"] for n in nodes}:
                    edges.append((f"code:{why[7:]}", w["id"]))
        if w.get("world"):
            sid = f"sim:{w['id']}"
            res = w["world"]["results"]
            add(sid, "simulation", f"{len(res)} simulations", f"world model {w['world']['verdict']}",
                "ok" if w["world"]["verdict"] == "PASS" else "fail")
            edges.append((w["id"], sid))
        if w.get("evidence"):
            eid = f"ev:{w['id']}"
            add(eid, "evidence", "Evidence pack", w["evidence"]["decision"], "ok" if w["evidence"]["decision"] == "APPROVED" else "fail")
            edges.append((w["id"], eid))
    return {"nodes": nodes, "edges": [{"source": a, "target": b} for a, b in dict.fromkeys(edges)]}
