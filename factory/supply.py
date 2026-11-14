"""Suppliers, supply chain, finance and the control tower, per project.

Sample data per device lives in supply/<device>.json (fictional suppliers, parts, prices and budget, labelled as such).
What people add from the UI (connected supplier teams, submitted deliverables) goes to .runs/supply-<device>.json.
A submitted deliverable also becomes a trace link (trace/links-<device>.json) on the requirement it supports, so it
shows in Traceability and in the evidence pack. Agent costs come from the real event feed (attempts, analysis steps,
simulations counted per work order) times the prices in the sample file's "rates", which the UI shows as assumptions.
Only factory/server.py writes, under one lock.
"""
import datetime
import json
import os
import re
import threading
import time

import store
import tracelinks

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
lock = threading.Lock()
KINDS = ("hardware", "software", "raw_material")
DELIVERABLE_KINDS = ("certificate", "test_report", "sbom", "cert_data", "report", "agreement", "declaration")
EXPIRING_DAYS = 60
LONG_LEAD_DAYS = 150
LLM_AGENTS = ("planner", "safety", "simulation")


def _sample(dev):
    p = os.path.join(ROOT, "supply", f"{dev}.json")
    return json.load(open(p)) if os.path.exists(p) else None


def _added_path(dev):
    return os.path.join(ROOT, ".runs", f"supply-{dev}.json")


def _added(dev):
    p = _added_path(dev)
    return json.load(open(p)) if os.path.exists(p) else {"suppliers": [], "deliverables": []}


def _save_added(dev, d):
    p = _added_path(dev)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(d, open(p + ".tmp", "w"), indent=1)
    os.replace(p + ".tmp", p)


def _days_left(date):
    if not date:
        return None
    return (datetime.date.fromisoformat(date) - datetime.date.today()).days


def suppliers(dev):
    """Sample suppliers plus connected teams, each deliverable with its expiry state."""
    s, added = _sample(dev), _added(dev)
    out = [json.loads(json.dumps(x)) for x in s["suppliers"]] + [json.loads(json.dumps(x)) for x in added["suppliers"]]
    by_id = {x["id"]: x for x in out}
    for d in added["deliverables"]:
        sup = by_id.get(d["supplier"])
        if not sup:
            continue
        old = next((x for x in sup["deliverables"] if x["id"] == d["id"]), None)
        if old:
            old.update({k: v for k, v in d.items() if k != "supplier"})
        else:
            sup["deliverables"].append({k: v for k, v in d.items() if k != "supplier"})
    for sup in out:
        for d in sup["deliverables"]:
            d["days_left"] = _days_left(d.get("expires"))
            d["expiry"] = ("expired" if d["days_left"] is not None and d["days_left"] < 0 else
                           "expiring" if d["days_left"] is not None and d["days_left"] <= EXPIRING_DAYS else "")
        sup["missing"] = sum(d["status"] == "missing" for d in sup["deliverables"])
        sup["expiring"] = sum(bool(d["expiry"]) for d in sup["deliverables"])
    return out


def risks(sups, parts):
    """Supplier compliance findings and supply-chain risks, each with what it could affect."""
    out = []
    for s in sups:
        for d in s["deliverables"]:
            if d["expiry"]:
                out.append({"kind": d["expiry"] + "_cert", "tone": "bad" if d["expiry"] == "expired" else "warn", "supplier": s["id"],
                            "deliverable": d["id"], "affects": [d["item"]] if d.get("item") else s["affects"],
                            "text": f"{d['title']} from {s['name']} {'expired' if d['expiry'] == 'expired' else 'expires'} "
                                    f"{d['expires']} ({abs(d['days_left'])} days {'ago' if d['days_left'] < 0 else 'left'})"})
            if d["status"] == "missing":
                out.append({"kind": "missing_deliverable", "tone": "bad", "supplier": s["id"], "deliverable": d["id"],
                            "affects": [d["item"]] if d.get("item") else s["affects"], "text": f"{s['name']} has not delivered: {d['title']}"})
    for p in parts:
        sup = next((s for s in sups if s["id"] == p["supplier"]), {"name": p["supplier"]})
        for f in p["flags"]:
            text = {"single_source": f"{p['name']} is single-source ({sup['name']})",
                    "long_lead": f"{p['name']} lead time is {p['lead_days']} days",
                    "import_delay": f"{p['name']} import {p['customs'].lower()} at customs ({p['origin']})"
                                    + (f": {p['customs_note']}" if p.get("customs_note") else ""),
                    "supplier_cert": f"{p['name']}: supplier certificate expiring or expired ({sup['name']})"}[f]
            if f != "supplier_cert":
                out.append({"kind": f, "tone": "bad" if f == "import_delay" else "warn", "part": p["id"], "supplier": p["supplier"],
                            "affects": p["affects"], "text": text})
    return out


