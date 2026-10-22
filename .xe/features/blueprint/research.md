# Research: Stack Blueprint

## Hosting decision

| Option | Cost | Private data | Verdict |
| ------ | ---- | ------------ | ------- |
| GitHub Pages | $0 | Private Pages needs Enterprise; public leaks | Rejected |
| Cloudflare Workers + Access | $0 | Yes | Viable; owner prefers Azure |
| Azure Static Web Apps (free) + Functions | $0 | Built-in auth, route rules, app-setting secrets | **Chosen** |
| Key Vault | Paid | n/a | Rejected |

## Storage

Markdown in a private git repo stays the editable truth; git history is audit and backup. Direct commits via GitHub API avoid PRs. Pluggable adapters leave room for DB later.

## Format

Emoji grammar is concise for text but poor for UI users; keep it for legacy compatibility and add a clean formatter. UI replaces typing with pickers.

## Scoring

Keep legacy formula as default for parity; evaluate a redesign in a separate bake-off to avoid risk.

## Competitive notes

Todoist/Things/Linear lack score-driven "next" with capacity and agent autonomy; plain-text tools (todo.txt, Obsidian Tasks) lack hosted multi-surface access. Stack's differentiator: scored next-action + agent-operable + markdown truth.

## Source

Phase 1 interview with the product owner (2026-10-21); legacy specs in `~/dev/todo/.xe/specs`; PRs 5, 6, 7.
