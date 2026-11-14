"""Traceability: hazard <-> requirement <-> regulation clause <-> code (file + lines) <-> tests <-> simulation scenarios
<-> work orders and evidence, plus the links people add from the UI (trace/links-<device>.json, in the repo).

Derived links come from the project's safety.json (symbols are located in the code, so line ranges follow the code).
Only factory/server.py writes the links files, under one lock. Files are served read-only and only if git tracks
them, which blocks path traversal, absolute paths and untracked secrets (.env) in one rule.
"""
import json
import os
import re
import subprocess
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
lock = threading.Lock()
KINDS = ("code", "doc", "test", "url")
MAX_FILE = 400_000
STD_DOC = "docs/TRACEABILITY.md"

# Regulation clauses every hazard / requirement of a device answers to: (label, heading in docs/TRACEABILITY.md).
CLAUSES = {
    "insulin-pump": {
        "hazard": [("ISO 14971 §5.4", "ISO 14971 §5.4 Identification of hazards and hazardous situations"),
                   ("ISO 14971 §7.1", "ISO 14971 §7.1 Risk control option analysis")],
        "requirement": [("IEC 62304 §5.2.3", "IEC 62304 §5.2.3 Risk control measures in software requirements"),
                        ("IEC 62304 §5.7.1", "IEC 62304 §5.7.1 Tests for software requirements"),
                        ("IEC 62304 §7.3.3", "IEC 62304 §7.3.3 Traceability"),
                        ("ISO 14971 §7.2", "ISO 14971 §7.2 Implementation and verification of risk control measures")],
    },
    "flight-controls": {
        "hazard": [("ARP4761 FHA", "ARP4761 Functional hazard assessment"),
                   ("14 CFR 25.1309(b)", "14 CFR 25.1309(b) Failure condition probabilities")],
        "requirement": [("DO-178C §11.21", "DO-178C §11.21 Trace data"),
                        ("14 CFR 25.672", "14 CFR 25.672 Stability augmentation and automatic systems")],
    },
}
OBJECTIVES_HEADING = "DO-178C Annex A objectives"
# Fixed gate scenarios (sim/) and the hazards each one exercises.
SCENARIOS = {
    "insulin-pump": ("sim/world.py", {"large-meal": ["H-1", "H-3"], "decimal-slip": ["H-1", "H-3"]}),
    "flight-controls": ("sim/flight.py", {"sideslip-stall": ["H-2"], "vane-failure": ["H-1", "H-2"], "turbulence": ["H-5"]}),
}


def slug(s):
    """GitHub's heading anchor."""
    return re.sub(r"[^\w\- ]", "", s.strip().lower()).replace(" ", "-")


def _git(*args):
    return subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True).stdout


_cache = {}


