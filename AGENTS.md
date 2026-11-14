# Agent instructions (Claude Code, Codex, Cursor)

- Read docs/PLAN.md first. It holds the chosen idea and build plan.
- One agent per branch/worktree. Never edit files another agent is working on.
- Small PRs into `main`. `main` must always run the demo.
- Put the Software Factory Work Order ID (e.g. `WO-12`) in PR titles so it auto-links.
- Secrets live in `.env` (gitignored). Never commit keys, sponsor codes or tokens.
- Prefer simple, boring code. No speculative abstractions. Hackathon: working demo beats polish.
