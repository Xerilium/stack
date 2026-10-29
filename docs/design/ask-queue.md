# Live ask queue: design

Spec: [.xe/features/ask-queue/spec.md](../../.xe/features/ask-queue/spec.md). Email module: [.xe/features/email-triage/spec.md](../../.xe/features/email-triage/spec.md). Agent contract: [docs/asks.md](../asks.md).

## Problem

Michael runs three companies through Chief of Staff (CoS) agents. Chat messages overwhelm him. He wants one page that is his only interface to them: only the top asks, each with one exact ask, a deadline, a link, a recommendation, and what happens if he stays silent. It updates by itself, like a dev server reloading. He answers there (approve, decide, go, defer, reply, ask) instead of in chat.

## Principles

1. **Agents work; the page shows decisions.** No feed, no status, no play-by-play. Everything else is hidden until asked (details, `Show n more`, `Sent`, `Snoozed`).
2. **Files are the bus.** Agents write ask files; the owner's answer is written back into the same file. No chat transcript is read. State survives any session or agent (charter: "keep state in files so any CoS can resume").
3. **One ask, one recommendation, one default.** Every ask is a decision with a stated default-if-silent. The default is applied by the agent, never by Stack, and shown only for reversible asks (charter: silence never decides irreversible, costly, or external actions).
4. **Agents never answer for the owner.** `answer` is owner-session only: an API token or any hosted non-owner caller gets `403`. In `stack web` a loopback request without a token is the owner's own page, so a local agent must present its token when it calls the api (and must never edit `answer`/`state` in an ask file by hand). The guard is a contract for agents, not a sandbox.
5. **Quiet by design.** No toast, sound, or badge for incoming asks. A new ask fades in with a dot for 6 seconds. The tab title carries the count for a glance.

## Data model

One markdown file per ask: `tasks/asks/<key>.md` (`- key: value` lines, optional `## Detail`, `## Thread`). The key is chosen by the agent and stable, so re-writing it updates the ask (idempotent agents; email conversation id is the key).

States: `open` (visible unless snoozed) → `answered` (owner replied; waiting on the agent) → `done` (agent `handled`, `resolved`, or `defaulted`). An agent can `reopen` with a one-line reply to a question.

Rank is a deterministic score computed by Stack (`scoreAsk`): priority + deadline pressure + what it unblocks + quick wins + irreversibility + age. Agents set facts (priority, `by`, `blocks`, `effort`); they do not set the score, so ranking stays consistent across agents and explainable.

## Event flow

```text
agent (CoS, email module)           todo repo / served folder                 stack web                          browser
        │ stack asks put / POST /asks/<key>   │                                  │                                  │
        ├────────────────────────────────────▶ tasks/asks/<key>.md  ────────────▶ fs.watch (150 ms coalesce)       │
        │                                      │                                  ├── SSE change {rev, kinds:[asks]} ▶ refetch GET /asks, re-render in place
        │                                      │                                  │                                  │ owner presses Enter / types a reply
        │                                      │ ◀── POST /asks/<key>/answer ◀────┤◀─────────────────────────────────┤ (row leaves at once, Undo 8 s)
        │ stack asks list --state answered     │ state: answered, answer, text    ├── SSE change ───────────────────▶ footer shows "Sent (1)"
        ├────────────────────────────────────▶ read, act                          │                                  │
        │ stack asks handle <key> --outcome handled                               │                                  │
        └────────────────────────────────────▶ state: done                         └── SSE change ───────────────────▶ footer clears
```

- **Watcher** (`src/cli/watch.ts`): `fs.watch` recursive on the served folder, classify path (`asks`, `tasks`, `state`), coalesce bursts, ignore dotfiles, `.git`, and editor temp files. A `rev` counter lets a reconnecting client catch up with one change.
- **Push**: server-sent events on `GET /events` (not under `/api`; same loopback and Host guards). `/.auth/me` says `events: true` so a host without a watcher (Azure Static Web Apps) is never probed; there the page polls `GET /asks` every 15 seconds.
- **Own writes are quiet**: the page holds an asked-about key for 2.5 s so its own write's echo does not flash or reorder; changes from elsewhere update in place and the cursor stays on the ask being read.

## Reply path back to agents

The answer is a file edit, so any agent can read it without a runtime link:

1. Poll: `stack asks list --state answered --json` (or `GET /asks?state=answered` with a token).
2. Act, then `stack asks handle <key> --outcome handled` (or `resolved`, `defaulted`, or `reopen --reply "<one line>"` when the owner asked a question).
3. A reply ending in `?` is stored as `ask` (the agent answers back and reopens); anything else is a `reply` (an instruction).

Waking a sleeping agent is out of scope here: the CoS poll (or a `stack web` hook, next) is the trigger. Writing is cheap and durable; the owner never needs to know whether the agent saw it, because `Sent (n)` stays visible until it is handled.

## How it reads CoS state files

It does not parse them. `.stack/*-state.md` files are prose that each CoS owns; a parser would guess, and charter rule 1 says never assume. The contract is the other direction: after each state update a CoS upserts its asks (`stack asks put`). Stack only watches `.stack/` so a state edit triggers a refresh. Migration for a CoS is one paragraph in its agent file (see `docs/asks.md`): replace "message Michael" with "put an ask".

## Email as a module

`src/email/` ships the parts that need no network or credentials: the Graph request allowlist that makes sending impossible in code (only `Mail.Read` or `Mail.ReadWrite` scopes; `send`, `forward`, `move`, and `DELETE` throw before the network), the deterministic prefilter, and the mapping from a triage result to an ask (`review` for a drafted reply, `decide` for a decision, `go-do` for sensitive mail). The runner (device-code sign-in, delta sync, Haiku/Sonnet/Opus tiers, launchd) from the plan in todo PR 93 plugs into `MailProvider`, `Classifier`, and `Drafter`; it needs Michael's one-time setup. First inbox: Allyte M365, drafts only.

## Rejected

- **Parsing state files into asks**: fragile and violates "never assume".
- **A chat feed or activity stream**: it is exactly the overload to remove.
- **Stack applying defaults itself**: it cannot know what "merge" or "send" means; the owning agent can.
- **Agent-set scores**: inconsistent across agents and not explainable.
- **WebSocket**: SSE is one-way, auto-reconnects, and needs no dependency.

## Next

Runner for the email module; MCP tools for asks; a `stack web` hook that wakes the owning agent on an answer; per-ask history view on request; Teams, Slack, and calendar sources as modules.