def _cached(key, ttl, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    val = fn()
    _cache[key] = (time.time(), val)
    return val


def tracked():
    return _cached("tracked", 10, lambda: set(_git("ls-files").splitlines()))


def github():
    """Repo URL and a commit GitHub has: this checkout's HEAD once pushed, else origin/main."""
    def f():
        m = re.search(r"github\.com[:/](.+?)(?:\.git)?$", _git("remote", "get-url", "origin").strip())
        head = _git("rev-parse", "HEAD").strip()
        sha = head if _git("branch", "-r", "--contains", head).strip() else _git("rev-parse", "origin/main").strip()
        return {"repo": f"https://github.com/{m.group(1)}" if m else "", "sha": sha}
    return _cached("github", 30, f)


def safe_path(path):
    """A git-tracked file inside the repo, or None. Anything else (../, absolute, symlink out, untracked) is refused."""
    path = str(path or "")
    if not path or path.startswith("/") or "\\" in path or "\0" in path or ".." in path.split("/") or path not in tracked():
        return None
    full = os.path.realpath(os.path.join(ROOT, path))
    if not full.startswith(os.path.realpath(ROOT) + os.sep) or not os.path.isfile(full) or os.path.getsize(full) > MAX_FILE:
        return None
    return full


def read_file(path):
    full = safe_path(path)
    if not full:
        return None
    text = open(full, encoding="utf-8", errors="replace").read()
    return {"path": path, "text": text, "lines": text.count("\n") + (0 if text.endswith("\n") else 1), **github()}


def headings(text):
    """(line, level, text, anchor) of each markdown heading outside code fences."""
    out, fence = [], False
    for i, l in enumerate(text.splitlines(), 1):
        if l.startswith("```"):
            fence = not fence
        m = None if fence else re.match(r"(#{1,6})\s+(.+?)\s*#*\s*$", l)
        if m:
            out.append((i, len(m.group(1)), m.group(2), slug(m.group(2))))
    return out


def _lines(path):
    full = safe_path(path)
    return open(full, encoding="utf-8", errors="replace").read().splitlines() if full else []


def _block_end(lines, i):
    """Last line (0-based) of the brace block that starts on line i."""
    depth, seen = 0, False
    for j in range(i, len(lines)):
        depth += lines[j].count("{") - lines[j].count("}")
        seen = seen or "{" in lines[j]
        if seen and depth <= 0:
            return j
    return i


def locate(files, sym):
    """(path, start, end) of a C symbol's definition: a #define line, or a function body."""
    for path in files:
        lines = _lines(path)
        for i, l in enumerate(lines):
            if re.match(rf"\s*#define\s+{re.escape(sym)}\b", l):
                return path, i + 1, i + 1
            if re.match(rf"[A-Za-z_][\w \*]*\b{re.escape(sym)}\s*\(", l) and not l.rstrip().endswith(";"):
                return path, i + 1, _block_end(lines, i) + 1
    return None


def functions(path):
    """(name, start, end) of every function defined in a C file."""
    lines, out = _lines(path), []
    for i, l in enumerate(lines):
        m = re.match(r"[A-Za-z_][\w \*]*?\b(\w+)\s*\(", l)
        if (m and m.group(1) not in ("if", "for", "while", "switch", "return", "sizeof") and not l.rstrip().endswith(";")
                and "{" in "".join(lines[i:i + 2])):
            out.append((m.group(1), i + 1, _block_end(lines, i) + 1))
    return out


def test_location(req):
    """(path, start, end) of the requirement's unit test: its function plus the comment above it."""
    m = re.search(r"(\S*test_\w+)\s+(SR-\d+)\s*$", req.get("test", ""))
    if not m:
        return None
    path, lines = m.group(1) + ".c", _lines(m.group(1) + ".c")
    for i, l in enumerate(lines):
        if re.match(rf"static int {m.group(2).lower().replace('-', '')}\s*\(", l):
            s = i
            while s > 0 and re.match(r"\s*(/\*|\*|//)", lines[s - 1]):
                s -= 1
            return path, s + 1, _block_end(lines, i) + 1
    return None


def scenarios(dev):
    """(id, label, hazards, path, line) of the device's fixed gate scenarios, located in the simulator source."""
    path, haz = SCENARIOS.get(dev, ("", {}))
    out = []
    for i, l in enumerate(_lines(path)):
        m = re.match(r'\s*\{"id": "([\w-]+)", "label": "([^"]+)"', l)
        if m and m.group(1) in haz:
            out.append((m.group(1), m.group(2), haz[m.group(1)], path, i + 1))
    return out


# ---------- unit test results: run in the background so the page never waits ----------
TESTS = {}


def run_tests(dev, spec):
    cmds = {re.sub(r"\s+SR-\d+\s*$", "", r["test"]) for r in spec["requirements"] if r.get("test")}
    results, out = {}, ""
    for cmd in cmds:
        try:
            p = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True, timeout=90)
            out += p.stdout + p.stderr
        except subprocess.TimeoutExpired:
            out += f"{cmd}: timed out\n"
    for m in re.finditer(r"^(SR-\d+) (PASS|FAIL)\s*$", out, re.M):
        results[m.group(1)] = m.group(2)
    TESTS[dev] = {"ts": time.time(), "results": results, "running": False}
    return TESTS[dev]


def warm_tests(dev, spec):
    if dev not in TESTS:
        TESTS[dev] = {"ts": 0, "results": {}, "running": True}
        threading.Thread(target=run_tests, args=(dev, spec), daemon=True).start()


# ---------- links people add ----------
def links_path(dev):
    return os.path.join(ROOT, "trace", f"links-{dev}.json")


def links(dev):
    p = links_path(dev)
    return json.load(open(p))["links"] if os.path.exists(p) else []


def _save_links(dev, ls):
    p = links_path(dev)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump({"links": ls}, open(p + ".tmp", "w"), indent=1)
    os.replace(p + ".tmp", p)


