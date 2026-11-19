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
- **Chief of Staff (CoS) Agent**: An agent that tracks the owner's projects, routes work to other agents, and brings the owner only the decisions, as asks. The Sweep Manager is the CoS agent that works open PRs in the owner's order.
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

### FR:needs-you: Needs you

Owner needs one ranked list of what only the owner can decide so that agents and messages never bury a decision. Features: [ask-queue](features/ask-queue/spec.md), [cos-view](features/cos-view/spec.md), [now-screen](features/now-screen/spec.md).

### FR:my-day: My day

Owner needs a plan for the day around meetings, from wake to bed, so that the next task fits the time until the next commitment. Features: [home](features/home/spec.md), [schedule](features/schedule/spec.md), [day-inputs](features/day-inputs/spec.md), [web-app](features/web-app/spec.md) (`FR:today`).

### FR:priorities: Owner priorities

Owner needs their ordered priorities to rank first in every list so that the most important work is always next. Features: [pri-first-ranking](features/pri-first-ranking/spec.md), [pris-aware-ranking](features/pris-aware-ranking/spec.md), [pris-sessions-ui](features/pris-sessions-ui/spec.md).

### FR:inbox-zero: Inbox zero

Owner needs mail to become asks or reply drafts, never sent mail, so that the inbox reaches zero without a manual pass. Features: [email-triage](features/email-triage/spec.md), [email-inbox-zero](features/email-inbox-zero/spec.md), [email-runner](features/email-runner/spec.md), [email-voice](features/email-voice/spec.md), [inbox-page](features/inbox-page/spec.md).

### FR:pr-review: PR review

Owner needs to see only the PRs that need the owner, each with one next action and an order the Sweep Manager follows, so that agent PRs move without a manual sweep. Features: [pr-page](features/pr-page/spec.md), [pr-priority](features/pr-priority/spec.md), [github-pr-status](features/github-pr-status/spec.md), [pr-review-lane](features/pr-review-lane/spec.md).

### FR:sessions: Agent sessions

Owner needs to see the agent sessions that wait on the owner or are stuck, with a link to each, so that no agent stalls on a prompt. Features: [agent-sessions](features/agent-sessions/spec.md), [session-inventory](features/session-inventory/spec.md), [pris-sessions-ui](features/pris-sessions-ui/spec.md).

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