def parts(dev, sups):
    by_id = {s["id"]: s for s in sups}
    out = []
    for p in _sample(dev)["parts"]:
        p = dict(p)
        sup = by_id.get(p["supplier"], {})
        p["flags"] = [f for f, on in (("single_source", p["single_source"]), ("long_lead", p["lead_days"] >= LONG_LEAD_DAYS),
                                      ("import_delay", p["customs"] in ("Held", "Delayed")),
                                      ("supplier_cert", bool(sup.get("expiring")))) if on]
        out.append(p)
    return out


def finance(proj, s, sups, prts):
    """Budget vs actual. Agent and compute actuals: counted from the real event feed, priced with the stated rates."""
    rates, budget = s["rates"], s["budget"]
    evs = store.events(proj["id"])
    rows = []
    for w in (w for w in store._load()["work_orders"] if w["project"] == proj["id"]):
        mine = [e for e in evs if e.get("wo") == w["id"]]
        if not mine:
            continue
        runs = sorted({e["run"] for e in mine})
        attempts = sum(e["agent"].startswith("coder") and e["state"] == "done" for e in mine)
        steps = sum(e["agent"] in LLM_AGENTS and e["state"] == "done" for e in mine)
        coder_s, start = 0.0, {}
        for e in mine:
            if e["agent"].startswith("coder"):
                if e["state"] == "working":
                    start.setdefault(e["run"], e["t"])
                elif e["state"] == "done" and e["run"] in start:
                    coder_s += e["t"] - start.pop(e["run"])
        checks = sum(e["agent"] == "world" and e["state"] in ("pass", "blocked") for e in mine)
        world = store._load_run(f"{w['id']}.world.json") or {}
        gate = store._load_run(f"{w['id']}.gate.json") or {}
        sims = checks * len(world.get("results", []))
        verified = sum(r["result"] == "PASS" for r in gate.get("rows", []))
        llm = attempts * rates["attempt_usd"] + steps * rates["step_usd"]
        compute = sims * rates["sim_usd"]
        st, _ = store.wo_status(w["id"], mine, None)
        rows.append({"wo": w["id"], "title": w["title"], "status": st, "runs": len(runs), "attempts": attempts, "steps": steps,
                     "agent_min": None if any(e.get("replay") for e in mine) else round(coder_s / 60, 1),  # a replay compresses time
                     "sims": sims, "verified": verified,
                     "llm_usd": round(llm, 2), "compute_usd": round(compute, 3), "total_usd": round(llm + compute, 2)})
    whatifs = sorted({e["run"] for e in evs if not e.get("wo") and e["agent"] == "simulation" and e["state"] == "done"})
    wi_sims = sum(len((e.get("world") or {}).get("results", [])) for e in evs if not e.get("wo") and e.get("world"))
    wi_usd = len(whatifs) * rates["step_usd"] + wi_sims * rates["sim_usd"]
    llm = sum(r["llm_usd"] for r in rows) + len(whatifs) * rates["step_usd"]
    compute = sum(r["compute_usd"] for r in rows) + wi_sims * rates["sim_usd"]
    done = [r for r in rows if r["status"] in ("Approved", "Blocked")]
    verified = sum(r["verified"] for r in rows)
    spent = sum(x["spend"]["invoiced"] for x in sups)
    saved_h = len(done) * rates["hours_per_wo"]
    return {
        "period": budget["period"],
        "lines": [
            {"id": "agents", "label": "Agent runs (LLM)", "budget": budget["agents"], "actual": round(llm, 2), "basis": "estimated"},
            {"id": "compute", "label": "Compute and simulation", "budget": budget["compute"], "actual": round(compute, 2), "basis": "estimated"},
            {"id": "suppliers", "label": "Supplier spend (invoiced)", "budget": budget["suppliers"], "actual": spent, "basis": "sample"},
        ],
        "work_orders": rows,
        "whatifs": {"runs": len(whatifs), "sims": wi_sims, "usd": round(wi_usd, 2)},
        "factory_usd": round(llm + compute, 2),
        "cost_per_wo": round((llm + compute) / len(done), 2) if done else None,
        "cost_per_req": round((llm + compute) / verified, 2) if verified else None,
        "verified": verified, "completed": len(done),
        "saved": {"hours": saved_h, "usd": saved_h * rates["hour_usd"]},
        "bom_unit": round(sum(p["qty"] * p["unit_cost"] for p in prts), 2),
        "bom": [{"part": p["id"], "name": p["name"], "qty": p["qty"], "unit_cost": p["unit_cost"], "supplier": p["supplier"]} for p in prts],
        "spend": [{"supplier": x["id"], "name": x["name"], "tier": x["tier"], **x["spend"]} for x in sups],
        "rates": rates,
        "assumptions": [
            f"Agent cost: ${rates['attempt_usd']:.2f} per coding attempt (about 40k tokens at a blended $15 per million tokens) "
            f"and ${rates['step_usd']:.2f} per analysis step (planner, safety analyst, simulation agent; about 3k tokens). "
            "Attempts and steps are counted from the real event feed; prices are list-price estimates, not invoices.",
            f"Compute: ${rates['sim_usd']} per simulated patient or flight (CPU seconds at cloud on-demand rates), counted from the world-model results.",
            f"Certification effort saved: {rates['hours_per_wo']} engineer-hours per completed work order of manual hazard-analysis update, "
            f"trace matrix, test report and evidence-pack assembly, at ${rates['hour_usd']}/h.",
            "Budget, supplier spend and BOM prices are sample data.",
        ],
    }