def add_link(dev, spec, actor, body):
    """Validate and store one link. Raises ValueError with a message for the user."""
    clip = lambda k, n=300: str(body.get(k) or "").strip()[:n]  # noqa: E731
    item, kind = clip("item", 20), clip("kind", 10)
    ids = {r["id"] for r in spec["requirements"]} | {h["id"] for h in spec["hazards"]}
    if item not in ids:
        raise ValueError(f"unknown requirement or hazard: {item or '(none)'}")
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}")
    link = {"item": item, "kind": kind, "label": clip("label", 120), "by": actor, "ts": time.time()}
    if kind == "url":
        url = clip("url", 500)
        if not re.match(r"https?://[^\s/]+\.[^\s]+$", url):
            raise ValueError("enter a full http(s) URL")
        link["url"] = url
    else:
        path = clip("path", 300)
        f = read_file(path)
        if not f:
            raise ValueError(f"not a file in the repository: {path or '(none)'}")
        link["path"] = path
        if kind == "doc":
            if not path.endswith(".md"):
                raise ValueError("a doc link must point to a markdown file")
            anchor = clip("anchor", 200).lstrip("#")
            if anchor and anchor not in {h[3] for h in headings(f["text"])}:
                raise ValueError(f"no section #{anchor} in {path}")
            link["anchor"] = anchor
        else:
            try:
                start, end = int(body.get("start") or 1), int(body.get("end") or body.get("start") or f["lines"])
            except (TypeError, ValueError):
                raise ValueError("line numbers must be whole numbers")
            if not 1 <= start <= end <= f["lines"]:
                raise ValueError(f"line range must be within 1-{f['lines']} and start <= end")
            link["start"], link["end"] = start, end
    with lock:
        ls = links(dev)
        n = max([int(x["id"][1:]) for x in ls if x["id"][1:].isdigit()] + [0]) + 1
        link = {"id": f"L{n}", **link}
        _save_links(dev, ls + [link])
    return link


def remove_link(dev, link_id):
    with lock:
        ls = links(dev)
        keep = [x for x in ls if x["id"] != link_id]
        if len(keep) == len(ls):
            raise ValueError(f"no link {link_id}")
        _save_links(dev, keep)
    return next(x for x in ls if x["id"] == link_id)


def search(q, dev_repo):
    """Repo files, markdown sections and code lines matching q, for the link picker."""
    q = q.strip().lower()[:80]
    files = sorted(f for f in tracked() if not f.startswith(("web/public/", "demo/replay/")) and not f.endswith(("lock.json", ".ico", ".png")))
    if not q:
        mine = [f for f in files if f.startswith((dev_repo + "/", "docs/"))]
        return {"files": mine[:30], "sections": [], "lines": []}
    sections = []
    for f in (f for f in files if f.endswith(".md")):
        for line, _, text, anchor in headings(open(os.path.join(ROOT, f), errors="replace").read()):
            if q in text.lower():
                sections.append({"path": f, "anchor": anchor, "text": text, "line": line})
    grep = subprocess.run(["git", "-C", ROOT, "grep", "-n", "-i", "-F", "-I", q, "--", dev_repo, "sim", "gate", "factory"],
                          capture_output=True, text=True).stdout.splitlines()
    lines = [{"path": p, "line": int(n), "text": t.strip()[:160]} for p, n, t in (g.split(":", 2) for g in grep[:80] if g.count(":") >= 2)]
    lines = sorted(lines, key=lambda x: x["path"].endswith(".md"))[:20]  # code before prose
    return {"files": [f for f in files if q in f.lower()][:15], "sections": sections[:12], "lines": lines}


