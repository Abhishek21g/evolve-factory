"""Shared memory (context layer) for the agents, backed by HydraDB.

Three HydraDB collections in one database (the free plan allows one database), every item tagged with its project
(device: insulin-pump | flight-controls) in additional_metadata, so recall is scoped with a metadata filter:
  org_memory       tickets, meetings, chats, emails, reviews, code notes (factory/seed_memory.jsonl)
  regulatory_kb    standards per project (factory/seed_knowledge.jsonl) and the hazard log from each safety.json
  factory_lessons  one lesson per finished work order: verdict, failed requirements and hazards, the fix that passed
Without HYDRADB_API_KEY a local JSONL store with keyword scoring stands in, so the demo still runs offline.
HydraDB never makes anyone wait: every call gives up after 2 s and the local store answers for the next minute.
The local store always keeps a full copy; seed() syncs anything HydraDB is missing.
Item: {"id", "kind", "title", "text", "project", "collection"?, "synthetic"?, "meta"?}.
"""
import hashlib
import json
import os
import re
import time

from hydra_db import HydraDB

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.path.join(ROOT, ".runs", "memory.jsonl")
SEEDED = os.path.join(ROOT, ".runs", "hydradb_seeded.json")
DB = os.environ.get("HYDRADB_DATABASE", "default-tenant")
ORG, KB, LESSONS = "org_memory", "regulatory_kb", "factory_lessons"
COLLECTIONS = (ORG, KB, LESSONS)
SEEDS = {ORG: os.path.join(ROOT, "factory", "seed_memory.jsonl"), KB: os.path.join(ROOT, "factory", "seed_knowledge.jsonl")}
HAZARD_LOGS = {"insulin-pump": "demo/pump/safety.json", "flight-controls": "demo/aircraft/safety.json"}
RECORDINGS = {"insulin-pump": "demo/replay/build", "flight-controls": "demo/replay/aircraft/build"}
FAST = {"timeout_in_seconds": 2, "max_retries": 0}
STOP = {"the", "and", "for", "let", "take", "with", "what", "that", "thi", "from", "any", "are", "into"}
_hydra = {"client": None, "failed_at": float(os.environ.get("HYDRADB_FAILED_AT") or 0), "ok": None}  # set by server.py for runs
_inv = {"data": None}


def _key():
    return os.environ.get("HYDRADB_API_KEY")


def _client():
    if _hydra["client"] is None:
        _hydra["client"] = HydraDB(token=_key(), **({"base_url": os.environ["HYDRADB_URL"]} if os.environ.get("HYDRADB_URL") else {}))
    return _hydra["client"]


def _use_hydra():
    return bool(_key()) and time.time() - _hydra["failed_at"] > 60


def _failed(what, e):
    _hydra["failed_at"] = time.time()
    print(f"[memory] HydraDB {what} failed, using local for 60 s: {getattr(e, 'status_code', '')} {str(getattr(e, 'body', e))[:300]}", flush=True)


def status():
    """connected | falling back | missing key (for the Home card)."""
    if not _key():
        return "missing key"
    return "falling back" if not _use_hydra() else "connected" if _hydra["ok"] else "connecting"


def backend():
    return "HydraDB" if _use_hydra() else "local"


def failed_at():
    """When HydraDB last failed in this process; runs inherit it so none of them waits on a known outage."""
    return _hydra["failed_at"]


def _hazard_items():
    """The hazard log of each project (its safety.json), one item per hazard with the requirements that mitigate it."""
    out = []
    for project, path in HAZARD_LOGS.items():
        spec = json.load(open(os.path.join(ROOT, path)))
        for h in spec["hazards"]:
            reqs = [r for r in spec["requirements"] if h["id"] in r["hazards"]]
            out.append({"id": f"kb-{project}-{h['id']}", "project": project, "collection": KB, "kind": "hazard",
                        "title": f"Hazard log {h['id']}: {h['title']} ({h.get('severity', '')}{', DAL ' + h['dal'] if h.get('dal') else ''})",
                        "text": f"{h.get('fha', '')} Mitigated by " + "; ".join(f"{r['id']}: {r['text']}" for r in reqs) + f". Source: {path}."})
    return out