def view(pid):
    proj = next((p for p in store._load()["projects"] if p["id"] == pid), None)
    if not proj:
        return None
    s = _sample(proj["device"])
    if not s:
        return {"project": pid, "device": proj["device"], "available": False}
    sups = suppliers(proj["device"])
    prts = parts(proj["device"], sups)
    spec = store.safety_spec(proj)
    return {"project": pid, "device": proj["device"], "available": True, "sample": s["sample"], "assurance": s["assurance"],
            "required": s["required"], "suppliers": sups, "parts": prts, "risks": risks(sups, prts),
            "finance": finance(proj, s, sups, prts),
            "items": [{"id": r["id"], "text": r["text"]} for r in spec["requirements"]] + [{"id": h["id"], "text": h["title"]} for h in spec["hazards"]]}


def tower(pid, running=None):
    """Everything a VP of engineering looks at first: software building, physical-AI safety, supply chain, finance."""
    v = view(pid)
    if not v:
        return None
    st = store.state(pid, running)
    wos = st.get("work_orders", [])
    evs = store.events(pid)
    count = lambda s: sum(w["status"] == s for w in wos)  # noqa: E731
    prs = sorted({e["pr"] for e in evs if e.get("pr")})
    sim = next((e for e in reversed(evs) if e.get("world") and e["world"].get("results")), None)
    tr = st.get("trace") or {}
    gaps = [{"id": r["id"], "gaps": r["gaps"]} for r in (tr.get("requirements") or []) + (tr.get("hazards") or []) if r["gaps"]]
    out = {
        "project": st["project"], "requirements": len(st.get("requirements", [])), "hazards": len(st.get("hazards", [])),
        "software": {"total": len(wos), "running": count("Running"), "approved": count("Approved"), "blocked": count("Blocked"),
                     "draft": count("Draft"), "prs": prs,
                     "latest": [{"id": w["id"], "title": w["title"], "status": w["status"],
                                 "verdict": (w.get("evidence") or {}).get("decision")} for w in reversed(wos)][:4]},
        "safety": {"sim": {"wo": sim.get("wo"), "question": sim["world"].get("question"), "verdict": sim["world"].get("verdict"),
                           "runs": len(sim["world"]["results"]), "new": sum(bool(r.get("new_hypo")) for r in sim["world"]["results"]),
                           "kind": sim["world"].get("kind") or "patients"} if sim else None,
                   "gaps": gaps, "untraced": len(tr.get("untraced") or [])},
    }
    if v.get("available"):
        f = v["finance"]
        rk = v["risks"]
        out["supply"] = {"suppliers": len(v["suppliers"]), "tiers": {t: sum(s["tier"] == t for s in v["suppliers"]) for t in (1, 2, 3)},
                         "parts": len(v["parts"]), "counts": {k: sum(r["kind"] == k for r in rk) for k in
                                                              ("expired_cert", "expiring_cert", "missing_deliverable", "single_source", "long_lead", "import_delay")},
                         "top": sorted(rk, key=lambda r: r["tone"] != "bad")[:5]}
        out["finance"] = {"factory_usd": f["factory_usd"], "budget_usd": sum(x["budget"] for x in f["lines"] if x["id"] != "suppliers"),
                          "suppliers_usd": f["lines"][2]["actual"], "suppliers_budget": f["lines"][2]["budget"],
                          "cost_per_wo": f["cost_per_wo"], "cost_per_req": f["cost_per_req"], "saved": f["saved"], "bom_unit": f["bom_unit"]}
    return out


