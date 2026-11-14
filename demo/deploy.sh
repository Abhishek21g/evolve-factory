#!/usr/bin/env bash
# Publish the web UI to Vercel (project certus-factory) as a read-only snapshot of a running factory's state.
# The hosted page shows that state instantly (every project, every page), and goes live when opened with ?live while
# a factory server runs on the viewer's machine (it then probes http://localhost:8787).
#
#   demo/deploy.sh                                  # needs `vercel login` once
#   FACTORY_URL=http://localhost:8917 demo/deploy.sh   # export from another factory server
#
# The snapshot is what that server answers (factory/snapshot.py). With no server running, the committed
# web/public/snapshot* is deployed: commit a fresh export so a clean checkout deploys the same content.
set -euo pipefail
cd "$(dirname "$0")/.."
URL=${FACTORY_URL:-http://localhost:8787}
if curl -sf -m 3 "$URL/api/state" >/dev/null; then python3 factory/snapshot.py "$URL"
else echo "deploy: no factory server at $URL, deploying the committed snapshot"; fi
(cd web && { [ -d node_modules ] || npm ci --no-audit --no-fund --loglevel=error; } && npm run build >/dev/null)
# Deploy from a folder named after the project; never from web/ (an unrelated Vercel project is called "web").
DIR=.runs/vercel/certus-factory
mkdir -p "$DIR"
rsync -a --delete --exclude .vercel --exclude '.env*' web/out/ "$DIR/"
cd "$DIR" && vercel deploy --prod --yes