# ---------- the trace ----------
def build(spec, wos, project, dev):
    """Matrix rows per requirement and hazard, coverage gaps, and graph nodes/edges. Every target is openable."""
    warm_tests(dev, spec)
    gh, tests, added = github(), TESTS.get(dev, {}), links(dev)
    cl = CLAUSES.get(dev, {"hazard": [], "requirement": []})
    clause = lambda label, heading, note="": {"kind": "clause", "label": label, "note": note, "path": STD_DOC, "anchor": slug(heading)}  # noqa: E731
    by_req = {}
    for w in wos:
        for row in (w.get("gate") or {}).get("rows", []):
            by_req.setdefault(row["id"], []).append((w, row))
    scen = scenarios(dev)
    code_ranges = []  # (path, start, end) of every code link, for untraced-code detection

    def user_targets(item):
        out = []
        for x in (x for x in added if x["item"] == item):
            t = {"kind": x["kind"], "link": x["id"], "by": x["by"], "ts": x["ts"], "label": x.get("label") or ""}
            for k in ("path", "start", "end", "anchor", "url"):
                if x.get(k) not in (None, ""):
                    t[k] = x[k]
            if not t["label"]:
                t["label"] = x.get("url") or (f"{x['path']}#{x['anchor']}" if x.get("anchor") else
                                             f"{x['path']}:{x['start']}-{x['end']}" if x["kind"] != "doc" else x["path"])
            out.append(t)
        return out

    reqs = []
    for r in spec["requirements"]:
        ts = [clause(lbl, hd) for lbl, hd in cl["requirement"]]
        ts += [clause(o if o.startswith("DO-178C") else f"DO-178C {o}", OBJECTIVES_HEADING, "Objective listed for this requirement in safety.json")
               for o in r.get("objectives", [])]
        seen = set()
        for s in r.get("symbols", []):
            loc = locate(r.get("files", []), s)
            if loc and loc not in seen:
                seen.add(loc)
                ts.append({"kind": "code", "label": s, "path": loc[0], "start": loc[1], "end": loc[2], "auto": True})
        tl = test_location(r)
        latest = by_req.get(r["id"], [])
        res = tests.get("results", {}).get(r["id"]) or (latest[-1][1]["result"] if latest else "")
        if tl:
            ts.append({"kind": "test", "label": f"test {r['id']}", "path": tl[0], "start": tl[1], "end": tl[2], "auto": True,
                       "cmd": r["test"], "result": res, "tone": {"PASS": "ok", "FAIL": "fail"}.get(res, "")})
        ts += [{"kind": "scenario", "label": lbl, "path": p, "start": ln, "end": ln, "note": f"gate scenario {sid}"}
               for sid, lbl, hz, p, ln in scen if set(hz) & set(r["hazards"])]
        for w, row in latest:
            ts.append({"kind": "work_order", "label": w["id"], "wo": w["id"], "note": w["title"], "result": row["result"],
                       "tone": {"Approved": "ok", "Blocked": "fail"}.get(w["status"], "")})
            if w.get("evidence"):
                d = w["evidence"]["decision"]
                ts.append({"kind": "evidence", "label": f"Evidence {w['id']}", "wo": w["id"], "note": d, "tone": "ok" if d == "APPROVED" else "fail"})
        ts += user_targets(r["id"])
        code_ranges += [(t["path"], t["start"], t["end"]) for t in ts if t["kind"] == "code"]
        gaps = [g for g, k in (("no code link", "code"), ("no test", "test")) if not any(t["kind"] == k for t in ts)]
        if res == "FAIL":
            gaps.append("test failing")
        reqs.append({"id": r["id"], "text": r["text"], "hazards": r["hazards"], "dal": r.get("dal", ""), "targets": ts, "gaps": gaps})

    hazards = []
    for h in spec["hazards"]:
        mit = [r["id"] for r in spec["requirements"] if h["id"] in r["hazards"]]
        ts = [clause(lbl, hd) for lbl, hd in cl["hazard"]]
        ts += [{"kind": "scenario", "label": lbl, "path": p, "start": ln, "end": ln, "note": f"gate scenario {sid}"}
               for sid, lbl, hz, p, ln in scen if h["id"] in hz]
        # No requirement names the hazard, but an approved work order targeted it: that verified change mitigates it.
        fixes = [] if mit else [w for w in wos if w["status"] == "Approved" and h["id"] in (w.get("hazards_in_scope") or [])]
        for w in fixes:
            ts.append({"kind": "work_order", "label": w["id"], "wo": w["id"], "note": f"approved fix: {w['title']}", "tone": "ok"})
            if w.get("evidence"):
                d = w["evidence"]["decision"]
                ts.append({"kind": "evidence", "label": f"Evidence {w['id']}", "wo": w["id"], "note": d, "tone": "ok" if d == "APPROVED" else "fail"})
        ts += user_targets(h["id"])
        hazards.append({"id": h["id"], "title": h["title"], "severity": h.get("severity", ""), "dal": h.get("dal", ""),
                        "fha": h.get("fha", ""), "requirements": mit, "fixes": [w["id"] for w in fixes], "targets": ts,
                        "gaps": [] if mit or fixes else ["no mitigating requirement"]})

    code_files = sorted({f for r in spec["requirements"] for f in r.get("files", []) if f.endswith(".c")})
    untraced = [{"kind": "code", "label": name, "path": f, "start": s, "end": e}
                for f in code_files for name, s, e in functions(f)
                if not any(p == f and a <= e and s <= b for p, a, b in code_ranges)]
    return {"device": dev, "github": gh, "tests": tests, "requirements": reqs, "hazards": hazards, "untraced": untraced,
            **graph(reqs, hazards, wos)}