def _recorded_lessons():
    """Lessons from the real runs recorded for the stage (demo/replay), so factory_lessons starts with true history."""
    out = []
    for project, src in RECORDINGS.items():
        rec = [json.loads(l) for l in open(os.path.join(ROOT, src + ".jsonl")) if l.strip()]
        last, evd = rec[-1], next((e["evidence"] for e in reversed(rec) if e.get("evidence")), {})
        reason = re.search(r"BLOCKED: (.*?)\. Not mergeable", last["msg"])
        out.append(lesson_item(rec[0]["wo"], project, rec[0]["title"], last["agent"] == "reviewer" and last["state"] == "done",
                               reason.group(1) if reason else "", evd.get("headline", ""), rec,
                               open(os.path.join(ROOT, src + ".diff.txt")).read(), ts=int(float(rec[0]["run"]))))
    return out


def _local_items():
    items = {}
    for coll, path in SEEDS.items():
        for line in open(path):
            if line.strip():
                it = json.loads(line)
                items[it["id"]] = {**it, "collection": coll}
    for it in _hazard_items() + _recorded_lessons():
        items[it["id"]] = it
    if os.path.exists(LOCAL):
        for line in open(LOCAL):
            if line.strip():
                it = json.loads(line)
                items[it["id"]] = it
    return list(items.values())


def _coll(it):
    return it.get("collection") or ORG


def _wire(it):
    meta = {"kind": it["kind"], "project": it.get("project", ""), **({"synthetic": True} if it.get("synthetic") else {}), **it.get("meta", {})}
    return {"id": it["id"], "title": it["title"], "text": it["text"], "infer": False, "additional_metadata": meta}


def _ingest(coll, items, opts=None):
    _client().context.ingest(type="memory", database=DB, collection=coll, upsert="true",
                             memories=json.dumps([_wire(it) for it in items]), request_options=opts)


def _append_local(items):
    os.makedirs(os.path.dirname(LOCAL), exist_ok=True)
    with open(LOCAL, "a") as f:
        for it in items:
            f.write(json.dumps(it) + "\n")


def remember(items):
    """Keep locally and write to HydraDB (2 s max). Returns {"backend", "ms", "collection"} of the write."""
    _append_local(items)
    t0, coll = time.time(), _coll(items[0])
    if _use_hydra():
        try:
            _ingest(coll, items, FAST)
            _hydra["ok"] = True
            _inv["data"] = None  # counts changed
            return {"backend": "HydraDB", "ms": round((time.time() - t0) * 1000), "collection": coll}
        except Exception as e:
            _failed("write", e)
    return {"backend": "local", "ms": round((time.time() - t0) * 1000), "collection": coll}


def seed():
    """Upsert every local item HydraDB does not have in its current form (stable ids, so re-running is safe)."""
    if not _use_hydra():
        return 0
    done = json.load(open(SEEDED)) if os.path.exists(SEEDED) else {}
    done = done if isinstance(done, dict) else {}  # older format: a list of ids without project tags; resend all
    sig = lambda it: hashlib.sha1(json.dumps(_wire(it), sort_keys=True).encode()).hexdigest()[:12]  # noqa: E731
    new = [it for it in _local_items() if it["kind"] != "run" and done.get(it["id"]) != sig(it)]
    for coll in COLLECTIONS:
        batch = [it for it in new if _coll(it) == coll]
        for i in range(0, len(batch), 20):
            _ingest(coll, batch[i:i + 20], {"timeout_in_seconds": 15, "max_retries": 0})
            done.update({it["id"]: sig(it) for it in batch[i:i + 20]})
            os.makedirs(os.path.dirname(SEEDED), exist_ok=True)
            json.dump(done, open(SEEDED, "w"))
    return len(new)


def items(project=None):
    """Everything the factory remembers for a project (newest first)."""
    return [it for it in reversed(_local_items()) if not project or it.get("project") == project]


def _stem(t):
    return {re.sub(r"s$", "", re.sub(r"(ing|ed|es|s)$", "", w)) for w in re.findall(r"[a-z0-9]{3,}", t.lower())} - STOP