def towers(running=None):
    return [t for t in (tower(p["id"], running) for p in store._load()["projects"]) if t]


# ---------- what people add ----------
def _clip(body, k, n=200):
    return str(body.get(k) or "").strip()[:n]


def invite(dev, spec, body):
    """Connect a supplier team: a workspace entry with contacts and the deliverables this project requires of it."""
    s = _sample(dev)
    if not s:
        raise ValueError("no supply chain for this project yet")
    name, kind = _clip(body, "name", 80), _clip(body, "kind", 20)
    if not name:
        raise ValueError("supplier name required")
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}")
    try:
        tier = int(body.get("tier") or 1)
    except (TypeError, ValueError):
        raise ValueError("tier must be 1, 2 or 3")
    if tier not in (1, 2, 3):
        raise ValueError("tier must be 1, 2 or 3")
    email = _clip(body, "email", 120)
    if email and not re.match(r"[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise ValueError("enter a valid contact email")
    ids = {r["id"] for r in spec["requirements"]} | {h["id"] for h in spec["hazards"]}
    affects = [a for a in body.get("affects") or [] if a in ids][:12]
    with lock:
        sups = suppliers(dev)
        parent = _clip(body, "parent", 20) or None
        if tier > 1 and not any(x["id"] == parent for x in sups):
            raise ValueError("a tier-2 or tier-3 supplier needs its parent supplier")
        n = max(int(x["id"][4:]) for x in sups) + 1
        req = s["required"][kind]
        sup = {"id": f"SUP-{n}", "name": name, "tier": tier, "parent": parent if tier > 1 else None, "kind": kind,
               "supplies": _clip(body, "supplies", 200), "location": _clip(body, "location", 80), "assurance": [t for t, _ in req],
               "status": "Invited", "invited": time.time(),
               "contacts": [{"name": _clip(body, "contact", 80) or "Supplier contact", "role": _clip(body, "role", 60), "email": email}],
               "affects": affects, "spend": {"po": 0, "invoiced": 0},
               "deliverables": [{"id": f"D-{i + 1}", "title": t, "kind": k, "status": "missing", "item": next((a for a in affects if a.startswith("SR-")), "")}
                                for i, (t, k) in enumerate(req)]}
        added = _added(dev)
        added["suppliers"].append(sup)
        _save_added(dev, added)
    return sup


def submit(dev, spec, actor, body):
    """A supplier submits a deliverable: recorded on its workspace and linked to the requirement it supports."""
    url, title, kind = _clip(body, "url", 500), _clip(body, "title", 120), _clip(body, "kind", 20)
    item, sid, did = _clip(body, "item", 20), _clip(body, "supplier", 20), _clip(body, "deliverable", 10)
    expires = _clip(body, "expires", 10)
    if not title:
        raise ValueError("deliverable title required")
    if kind not in DELIVERABLE_KINDS:
        raise ValueError(f"kind must be one of {', '.join(DELIVERABLE_KINDS)}")
    if expires:
        try:
            datetime.date.fromisoformat(expires)
        except ValueError:
            raise ValueError("expiry must be a date (YYYY-MM-DD)")
    with lock:
        sup = next((x for x in suppliers(dev) if x["id"] == sid), None)
        if not sup:
            raise ValueError(f"unknown supplier: {sid or '(none)'}")
        if did and not any(d["id"] == did for d in sup["deliverables"]):
            raise ValueError(f"no deliverable {did} for {sup['name']}")
        link = tracelinks.add_link(dev, spec, actor, {"item": item, "kind": "url", "url": url,
                                                      "label": f"Supplier deliverable: {title} ({sup['name']})"})
        did = did or f"D-{max([int(d['id'][2:]) for d in sup['deliverables']] + [0]) + 1}"
        d = {"supplier": sid, "id": did, "title": title, "kind": kind, "status": "submitted", "item": item, "url": url,
             "link": link["id"], "submitted": time.time(), "by": actor, **({"expires": expires} if expires else {})}
        added = _added(dev)
        added["deliverables"] = [x for x in added["deliverables"] if not (x["supplier"] == sid and x["id"] == did)] + [d]
        _save_added(dev, added)
    return {**d, "supplier_name": sup["name"]}
