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

import tracelinks
import whatif_title

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
    {"id": "actions", "name": "Composio", "role": "Files evidence on GitHub", "kind": "agent"},
]
ROLES_BY_DEVICE = {  # agent roles that depend on the project's device (default: the pump's, in TEAM)
    "flight-controls": {"safety": "Hazard analysis, ARP4761", "world": "Flight software in simulated aircraft"},
}
DEVICES = {  # repo: code + safety.json; checks: gate config; rules: coding-agent rules (default: the pump's, in runner.py)
    "insulin-pump": {"label": "Insulin pump", "world_model": "UVA/Padova type 1 diabetes simulator (simglucose), 30 virtual patients",
                     "repo": "demo/pump", "standard": "IEC 62304 Class C · ISO 14971", "checks": "gate/checks.json",
                     "replay": "demo/replay"},
    "flight-controls": {"label": "Flight controls (airliner)",
                        "world_model": "Longitudinal flight model of a 737-class airliner, 6 weight/CG configs x 3 scenarios",
                        "repo": "demo/aircraft", "standard": "DO-178C DAL A · ARP4754A · ARP4761 · 14 CFR 25.1309",
                        "checks": "gate/checks-aircraft.json", "rules": "demo/aircraft/RULES.md", "replay": "demo/replay/aircraft"},
}
DEFAULT_PROJECTS = [("Boeing Flight Controls", "flight-controls")]  # added next to whatever go.sh seeded


def _load():
    if os.path.exists(PATH):
        return json.load(open(PATH))
    return {"projects": [], "work_orders": [], "audit": []}


def _save(d):
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    tmp = PATH + ".tmp"
    json.dump(d, open(tmp, "w"), indent=1)
    os.replace(tmp, PATH)


def _audit(d, actor, action, obj, detail="", project=None):
    d["audit"].append({"ts": time.time(), "actor": actor, "action": action, "object": obj, "detail": detail,
                       **({"project": project} if project else {})})


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
        _audit(d, actor, "created project", name, f"{dev['label']}, {dev['standard']}", pid)
        _audit(d, "planner", "imported hazard log", name,
               f"{len(spec['hazards'])} hazards and {len(spec['requirements'])} safety requirements from {dev['repo']}/safety.json", pid)
        _save(d)
        return p


def ensure_projects(actor="abhishek"):
    """Create the DEFAULT_PROJECTS that don't exist yet (only once some project exists, so go.sh's stays first)."""
    d = _load()
    if not d["projects"]:
        return
    for name, device in DEFAULT_PROJECTS:
        if not any(p["device"] == device for p in d["projects"]):
            create_project(actor, name, device)


def device(project_id):
    """Device config of a project (the first project's if unknown)."""
    d = _load()
    p = next((p for p in d["projects"] if p["id"] == project_id), d["projects"][0] if d["projects"] else None)
    key = p["device"] if p else "insulin-pump"
    return {**DEVICES[key], "id": key}


def create_wo(actor, project, title, description):
    with lock:
        d = _load()
        if not any(p["id"] == project for p in d["projects"]):
            raise ValueError("unknown project")
        # Branches are shared by every checkout of the repo: never reuse a number whose wo/ branch another checkout owns.
        branches = subprocess.run(["git", "-C", ROOT, "branch", "--list", "wo/WO-*", "--format=%(refname:short)"],
                                  capture_output=True, text=True).stdout.split()
        n = [int(w["id"][3:]) for w in d["work_orders"]] + [int(b[6:]) for b in branches if b[6:].isdigit()]
        wo = {"id": f"WO-{max(n + [100]) + 1}", "project": project, "title": title, "description": description,
              "created": time.time(), "requested_by": actor}
        d["work_orders"].append(wo)
        _audit(d, actor, "created work order", wo["id"], title, project)
        _save(d)
        return wo


def log(actor, action, obj, detail="", project=None):
    with lock:
        d = _load()
        _audit(d, actor, action, obj, detail, project)
        _save(d)


