"""Shared memory (context layer) for the agents.

HydraDB when HYDRADB_API_KEY is set (managed context graph, semantic recall); otherwise a local JSONL store with
keyword scoring so the demo still runs offline. Same two calls either way: remember(items), recall(query, k).
Item: {"id", "kind", "title", "text"}; kind = work_order | run | safety_finding | meeting | chat | email | code.
"""
import json
import os
import re
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.path.join(ROOT, ".runs", "memory.jsonl")
SEED = os.path.join(ROOT, "factory", "seed_memory.jsonl")
DB, COLL = "certus_factory", "org_memory"
STOP = {"the", "and", "for", "let", "take", "with", "what", "that", "thi", "from", "any", "are", "into"}


def _key():
    return os.environ.get("HYDRADB_API_KEY")


def backend():
    return "HydraDB" if _key() else "local"


def _local_items():
    items = {}
    for path in (SEED, LOCAL):
        if os.path.exists(path):
            for line in open(path):
                if line.strip():
                    it = json.loads(line)
                    items[it["id"]] = it
    return list(items.values())


def _hydra():
    from hydra_db import HydraDB
    c = HydraDB(token=_key())
    try:
        c.databases.create(database=DB, database_metadata_schema=[{"name": "kind", "data_type": "VARCHAR"}])
        for _ in range(60):
            if c.databases.status(database=DB).data.infra.ready_for_ingestion:
                break
            time.sleep(3)
    except Exception:
        pass  # already exists
    return c


def remember(items):
    os.makedirs(os.path.dirname(LOCAL), exist_ok=True)
    with open(LOCAL, "a") as f:
        for it in items:
            f.write(json.dumps(it) + "\n")
    if _key():
        _hydra().context.ingest(type="memory", database=DB, collection=COLL, memories=json.dumps(
            [{"id": it["id"], "title": it["title"], "text": it["text"], "metadata": {"kind": it["kind"]}} for it in items]))


def seed():
    """Load the organization's knowledge (demo seed) into HydraDB once."""
    if _key():
        items = [json.loads(l) for l in open(SEED) if l.strip()]
        _hydra().context.ingest(type="memory", database=DB, collection=COLL, memories=json.dumps(
            [{"id": it["id"], "title": it["title"], "text": it["text"], "metadata": {"kind": it["kind"]}} for it in items]))
        return len(items)
    return 0


def recall(query, k=5):
    if _key():
        try:
            res = _hydra().query(database=DB, collections=[COLL], type="all", query=query, max_results=k)
            hits = [{"title": getattr(ch, "source_title", "") or "", "text": ch.chunk_content,
                     "kind": (getattr(ch, "metadata", None) or {}).get("kind", ""), "score": round(ch.relevancy_score, 3)}
                    for ch in res.data.chunks]
            if hits:
                return hits
        except Exception as e:  # fall back to local so a network blip never stops the factory
            print(f"[memory] HydraDB recall failed, using local: {e}", flush=True)
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
        print(f"seeded {seed()} items into {backend()}")
    else:
        for h in recall(" ".join(sys.argv[1:]) or "bolus limit"):
            print(h["score"], h["kind"], h["title"])
