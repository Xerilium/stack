---
features: [agent-sessions, agent-team]
status: in-progress
created: 2026-11-01
last_updated: 2026-11-01
---

<!-- markdownlint-disable no-duplicate-heading -->

# Rollout: agents-org

## Active State

**Model**: Michael's first-use feedback on the Agents experience, six items, split across two specs. `agent-sessions` owns the sessions list, drawer, pins, project scope (which repo belongs to which Stack project), priority order, usage-not-cost, and the prompt-first new-session composer. `agent-team` owns the team model (now also `.claude/agents/*.md`, a reporting line, the roll-up CoS first on every task, stale metadata-only agents dropped), the org tree on the Agents page, and the agent picker in the new-session composer. Both specs move to the current template (scenario openers, one MUST per FR, Data Model / Architecture Constraints / External Dependencies).

**Decisions**:

- Roll-up CoS first in every task's agent list and the default `To` — rejected keeping the most specific agent first (Michael: the CoS owns all tasks and sits at the top).
- Reporting line = explicit `reports-to`, else the narrowest agent whose projects strictly cover the agent's, else the roll-up — rejected parsing "Reports to …" out of prose.
- Session ↔ Stack project from project metadata (`Repos`, `Repository`, name, aliases, `<alias>-` prefix) on the server — rejected a client-side guess.
- Tokens are the number; dollars stay as a muted list-price line in the Usage panel — rejected dropping dollars entirely (relative weight is still useful).
- Agent-first composer uses Cmd/Ctrl+Enter; the drawer's message box keeps Enter (chat) — rejected changing both.

**Open**: None

**Next**: Phase 1: rewrite both specs in the current template; run `npx catalyst check` on each; commit.

**Pins**:

- `src/core/agents.ts:118-150` — listTeam (files + metadata)
- `src/core/agents.ts:169-177` — agentFor (specificity order)
- `src/api/handler.ts:552-566` — sessions.new (cwd rules)
- `web/src/SessionsView.tsx:121-215` — the view: order, groups, keys
- `web/src/pins.ts` — pins and by-project grouping
- `web/src/team.ts:29-35` — agentsFor (mirror of the server)
- `web/src/home.ts:54-60` — project priority order (home2.order)

**Assumptions**:

- PR 70 (`xe/batched-sync`) lands before this one; the catalyst 0.3.3 bump is cherry-picked here so the two merge cleanly.
- PR 66 (`xe/agent-thread`) is not merged; its `RowDetail.extra` thread is out of scope here.

## Overview

Rework the Agents experience after Michael's first use: the team model reads his real agent definitions (`.claude/agents/*.md`) and puts the roll-up Chief of Staff first on every task; the Agents page shows the reporting structure as a tree, orders by project priority with pins as a fallback, shows only sessions tied to Stack projects (or pinned), reads tokens as usage instead of a bill, and starts a session agent-first and prompt-first. Branch `xe/agents-org`, autonomous mode, PR `[Stack][Change] …`.

## Run 1: agents-org

> **Execute**: `/catalyst:change agent-sessions agent-team — Agents rework: CoS first, org tree, usage, priority order, project scope, agent-first composer`

### Pre-implementation

- [x] Branch `xe/agents-org` from `origin/main` with the catalyst 0.3.3 bump from PR 70

### Features

#### agent-sessions

- [ ] Spec in the current template
- [ ] Failing tests with `@req`
- [ ] Code
- [ ] `npx catalyst check` / `traceability` clean

#### agent-team

- [ ] Spec in the current template
- [ ] Failing tests with `@req`
- [ ] Code
- [ ] `npx catalyst check` / `traceability` clean

### Post-implementation

- [ ] Designer screenshot loop on real data (desktop + phone, light + dark) in the shared notes folder
- [ ] PR + `/catalyst:pr-loop`
- [ ] Present work for review
- [ ] Route external issues discovered during implementation

## Notes

- Downstream impact: `npx catalyst deps --reverse` reports none for either feature on main (web-shell's `@req FR:agent-sessions/web.view` is on PR 70's branch); the touched FR ids there (`web.view`) keep their meaning.
- Same-scenario traceability gaps at scope time: none (both features at 100%).
- Michael's feedback (verbatim intent), Nov 1 2026: (1) CoS missing from the task's agent list, stale agents present; (2) show the reporting structure; (3) `$` is unclear and wrong per agent, one prepaid account; (4) pins are a fallback, order by project/task priority, project-tied agents only by default; (5) new-session flyout: pick an agent, folder follows from the project, prompt first, Cmd/Ctrl+Enter; (6) sessions from repos no Stack project owns must not show unless pinned.
- Michael's repo needs no change for the defaults: `cos` is the roll-up by convention. For a tighter picture he can add `reports-to:` and `scope:` to `.claude/agents/*.md` and a `- **Repos:**` line to a project file (e.g. `allyte`: `finops-hubs, allyte-web`).

## Final Review

- [ ] Confirm all runs complete — no unchecked tasks, no unresolved blockers in Notes
- [ ] Clean up temporary files and this rollout plan
- [ ] Close out — commit, PR, or defer