def search(query, k=5, project=None, collections=(ORG, KB), recency=None):
    """Recall for the agents. Returns (hits, info); info = {"backend", "ms", "collections"} for the UI."""
    t0 = time.time()
    info = lambda b: {"backend": b, "ms": round((time.time() - t0) * 1000), "collections": list(collections)}  # noqa: E731
    if _use_hydra():
        try:
            scope = {"collections": list(collections)} if len(collections) > 1 else {"collection": collections[0]}
            res = _client().query(database=DB, type="memory", query=query, max_results=k, mode="fast", graph_context=False,
                                  response_format="structured", recency_bias=recency,
                                  metadata_filters={"additional_metadata": {"project": project}} if project else None,
                                  request_options=FAST, **scope)
            _hydra["ok"] = True
            hits, seen = [], set()
            for ch in res.data.chunks:
                meta = ch.additional_metadata or {}
                if ch.id in seen:
                    continue
                seen.add(ch.id)
                hits.append({"id": ch.id, "title": ch.source_title or "", "text": ch.chunk_content, "kind": meta.get("kind", ""),
                             "project": meta.get("project", ""), "collection": ch.collection or ch.sub_tenant_id or collections[0],
                             "synthetic": bool(meta.get("synthetic")), "meta": meta, "score": round(ch.relevancy_score, 3)})
            return hits, info("HydraDB")
        except Exception as e:  # fall back to local so a network blip never stops the factory
            if "do not exist" in str(getattr(e, "body", "")):  # a collection nothing was written to yet: HydraDB is fine
                return [], info("HydraDB")
            _failed("recall", e)
    words, scored = _stem(query), []
    for it in _local_items():
        if _coll(it) not in collections or (project and it.get("project") != project):
            continue
        overlap = len(words & _stem(it["title"] + " " + it["text"]))
        if overlap:
            scored.append({**it, "collection": _coll(it), "score": round(overlap / max(len(words), 1), 3)})
    # ponytail: keyword overlap is the offline fallback only; HydraDB does the real semantic recall
    return sorted(scored, key=lambda h: -h["score"])[:k], info("local")


def recall(query, k=5, project=None):
    return search(query, k, project)[0]


def refresh_inventory():
    """Item counts per collection, kind and project, read from HydraDB itself (context.list). Cached for the UI."""
    if not _use_hydra():
        return
    t0, out = time.time(), {}
    try:
        for coll in COLLECTIONS:
            res = _client().context.list(database=DB, collection=coll, type="memory", page_size=100, request_options=FAST)
            rows = [m.additional_metadata or {} for m in res.data.user_memories or []]
            out[coll] = _count([(m.get("project", ""), m.get("kind", "")) for m in rows], res.data.total)
        _hydra["ok"] = True
        _inv["data"] = {"backend": "HydraDB", "ms": round((time.time() - t0) * 1000), "at": time.time(), "collections": out}
    except Exception as e:
        _failed("list", e)


def inventory():
    """Last HydraDB counts if fresh (under 2 min), else counts from the local copy. Never calls the network."""
    d = _inv["data"]
    if d and time.time() - d["at"] < 120 and _use_hydra():
        return d
    loc = _local_items()
    out = {c: _count([(it.get("project", ""), it["kind"]) for it in loc if _coll(it) == c]) for c in COLLECTIONS}
    return {"backend": "local", "ms": 0, "at": time.time(), "collections": out}


def _count(rows, total=None):
    """rows: (project, kind) pairs -> {"total", "projects": {p: n}, "kinds": {project: {kind: n}}}; project "" = all."""
    c = {"total": total or len(rows), "projects": {}, "kinds": {"": {}}}
    for p, k in rows:
        c["projects"][p] = c["projects"].get(p, 0) + 1
        for scope in {"", p}:
            c["kinds"].setdefault(scope, {})[k] = c["kinds"].get(scope, {}).get(k, 0) + 1
    return c


