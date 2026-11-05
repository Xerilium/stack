---
id: email-assistant
title: Email Assistant Plan
---

# Plan: Email Assistant

## Owner and done

- **Owner:** `stack-architect` (design, gates, review). **Worker:** `email-runner` (builds each phase in its own worktree and draft PR). Agents never merge.
- **Definition of done:**
  1. Every inbox on the owner's list runs every 15 minutes from one LaunchAgent for 7 days with no manual run.
  2. The owner sees mail only as asks (at most 5 open per inbox) and drafts; zero sends (guard, scope, and scan tests green).
  3. Agents view shows tokens and list-price dollars per inbox per day; a busy inbox stays under 250k tokens a day; the `email-cos` browser triage is retired.

## Architecture fit

```text
launchd (every 15 min, owner's Mac)
  stack email run --all
    for each inbox in listInboxes()          FR:inbox.list
      lock, state, queue                     FR:email-runner/cli.lock, FR:auto.backlog
      provider.delta  (Graph | Gmail | IMAP) FR:provider.*  behind guard
      sent delta -> resolve answered asks    FR:email-runner/graph.replies
      rules -> classify (Haiku) -> draft (Sonnet) -> voice check
      inbox-zero batches, approved moves     FR:email-inbox-zero/*
      asks (cap + roll-up)                   FR:surface.*
      meter + budget                         FR:meter.*
    write .stack/email.json, tasks/asks/mail-*  -> content repo commit (existing storage)

Stack host (Azure SWA, no timers)
  reads tasks/asks/*        -> Needs you (one ranking, FR:ask-queue)
  reads .stack/email.json   -> stale items (FR:auto.stale), Agents usage panel (FR:meter.view)
```

- **Scheduler:** launchd on the Mac. This is the only Stack scheduler that can reach the owner's Claude login and local secrets. The host has no timers; GitHub Actions cron would need mail tokens in Actions secrets and mail content on shared runners. Both rejected.
- **Store:** the content repo through the existing storage layer. Asks in `tasks/asks/`, status and usage in `.stack/email.json`. Mail state, cursors, queues, voice: local `0600` files under `$STACK_DATA_DIR/email/<inbox>/`, never in git.
- **Needs you:** the assistant writes asks (the agent channel). It never writes `.stack/needs-you.json` (CoS only). Stale items are computed by the host at read time.

## Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Model billing | Keep `claude -p` on the owner's plan (already built). Adapter stays injectable for an API key. | No new secret; the owner runs one prepaid plan, so the meter reads as usage (`FR:agent-sessions/web.usage`). Switch to an API key only if headless use is limited or the cloud runner (phase 4) ships. |
| Opus tier | Dropped. | Plan PR 93 showed Opus is most of the cost. Sonnet with the voice check is enough; revisit only with miss data. |
| Gmail access | Gmail API, not IMAP. | IMAP on Gmail needs `https://mail.google.com/` (full access, delete included) or an app password (full account, SMTP send). Gmail API gives `gmail.readonly`, history-based delta, labels, and drafts. Free quota. |
| Gmail auth | Installed-app OAuth, loopback redirect, PKCE. App "In production", unverified, single user. | Google device flow does not allow Gmail scopes. "Testing" status expires refresh tokens after 7 days; production unverified apps for personal use avoid that (warning screen once). Workspace accounts can use an Internal app instead. |
| Gmail never-send | Code guard only. | No Gmail scope allows drafts without send (`gmail.modify` and `gmail.compose` both allow send). Graph is stronger: `Mail.ReadWrite` cannot send. Documented risk; guard + scan tests. |
| Other inboxes | IMAP with app-specific passwords in the Keychain; `imapflow`. | Works for iCloud, Fastmail, Yahoo, custom hosts. Drafts by `APPEND` to `\Drafts`. IMAP itself cannot send; we ship no SMTP code. The password usually also allows SMTP, so never-send is code-level here too. |
| Microsoft app | One public-client app, "work and personal accounts", delegated `Mail.ReadWrite`, `Calendars.Read`, `offline_access`, `User.Read`; no `Mail.Send`. | One registration serves Allyte and Outlook.com (`consumers` tenant, PR 76). Created by a script so the owner does one sign-in, not portal clicks. |
| Secrets | Refresh tokens: `0600` files (built, `FR:graph-signin/cache.file`). IMAP passwords: Keychain. | Refresh tokens rotate on each use; a file write is simple and already tested. A static password is higher value; Keychain is the safer home. |
| Draft flood | Cap 5 individual asks per inbox; roll the rest into one review ask. | Michael wants decisions, not a review queue of every reply. |
| Heartbeat | `lastOk` written at most every 4 hours; stale at 12 hours. | Keeps idle passes from committing every 15 minutes; tolerates overnight sleep. |
| Push (Graph subscriptions, Gmail Pub/Sub) | No. | Needs a public HTTPS endpoint and renewals. 15-minute polling costs about 1 request per inbox per pass. |

