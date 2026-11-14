"""Save a real factory run as the recording that replay mode plays (FACTORY_REPLAY=1, see factory/pipeline.py).

  .venv/bin/python demo/record.py WO-200            # build run of WO-200 -> demo/replay/build.*
  .venv/bin/python demo/record.py whatif            # latest what-if run  -> demo/replay/whatif.jsonl
  .venv/bin/python demo/record.py WO-101 ../other   # record from another checkout's feed and .runs/
Only real runs go in: events are copied from the dashboard feed as they happened, with their real timestamps.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "replay")


def main(target, root):
    evs = [json.loads(line) for line in open(os.path.join(root, "dashboard", "events.jsonl")) if line.strip()]
    os.makedirs(OUT, exist_ok=True)
    if target == "whatif":
        run = [e["run"] for e in evs if (e.get("world") or {}).get("question")][-1]
        rec, kind = [e for e in evs if e["run"] == run], "whatif"
    else:
        run = [e["run"] for e in evs if e.get("wo") == target and e["agent"] == "planner"][-1]
        rec, kind = [e for e in evs if e["run"] == run and e.get("wo") == target], "build"
        git = lambda *a: subprocess.run(["git", "-C", root, *a], capture_output=True, text=True).stdout  # noqa: E731
        diff = git("diff", "--stat", "-p", f"origin/main...wo/{target}", "--", "demo/")
        log = git("log", "--format=%H%x09%an%x09%at%x09%s", f"origin/main..wo/{target}")
        commits = [dict(zip(("sha", "author", "ts", "subject"), c.split("\t"))) for c in log.splitlines() if c.count("\t") == 3]
        if diff:
            open(os.path.join(OUT, "build.diff.txt"), "w").write(diff)
        json.dump(commits, open(os.path.join(OUT, "build.commits.json"), "w"))
        ev = os.path.join(root, ".runs", f"{target}.evidence.md")
        if os.path.exists(ev):
            open(os.path.join(OUT, "build.evidence.md"), "w").write(open(ev).read())
    with open(os.path.join(OUT, f"{kind}.jsonl"), "w") as f:
        for e in rec:
            f.write(json.dumps(e) + "\n")
    print(f"recorded {len(rec)} events ({rec[-1]['t']:.0f}s real time) -> demo/replay/{kind}.jsonl")


if __name__ == "__main__":
    main(sys.argv[1], os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.dirname(HERE))
