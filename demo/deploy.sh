#!/usr/bin/env bash
# Publish the web UI to Vercel (project certus-factory) as a read-only snapshot of this checkout's latest factory state.
# The hosted page shows that state instantly, and goes live by itself when a factory server runs on the viewer's
# machine (it probes http://localhost:8787).
#
#   demo/deploy.sh [project-id]       # needs `vercel login` once
set -euo pipefail
cd "$(dirname "$0")/.."
.venv/bin/python factory/snapshot.py "${1:-}"
(cd web && { [ -d node_modules ] || npm ci --no-audit --no-fund --loglevel=error; } && npm run build >/dev/null)
# Deploy from a folder named after the project; never from web/ (an unrelated Vercel project is called "web").
DIR=.runs/vercel/certus-factory
mkdir -p "$DIR"
rsync -a --delete --exclude .vercel web/out/ "$DIR/"
cd "$DIR" && vercel deploy --prod --yes
