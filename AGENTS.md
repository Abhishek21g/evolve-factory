# Agent instructions (Claude Code, Codex, Cursor)

- Read docs/PLAN.md first. It holds the chosen idea and build plan.
- One agent per branch/worktree. Never edit files another agent is working on.
- Small PRs into `main`. `main` must always run the demo.
- Put the Software Factory Work Order ID (e.g. `WO-12`) in PR titles so it auto-links.
- Secrets live in `.env` (gitignored). Never commit keys, sponsor codes or tokens.
- Prefer simple, boring code. No speculative abstractions. Hackathon: working demo beats polish.

## Learned User Preferences

- The demo must feel instant and always live: no loading screens or visible waits. Slow steps (LLM calls, builds, sims, SF MCP) need pre-warm, caching, background streaming, or a replay fallback.
- No Claude API spend: the Anthropic key stays disabled in `.env`. Verify with `demo/go.sh replay` and recorded runs, not live LLM runs, and don't re-enable the key.
- UI taste: clean and simple (Notion/startup style). The user dislikes busy, boxy, "vibe-coded" layouts and prefers keeping earlier simpler designs over heavy redesigns.
- Wording: Boeing is not a customer (at most "Boeing asked CertusAI about DO-254"); supplier/finance data is labelled sample; say "tested against N cases", not "proven".
- Keep projects isolated: data from one project (e.g. insulin pump) must never show up in another (e.g. Boeing) — audit trail, what-ifs, sims, work orders.
- The repo is public: never commit private CertusAI material (investor names, pricing, deal status, internal paths, coaching notes) or unconfirmed figures.

## Learned Workspace Facts

- GitHub history was rewritten (Nov 14) to remove private docs. Branch new worktrees off a fresh `origin/main`; never push a branch based on the old history (rebase with `git rebase --onto origin/main <old-base>` first).
- Verify gate changes with `.venv/bin/python gate/test_gate.py` (the venv has simglucose for `sim/`).
- Check `.env` keys by name only; never print their values.
- Vercel: the hosted demo is https://certus-factory-ten.vercel.app (project `certus-factory` on account `eabhishek2005-4053`). Deploy only there; never create new projects, and don't use the old account or the stale `certus-factory.vercel.app`.
- `demo/deploy.sh` exports the static snapshot from the running factory server (default the stage on 8787), so hosted matches localhost; without a server it ships the committed `web/public/snapshot` data.
- The stage checkout `~/evolve-factory-stage` serves the demo (`demo/go.sh replay`) on port 8787. Don't restart it from other worktrees; use your own port, and symlink `web/node_modules` from it instead of fresh npm installs.
