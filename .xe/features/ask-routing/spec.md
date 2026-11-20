---
id: ask-routing
title: Ask Routing
author: flanakin
description: "Every question between the owner and an agent is one ask thread with one home. Stack carries each answer to the asking session and wakes it. The owner sees only threads where it is his turn."
dependencies:
  [
    ask-queue,
    task-asks,
    agent-sessions,
    session-inventory,
    goal-model,
    agent-delivery,
  ]
---

<!-- markdownlint-disable single-title -->

# Feature: Ask Routing

## Purpose

The owner talks to hundreds of agent sessions through a few chats. Every question, both ways, shares one channel. So each new event pushes his question out of view, and an answer often never reaches the agent that asked. This feature gives every question one durable thread, addresses it to one session, and delivers every turn to the other side.

## Research (Nov 2026)

How agents ask today:

- `AskUserQuestion` in each chat. The dialog lives in that chat only.
- `stack asks put`: a 🙋 row with context (PR 316). The answer goes to a passive wake file, so the agent must poll.
- Inbox messages on a task (PRs 262, 270, 307) run a fresh headless `claude -p`. They never reach the live session that holds the context.
- Session messages between agents relay his words. Relays drop or reword them.

Where it breaks (session transcripts, Nov 3-20):

1. CoS: "I have multiple questions and they all get overridden by other convos." Peer relays took his turn.
2. CoS: "I'm asking about the gd perm slip." CoS answered a merge-conflict relay instead.
3. CoS: "I already told the Korr session go anyway." He answered in the worker chat; CoS asked again.
4. Stack v2: "These don't match what CoS has." His input to CoS never reached the worker.
5. Stack v2: "are you blocked on me for anything? progress has stalled." The agent idled and did not ask.
6. Sweep: "then why haven't you escalated via AUQ?" The agent sat on a question.
7. CoS: "hundreds of sessions idle, waiting, or stuck without knowing what to do."
8. FH: "Wtf are you asking? … You should not be waiting on me." The ask had no context.
9. Oct 30: "Wrong agent. That was for Xe CoS." He answered in the wrong chat.

Routing primitives:

- Each session knows its own ID: `CLAUDE_CODE_HOST_SESSION_ID` (`local_…`) and `CLAUDE_CODE_SESSION_ID` (Claude Code ID) are in the environment of every tool call.
- Stack can resume a session on this machine (`AgentRuns.prompt({sessionId})`, `FR:agent-sessions/run.prompt`). A busy session refuses with `SessionBusy`.
- The session inventory maps `local_…` IDs to Claude Code IDs and tells `running`/`active`/`idle`.
- Cross-session messages wake idle sessions but exist only inside the desktop app. Stack cannot call them.

Root causes:

- An ask has no address. `from` is a name, so nobody knows which session waits.
- Nothing carries the answer back. The agent must poll or a person must relay.
- No thread per question. All topics share one chat, so turns overwrite each other.
- An ask can have no context, so he must ask "what is this?" first.

## Scope

- In: the agent link and turn on ask rows, owner questions to an agent, agent replies, the courier that delivers each turn and wakes the session, the context rule, CLI, API, MCP, the agent doc.
- Out: owner identity beyond `owner`; sessions on other machines; a second store; push notifications (`notifications`).

## Scenarios

### FR:addr: Every ask has an address

The owner needs each ask tied to the session that waits on it so that the answer can go back to that session.

- **FR:addr.link** (P1): An ask row MAY have `> agent: [Name](#<session id>)` (`FR:goal-model/agent.link`). It names the agent side of the thread
- **FR:addr.env** (P1): `stack asks put` and `stack asks reply` MUST set `agent` from the caller's environment when `--agent` is absent: `CLAUDE_CODE_HOST_SESSION_ID` when it starts `local_`, else `local_<CLAUDE_CODE_SESSION_ID>`. The name is `--from`. No ID: no link. The session that writes last is the one that waits, so each write sets the link
- **FR:addr.api** (P1): `POST /asks/{key}`, `POST /asks/{key}/reply`, and the MCP `asks_put` and `asks_reply` accept `agent` as a link string. A value that is not a link is `422`. A token MUST NOT set it (`403`): a token's session is not on this host, and its link could make Stack prompt any local session. The stdio MCP server fills it from its own environment (`FR:addr.env`) when absent
- **FR:addr.context** (P1): A new ask from an agent (CLI, API token) MUST have `why`, else `422` with `why is required: say what you need and why in one line`. The MCP `asks_put` requires `from` and `why` on every call (the stdio server writes as the owner session)

