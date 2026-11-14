"""Safety Gate core: git diff -> affected safety requirements -> run their tests -> traceability matrix.

Usage: python3 gate/gate.py --repo PATH --safety safety.json --base main [--head HEAD] [--out report.md]
Exit code 0 = gate passes, 1 = gate blocks merge.

safety.json:
{
  "hazards": [{"id": "H-1", "title": "Insulin overdose", "severity": "S3"}],
  "requirements": [{
    "id": "SR-1", "text": "Single bolus never exceeds 10 U", "hazards": ["H-1"],
    "files": ["src/bolus.c"], "symbols": ["MAX_BOLUS_U"], "test": "make test-bolus"
  }]
}
A requirement is affected when the diff touches one of its files, or a changed line mentions one of its symbols.
"""
import argparse
import fnmatch
import json
import subprocess
import sys


def changed(repo, base, head):
    """Return {file: [changed line text, ...]} for base..head (added and removed lines)."""
    out = subprocess.run(
        ["git", "-C", repo, "diff", "--unified=0", f"{base}..{head}"],
        capture_output=True, text=True, check=True,
    ).stdout
    files, cur = {}, None
    for line in out.splitlines():
        if line.startswith("+++ ") or line.startswith("--- "):
            path = line[4:]
            if path != "/dev/null":
                cur = path[2:] if path[:2] in ("a/", "b/") else path
                files.setdefault(cur, [])
        elif cur and line[:1] in "+-" and not line.startswith(("+++", "---")):
            files[cur].append(line[1:])
    return files


def affected(reqs, diff):
    hits = []
    for r in reqs:
        why = [f for f in diff if any(fnmatch.fnmatch(f, p) for p in r.get("files", []))]
        why += [f"symbol {s}" for s in r.get("symbols", [])
                if any(s in l for lines in diff.values() for l in lines)]
        if why:
            hits.append((r, sorted(set(why))))
    return hits


def run_test(repo, cmd):
    if not cmd:
        return "NO TEST", ""
    p = subprocess.run(cmd, shell=True, cwd=repo, capture_output=True, text=True)
    return ("PASS" if p.returncode == 0 else "FAIL"), (p.stdout + p.stderr)[-2000:]


def report(spec, hits, results):
    hz = {h["id"]: h for h in spec.get("hazards", [])}
    rows = ["| Requirement | Hazards | Triggered by | Test | Result |", "|---|---|---|---|---|"]
    for (r, why), (status, _) in zip(hits, results):
        hzs = ", ".join(f'{h} ({hz.get(h, {}).get("title", "?")})' for h in r.get("hazards", []))
        rows.append(f'| {r["id"]}: {r["text"]} | {hzs} | {"; ".join(why)} | `{r.get("test", "")}` | {status} |')
    ok = all(s == "PASS" for s, _ in results)
    head = "## Safety Gate: PASS" if ok else "## Safety Gate: BLOCKED"
    if not hits:
        head, rows = "## Safety Gate: PASS (no safety requirements affected)", []
    fails = [f'### {r["id"]} {s}\n```\n{log}\n```' for (r, _), (s, log) in zip(hits, results) if s != "PASS"]
    return ok, "\n".join([head, "", *rows, "", *fails])


def main(argv=None):
    a = argparse.ArgumentParser()
    a.add_argument("--repo", default=".")
    a.add_argument("--safety", required=True)
    a.add_argument("--base", default="main")
    a.add_argument("--head", default="HEAD")
    a.add_argument("--out")
    args = a.parse_args(argv)
    spec = json.load(open(args.safety))
    hits = affected(spec["requirements"], changed(args.repo, args.base, args.head))
    results = [run_test(args.repo, r.get("test")) for r, _ in hits]
    ok, md = report(spec, hits, results)
    if args.out:
        open(args.out, "w").write(md)
    print(md)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
