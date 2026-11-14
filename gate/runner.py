"""Manual runner: take a Work Order, let an agent implement it in a git worktree, gate it, retry on BLOCKED.

Usage:
  python3 gate/runner.py --wo WO-12 --text "Allow larger meal bolus for adult profile" [--pr]
  python3 gate/runner.py --wo WO-12 --text-file wo.txt

Agent command comes from $AGENT_CMD (default: claude -p ...). The prompt is passed on stdin.
Safety spec is read from the main checkout (trusted), never from the agent's worktree.
Exit code 0 = gate passed, 1 = still blocked after retries.
"""
import argparse
import json
import os
import shlex
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "dashboard"))
import emit as feed  # noqa: E402  dashboard event feed
DEFAULT_AGENT = 'claude -p --permission-mode acceptEdits --allowedTools "Bash(make:*)"'
# Checks come from gate/checks.json in the main checkout (trusted, agents can't edit it).
# Each check is {"name", "cmd"}; cmd may use {root} {repo} {base} {wo} {json} (path for machine-readable output). Exit 0 = pass, else BLOCKED;
# whatever it prints (markdown) goes in the report and is fed back to the agent.

PROMPT = """You are implementing Software Factory Work Order {wo}.

{text}

Rules:
- Code lives in demo/pump/. Run `make -C demo/pump test` before you finish.
- This is a safety-critical insulin pump. Limits in pump.h mitigate hazards listed in demo/pump/safety.json.
- Do NOT edit demo/pump/safety.json, demo/pump/test_*.c or anything in gate/. Those are protected evidence.
- Keep the change small."""

RETRY = """The Safety Gate BLOCKED your change to {wo}. Fix it without weakening any safety requirement.

{report}

Make the smallest change that satisfies the Work Order AND every requirement above."""


def sh(cmd, cwd, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def say(agent, state, msg, **kw):
    """Report to the dashboard. A broken feed must never stop a run."""
    try:
        feed.emit(agent, state, msg, **kw)
    except Exception as e:
        print(f"(dashboard feed unavailable: {e})", file=sys.stderr)


def run_checks(checks, wt, base, wo, gate_json):
    """Run every check (no short-circuit). Returns (all_passed, markdown report)."""
    parts, ok = [], True
    for c in checks:
        cmd = c["cmd"].format(root=ROOT, repo=wt, base=base, wo=wo, json=gate_json)
        p = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True)
        passed = p.returncode == 0
        ok &= passed
        parts.append(f"### {c['name']}: {'PASS' if passed else 'BLOCKED'}\n\n{(p.stdout + p.stderr).strip()}")
    head = "## Checks: PASS" if ok else "## Checks: BLOCKED"
    return ok, head + "\n\n" + "\n\n".join(parts) + "\n"


def run_agent(wt, prompt):
    # Prompt goes on stdin: --allowedTools is variadic and would swallow a trailing prompt argument.
    cmd = shlex.split(os.environ.get("AGENT_CMD", DEFAULT_AGENT))
    p = subprocess.run(cmd, cwd=wt, input=prompt, capture_output=True, text=True)
    return p.stdout[-1500:] + p.stderr[-500:]


def commit(wt, msg):
    sh(["git", "add", "-A"], wt)
    sh(["git", "commit", "-q", "--allow-empty", "-m", msg], wt)


def main(argv=None):
    a = argparse.ArgumentParser()
    a.add_argument("--wo", required=True)
    a.add_argument("--text")
    a.add_argument("--text-file")
    a.add_argument("--base", default="main")
    a.add_argument("--checks", default=os.path.join(ROOT, "gate/checks.json"))
    a.add_argument("--retries", type=int, default=2)
    a.add_argument("--pr", action="store_true", help="push the branch and open a PR with gh")
    args = a.parse_args(argv)
    text = args.text or open(args.text_file).read()
    checks = json.load(open(args.checks))

    wt = os.path.join(ROOT, ".worktrees", args.wo)
    branch = f"wo/{args.wo}"
    if os.path.exists(wt):
        sh(["git", "worktree", "remove", "--force", wt], ROOT)
    sh(["git", "branch", "-D", branch], ROOT, check=False)
    sh(["git", "worktree", "add", "-q", "-b", branch, wt, args.base], ROOT)

    os.makedirs(os.path.join(ROOT, ".runs"), exist_ok=True)
    out = os.path.join(ROOT, ".runs", f"{args.wo}.md")
    prompt = PROMPT.format(wo=args.wo, text=text)
    gate_json = os.path.join(ROOT, ".runs", f"{args.wo}.gate.json")
    coder = os.environ.get("AGENT_NAME", "coder-claude")
    title = text.splitlines()[0]
    say("planner", "done", f'Picked up {args.wo} "{title}"; coder works in its own worktree', wo=args.wo, title=title)
    ok, report = False, ""
    for attempt in range(args.retries + 1):
        n = attempt + 1
        print(f"[{args.wo}] attempt {n}: running agent", flush=True)
        say(coder, "working", f"Attempt {n}: implementing" if n == 1 else f"Attempt {n}: fixing what the gate blocked", wo=args.wo)
        log = run_agent(wt, prompt)
        open(os.path.join(ROOT, ".runs", f"{args.wo}.agent{n}.log"), "w").write(log)
        if "Failed to authenticate" in log:
            say(coder, "blocked", "Agent CLI not logged in", wo=args.wo)
            sys.exit(f"Agent CLI is not logged in. Run `claude` then /login, and retry.\n{log}")
        commit(wt, f"{args.wo}: {text.splitlines()[0][:60]} (attempt {attempt + 1})")
        if sh(["git", "diff", "--quiet", f"{args.base}..HEAD"], wt, check=False).returncode == 0:
            # An empty change must never pass the gate just because nothing was affected.
            say(coder, "blocked", f"Attempt {n}: agent made no changes", wo=args.wo)
            ok, report = False, f"## Checks: BLOCKED\n\nAgent made no code changes. Agent output:\n\n```\n{log[-1200:]}\n```\n"
            print(f"[{args.wo}] attempt {n}: no changes", flush=True)
            prompt = PROMPT.format(wo=args.wo, text=text) + "\n\nYour previous attempt changed nothing. Edit the code."
            continue
        say(coder, "done", f"Attempt {n}: committed", wo=args.wo)
        say("gate", "working", "Running checks", wo=args.wo)
        if os.path.exists(gate_json):
            os.remove(gate_json)
        ok, report = run_checks(checks, wt, args.base, args.wo, gate_json)
        extra = {}
        if os.path.exists(gate_json):
            extra["gate"] = json.load(open(gate_json))
        elif not ok:
            extra["gate"] = {"verdict": "BLOCKED", "rows": []}
        say("gate", "pass" if ok else "blocked", f"Attempt {n}: {'all checks passed' if ok else 'BLOCKED'}", wo=args.wo, **extra)
        print(f"[{args.wo}] attempt {attempt + 1}: {'PASS' if ok else 'BLOCKED'}", flush=True)
        if ok:
            break
        prompt = RETRY.format(wo=args.wo, report=report)

    open(out, "w").write(report)
    print(f"\nreport: {out}\nworktree: {wt} (branch {branch})")
    if ok and args.pr:
        sh(["git", "push", "-u", "origin", branch], wt)
        title = f"{args.wo}: {text.splitlines()[0][:70]}"
        sh(["gh", "pr", "create", "--base", args.base, "--head", branch, "--title", title, "--body", report], wt)
        print("PR opened")
        say("reviewer", "done", f"PR opened for {args.wo}", wo=args.wo)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