### FR:turn: Whose turn it is

The owner needs to see only the threads where he must act so that nothing waits on him unseen and nothing he cannot act on distracts him.

- **FR:turn.derive** (P1): Each listed ask has `turn`: `owner`, `agent` or `none`
  - Agent ask (`from` is not `owner`): `open` is `owner`, `answered` is `agent`, `done` is `none`.
  - Owner question (`from` is `owner`): `open` is `agent`, `answered` is `owner`, `done` is `none`.
- **FR:turn.list** (P1): `listAsks` MUST accept `turn` and return only those asks. The open count on the page counts `turn: owner` only

### FR:ask: The owner asks an agent

The owner needs to ask one agent one question in its own thread so that no other chat can bury it.

- **FR:ask.put** (P1): The owner MAY put an ask with `from: owner`, `kind: answer`, the question as `ask`, and `agent` (required). Only the owner page may write `from: owner`: a token, the CLI, and MCP are refused (`403`)
- **FR:ask.follow** (P1): On an owner question with `turn: owner`, the owner's `reply` or `ask` answer adds `- <iso> you: <text>` to the thread and gives the turn back to the agent (`open`). His `done` answer closes it (`done`)
- **FR:ask.close** (P1): Only the owner closes or reopens his own question: `handle` by anyone else is `403`

### FR:reply: The agent replies in the thread

The agent needs one command to answer in the thread so that its answer lands where the question is.

- **FR:reply.cmd** (P1): `replyAsk(key, text, actor)` adds `- <iso> <actor>: <text>` to the thread. Text is one line, 1-1000 characters
  - Owner question with `turn: agent`: sets `answer: reply`, `text`, `answered`; state `answered`.
  - Agent ask, `answered`: reopens it (`FR:ask-queue/flow.handle` `reopen`).
  - Agent ask, `open`: adds the line only (more context).
  - `done`: `409`.
  - A token replies only on asks it wrote, never on an owner question (`403`).
- **FR:reply.surfaces** (P1): CLI `stack asks reply <key> --from <agent> --text "…"`, API `POST /asks/{key}/reply` (`tasks:write`), MCP `asks_reply`

### FR:deliver: Stack carries each turn to the session

The owner needs every answer to reach and wake the asker so that he never relays and the agent never polls.

- **FR:deliver.pick** (P1): A courier pass MUST pick each ask with `turn: agent`, an `agent` link, and neither `delivered` nor `undelivered`
- **FR:deliver.reset** (P1): Every write that gives the turn to the agent, reopens a done ask, or changes `agent` MUST remove `delivered` and `undelivered`
- **FR:deliver.find** (P1): The session is the inventory session whose ID is the link ID, or whose Claude Code ID is the link ID without `local_` (`sessionAlive`). None: write `undelivered: Session gone` and the thread line `- <iso> stack: not delivered (Session gone)`. The wake file stays (`FR:ask-queue/wake.write`). A session with no Claude Code ID is `undelivered: Session has no Claude Code id`: a desktop ID never resumes
- **FR:deliver.busy** (P1): A session that is `running`, has a Stack run in flight, shows an open dialog (reason `question` or `permission`), or refuses with `SessionBusy`, is skipped this pass and tried on the next. A busy check writes nothing. A session that waits on the owner after its turn (`waiting`, reason `blocked`) is the main target and is resumed
- **FR:deliver.wake** (P1): Else Stack resumes the session (`AgentRuns.prompt({sessionId})`) with the delivery prompt and `allowedTools` `Bash(stack asks handle:*)` and `Bash(stack asks reply:*)` (the loop-closing commands; every other tool still becomes a permission ask, `FR:agent-sessions/perm.ask`), then writes `delivered: <iso>` and `- <iso> stack: delivered to <Name>`. Any other error writes `undelivered: <reason>` (one line, 200 characters)
- **FR:deliver.prompt** (P1): The prompt is fixed text plus the ask:
  - Agent ask: `Stack: the owner answered your ask <key> ("<ask>"): <answer word>[: "<text>"]. Act on it now, then run: stack asks handle <key> --outcome handled --note "<what you did>". To ask back: stack asks reply <key> --text "…". Never ask in chat.`
  - Owner question: `Stack: the owner asks you (<key>): "<question>"[ Thread: "<last 5 lines>"]. Answer in one reply: stack asks reply <key> --text "…". Never answer in chat.`
