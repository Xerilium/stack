---
id: goal-model
title: Goal Model
author: flanakin
description: "⭐️ marks Now, goal files carry frontmatter, and agent names resolve through .stack/agents files."
dependencies: [task-structure, task-ids, agent-team, priorities-tables, task-lint]
---

<!-- markdownlint-disable single-title -->

# Feature: Goal Model

> Status: planned (PR 4; after `task-asks`). The end-to-end validation issue is filed separately and is not part of this feature.

## Purpose

The owner's model is simpler than today's code: one priority mark (⭐️ = Now), file-level settings in frontmatter, and agent names that always resolve to something real.

## Scope

- In: ⭐️ priority, goal-file frontmatter, a per-file emoji legend, agent name resolution and its lint.
- Out: UI redesign, scoring changes beyond reading ⭐️, end-to-end validation.

## Goal file frontmatter

```markdown
---
aliases: [stack, stack-app]
owner: flanakin
agent: stack-architect
legend:
  🧪: needs a live test
---

# Stack v2
```

No key has `_`. The parser still reads today's `- **Aliases:** a, b` bullets.

## Agent files

`.stack/agents/<name>.md` (any level) declares what a name runs as:

```markdown
---
kind: session
target: 5c1e…            # session ID or title
---
```

`kind: definition` targets a `.claude/agents/<file>.md`.

## Scenarios

### FR:pri: Priority

- **FR:pri.now** (P1): ⭐️ on a task row MUST mean Now: it ranks the row first in its project and in the Now list
- **FR:pri.tiers** (P2): The parser MUST still read 1️⃣-3️⃣, but no schema, report, or gap text may require them (for example, the priorities gap text MUST NOT ask for a 1️⃣/2️⃣/3️⃣ task)

### FR:front: Frontmatter

- **FR:front.parse** (P1): A goal file MAY start with YAML frontmatter; the parser MUST read `aliases` (list), `owner`, `agent` (the default agent for the file's tasks), and `legend` (emoji to meaning), and keep unknown keys
- **FR:front.bullets** (P1): The parser MUST still read `- **Aliases:**` bullets; frontmatter wins when both exist
- **FR:front.roundtrip** (P1): Reading frontmatter MUST NOT change a byte
- **FR:front.legend** (P2): A legend emoji MUST be shown with its meaning in that file's tasks; it never changes ranking

### FR:agent: Agent names

- **FR:agent.resolve** (P1): An `agent:` name (frontmatter, task metadata, or the `(agent: …)` tag) MUST resolve through `.stack/agents/<name>.md`, which declares `kind: session|definition` and `target`
- **FR:agent.lint** (P1): `stack lint` MUST flag an agent name that does not resolve, and an agent file whose `kind` or `target` is missing or whose `.claude/agents` target does not exist

## Architecture Constraints

- One frontmatter reader in the parser; no YAML dependency beyond what the repo has (a small reader for the keys above is enough).
