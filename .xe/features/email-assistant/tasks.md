# Tasks: Email Assistant

Stub. The `email-runner` worker expands each step before it starts the phase. Tests first in every task.

## Step 1: Autonomous Graph (phase 1, after PR 76)

- [ ] T001: Failing tests for safety scans (send names, SMTP, browser libraries) and scope refusal
  - @req FR:safe.nosend
  - @req FR:safe.scopes
  - @req FR:auto.nobrowser
- [ ] T002: Inbox list, ids, projects, per-inbox isolation
  - @req FR:inbox.list
  - @req FR:inbox.route
  - @req FR:auto.isolate
  - @req FR:inbox.id
  - @req FR:inbox.project
  - @req FR:inbox.state
- [ ] T003: Provider contract over the Graph provider; cursor reset; throttle
  - @req FR:provider.contract
  - @req FR:provider.guard
  - @req FR:provider.cursor
  - @req FR:provider.throttle
- [ ] T004: Backlog queue, sign-in ask, model-down breaker, auto voice
  - @req FR:auto.backlog
  - @req FR:auto.signin
  - @req FR:auto.modeldown
  - @req FR:auto.voice
- [ ] T005: Decisions-only asks: cap, roll-up, priority, system asks
  - @req FR:surface.asks
  - @req FR:surface.cap
  - @req FR:surface.priority
  - @req FR:surface.system
  - @req FR:surface.counts
- [ ] T006: Usage meter, status file, budget, CLI and API
  - @req FR:meter.call
  - @req FR:meter.price
  - @req FR:meter.day
  - @req FR:meter.cli
  - @req FR:meter.api
  - @req FR:meter.budget
- [ ] T007: Host side: stale items in Needs you; email lines in the Agents usage panel
  - @req FR:auto.stale
  - @req FR:meter.view
- [ ] T008: Token rules: zero-call pass, clip limits, content cache
  - @req FR:tokens.zero
  - @req FR:tokens.clip
  - @req FR:tokens.cache
- [ ] T009: Injection, links, PII, sensitive seed
  - @req FR:safe.injection
  - @req FR:safe.links
  - @req FR:safe.pii
  - @req FR:safe.sensitive
- [ ] T010: `schedule --install|--uninstall`, heartbeat, `scripts/email/register-graph-app.ps1`, `email-setup` ask
  - @req FR:auto.schedule
  - @req FR:auto.heartbeat
- [ ] T011: Amend `email-triage` and `email-runner` specs (plan "Changes to existing specs")
- [ ] T012: Replay eval (120-message synthetic day) and cost NFRs
  - @req NFR:cost.busy
  - @req NFR:cost.idle
  - @req NFR:fresh

## Step 2: Gmail (phase 2, only with a Gmail inbox)

- [ ] T020: [P] Gmail login (loopback PKCE), scopes, cache
  - @req FR:gmail.auth
  - @req FR:gmail.scopes
  - @req FR:gmail.cache
- [ ] T021: Gmail guard, delta, details, draft, link, reply headers
  - @req FR:gmail.guard
  - @req FR:gmail.delta
  - @req FR:gmail.details
  - @req FR:gmail.draft
  - @req FR:gmail.link
  - @req FR:provider.reply

## Step 3: IMAP (phase 3, only with an IMAP inbox)

- [ ] T030: [P] IMAP login to Keychain, config, TLS
  - @req FR:imap.login
  - @req FR:imap.config
  - @req FR:imap.tls
- [ ] T031: IMAP guard, read with PEEK, delta, draft by APPEND, no-MOVE fallback, no SMTP
  - @req FR:imap.guard
  - @req FR:imap.read
  - @req FR:imap.delta
  - @req FR:imap.draft
  - @req FR:imap.nomove
  - @req FR:imap.nosmtp

## Step 4: Live

- [ ] T040: Owner human batch (`plan.md`), 48 h observe per inbox, then drafts; retire `email-cos` browser triage