- **FR:deliver.fallback** (P1): When the run for an owner question ends and the ask is still in the same turn (`delivered` unchanged), Stack posts the run's final text (one line, 1000 characters) as the agent's reply (`FR:reply.cmd`). An empty text posts nothing
- **FR:deliver.loop** (P1): `stack web` runs a pass every 15 s and once at start, only when it has agent runs and an inventory, never in demo mode. Passes never overlap
- **FR:deliver.once** (P1): One ask is delivered at most once per turn, also with two writers on one repo: the claim (`delivered`) is written before the prompt, under the repo write lock and the row's version, and only the writer that set it prompts

### FR:ui: One page for every thread

The owner needs one page that shows only his turns, with each thread's context and state, so that he answers in one action and never hunts across chats.

- **FR:ui.mine** (P1): The Asks page and its count MUST list `turn: owner` asks only, ranked (`GET /asks?turn=owner`). An answered owner question shows as `<Agent> replied` with the reply text
- **FR:ui.waiting** (P1): Under the list, a collapsed `Waiting on agents (<n>)` group MUST list `turn: agent` asks. Each card shows the agent name and one status chip: `Delivered <time ago>` (`ok`), `Not delivered: <reason>` (`bad`), or `Sending…` (`neutral`) when neither is set. Nothing in the group asks him to act
- **FR:ui.thread** (P1): A card's detail MUST show the thread (oldest first, the newest 5 lines, `Show all` for the rest), each line as `<who>: <text>` with its time. `stack:` lines are muted
- **FR:ui.reply** (P1): On an answered owner question the card offers `Done` (closes it) and `Reply` (opens the reply box). The reply box keeps an editable draft and sends only on an explicit `Send to <Agent>` click or Enter; it never sends on its own (`FR:ui-kit/send.box`)
- **FR:ui.ask** (P1): `Ask an agent` at the top of the page MUST open a form: an agent picker (live sessions from the inventory, newest first, named by title) and a question box, sent only by `Send to <Agent>`. Sending puts an owner question (`FR:ask.put`) with a new key `q-<yyyymmdd>-<4 hex>` and the picked session as `agent`
- **FR:ui.kit** (P1): The page uses only `ui-kit` components; a new piece of UI is a new reusable component. Muted cards, one accent, whole-card click, buttons named by their effect, readable at 375 px and on desktop, in light and dark

### FR:doc: Agents ask there and nowhere else

The owner needs every agent to use one channel so that every question lands in one place.

- **FR:doc.snippet** (P1): `docs/asks.md` MUST open with a paste-ready rule block: never `AskUserQuestion` or chat to ask the owner; put an ask with `why`, `recommend`, and a link; end the turn when blocked; Stack resumes the session with the answer; reply with `stack asks reply`

## Data Model

New ask row metadata (all `> key: value`, `FR:task-asks/format.fields`):

- `agent`: `[Name](#<session id>)`, the agent side of the thread.
- `delivered`: ISO time Stack woke the session for this turn.
- `undelivered`: why Stack could not, one line.

`ListedAsk` adds `turn`.

## Decisions

- **Resume, not a new store or socket**: Stack reuses the session resume path the dashboard uses. The desktop messaging socket is private and undocumented.
- **Turn, not new states**: the three ask states stay. `turn` is derived, so old rows need no migration.
- **Owner questions are ask rows**: one store and one page for both directions. 🙋 still marks a human step: the owner reads each answer.
- **Fallback reply**: an agent that forgets `stack asks reply` still answers, because its final text is posted.
- **Follow-up**: a resumed run keeps the dashboard's permission rules, so a tool call beyond `stack asks` waits for a permission ask. Running it in the session's own permission mode is the next slice.
- **Known limit**: a host that stops between the claim and the prompt loses that turn's delivery; the wake file still has it.
- **Known limit**: resuming a session that is open but idle in the desktop app adds the turn to its transcript. The app may show it only after a reload.
- **Live check (Nov 19)**: a throwaway terminal session put an ask; the owner's `go` on `stack web` resumed it 3 s later with the prompt above, and the agent ran `stack asks handle`.

## Architecture Constraints

- One parser and one writer: the ask core (`src/core/asks.ts`). The courier writes only through it.
- The courier depends on `AgentRuns` and the inventory reader only (injected), so tests start no process.

## External Dependencies

None