def events(project_id=None):
    """The event feed, every event stamped with the project its run belongs to (only that project's if given)."""
    if not os.path.exists(FEED):
        return []
    evs = [json.loads(l) for l in open(FEED) if l.strip()]
    tag_projects(evs, _load())
    whatif_title.apply(evs)
    return [e for e in evs if e["project"] == project_id] if project_id else evs


def tag_projects(evs, d):
    """A run belongs to one project. New events carry it (dashboard/emit.py stamps FACTORY_PROJECT); for older ones it
    is the project of the run's work order, else of the device its world model simulated (aircraft runs say so)."""
    by_wo = {w["id"]: w["project"] for w in d["work_orders"]}
    by_dev = {}
    for p in d["projects"]:
        by_dev.setdefault(p["device"], p["id"])
    fallback = by_dev.get("insulin-pump") or (d["projects"][0]["id"] if d["projects"] else "")
    runs = {}
    for e in evs:
        r = runs.setdefault(e["run"], {})
        if e.get("project"):
            r.setdefault("tagged", e["project"])
        if e.get("wo") in by_wo:
            r.setdefault("wo", by_wo[e["wo"]])
        w = e.get("world") or {}
        if w.get("kind") == "aircraft" or any("speed_kt" in s for s in e.get("scenarios") or []):
            r.setdefault("device", by_dev.get("flight-controls"))
    for e in evs:
        r = runs[e["run"]]
        e["project"] = e.get("project") or r.get("tagged") or r.get("wo") or r.get("device") or fallback


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


def audit_project(a, d, evs):
    """Project of a human audit entry (None: organization-wide, e.g. memory). Older entries predate the project field."""
    if a.get("project"):
        return a["project"]
    w = next((w for w in d["work_orders"] if w["id"] == a["object"]), None)
    if w:
        return w["project"]
    p = next((p for p in d["projects"] if a["object"] == p["name"] or a["detail"] == p["id"]), None)  # older "ran monitor": project id in detail
    if p:
        return p["id"]
    if a["object"] == "world model":  # a what-if: the project of the run that asked the same question
        return next((e["project"] for e in evs if e.get("asked", e.get("title")) == a["detail"]), None)
    return None


def state(project_id, running):
    d = _load()
    proj = next((p for p in d["projects"] if p["id"] == project_id), d["projects"][0] if d["projects"] else None)
    roles = ROLES_BY_DEVICE.get(proj["device"], {}) if proj else {}
    out = {"team": [{**m, "role": roles.get(m["id"], m["role"])} for m in TEAM], "devices": {k: v["label"] for k, v in DEVICES.items()},
           "projects": d["projects"], "project": proj}
    if not proj:
        out["audit"] = sorted(d["audit"], key=lambda a: -a["ts"])
        return out
    all_evs = events()
    evs = [e for e in all_evs if e["project"] == proj["id"]]
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
    audit = [a for a in d["audit"] if audit_project(a, d, all_evs) in (proj["id"], None)]
    titles = {e["asked"]: e["title"] for e in evs if e.get("asked")}
    for i, a in enumerate(audit):
        if a["object"] == "world model":  # a what-if: show it under its run's title, typed text kept as `asked`
            t = titles.get(a["detail"]) or whatif_title.clean(a["detail"])
            audit[i] = {**a, "detail": t, **({"asked": a["detail"]} if t != a["detail"] else {})}
    for e in evs:
        if e["state"] in ("done", "pass", "blocked"):
            base = t0.setdefault(e["run"], float(e["run"]))
            audit.append({"ts": base + e["t"], "actor": e["agent"], "action": e["state"], "object": e.get("wo") or "world model", "detail": e["msg"]})
    for w in wos:
        for c in w["commits"]:
            audit.append({"ts": float(c["ts"]), "actor": "coder-claude",  # wo/ branches are written by the coding agent
                          "action": "committed code", "object": w["id"], "detail": f"{c['sha'][:7]} {c['subject']}"})
    out["agents"] = agent_roster(evs)
    out.update({"hazards": spec["hazards"], "requirements": spec["requirements"], "work_orders": wos,
                "audit": sorted(audit, key=lambda a: -a["ts"])[:300], "trace": tracelinks.build(spec, wos, proj, proj["device"])})
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

