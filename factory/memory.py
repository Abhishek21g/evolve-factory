"""Shared memory (context layer) for the agents.

HydraDB when HYDRADB_API_KEY is set (managed context graph, semantic recall); otherwise a local JSONL store with
keyword scoring so the demo still runs offline. Same two calls either way: remember(items), recall(query, k).
HydraDB never makes anyone wait: recall gives up after 2 s and uses the local store for the next minute, and
writes go to HydraDB in the background. The local store always keeps a full copy.
Item: {"id", "kind", "title", "text"}; kind = work_order | run | safety_finding | meeting | chat | email | code.
"""
import json
import os
import re
import threading
import time

from hydra_db import HydraDB

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.path.join(ROOT, ".runs", "memory.jsonl")
SEEDED = os.path.join(ROOT, ".runs", "hydradb_seeded.json")
SEED = os.path.join(ROOT, "factory", "seed_memory.jsonl")
DB = os.environ.get("HYDRADB_DATABASE", "default-tenant")  # the free plan allows one database
COLL = "org_memory"
FAST = {"timeout_in_seconds": 2, "max_retries": 0}
STOP = {"the", "and", "for", "let", "take", "with", "what", "that", "thi", "from", "any", "are", "into"}
_hydra = {"client": None, "failed_at": 0.0, "ok": None}


def _key():
    return os.environ.get("HYDRADB_API_KEY")


def _client():
    if _hydra["client"] is None:
        _hydra["client"] = HydraDB(token=_key())
    return _hydra["client"]


def _use_hydra():
    return bool(_key()) and time.time() - _hydra["failed_at"] > 60


def status():
    """connected | falling back | missing key (for the Home card)."""
    if not _key():
        return "missing key"
    return "falling back" if not _use_hydra() else "connected" if _hydra["ok"] else "connecting"


def backend():
    return "HydraDB" if _use_hydra() else "local"


def _local_items():
    items = {}
    for path in (SEED, LOCAL):
        if os.path.exists(path):
            for line in open(path):
                if line.strip():
                    it = json.loads(line)
                    items[it["id"]] = it
    return list(items.values())


def _ingest(items):
    _client().context.ingest(type="memory", database=DB, collection=COLL, memories=json.dumps(
        [{"id": it["id"], "title": it["title"], "text": it["text"], "infer": False, "additional_metadata": {"kind": it["kind"]}}
         for it in items]))


def _ingest_quietly(items):
    try:
        _ingest(items)
    except Exception as e:
        print(f"[memory] HydraDB write failed (kept locally): {e}", flush=True)


def remember(items):
    os.makedirs(os.path.dirname(LOCAL), exist_ok=True)
    with open(LOCAL, "a") as f:
        for it in items:
            f.write(json.dumps(it) + "\n")
    if _key():
        threading.Thread(target=_ingest_quietly, args=(items,)).start()


def seed():
    """Copy every local memory item HydraDB does not have yet (stable ids, so re-running is safe)."""
    if not _key():
        return 0
    done = set(json.load(open(SEEDED))) if os.path.exists(SEEDED) else set()
    new = [it for it in _local_items() if it["id"] not in done]
    if new:
        _ingest(new)
        os.makedirs(os.path.dirname(SEEDED), exist_ok=True)
        json.dump(sorted(done | {it["id"] for it in new}), open(SEEDED, "w"))
    return len(new)


def items():
    """Everything the factory remembers (newest first)."""
    return list(reversed(_local_items()))


def recall(query, k=5):
    if _use_hydra():
        try:
            res = _client().query(database=DB, collection=COLL, type="memory", query=query, max_results=k, mode="fast",
                                  request_options=FAST)
            _hydra["ok"] = True
            hits = [{"id": ch.id, "title": ch.source_title or "", "text": ch.chunk_content,
                     "kind": (ch.additional_metadata or {}).get("kind", ""), "score": round(ch.relevancy_score, 3)}
                    for ch in res.data.chunks]
            if hits:
                return hits
        except Exception as e:  # fall back to local so a network blip never stops the factory
            _hydra["failed_at"] = time.time()
            print(f"[memory] HydraDB recall failed, using local for 60 s: {e}", flush=True)
    stem = lambda t: {re.sub(r"s$", "", re.sub(r"(ing|ed|es|s)$", "", w)) for w in re.findall(r"[a-z0-9]{3,}", t.lower())} - STOP  # noqa: E731
    words = stem(query)
    scored = []
    for it in _local_items():
        body = stem(it["title"] + " " + it["text"])
        overlap = len(words & body)
        if overlap:
            scored.append({**it, "score": round(overlap / max(len(words), 1), 3)})
    # ponytail: keyword overlap is the offline fallback only; HydraDB does the real semantic recall
    return sorted(scored, key=lambda h: -h["score"])[:k]


if __name__ == "__main__":
    import sys
    if sys.argv[1:2] == ["seed"]:
        print(f"seeded {seed()} new items into {backend()}")
    else:
        for h in recall(" ".join(sys.argv[1:]) or "bolus limit"):
            print(h["score"], h["kind"], h["title"], f"({backend()})")
