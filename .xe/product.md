# Product Vision

## Purpose

Stack is built with Catalyst. It is the rebuild of Michael's markdown task system ("stack 'em up, burn 'em down"). It keeps tasks in markdown, scores them across projects, and says what to do next, from the CLI, web, REST, MCP, and chat bots. AI works the stack alongside the owner. It is a single-owner tool in v1, not a team tracker. Long term, Stack becomes a feature on top of Xe Prime (not built yet).

## Product Strategy

1. Prove the concept (POC): core and CLI at parity with the legacy system, byte-exact round-trip of existing task files, golden-tested scoring
2. Perfect the user experience (Mainstream): secure access from anywhere with a web app that beats editing text
3. Deliver breakthrough capability (Innovation): MCP, chat bots, and AI triage so agents operate the stack within set autonomy
4. Build extensible foundation (Platform): deployable, documented, free-tier cost
5. Enterprise readiness (Enterprise): multi-user, sharing, database adapter, Xe Prime integration
6. Scale to broader markets (Scale)

## Design Principles

- **Transparent: Work in the open** - Markdown in a private Git repo is the source of truth. Every change is a direct commit, so history is the audit trail and nothing is hidden.
- **Lossless: Never break the legacy format** - Existing task files must round-trip byte-exact. Cleaner formats are added beside the legacy one, never in place of it.
- **Agents never block on a human** - Agents pick the next task, work within the task's autonomy level, and move on. They never merge or deploy, and never wait on approval to keep the stack moving.
- **Secure and free by default** - Deny every unauthenticated request, hash and scope tokens, and stay on free-tier hosting.
- **Prove before replacing** - Scoring changes need parity proof against legacy output. The default stays unchanged unless approved.

## Personas

- **Owner**: The single user who captures, prioritizes, and completes tasks and wants to know what to do next.
- **AI Agent**: An assistant (MCP client, bot, or Claude Code) that adds, triages, and works tasks within the task's autonomy level.
- **Stack System**: The core, storage, and API components that parse, score, and commit tasks.

## Scenarios

### FR:next-task: Next task

Owner needs to see the single best next task so that they act without sorting a list.

### FR:capture: Quick capture

Owner needs to add a task by typing or speaking a sentence so that capture takes seconds.

### FR:lifecycle: Task lifecycle

Owner needs to start, complete, skip, resume, and set properties on tasks, including recurring rows that roll forward, so that the stack stays current.

### FR:summaries: Summaries

Owner needs generated summaries (README, stack, projects, my-day) so that the whole stack reads at a glance.

### FR:anywhere: Access from anywhere

Owner needs a secure web and mobile UI, REST API, and chat entry points so that the stack is reachable from any device.

### FR:agent-work: Agent work

AI Agent needs token-efficient tools to read the next task, add tasks, and complete or triage them within the task's autonomy level so that routine work gets done without the owner.

### FR:parity: Legacy parity

Owner needs the same scoring, formats, and files as the legacy system so that migration loses nothing.

## Customer Journey

See [customer-journey.md](customer-journey.md) for the product-level workflows showing actor interactions and checkpoints.

## Team

**Roles:**

- **Product Manager**: @flanakin
- **Architect**: @flanakin
- **Engineer**: @flanakin

**AI Reviewers:**

- Claude Code
- GitHub Copilot
