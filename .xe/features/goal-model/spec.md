---
id: goal-model
title: Goal Model
author: flanakin
description: "⭐️ marks Now, dated ⛔️ and ⏰ hide work until its date, goal files carry frontmatter, and agents are session links that inherit down the tree."
dependencies: [task-structure, task-ids, agent-team, priorities-tables, task-lint]
---

<!-- markdownlint-disable single-title -->

# Feature: Goal Model

> Status: built (PR 4). The end-to-end validation issue is filed separately and is not part of this feature.

## Purpose

The owner's model is simpler than today's code: one priority mark (⭐️ = Now), dates on the marks that already exist, file-level settings in frontmatter, and one agent rule: an agent is a session link, inherited down the tree.

## Scope

- In: ⭐️ priority, dated ⛔️ and ⏰, goal-file frontmatter, a per-file emoji legend, agent links and their inheritance, agent lint.
- Out: UI redesign, scoring changes beyond these marks, end-to-end validation, cross-device sessions.

## Owner and agents

- There is no `owner` key. The owner owns every task by default. A task is agent-owned only through an agent.
- An agent is a markdown link whose target is a session: `[Name](#local_<id>)`. The session ID is the truth; the name is only a label. Messages address the session by ID.
- Session IDs are machine-local. There is no registry, cache, role, or scope field.
- A lead agent may also name a definition to start a replacement session: `agent-def: <path from repo root>` (any path, for example `plugin/agents/x.md` or `.claude/agents/x.md`). No `agent-def` means no automatic restart.

Goal file (`agent` and `agent-def` also go in a folder default, `<folder>/.stack/agent.md`, as frontmatter):

```markdown
---
aliases: [stack, stack-app]
agent: "[Stack architect](#local_5c1e0a)"
agent-def: .claude/agents/stack-architect.md
legend:
  🧪: needs a live test
---

# Stack v2

## 🔄 Active

- [ ] ⭐️ Ship v2
  > id: ship-v2
  - [ ] Write the release note
    > agent: [Docs writer](#local_9f2b11)
```

No key has `_`. The parser still reads today's `- **Aliases:** a, b` bullets.

## Scenarios

### FR:pri: Priority and dates

- **FR:pri.now** (P1): ⭐️ on a task row MUST mean Now: it ranks the row first in its project and in the Now list
- **FR:pri.tiers** (P2): The parser MUST still read 1️⃣-3️⃣, but no schema, report, or gap text may require them (for example, the priorities gap text MUST NOT ask for a 1️⃣/2️⃣/3️⃣ task)
- **FR:pri.blocked-until** (P1): `⛔️ <yyyy-mm-dd>` MUST mean blocked until that date. `⛔️` with no date keeps today's meaning. `> blocked:` (task IDs) stays a separate field
- **FR:pri.start** (P1): `⏰ <date>` MUST mean the planned start date
- **FR:pri.hide** (P1): A row with a ⛔️ date or a ⏰ date MUST NOT show in the Now, Today, and Next views before that date. There is no mode that shows it early
- **FR:pri.sweep-rows** (P1): The date sweep MUST change only open `- [ ]` task rows; checked rows, notes, and frontmatter stay as they are

### FR:front: Frontmatter

- **FR:front.parse** (P1): A goal file MAY start with YAML frontmatter; the parser MUST read `aliases` (list), `agent` (a session link), `agent-def` (a repo path), and `legend` (emoji to meaning), and keep unknown keys
- **FR:front.strict** (P1): A leading `---` block MUST be frontmatter only when each non-blank, non-indented line in it is `key:`; else it is markdown and its tasks parse as before
- **FR:front.bullets** (P1): The parser MUST still read `- **Aliases:**` bullets; frontmatter wins when both exist
- **FR:front.roundtrip** (P1): Reading frontmatter MUST NOT change a byte
- **FR:front.legend** (P2): A legend emoji MUST be shown with its meaning in that file's tasks; it never changes ranking

### FR:agent: Agents

