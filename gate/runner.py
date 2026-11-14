"""Manual runner: take a Work Order, let an agent implement it in a git worktree, gate it, retry on BLOCKED.

Usage:
  python3 gate/runner.py --wo WO-12 --text "Allow larger meal bolus for adult profile" [--pr]
  python3 gate/runner.py --wo WO-12 --text-file wo.txt
  python3 gate/runner.py --wo WO-2 [--pr]      # no --text: fetch the Work Order from Software Factory (needs SF_API_KEY)
When the WO comes from Software Factory the runner also sets its status (in_progress, then in_review once the PR is
linked, or blocked if the gate never passes). Status updates never stop a run; failures print a warning.

Agent command comes from $AGENT_CMD (default: claude -p ...). The prompt is passed on stdin.
Safety spec is read from the main checkout (trusted), never from the agent's worktree.
Exit code 0 = gate passed, 1 = still blocked after retries, 3 = checks passed but the PR step failed,
4 = the agent itself could not run (not logged in, usage limit): nothing was built or checked, so no safety decision.
"""
import argparse
import json
import os
import shlex
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "dashboard"))
import emit as feed  # noqa: E402  dashboard event feed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sf  # noqa: E402  Software Factory client
import verdict  # noqa: E402  deterministic verdict layer (Rust when built, Python reference otherwise)
DEFAULT_AGENT = 'claude -p --permission-mode acceptEdits --allowedTools "Bash(make:*)"'
AGENT_DOWN = 4
# Checks come from gate/checks.json in the main checkout (trusted, agents can't edit it).
# Each check is {"name", "cmd"}; cmd may use {root} {repo} {base} {wo} {json} (path for machine-readable output). Exit 0 = pass, else BLOCKED;
# whatever it prints (markdown) goes in the report and is fed back to the agent.

PROMPT = """You are implementing Software Factory Work Order {wo}.

{text}

Rules:
{rules}"""
PUMP_RULES = """- Code lives in demo/pump/. Run `make -C demo/pump test` before you finish.
- This is a safety-critical insulin pump. Limits in pump.h mitigate hazards listed in demo/pump/safety.json.
- Do NOT edit demo/pump/safety.json, demo/pump/test_*.c or anything in gate/ or sim/. Those are protected evidence.
- Every change is also run in a world model: 10 simulated patients (sim/world.py). It must not cause severe hypoglycemia.
- If you add extended delivery, implement the extended bolus interface declared at the bottom of pump.h exactly.
- Keep the change small."""

RETRY = """The Safety Gate BLOCKED your change to {wo}. Fix it without weakening any safety requirement.

{report}

Make the smallest change that satisfies the Work Order AND every requirement above."""


