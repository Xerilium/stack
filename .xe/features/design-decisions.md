# Design Decisions

## Product

- **Source of truth**: private GitHub repo of markdown behind a storage interface — rejected DB-first (loses editability) and GitHub Pages (private Pages is paid, public leaks).
- **Host**: Azure Static Web Apps free tier + managed Functions, secrets in app settings — rejected Key Vault (not free), Cloudflare (owner preference).
- **Auth**: SWA built-in auth allow-listed to the owner; hashed, scoped, revocable API tokens — rejected multi-user in v1.
- **Formats**: pluggable formatters; emoji-markdown (lossless, legacy) and clean — rejected breaking the legacy format.
- **Scoring**: pluggable engine, legacy formula default, redesign via separate bake-off — rejected replacing without parity proof.
- **No PRs for edits**: direct commits; history is the audit trail — rejected PR workflow.
- **Agents**: never merge or deploy; per-task autonomy level.

## Review gates (PR 7), resolved

- Date format `Mon D[, YYYY]` kept in emoji formatter; internal ISO.
- Recurring canonical form `📅 date: 🔄 Cadence:`; legacy form `🔄 Weekly: 📅 Mondays:` also parsed; weekday names supported.
- Weekend due dates shift to Monday (config, default on); nominal day retained so rolls do not drift.
- Rolled rows reset subtasks; monthly clamps to month end; `Quarterly-EOM+1` token.
- `complete` rolls the row in place.
- Config at legacy `.xe/config/stack.json`, JSON, baked-in defaults.
- Scoring parity via golden outputs from legacy.
- Phase 1 scope widened to the full product.

## Acceptance criteria

1. Golden parity vs legacy on a copy of real data. 2. Every legacy `tasks/*.md` round-trips byte-exact. 3. Unit + browser e2e green, core coverage ≥ 90%. 4. Security: every unauthenticated request denied, tokens hashed/scoped, no task data in client bundle or logs. 5. Web, CLI, REST, MCP, bot all complete next/add/start/complete/skip/resume/set. 6. Web edit lands as a direct commit in seconds. 7. Free-tier cost. 8. Spec → test → code traceability. 9. README, API/MCP reference, deploy runbook. 10. Scoring bake-off report, default unchanged unless approved.