### Scope table (`FR:safe.scopes`)

| Provider | observe | drafts | Can the token send? |
| --- | --- | --- | --- |
| Graph | `Mail.Read`, `offline_access` | `Mail.ReadWrite`, `offline_access` | No |
| Gmail | `gmail.readonly` | `gmail.modify` | Yes (guard blocks) |
| IMAP | app password, `EXAMINE` | app password, `SELECT` | Yes over SMTP (no SMTP code) |

## Cost model

List prices from `priceFor` (`src/agents/store.ts`). On the prepaid plan this is usage weight, not a bill. Provider APIs, Google Cloud, and launchd cost $0.

| Inbox | Mail/day | Settled by rules | Haiku classify | Sonnet re-judge | Sonnet drafts (+redrafts) | Tokens/day | ≈ $/day | ≈ $/mo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Busy work (Allyte) | 120 | 55% | 54 calls, ~90k | 5, ~15k | 12+4, ~55k | ~160k | ~$0.18 | ~$5.50 |
| Personal (Outlook.com, Gmail) | 60 | 75% | 15, ~25k | 1, ~3k | 2, ~8k | ~35k | ~$0.03 | ~$1 |
| 1 busy + 3 personal | | | | | | ~270k | ~$0.27 | ~$8 |

- Cost is mostly Sonnet drafts. First lever: the draft cap and roll-up, not the classifier.
- `claude -p` adds a fixed CLI prompt per call. It caches inside one pass (calls run back to back). Phase 1 measures it; if it is more than 30% of tokens, switch classify to the API adapter.
- Budget default: 1M tokens per inbox per day (about 6 times the busy estimate). It trips only on a loop or a flood.
- Saves: retires the `email-cos` browser triage (screenshots per message) and the owner's own inbox scan.

## Failure modes

| Failure | Detect | Response |
| --- | --- | --- |
| Mac asleep or off | `lastOk` > 12 h | Host lists `mail-stale-<inbox>`; next pass catches up from the cursor |
| Sign-in lost (Graph 90-day idle, password change, Google revoke, IMAP password change) | provider auth error | `mail-signin-<inbox>` with the login command; other inboxes continue |
| Claude login lost or plan limit | 3 model errors in a row | Stop model calls; queue mail; `mail-model-down` |
| Flood (> `--max`) | delta size | Queue ids; drain oldest first; `mail-backlog-<inbox>` over 1,000 |
| Cursor invalid (410, history 404, UIDVALIDITY) | provider code | Re-bootstrap 14 days; idempotent |
| Throttle (429, 5xx) | status | `Retry-After`, 2 retries, end pass, cursor unchanged |
| Runaway tokens | meter | Budget cap, rules-only, `mail-budget-<inbox>` |
| Prompt injection | model flag, schema check | No draft, no ask, spam candidate; output never sets headers or links |
| Push conflict on the content repo | storage | Existing retry in storage |
| Lock held or stale | lock file | Existing (`FR:email-runner/cli.lock`) |
| Missed urgent mail | eval recall | VIP floor; uncertain goes to an ask; replay eval gate |

## Test plan

- **Unit and contract** (CI, offline, synthetic `example.test` mail only): one test per FR with `@req`. Provider fixtures shaped like real responses: Graph delta pages, `@removed`, 410; Gmail history pages, 404, MIME parts; IMAP via a fake session with `UIDVALIDITY` change and no `MOVE`.
- **Safety** (zero tolerance): guard deny tables for each provider (every send, delete, trash, expunge, settings path); source scan for send names and SMTP; dependency check for browser libraries; scope refusal on request and on grant; secrets never in argv, logs, asks, or the status file.
- **Injection suite** (10+ cases from PR 93 section 10) through the prompt builders: text stays escaped and fenced; flagged mail gets no draft; no model value reaches a header, link, folder, or label.
- **Surface:** cap and roll-up ordering; system asks open once and clear; no ask from counts.
- **Meter:** token sums from `modelUsage` and `usage`; owner-local day rollover; list-price math; budget trip and next-day reset; zero calls on an empty pass.
- **Autonomy:** plist content and idempotent install; stale item at 12 h and not at 11 h; backlog drain across passes; model-down breaker; one failing inbox does not stop the next.
- **Replay eval** (local, `STACK_LIVE_EVAL=1`, not in CI): 120-message synthetic day through real models. Gates: `needs_reply` recall ≥ 95%, precision ≥ 80%, schema-valid 100%, ≤ 250k tokens.
- **Live acceptance** (after the human batch): 48 h observe per inbox; check asks and meter; then drafts mode.