def sh(cmd, cwd, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def publish(wt, branch, base, title, body):
    """Push the branch and open (or update) its PR; return the PR url. Raises RuntimeError with git's/gh's own message."""
    def run(cmd):
        try:
            p = subprocess.run(cmd, cwd=wt, capture_output=True, text=True)
        except FileNotFoundError:
            raise RuntimeError(f"{cmd[0]} not found: install it and put it on PATH") from None
        if p.returncode:
            raise RuntimeError(f"`{' '.join(cmd[:3])}` failed: {(p.stderr or p.stdout).strip()[-600:]}")
        return p.stdout.strip()
    # The runner recreates this branch every run, so replace any leftover remote copy (lease: only the tip we fetched).
    run(["git", "push", "--force-with-lease", "-u", "origin", branch])
    existing = run(["gh", "pr", "list", "--head", branch, "--state", "open", "--json", "url", "-q", ".[0].url"])
    if existing:
        run(["gh", "pr", "edit", existing, "--title", title, "--body", body])
        return existing
    return run(["gh", "pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body]).splitlines()[-1]


def say(agent, state, msg, **kw):
    """Report to the dashboard. A broken feed must never stop a run."""
    try:
        feed.emit(agent, state, msg, **kw)
    except Exception as e:
        print(f"(dashboard feed unavailable: {e})", file=sys.stderr)


def run_checks(checks, wt, base, wo, gate_json):
    """Run every check (no short-circuit), then let the deterministic verdict layer (gate/verdict.py: Rust when built)
    decide from the rule table, the check outcomes, the requirement test results and the world-model results.
    Returns (passed, markdown report, verdict)."""
    parts, outcomes = [], []
    started = time.time()
    for c in checks:
        cmd = c["cmd"].format(root=ROOT, repo=wt, base=base, wo=wo, json=gate_json)
        p = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True)
        passed = p.returncode == 0
        outcomes.append((c["name"], passed))
        parts.append(f"### {c['name']}: {'PASS' if passed else 'BLOCKED'}\n\n{(p.stdout + p.stderr).strip()}")
    rules = next((c["rules"].format(root=ROOT) for c in checks if c.get("rules")), None)
    rules = json.load(open(rules)) if rules else {"hazards": [], "requirements": []}
    gate = json.load(open(gate_json)) if os.path.exists(gate_json) else {"rows": []}
    world_json = os.path.join(ROOT, ".runs", f"{wo}.world.json")  # path set in gate/checks*.json
    world = json.load(open(world_json)) if os.path.exists(world_json) and os.path.getmtime(world_json) >= started else None
    v = verdict.decide(verdict.evidence(rules, outcomes, gate["rows"], world))
    ok = v["verdict"] == "PASS"
    parts += [f"{verdict.label(v)}\n\n" + "\n".join(f"- {r}" for r in v["reasons"])]
    head = "## Checks: PASS" if ok else "## Checks: BLOCKED"
    return ok, head + "\n\n" + "\n\n".join(parts) + "\n", v


def run_agent(wt, prompt):
    # Prompt goes on stdin: --allowedTools is variadic and would swallow a trailing prompt argument.
    cmd = shlex.split(os.environ.get("AGENT_CMD", DEFAULT_AGENT))
    try:  # a hung agent must not hang the factory: whatever it wrote so far still goes through the gate
        p = subprocess.run(cmd, cwd=wt, input=prompt, capture_output=True, text=True,
                           timeout=int(os.environ.get("AGENT_TIMEOUT", "600")))
    except subprocess.TimeoutExpired as e:
        out = e.stdout or b""
        return f"(agent timed out after {e.timeout}s)\n" + (out.decode(errors="replace") if isinstance(out, bytes) else out)[-1500:]
    return p.stdout[-1500:] + p.stderr[-500:]


def commit(wt, msg):
    sh(["git", "add", "-A"], wt)
    sh(["git", "commit", "-q", "--allow-empty", "-m", msg], wt)


def sf_update(sf_wo, action, *a):
    """Best-effort Software Factory write. A failure warns but never stops the run."""
    if not sf_wo:
        return
    try:
        getattr(sf, action)(sf_wo["id"], *a)
        print(f"[SF] {action} {' '.join(a)} ok", flush=True)
    except sf.SFError as e:
        print(f"[SF] warning: {action} failed: {e}", file=sys.stderr)


def main(argv=None):
    a = argparse.ArgumentParser()
    a.add_argument("--wo", required=True)
    a.add_argument("--text")
    a.add_argument("--text-file")
    a.add_argument("--base", default="main")
    a.add_argument("--checks", default=os.path.join(ROOT, "gate/checks.json"))
    a.add_argument("--rules", help="coding-agent rules file (default: the insulin pump's)")
    a.add_argument("--retries", type=int, default=2)
    a.add_argument("--pr", action="store_true", help="push the branch and open a PR with gh")
    args = a.parse_args(argv)
    sf_wo = None
    if args.text or args.text_file:
        text = args.text or open(args.text_file).read()
    else:
        try:
            sf_wo = sf.get_wo(args.wo)
        except sf.SFError as e:
            sys.exit(f"Could not fetch {args.wo} from Software Factory: {e}\nPass --text to run without it.")
        text = sf_wo["title"] + ("\n\n" + sf_wo["text"].strip() if sf_wo["text"].strip() else "")
        print(f"[SF] fetched {args.wo} [{sf_wo['status']}]: {sf_wo['title']}", flush=True)
    checks = json.load(open(args.checks))
    rules = open(args.rules).read().strip() if args.rules else PUMP_RULES

    # Always start from the remote base: a stale local main (e.g. after a history rewrite) breaks the PR later.
    base_ref = args.base
    if sh(["git", "fetch", "-q", "origin"], ROOT, check=False).returncode == 0 and \
            sh(["git", "rev-parse", "--verify", "-q", f"origin/{args.base}"], ROOT, check=False).returncode == 0:
        base_ref = f"origin/{args.base}"
    else:
        print(f"warning: could not fetch origin; using local {args.base}", file=sys.stderr)

    wt = os.path.join(ROOT, ".worktrees", args.wo)
    branch = f"wo/{args.wo}"
    if os.path.exists(wt):
        sh(["git", "worktree", "remove", "--force", wt], ROOT)
    sh(["git", "branch", "-D", branch], ROOT, check=False)
    os.makedirs(os.path.join(ROOT, ".runs"), exist_ok=True)
    out = os.path.join(ROOT, ".runs", f"{args.wo}.md")
    coder = os.environ.get("AGENT_NAME", "coder-claude")

    def not_run(why, detail=""):
        say(coder, "blocked", why, wo=args.wo)
        open(out, "w").write(f"## Agent unavailable\n\n{why}\n\nNo code was written and no check ran.\n\n```\n{detail[-1200:]}\n```\n")
        print(f"[{args.wo}] {why}", file=sys.stderr)
        return AGENT_DOWN

    p = sh(["git", "worktree", "add", "-q", "-b", branch, wt, base_ref], ROOT, check=False)
    if p.returncode:  # e.g. the same WO number is checked out by another checkout of this repo
        return not_run(f"Could not create the agent worktree: {p.stderr.strip().splitlines()[-1][:160]}", p.stderr)

    prompt = PROMPT.format(wo=args.wo, text=text, rules=rules)
    gate_json = os.path.join(ROOT, ".runs", f"{args.wo}.gate.json")
    title = text.splitlines()[0]
    say("planner", "done", f'Picked up {args.wo} "{title}"; coder works in its own worktree', wo=args.wo, title=title)
    sf_update(sf_wo, "set_status", "in_progress")
    ok, report = False, ""
    for attempt in range(args.retries + 1):
        n = attempt + 1
        print(f"[{args.wo}] attempt {n}: running agent", flush=True)
        say(coder, "working", f"Attempt {n}: implementing" if n == 1 else f"Attempt {n}: fixing what the gate blocked", wo=args.wo)
        log = run_agent(wt, prompt)
        open(os.path.join(ROOT, ".runs", f"{args.wo}.agent{n}.log"), "w").write(log)
        down = ("Agent CLI is not logged in" if "Failed to authenticate" in log
                else "Agent CLI usage limit reached" if "hit your" in log and "limit" in log else None)
        if down:  # fix: `claude` then /login, ANTHROPIC_API_KEY in .env, or demo/go.sh replay
            return not_run(f"{down} ({log.strip().splitlines()[-1][:100]})", log)
        commit(wt, f"{args.wo}: {text.splitlines()[0][:60]} (attempt {attempt + 1})")
        if sh(["git", "diff", "--quiet", f"{base_ref}..HEAD"], wt, check=False).returncode == 0:
            # An empty change must never pass the gate just because nothing was affected.
            say(coder, "blocked", f"Attempt {n}: agent made no changes", wo=args.wo)
            ok, report = False, f"## Checks: BLOCKED\n\nAgent made no code changes. Agent output:\n\n```\n{log[-1200:]}\n```\n"
            print(f"[{args.wo}] attempt {n}: no changes", flush=True)
            prompt = PROMPT.format(wo=args.wo, text=text, rules=rules) + "\n\nYour previous attempt changed nothing. Edit the code."
            continue
        say(coder, "done", f"Attempt {n}: committed", wo=args.wo)
        say("gate", "working", "Running checks", wo=args.wo)
        if os.path.exists(gate_json):
            os.remove(gate_json)
        ok, report, v = run_checks(checks, wt, base_ref, args.wo, gate_json)
        gate = json.load(open(gate_json)) if os.path.exists(gate_json) else {"verdict": "PASS" if ok else "BLOCKED", "rows": []}
        gate["checker"] = verdict.checker(v)
        json.dump(gate, open(gate_json, "w"), indent=1)
        json.dump(v, open(os.path.join(ROOT, ".runs", f"{args.wo}.verdict.json"), "w"), indent=1)
        extra = {"gate": gate}
        say("gate", "pass" if ok else "blocked", f"Attempt {n}: {'all checks passed' if ok else 'BLOCKED'}", wo=args.wo, **extra)
        print(f"[{args.wo}] attempt {attempt + 1}: {'PASS' if ok else 'BLOCKED'}", flush=True)
        if ok:
            break
        # Each attempt is a fresh agent session: resend the Work Order and rules, not just the report.
        prompt = PROMPT.format(wo=args.wo, text=text, rules=rules) + "\n\n" + RETRY.format(wo=args.wo, report=report)

    open(out, "w").write(report)
    print(f"\nreport: {out}\nworktree: {wt} (branch {branch})")
    if ok and args.pr:
        title = f"{args.wo}: {text.splitlines()[0][:70]}"
        say("reviewer", "working", "Opening PR", wo=args.wo)
        try:
            pr_url = publish(wt, branch, args.base, title, report)
        except RuntimeError as e:
            print(f"[{args.wo}] PR step failed: {e}", file=sys.stderr)
            say("reviewer", "blocked", f"PR step failed: {e}"[:200], wo=args.wo)
            return 3
        print(f"PR opened: {pr_url}")
        sf_update(sf_wo, "link_pr", pr_url)
        sf_update(sf_wo, "set_status", "in_review")
        say("reviewer", "done", f"PR opened for {args.wo}", wo=args.wo, pr=pr_url)
    if not ok:
        sf_update(sf_wo, "set_status", "blocked")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
