#!/usr/bin/env bash
# Demo-doc watcher: polls origin/main; whenever it moves, a headless Claude Code agent updates docs/DEMO.md
# (demo script + video shot list) to match what landed, and the change goes up as one PR from branch demo-doc.
#
#   demo/watch.sh                                        # in its own terminal; Ctrl-C to stop
#   nohup demo/watch.sh > .runs/watch.log 2>&1 &         # background; tail -f .runs/watch.log
#   demo/watch.sh once                                   # one pass now, then exit
# Env: INTERVAL seconds between polls (default 120).
#      WATCH_AGENT_CMD headless agent, prompt on stdin (default Claude Code; when Claude is rate-limited use
#      WATCH_AGENT_CMD="cursor-agent -p --force" after a one-time `cursor-agent login`).
# Works in its own worktree (.worktrees/demo-doc), never in yours. It only ever commits docs/DEMO.md, and skips
# pushes to main that only touched docs/DEMO.md (its own merged PRs).
set -euo pipefail
cd "$(dirname "$0")/.."
# Keys from the main checkout's .env: with ANTHROPIC_API_KEY set, Claude's 5-hour limit can't stall the watcher.
main=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
for f in .env "$main/.env"; do if [ -f "$f" ]; then set -a; . "$f"; set +a; break; fi; done
INTERVAL=${INTERVAL:-120}
AGENT=${WATCH_AGENT_CMD:-'claude -p --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Glob,Grep,Bash(git log:*),Bash(git diff:*),Bash(git show:*)"'}
WT="$PWD/.worktrees/demo-doc"
LAST=.runs/watch.last
mkdir -p .runs

pass() {
  git fetch -q origin main
  local head last range
  head=$(git rev-parse origin/main)
  last=$(cat "$LAST" 2>/dev/null || true)
  [ "$head" = "$last" ] && return 0
  if [ -n "$last" ] && [ -z "$(git diff --name-only "$last" "$head" -- . ':!docs/DEMO.md')" ]; then
    echo "$head" > "$LAST"; return 0
  fi
  range="${last:-$head~5}..$head"
  if [ -d "$WT" ]; then git -C "$WT" checkout -q -B demo-doc "$head" && git -C "$WT" clean -qfd
  else git worktree add -q -B demo-doc "$WT" "$head"; fi

  echo "$(date +%H:%M:%S) main moved to $(git rev-parse --short "$head"); updating docs/DEMO.md..."
  (cd "$WT" && sh -c "$AGENT" > "$OLDPWD/.runs/watch-agent.log" 2>&1 <<EOF
You maintain docs/DEMO.md: the 3-minute stage demo script (exact clicks, commands, on-screen text, timings) and the
backup-video shot list for this repo (Certus Factory / Safety Gate, 8090 EVOLVE hackathon). Read AGENTS.md first.

New commits just landed on main ($range):
$(git log --oneline "$range")

Files changed:
$(git diff --stat "$range")

Read the changes that can affect the demo (web/, factory/, gate/, sim/, demo/, README.md). Update docs/DEMO.md so every
beat, click target, command, URL, on-screen message and timing matches what the code does now. Keep its structure and
the 3-minute length. Keep measured timings unless the new code changes them; label any new number you did not measure
as an estimate. If a new feature is worth showing, fit it into a beat or the shot list instead of making the demo longer.
If nothing affects the demo, change nothing. Edit only docs/DEMO.md. Never edit docs/PITCH.md or any other file.
EOF
  ) && ! grep -q "hit your .*limit" .runs/watch-agent.log || {
    echo "  agent failed (retrying next poll): $(tail -c 200 .runs/watch-agent.log)"
    git -C "$WT" reset -q --hard && git -C "$WT" clean -qfd; return 1; }

  if git -C "$WT" diff --quiet -- docs/DEMO.md; then
    echo "  DEMO.md already current"
  else
    git -C "$WT" add docs/DEMO.md
    git -C "$WT" commit -q -m "Sync DEMO.md with main at $(git rev-parse --short "$head")"
    git -C "$WT" push -q -f -u origin demo-doc
    url=$(gh pr list --head demo-doc --state open --json url -q '.[0].url')
    [ -n "$url" ] || url=$(gh pr create --base main --head demo-doc --title "Demo script: sync docs/DEMO.md with main" \
      --body "Automatic update by demo/watch.sh after main moved ($range). Only docs/DEMO.md changes.")
    echo "  DEMO.md updated: $url"
  fi
  git -C "$WT" reset -q --hard && git -C "$WT" clean -qfd
  echo "$head" > "$LAST"
}

if [ "${1:-}" = once ]; then pass; exit; fi
echo "watching origin/main every ${INTERVAL}s (Ctrl-C to stop)"
while true; do pass || echo "  pass failed (will retry)"; sleep "$INTERVAL"; done
