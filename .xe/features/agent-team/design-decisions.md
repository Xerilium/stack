# Design Decisions: Agent Team

## The roll-up Chief of Staff is first on every task

**Decision**: `agentFor` lists the roll-up (scope `*`; `cos` by convention when it declares no scope) first, then the most specific agents. The chip, the composer's default `To`, and `startAgentRun` without an explicit agent all use that first agent.

**Date**: 2026-11-01

**Why**: The owner runs a Chief of Staff who owns every task and delegates; a specialist named on a project (a label manager, a PR sweeper) knows the topic but does not manage the task. Handing a task to the specialist by default skipped the person who decides.

**Rejected**: Most specific agent first (the previous rule: the owner's top task showed the label manager and two stale workers, no CoS); the CoS on every row only when no specialist exists (hides the owner's own model).

**Evidence**:

- Owner feedback after first use, 2026-11-01 (rollout `agents-org`)

## Reporting lines come from `reports-to`, else the narrowest covering agent, else the roll-up

**Decision**: An agent reports to the slug its `reports-to` names when it exists; otherwise to the narrowest other agent whose projects strictly contain its own; otherwise to the roll-up. The roll-up reports to no one.

**Date**: 2026-11-01

**Why**: The owner's definitions say "Reports to cos" in prose, which no parser should depend on, and most metadata-only agents name no manager at all. The containment default gives a sensible tree with zero edits (a project's workers under that project's CoS) and one optional line fixes any exception.

**Rejected**: Parsing "Reports to …" from descriptions (fragile, English-only); a flat team with no tree (the owner asked for the org structure); requiring `reports-to` on every agent (his files would all need edits before the page is right).

## Claude agent definitions are read, never written

**Decision**: `.claude/agents/<slug>.md` files join the team through `listClaudeAgents` and `parseClaudeAgent` (frontmatter `name`, `description`, `model`, `tools`, plus Stack's `scope`, `reports-to`, `mode`); the display name is the first H1. Storage refuses writes there; `stack agents add` keeps writing `tasks/agents/`.

**Date**: 2026-11-01

**Why**: The owner's real agents live where Claude Code reads them, and the team must be the team he runs. Those files belong to Claude: Stack writing them would race the editor and the CLI.

**Rejected**: Asking the owner to duplicate each agent as `tasks/agents/<slug>.md` (two copies drift); a one-off import (same drift after the first edit).

## Metadata-only agents drop off a task after 7 days without a session

**Decision**: On the page, an agent named only in a project's `Agents` line is left out of a task's list when no session has matched it (title starts with its name or slug) in the last 7 days. Agents with a file never drop.

**Date**: 2026-11-01

**Why**: `Agents` lines accumulate one-off workers (`PR sweep worker: f4-music`) nobody removes; the owner reads them as stale noise. A file is a deliberate definition; a metadata line is often a note.

**Rejected**: Dropping nothing (the owner's complaint); a server-side rule (the server does not see sessions in the core; the page already has both lists); 14 days (the owner's examples were 9 days old and he called them old).

## The agent-first composer sends on Cmd/Ctrl+Enter; the drawer's message box keeps Enter

**Decision**: The new-session composer (agent, folder, prompt) starts on `Cmd+Enter` / `Ctrl+Enter`; plain `Enter` is a newline. The drawer's message box to an existing session still sends on `Enter` (`Shift+Enter` newline).

**Date**: 2026-11-01

**Why**: A first prompt is a brief, usually several lines; the owner asked for the chord so a stray Enter never sends half of it. A reply to a running session is chat, where Enter-to-send is the habit and the existing tests and spec cover it.

**Rejected**: Changing both to the chord (chat replies would feel broken); keeping Enter on both (the owner's ask).
