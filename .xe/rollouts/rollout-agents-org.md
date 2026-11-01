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

**Next**: Phase 3: write the failing tests listed under Features (core, api, web unit, e2e), run them, then the code.

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

Scenarios in scope: `FR:sessions.owner` (+ `.repos`, `.worktree`), `FR:sessions.cost` (bucket by owner), `FR:web.scope` (+ `.all`), `FR:web.order` (+ `.project`), `FR:web.pins`, `FR:web.groups`, `FR:web.usage` (+ `.panel`, `.price`; replaces `web.cost`), `FR:web.new` (+ `.submit`, `.context`), `FR:web.view`, `FR:web.drawer`, `FR:web.states`, `FR:web.keys`, `FR:$session`, `FR:$cost`.

- [ ] Tests: `tests/core/repos.test.ts` (ownerOf: Repos, Repository, name, alias, `<alias>-` prefix, case and `_`, worktree forms, tie-break), `tests/agents/runs.test.ts` (sessions carry `owner`; cost buckets by owner), `tests/api/sessions.test.ts` (`cwd` with `agent`/`project` accepted), `web/tests/sessions.test.ts` (usage strip, rows and done line in tokens, price line), `web/tests/pins.test.ts` (order by attention → project rank → recency; scope with pins; group modes `team`/`project`/``), `web/e2e/sessions.spec.ts` (scope + Show all, usage strip and panel, prompt-first composer with Cmd+Enter, `A`/`c`/`n` keys)
- [ ] Code: `src/core/repos.ts` (`repoOf`, `projectRepos`, `ownerOf`), `src/agents/driver.ts` (`projectOf` worktree forms), `src/agents/runs.ts` (owner on sessions, cost by owner), `src/api/handler.ts` (sessions.new accepts cwd with agent), `docs/api/openapi.yaml` (Session.owner), `web/src/sessions.ts` (owner, `usageStrip`, tokens everywhere, `orderSessions`, `scopeSessions`), `web/src/pins.ts` (group mode string), `web/src/useSessions.ts` (`showAll` repos, `start(cwd, text, extra)`), `web/src/SessionsView.tsx` (scope, order, usage, composer), `web/src/sessions.css`, `web/src/App.tsx` (project order from Home, palette entries, help)
- [ ] `npx catalyst check agent-sessions` and `traceability` clean; `@req FR:agent-sessions/web.cost` references moved to `web.usage`

#### agent-team

Scenarios in scope: `FR:agent.path.claude`, `FR:agent.format` (reports-to) + `.claude`, `FR:agent.team` (+ `.order`, `.rollup`, `.reports`), `FR:agent.resolve`, `FR:talk.start.cwd`, `FR:talk.api`, `FR:cli.agents`, `FR:web.chip` (+ `.live`, `.title`), `FR:web.talk`, `FR:org.*`, `FR:compose.*`, `FR:$team-agent`.

- [ ] Tests: `tests/core/storage.test.ts` (`listClaudeAgents`, read ok, write refused, memory + fs), `tests/core/agents.test.ts` (`parseClaudeAgent`, `reports-to` round trip, listTeam order/source/rollup/reportsTo with containment default and cycle break, agentFor roll-up first), `tests/agents/team.test.ts` (startAgentRun `cwd`), `tests/api/team.test.ts` (reportsTo/source in `/team`, resolve order), `tests/cli/agents.test.ts` or existing CLI test (list prints reports-to; add `--reports-to`), `web/tests/team.test.ts` (agentsFor roll-up first + 7-day live filter, `matchAgent`, `orgTree`, chip title chain, `composeDefault`), `web/e2e/team.spec.ts` (chip chain, composer To order), `web/e2e/sessions.spec.ts` (Team tree default, agent rows, Unassigned, pinned marker, `t`/`p` keys, Enter on an agent row opens the composer with it chosen, agent chooser sets the folder)
- [ ] Code: `src/core/storage.ts` (`CLAUDE_AGENT_PATH`, `listClaudeAgents`, write refusal), `src/core/agents.ts` (`parseClaudeAgent`, `reportsTo`, `source`, roll-up, `agentFor`), `src/agents/team.ts` (cwd), `src/api/handler.ts` + `docs/api/openapi.yaml` (TeamAgent fields), `src/cli/run.ts` (agents list/add), `web/src/team.ts` (`agentsFor`, `matchAgent`, `orgTree`, `composeDefault`, chip title), `web/src/useTeam.ts` (live set from sessions), `web/src/SessionsView.tsx` (tree, agent rows, chooser), `web/src/AgentTalk.tsx` (To order), `web/src/team.css`, `web/e2e/mock.ts`
- [ ] `npx catalyst check agent-team` and `traceability` clean

### Post-implementation

- [ ] Designer screenshot loop on real data (desktop + phone, light + dark) in the shared notes folder
- [ ] PR + `/catalyst:pr-loop`
- [ ] Present work for review
- [ ] Route external issues discovered during implementation

## Notes

### Planning record

**Approach**: Server owns the facts that need the task repo (which project owns a repo, who reports to whom, the Claude definitions); the page owns everything that needs the session list (which agent a session matches, staleness, the tree, the order). Pure helpers in `web/src/team.ts` and `web/src/sessions.ts` carry the rules so unit tests cover them without a browser; the view only paints. The team feature layers onto the sessions view through props (`team`, `projectOrder`, a chooser slot in the composer), so `agent-sessions` never imports `agent-team` concepts.

**Planning subagent**: none; the planner already held the full code context from discovery (every touched file was read in this session), so a fresh read-only agent would have re-derived it at higher cost.

**Critique**: checked (1) reverse dependency: the sessions view must not know the team → it takes a grouping and a chooser from props, keyed by `stack.agents.group` values the team feature adds; (2) the `Agents` line parsing already in `listTeam` is reused for metadata agents; (3) `projectOf` worktree forms extended once in `driver.ts` and reused by `repos.ts`; (4) `sessions.new` keeps refusing nothing new: `cwd` must still be absolute and exist; (5) `web.cost` id deprecated, not removed: five `@req` references updated in the same change; (6) staleness lives on the page (the core has no sessions), documented in design-decisions.

**Traceability**: 72/72 FRs in the two specs mapped to a test and a code task above; `@req` deps: task-model/$project, ask-queue/flow.put, web-app/home2.order, storage-git/interface.paths, ai-triage-assist/result.log, agent-sessions/* from agent-team — all exist on main. Gaps: none.


- Downstream impact: `npx catalyst deps --reverse` reports none for either feature on main (web-shell's `@req FR:agent-sessions/web.view` is on PR 70's branch); the touched FR ids there (`web.view`) keep their meaning.
- Same-scenario traceability gaps at scope time: none (both features at 100%).
- Michael's feedback (verbatim intent), Nov 1 2026: (1) CoS missing from the task's agent list, stale agents present; (2) show the reporting structure; (3) `$` is unclear and wrong per agent, one prepaid account; (4) pins are a fallback, order by project/task priority, project-tied agents only by default; (5) new-session flyout: pick an agent, folder follows from the project, prompt first, Cmd/Ctrl+Enter; (6) sessions from repos no Stack project owns must not show unless pinned.
- Michael's repo needs no change for the defaults: `cos` is the roll-up by convention. For a tighter picture he can add `reports-to:` and `scope:` to `.claude/agents/*.md` and a `- **Repos:**` line to a project file (e.g. `allyte`: `finops-hubs, allyte-web`).

## Final Review

- [ ] Confirm all runs complete — no unchecked tasks, no unresolved blockers in Notes
- [ ] Clean up temporary files and this rollout plan
- [ ] Close out — commit, PR, or defer