- **FR:agent.link** (P1): An agent value MUST be a markdown link `[Name](#local_<id>)`; the ID is the session, the name only a label
- **FR:agent.inherit** (P1): A task's agent MUST resolve in this order: the task's `> agent:`, its parent tasks' `> agent:`, the goal file frontmatter `agent`, `<folder>/.stack/agent.md` frontmatter `agent`, then the same file in each ancestor folder up to `tasks/`. A task `> agent:` only overrides
- **FR:agent.none** (P1): A task with no resolved agent is the owner's
- **FR:agent.restart** (P2): When a lead agent's session is gone and its level has `agent-def`, Stack MUST start a new session from that definition and update the link at that level; with no `agent-def`, Stack MUST NOT start one
  - **FR:agent.restart.live** (P1): A link MUST count as live when the agent runs' session list has its ID; one link MUST restart at most once per process
  - **FR:agent.restart.level** (P1): The restart guard MUST key on the lead's level file (goal file or folder default), so goal files under one folder default start at most one session
  - **FR:agent.restart.to** (P1): Stack MUST restart a lead only when the work goes to that lead, not to another agent (for example the roll-up)

### FR:lint: Agent lint

- **FR:lint.lead** (P2): `stack lint` MUST warn (not fail) on a goal file with no lead agent from frontmatter or folder defaults; such a file is the owner's
- **FR:lint.duplicate** (P1): `stack lint` MUST fail when one agent name links to two session IDs, or one session ID has two names
- **FR:lint.dead** (P2): `stack lint` MUST warn when an agent link's session is archived or missing on this machine, naming the file and the fix (relink, or add `agent-def` to restart)
- **FR:lint.agent-def** (P2): `stack lint` MUST warn when `agent-def` names a file that does not exist

## Architecture Constraints

- One frontmatter reader in the parser; no new YAML dependency (a small reader for the keys above is enough).
- Session lookup is local to the machine (the session store Stack already reads).

## Decisions

Closest safe versions, taken while building:

- **Dates hide through the marks that already park a row.** Rank already parks every ⛔️ and ⏰ row. The sweep (`stack update --sweep`, and the refresh after each CLI write) now removes a due `⛔️ <yyyy-mm-dd>` and a due `⏰ <yyyy-mm-dd>`, as it already did for `⏰ Nov 12:`; the row shows from that day. My day, the priorities report, and the web Now read the date directly. A bare ⛔️ is never removed.
- **⏰ takes both forms.** `⏰ <yyyy-mm-dd>` (a colon may follow) and the older `⏰ Nov 12:`. The lint does not read either date as status text.
- **⭐️ orders; it does not score.** ⭐️ rows, and rows under a ⭐️ parent, move to the front of the rank and of their project, in score order. Scores do not change. A ⭐️ row shows outside its time block (like a `top` rule); a parked or dated row stays hidden. In the priorities report, a ⭐️ line counts as a today task.
- **Restart writes the driver's session ID.** The agent driver returns a Claude Code session ID, not an app `local_` ID. Stack writes `[Name](#local_<that id>)`. A link is live when an app session has its ID, or when `local_<Claude Code id>` of a session is equal to it.
- **`agent-def` belongs to a lead level only.** Restart reads `agent-def` from the goal frontmatter or the folder default that gave the link. A task `> agent:` link has no restart. The definition path must stay inside the repo.
- **Restart runs only where Stack delivers work.** The delivery pass restarts a gone lead (once per level file per pass, once per link per process) just before it runs a message that goes to that lead. A session the agent runs started is live through the driver's session list. It runs only on a host with agent runs (`stack web`). Reads never restart.
- **The lead warning hits every file with no lead.** Each goal file with no frontmatter `agent` and no folder default warns once (`agent-lead`). One `tasks/.stack/agent.md` with `agent` clears every file below it.
- **Tests never read the developer's session store.** `tests/setup-env.ts` points `STACK_SESSIONS_DIR` at a missing folder, so the dead-link check skips unless a test sets a folder.