def target_id(t):
    k = t["kind"]
    if k in ("work_order",):
        return t["wo"]
    if k == "evidence":
        return f"ev:{t['wo']}"
    if k == "url":
        return f"url:{t['url']}"
    if k == "clause":
        return f"clause:{t['label']}"
    if k == "doc":
        return f"doc:{t['path']}#{t.get('anchor', '')}"
    return f"{k}:{t['path']}:{t.get('start', '')}-{t.get('end', '')}"


def graph(reqs, hazards, wos):
    nodes, edges, ids = [], [], set()

    def add(i, kind, label, sub="", tone="", target=None):
        if i not in ids:
            ids.add(i)
            nodes.append({"id": i, "kind": kind, "label": label, "sub": sub, "tone": tone, "target": target})

    for h in hazards:
        add(h["id"], "hazard", h["id"], h["title"], "fail" if h["gaps"] or h["severity"] in ("S3", "Catastrophic", "Hazardous") else "warn")
        for t in h["targets"]:
            add(target_id(t), t["kind"], t["label"], t.get("note") or t.get("path", ""), t.get("tone", ""), t)
            edges.append((target_id(t), h["id"]) if t["kind"] == "clause" else (t["wo"], target_id(t)) if t["kind"] == "evidence"
                         else (h["id"], target_id(t)))
    for r in reqs:
        add(r["id"], "requirement", r["id"], r["text"], "fail" if r["gaps"] else "")
        for h in r["hazards"]:
            edges.append((h, r["id"]))
        for t in r["targets"]:
            add(target_id(t), t["kind"], t["label"], t.get("note") or t.get("path", ""), t.get("tone", ""), t)
            if t["kind"] == "clause":
                edges.append((target_id(t), r["id"]))
            elif t["kind"] == "evidence":
                edges.append((t["wo"], target_id(t)))
            elif t["kind"] != "scenario":
                edges.append((r["id"], target_id(t)))
    for w in wos:  # world-model results of each work order
        if w.get("world") and w["id"] in ids:
            sid = f"sim:{w['id']}"
            add(sid, "simulation", f"{len(w['world']['results'])} simulations", f"world model {w['world']['verdict']}",
                "ok" if w["world"]["verdict"] == "PASS" else "fail")
            edges.append((w["id"], sid))
    return {"nodes": nodes, "edges": [{"source": a, "target": b} for a, b in dict.fromkeys(edges) if a in ids and b in ids]}


def evidence_section(dev, spec, req_ids):
    """Markdown appended to an evidence pack when served: where each in-scope requirement lives, with added links."""
    gh = github()
    at = lambda path, frag="": f"[{path}{frag}]({gh['repo']}/blob/{gh['sha']}/{path}{frag})"  # noqa: E731
    reqs = [r for r in spec["requirements"] if r["id"] in req_ids] or spec["requirements"]
    rows = []
    for r in reqs:
        for s in r.get("symbols", []):
            loc = locate(r.get("files", []), s)
            if loc:
                rows.append((r["id"], "code", f"`{s}` {at(loc[0], f'#L{loc[1]}-L{loc[2]}')}", "safety.json"))
        tl = test_location(r)
        if tl:
            rows.append((r["id"], "test", at(tl[0], f"#L{tl[1]}-L{tl[2]}"), "safety.json"))
        for x in (x for x in links(dev) if x["item"] == r["id"]):
            where = x.get("url") or at(x["path"], f"#{x['anchor']}" if x.get("anchor") else f"#L{x['start']}-L{x['end']}" if x["kind"] != "doc" else "")
            rows.append((r["id"], x["kind"], (f"{x['label']}: " if x.get("label") else "") + where, f"added by {x['by']} ({x['id']})"))
    md = ["", f"## Trace links (live from safety.json and trace/links-{dev}.json at {gh['sha'][:7]})", "",
          "| Requirement | Kind | Target | Source |", "|---|---|---|---|"]
    return "\n".join(md + [f"| {a} | {b} | {c} | {d} |" for a, b, c, d in rows]) + "\n"