def _fix(diff):
    """The first comment the coding agent added to product code in its final change: its own account of the fix."""
    added, path = [], ""
    for l in diff.splitlines():
        path = l.split(" b/")[-1] if l.startswith("diff --git") else path
        if l.startswith("+") and not l.startswith("+++") and not re.search(r"test|check|Makefile", os.path.basename(path), re.I):
            added.append(l[1:].strip())
    for i, line in enumerate(added):
        if line.startswith(("/*", "//")):
            text = " ".join(l.strip("/* ").strip() for l in added[i:i + 3] if l.startswith(("/*", "//", "*")))
            return re.sub(r"^WO-[\w-]+:\s*", "", text.split("*/")[0]).strip()[:220]
    files = re.findall(r"^diff --git a/(\S+)", diff, re.M)
    return f"changed {', '.join(files)}" if files else ""


def lesson_item(wo, project, intent, passed, reason, headline, evs, diff, replay_of=None, ts=None):
    """What the factory learned from one finished work order, from its event log and final diff."""
    attempts, world, desc = [], "", {}
    for e in evs:
        m = re.match(r"Attempt (\d+): (.+)", e["msg"])
        if e["agent"].startswith("coder") and m and m.group(2) not in ("implementing", "committed", "fixing what the gate blocked"):
            desc[m.group(1)] = m.group(2)
        if e["agent"] == "world" and e["state"] in ("blocked", "pass"):
            world = e["msg"].split(";")[0].replace("BLOCKED: ", "").replace(" caused by this change", "")
        if e["agent"] == "gate" and m and e["state"] in ("blocked", "pass"):
            failed = [f"{r['id']} ({', '.join(h['id'] for h in r['hazards'])})" for r in (e.get("gate") or {}).get("rows", []) if r["result"] != "PASS"]
            attempts.append({"n": m.group(1), "ok": e["state"] == "pass", "failed": failed,
                             "world": world if e["state"] == "blocked" else "", "what": desc.get(m.group(1), "")})
            world = ""
    blocked = [a for a in attempts if not a["ok"]]
    why = lambda a: "; ".join(a["failed"] + ([f"world model: {a['world']}"] if a["world"] else [])) or "a check failed"  # noqa: E731
    fix = _fix(diff) if passed else ""
    verdict = ("APPROVED" + (f" after {len(attempts)} attempts" if len(attempts) > 1 else " first time")) if passed else "BLOCKED"
    if passed and blocked:
        summary = f"{wo} was blocked for {why(blocked[0])}; fixed by: {fix}"
    elif passed:
        summary = f"{wo} passed every check first time: {fix}"
    else:
        summary = f"{wo} was blocked: {reason}"
    lines = [f"Work order {wo} ({project}): {intent.splitlines()[0].rstrip('.')}.", f"Verdict: {verdict}."]
    lines += [f"Attempt {a['n']}{' (' + a['what'] + ')' if a['what'] else ''}: "
              + ("passed all checks." if a["ok"] else f"BLOCKED for {why(a)}.") for a in attempts]
    lines += [f"Fix that passed the gate: {fix}" if fix else "", f"Evidence: {headline}." if headline else "",
              f"Replay of recorded run {replay_of}." if replay_of else ""]
    failed_all = sorted({f for a in blocked for f in a["failed"]})
    return {"id": f"lesson-{wo}-{ts or int(time.time())}", "project": project, "collection": LESSONS, "kind": "lesson",
            "title": f"{wo} {verdict}: {intent.splitlines()[0][:90]}", "text": " ".join(l for l in lines if l),
            "meta": {"wo": wo, "verdict": "APPROVED" if passed else "BLOCKED", "attempts": len(attempts),
                     "failed": ", ".join(failed_all)[:200], "summary": summary[:320], "request": intent.splitlines()[0][:120]}}


if __name__ == "__main__":
    import sys
    if sys.argv[1:2] == ["seed"]:
        print(f"seeded {seed()} new items into {backend()}")
    else:
        hits, info = search(" ".join(sys.argv[1:]) or "bolus limit", project=os.environ.get("PROJECT"))
        for h in hits:
            print(h["score"], h["collection"], h["kind"], h["title"])
        print(info)
