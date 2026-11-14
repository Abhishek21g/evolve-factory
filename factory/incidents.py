"""Safety incident hotline: a phone call becomes a traced work order.

The ElevenLabs hotline agent (factory/hotline.py) collects the report and calls its `create_incident` tool; the browser
(or the test caller) forwards that call to POST /api/incidents, which creates, deterministically:
  1. a draft work order on the right project (keyword match of the reported project/system),
  2. a memory item in HydraDB org_memory (memory.remember, local copy always),
  3. a trace link from the most likely hazard in the project's safety.json (keyword overlap, ties to the lower id)
     to the incident (trace/links-<device>.json, kind url), so it shows on the hazard in Traceability.
Incidents live in .runs/incidents.json; only factory/server.py writes it.
"""
import json
import os
import threading
import time

import memory
import store
import tracelinks

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, ".runs", "incidents.json")
HOSTED = "https://certus-factory.vercel.app"
lock = threading.Lock()
DEVICE_WORDS = {
    "flight-controls": {"boeing", "737", "aircraft", "airplane", "plane", "flight", "pilot", "aoa", "angle", "attack", "vane",
                        "stall", "trim", "stabilizer", "mcas", "cockpit", "captain", "altitude", "sideslip"},
    "insulin-pump": {"pump", "insulin", "bolus", "glucose", "patient", "dose", "diabetes", "diabetic", "hypo", "basal",
                     "cgm", "hypoglycemia", "units"},
}


def _load():
    return json.load(open(PATH)) if os.path.exists(PATH) else []


def _save(xs):
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    json.dump(xs, open(PATH + ".tmp", "w"), indent=1)
    os.replace(PATH + ".tmp", PATH)


def _words(text):
    return set(text.lower().replace("-", " ").split()) | memory._stem(text)


def pick_project(said, text):
    """The project the caller named, else the one whose device vocabulary the report uses most."""
    projects = store._load()["projects"]
    s = (said or "").lower()
    for p in projects:
        if s and (s in p["name"].lower() or p["name"].lower() in s or p["id"] == s):
            return p
    w = _words(f"{said} {text}")
    scores = {dev: len(w & vocab) for dev, vocab in DEVICE_WORDS.items()}
    dev = max(scores, key=lambda d: scores[d])
    return next((p for p in projects if p["device"] == dev), projects[0] if projects else None)


def match_hazard(spec, text):
    """Most likely hazard: stemmed words shared with the hazard (title counts double) and its mitigating requirements."""
    w = memory._stem(text)
    best = None
    for h in spec["hazards"]:
        title = memory._stem(h["title"])
        body = memory._stem(h.get("fha", "") + " " + " ".join(r["text"] for r in spec["requirements"] if h["id"] in r["hazards"]))
        hits = (w & title) | (w & body)
        score = 2 * len(w & title) + len(w & (body - title))
        if best is None or score > best["score"]:
            best = {"id": h["id"], "title": h["title"], "severity": h.get("severity"), "score": score, "matched": sorted(hits)[:12]}
    return best


def create(body, actor):
    """Incident from the hotline agent's create_incident call. Returns the incident (what the agent reads back)."""
    clip = lambda k, n=600: str(body.get(k) or "").strip()[:n]  # noqa: E731
    what = clip("what_happened", 1500)
    if not what:
        raise ValueError("what_happened required")
    text = " ".join(clip(k) for k in ("project", "what_happened", "context", "summary"))
    p = pick_project(clip("project", 80), text)
    if not p:
        raise ValueError("no project to file the incident on")
    dev = store.device(p["id"])
    spec = store.safety_spec(dev)
    haz = match_hazard(spec, text)
    with lock:
        xs = _load()
        inc_id = f"INC-{len(xs) + 1}"
        summary = clip("summary", 300) or what[:200]
        severity = clip("severity", 40) or "unknown"
        wo = store.create_wo(actor, p["id"], f"{inc_id}: {summary}"[:120],
                             f"Reported on the Certus safety hotline ({clip('caller', 80) or 'caller not named'}).\n\n"
                             f"What happened: {what}\nWhen: {clip('when', 120) or 'not stated'}\nSeverity (caller): {severity}\n"
                             f"Context: {clip('context', 600) or 'none given'}\n\n"
                             f"Traced to hazard {haz['id']} {haz['title']} (keyword match: {', '.join(haz['matched']) or 'none'}). "
                             "Investigate, reproduce in the world model, and fix without changing a certified limit.")
        url = f"{HOSTED}/#/p/{p['id']}/incidents/{inc_id}"
        link = tracelinks.add_link(dev["id"], spec, actor, {"item": haz["id"], "kind": "url", "url": url,
                                                             "label": f"{inc_id} hotline report → {wo['id']}: {summary[:70]}"})
        inc = {"id": inc_id, "ts": time.time(), "project": p["id"], "device": dev["id"], "caller": clip("caller", 80),
               "what": what, "when": clip("when", 120), "severity": severity, "context": clip("context", 600), "summary": summary,
               "hazard": haz, "wo": wo["id"], "link": link["id"], "url": url, "conversation_id": clip("conversation_id", 80),
               "source": clip("source", 20) or "live", "transcript": body.get("transcript") or [],
               "memory": {"id": f"mem-{inc_id.lower()}-{int(time.time())}", "backend": "pending"}}
        xs.append(inc)
        _save(xs)
    item = {"id": inc["memory"]["id"], "kind": "safety_finding", "project": dev["id"],
            "title": f"{inc_id} safety hotline: {summary[:90]}",
            "text": f"{what} When: {inc['when'] or 'not stated'}. Severity: {severity}. Context: {inc['context'] or 'none'}. "
                    f"Filed as {wo['id']}; traced to {haz['id']} {haz['title']}."}
    threading.Thread(target=_remember, args=(inc_id, item), daemon=True).start()
    store.log(actor, "logged incident", inc_id, f"safety hotline → {wo['id']}, {haz['id']}", p["id"])
    return inc


def _remember(inc_id, item):
    res = memory.remember([item])
    update(inc_id, {"memory": {"id": item["id"], **res}})


def update(inc_id, fields):
    with lock:
        xs = _load()
        for x in xs:
            if x["id"] == inc_id:
                x.update(fields)
                _save(xs)
                return x
    return None


def attach_transcript(inc_id, transcript, conversation_id=""):
    turns = [{"role": "agent" if t.get("role") == "agent" else "caller", "text": str(t.get("text", ""))[:1000]}
             for t in (transcript or [])[:80] if t.get("text")]
    return update(inc_id, {"transcript": turns, **({"conversation_id": conversation_id[:80]} if conversation_id else {})})


def listing(project=None):
    return [x for x in reversed(_load()) if not project or x["project"] == project]
