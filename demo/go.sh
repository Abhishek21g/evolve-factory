#!/usr/bin/env bash
# One command to get the demo ready: deps, web build, demo project + draft work order, pre-warm, server, health check.
#
#   demo/go.sh            live: real agents (Claude Code), real gate, real world model (~2-5 min per run)
#   demo/go.sh replay     stage-safe: every run plays a recorded real run (demo/replay/), ~35 s, cannot hang
#   demo/go.sh check      health check only
# Env: PORT (default 8787), FACTORY_PR=1 (live runs open a GitHub PR), REPLAY_SPEED (default 4).
# Re-running is safe and fast (~3 s when nothing changed): it rebuilds the UI only if web/ changed,
# restarts the server, and adds a fresh draft work order if the last one was already run.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8787}
MODE=${1:-live}
PY=.venv/bin/python

if [ "$MODE" = check ]; then exec "$PY" demo/health.py "$PORT"; fi
[ "$MODE" = live ] || [ "$MODE" = replay ] || { echo "usage: demo/go.sh [live|replay|check]"; exit 2; }
mkdir -p .runs

# 1. Keys and Python env (a worktree reuses the main checkout's .env and .venv)
main=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
[ -e .env ] || [ ! -f "$main/.env" ] || ln -s "$main/.env" .env
# With ANTHROPIC_API_KEY set, the Claude CLI bills the API instead of the subscription, so its 5-hour limit can't stop a run.
# Only KEY=value lines are loaded, so a stray pasted value can't abort the script (or echo a secret).
if [ -f .env ]; then
  set -a; . <(grep -E '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=' .env); set +a
  bad=$(grep -nvE '^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=|#|$)' .env | cut -d: -f1 | paste -sd, - || true)
  [ -z "$bad" ] || echo "warning: .env line(s) $bad are not KEY=value and were skipped"
fi
if [ ! -x "$PY" ]; then
  if [ "$main" != "$PWD" ] && [ -x "$main/.venv/bin/python" ]; then
    ln -s "$main/.venv" .venv
  else
    python3 -m venv .venv && .venv/bin/pip install -q -r sim/requirements.txt -r factory/requirements.txt
  fi
fi

# 2. Web UI: build only when web/ changed since the last build (a cold build is ~30 s)
if [ ! -f web/out/index.html ] || [ -n "$(find web/src web/public web/package.json -newer web/out/index.html -print -quit)" ]; then
  echo "building web UI..."
  (cd web && { [ -d node_modules ] || npm ci --no-audit --no-fund --loglevel=error; } && npm run build >/dev/null)
fi

# 3. Demo project + a draft work order with the recorded request, so the stage starts one click from "Run"
"$PY" - <<'EOF'
import json, sys
sys.path.insert(0, "factory")
import store
d = store._load()
if not d["projects"]:
    store.create_project("abhishek", "Insulin Pump Firmware", "insulin-pump")
    d = store._load()
first = json.loads(open("demo/replay/build.jsonl").readline())
title, _, desc = first["title"].partition("\n\n")
evs = store.events()
pid = d["projects"][0]["id"]
if not any(w["title"] == title and store.wo_status(w["id"], evs, None)[0] == "Draft" for w in d["work_orders"]):
    w = store.create_wo("abhishek", pid, title, desc)
    print(f"draft work order ready: {w['id']} {title}")
EOF

# 4. Pre-warm: Python imports (simglucose, pandas) and the pump's C build, so the first run starts hot
"$PY" -c "import sys; sys.path.insert(0, 'sim'); import world" 2>/dev/null
make -s -C demo/pump test >/dev/null

# 5. (Re)start the factory server in the background, in the chosen mode
pid=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)
if [ -n "$pid" ]; then
  if ps -o command= -p "$pid" | grep -q factory/server.py; then kill "$pid"; sleep 0.3
  else echo "port $PORT is used by something else: $(ps -o command= -p "$pid")"; exit 1; fi
fi
FACTORY_REPLAY=$([ "$MODE" = replay ] && echo 1 || echo 0) nohup "$PY" factory/server.py "$PORT" > .runs/server.log 2>&1 &
for _ in $(seq 50); do curl -s -o /dev/null "http://localhost:$PORT/api/state" && break; sleep 0.1; done

# 6. Live mode: pre-warm the Home what-if chips in the background, on their own feed so the stage feed stays clean.
#    Afterwards each answers in seconds from its cached real run (factory/pipeline.py recorded()).
if [ "$MODE" = live ]; then
  for q in "What if a child eats 80 g and the parent types the dose 10x?" "What if an adult eats 150 g of carbs?"; do
    env -u RUN_ID -u RUN_T0 EVENTS=.runs/prewarm-events.jsonl "$PY" factory/pipeline.py whatif "$q"
  done > .runs/prewarm.log 2>&1 &
fi

# 7. Health check (live mode also checks that the coding agent is logged in, which warms it up)
"$PY" demo/health.py "$PORT" $([ "$MODE" = live ] && echo --deep)
