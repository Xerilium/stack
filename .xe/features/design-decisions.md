# Design Decisions: Stack

## Keep tasks as markdown in a private GitHub repo

**Decision**: Markdown files in a private GitHub repo are the source of truth, behind a storage interface.

**Date**: 2026-10-22

**Why**: Markdown stays editable by hand and by agents, and history is the audit trail. The interface leaves room for a database adapter later.

**Rejected**: Database-first (loses editability); GitHub Pages (private Pages is paid, public leaks).

## Host on Azure Static Web Apps free tier with managed Functions

**Decision**: Azure Static Web Apps free tier plus managed Functions, secrets in app settings.

**Date**: 2026-10-22

**Why**: Runs at $0 and fits the free-tier requirement.

**Rejected**: Key Vault (not free); Cloudflare (owner preference).

## Allow-list the owner and use hashed, scoped, revocable API tokens

**Decision**: SWA built-in auth allow-listed to the owner. API tokens are hashed, scoped, and revocable. Single-user in v1.

**Date**: 2026-10-22

**Why**: One owner needs deny-by-default access, not account management.

**Rejected**: Multi-user in v1.

## Support pluggable formatters with the legacy emoji-markdown format as default

**Decision**: Formatters are pluggable. Emoji-markdown (lossless, legacy) and a clean format both ship. Date format `Mon D[, YYYY]` stays in the emoji formatter; internal dates are ISO.

**Date**: 2026-10-22

**Why**: Existing task files must round-trip byte-exact, so the legacy format cannot change.

**Rejected**: Replacing the legacy format.

## Parse both recurring forms and shift weekend due dates to Monday

**Decision**: Canonical form is `📅 date: 🔄 Cadence:`; legacy `🔄 Weekly: 📅 Mondays:` is also parsed; weekday names work. Weekend due dates shift to Monday (config, default on) and the nominal day is kept so rolls do not drift. Rolled rows reset subtasks, monthly clamps to month end, and `Quarterly-EOM+1` is a token. `complete` rolls the row in place.

**Date**: 2026-10-22

**Why**: Matches legacy behavior and prevents date drift across rolls.

**Rejected**: Dropping the legacy form; letting the due date follow the shifted day (drifts).

## Keep scoring pluggable with the legacy formula as default

**Decision**: Pluggable scoring engine, legacy formula by default, verified by golden outputs from legacy. Any redesign goes through a separate bake-off.

**Date**: 2026-10-22

**Why**: Replacing scoring without parity proof risks silent behavior change.

**Rejected**: Replacing the formula without parity proof.

## Read config from legacy `.xe/config/stack.json`

**Decision**: JSON config at the legacy path with baked-in defaults.

**Date**: 2026-10-22

**Why**: Existing setups keep working with no migration.

**Rejected**: A new config location or format.

## Commit edits directly with no PRs

**Decision**: Task edits are direct commits to the repo.

**Date**: 2026-10-22

**Why**: Edits land in seconds and git history is the audit trail.

**Rejected**: PR workflow for task edits (too slow for capture).

## Scope phase 1 to the full product

**Decision**: Phase 1 covers the full product, not only a POC.

**Date**: 2026-10-22

**Why**: The rebuild only replaces legacy once every surface exists.

**Rejected**: A narrow POC first.

## Use pnpm as the package manager

**Decision**: pnpm for installs and scripts (`pnpm run`).

**Date**: 2026-10-22

**Why**: Matches the Catalyst toolchain and gives strict, fast installs.

**Rejected**: npm.

## Build with Catalyst

**Decision**: Stack is built using Catalyst (specs, rollouts, and agent playbooks).

**Date**: 2026-10-22

**Why**: Spec-first, traceable delivery fits the product's own agent-driven model.

**Rejected**: Ad hoc development without specs.

## Plan Stack as a future feature of Xe Prime, not built yet

**Decision**: Long term, Stack becomes a feature on top of Xe Prime. Nothing for Xe Prime is built now.

**Date**: 2026-10-22

**Why**: Stack must ship standalone first; the integration is planned for the Enterprise phase.

**Rejected**: Building on Xe Prime now (not available).

## Agents never block on a human

**Decision**: Agents proceed on their own judgment, record decisions, and never wait on approval. They never merge or deploy. Humans review asynchronously at the PR.

**Date**: 2026-10-22

**Why**: Waiting on a person stalls the stack the product exists to keep moving.

**Rejected**: Human approval gates before implementation.