## Phases

| # | Phase | Contents | Gate | Effort (agent) |
| --- | --- | --- | --- | --- |
| 0 | Done or in review | Triage, voice, inbox zero, runner, Graph sign-in (merged); all Graph inboxes ([PR 76](https://github.com/Xerilium/stack/pull/76), draft) | PR 76 merged | 0 |
| 1 | Autonomous Graph | `FR:auto.*`, `FR:inbox.*`, `FR:provider.*` for Graph, `FR:surface.*`, `FR:meter.*`, `FR:tokens.*`, `FR:safe.*`; app registration script; `email-setup` ask | All tests green; replay eval passes | ~1 day |
| 2 | Gmail | `FR:gmail.*` | Only if a Gmail inbox is on the list; 8-day refresh-token check | ~1 day |
| 3 | IMAP | `FR:imap.*` | Only if an IMAP inbox is on the list; verify `imapflow` deps | ~0.5-1 day |
| — | Human batch | One sitting (below) | After phases 1-3 that apply are merged | ~15 min owner |
| 4 | Cloud runner (conditional) | Timer-triggered Azure Function with Key Vault and an API key | Only if `mail-stale-*` fires more than twice a week for 2 weeks | not designed (YAGNI) |

Phases 1-3 build against fixtures with no credentials, so nothing waits on the owner until the batch.

### Changes to existing specs (phase 1 tasks)

- `email-triage` `FR:ask.reply`: each draft is an ask only within the cap (`FR:surface.cap`).
- `email-runner` `FR:cli.run`: over `--max` queues instead of exit 4 (`FR:auto.backlog`); `FR:model.usage` records tokens (`FR:meter.call`); `FR:cli.schedule` gains `--install`.
- `email-runner` `FR:cli.all` (PR 76): asks use the inbox project, not the address (`FR:inbox.project`).

## Human-only steps (one batch)

The worker writes one `go-do` ask `email-setup` with this list when the code is merged. Do it in one sitting.

1. **Microsoft app (once, 1 min):** run `pwsh scripts/email/register-graph-app.ps1`. Sign in once in the browser it opens (`Connect-AzAccount`). The script creates the app and saves its client id.
2. **Each Microsoft inbox (1 min each):** run `stack graph login --account <addr> --with drafts`. Open <https://microsoft.com/devicelogin>, paste the code, sign in, click **Accept**. Allyte: if it says "Need admin approval", tick **Consent on behalf of your organization**.
3. **Google (once, only with a Gmail inbox, 5 min):**
   - <https://console.cloud.google.com/projectcreate>: name `stack-email`, **Create**.
   - <https://console.cloud.google.com/apis/library/gmail.googleapis.com>: **Enable**.
   - <https://console.cloud.google.com/auth/overview>: **Get started**, app name `Stack`, your email, **External**, **Create**. Then **Audience**, **Publish app**.
   - <https://console.cloud.google.com/auth/clients>: **Create client**, type **Desktop app**, **Create**, **Download JSON**. Save it as `~/.config/stack/google-client.json`.
4. **Each Gmail inbox (1 min each):** run `stack gmail login --account <addr> --with drafts`. In the browser: **Advanced**, **Go to Stack (unsafe)**, **Continue**.
5. **Each IMAP inbox (2 min each):** make an app-specific password at the provider (iCloud: <https://account.apple.com>, **Sign-In and Security**, **App-Specific Passwords**). Run `stack imap login --account <addr> --host <host>` and type it at the prompt.
6. **Start (30 s):** run `stack email schedule --install`.

## Open questions

- **Inbox list (blocks phases 2-3):** which addresses, and which provider each? Phase 2 and 3 build only for inboxes that exist. Any mailbox in a tenant the owner does not administer is out of scope.

## Not verified (check in the phase)

- Google "In production" unverified single-user app keeps refresh tokens past 7 days (phase 2: 8-day check).
- `imapflow` dependency tree has no SMTP code reachable from our imports (phase 3).
- `claude -p` JSON carries `modelUsage` per call on the owner's CLI version (phase 1, first test).
- launchd coalesces missed `StartInterval` runs after sleep on current macOS (phase 1 live check; the cursor makes catch-up safe either way).
