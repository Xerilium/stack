# Security review: email and inbox (PRs 76, 82, 84, 87)

Reviewed: pr76 (email runner), pr84 (inbox runner, Teams/Slack; includes pr82), pr87 (brief AI). All four PRs are now on main; fixes sit on main (merged through PR 95).
Counts: Critical 0 · High 3 (fixed) · Medium 4 (all fixed; M1, M2 in the follow-up) · Low 4 (L1, L2 fixed) · Info 5.

## Results by focus

1. **No send path: PASS.** `guard.ts` denies send/forward/reply/move/copy/DELETE by path segment before the allowlist; only `createReply` (body `comment` only, drafts mode) and approved Archive/Junk moves pass. `auth.ts` allowlist has no `Mail.Send`/`Chat.Send`; Chat.Read is not requested anywhere (Teams token is injected, never obtained here). Chat/Slack guards allow reads only.
2. **Tokens: PASS with Low notes.** Cache is 0600 atomic write, refuses task repos, errors carry OAuth codes only. State/lock/voice 0600 in 0700 dir under `~/Library/Application Support/stack`.
3. **Prompt injection: PASS with Medium notes.** `claude -p --safe-mode --tools ''`, empty temp cwd, schema output, email fenced and `<` escaped, class enum re-checked, injection flag stops drafting. Drafts land in Drafts only.
4. **SSRF/command injection: PASS.** `gh` via `execFile`, fixed repo; plist uses XML escaping, no shell; unsubscribe POST pins resolved IP, blocks private ranges, no redirects.
5. **Owner-only/CSRF: 1 High, see H2.**

## High (fixed in this PR, tests first)

- **H1. Untrusted text becomes a task with the autonomy marker.** `src/inbox/run.ts:43` (create-task) and `src/inbox/request.ts` (fallback task) built task text from email subject/sender or chat topic and called `addTask` directly, skipping `noAutonomyMark` (`src/api/handler.ts:97`). A subject containing `🤖:full` or `🤖` turned an owner click on "Create task" into a task an agent runs. Fix: `plainTask()` strips autonomy/agent/status/date marks. Test: `tests/security/inbox-review.test.ts`.
- **H2. `GET /inbox-items` readable by any `tasks:read` token.** `src/api/handler.ts:598`. Returns every mailbox's sender, subject, summary and Graph `messageId`; calendar and schedule reads are owner-only, this was not. Fix: `ownerOnly`. Test: `tests/security/authorize.test.ts` (owner-only list).
- **H3. Inbox item summary unredacted; sensitive mail falls back to body preview.** `src/inbox/items.ts:21`. Asks use `redact()` and "sensitive mail never carries a body"; items did neither, and the file `.stack/inbox-items.json` goes into the task repo. Fix: `redact()`, fixed text for `sensitive`. Test: `tests/security/inbox-review.test.ts`.

## Medium (all fixed: M3, M4 in `src/email/llm.ts` `childEnv`, `src/email/run.ts`; M1, M2 in the follow-up)

- **M1 (fixed). Brief one-tap actions steered by attacker text.** `src/api/brief.ts:38,45`. Ask text from email/Teams goes to the model; the model's `text` is shown beside a go/no/done button for the key it picks. Actions are allowlisted per ask kind (good), but a crafted ask can make a line misdescribe another ask. Fix: show the ask's own title beside the button; use model text only as a second line.
- **M2 (fixed). `GET /brief/summary?refresh=1` spends model calls.** `src/api/handler.ts:629`. A cross-site GET to loopback `stack web` passes the Host guard (CSRF guard covers non-GET only, `src/cli/web.ts:192`); response is unreadable but cost is real. Fix: POST for refresh, or a 60 s floor between refreshes.
- **M3 (fixed). Whole environment passed to `claude -p`.** `src/email/llm.ts:22` (`env: process.env`). No tools, so no exfil path today, but GH/Graph/Slack secrets in env reach a child that reads hostile text. Fix: pass an allowlist (PATH, HOME, ANTHROPIC_*, locale).
- **M4 (fixed). No server-side shape check of model fields.** `src/email/to-ask.ts` calls `oneLine(redact(r.summary))` on model output; the CLI enforces the schema, Stack does not. A non-string summary throws and aborts the pass (DoS by one mail, if the CLI schema check ever lapses). Fix: coerce with `typeof === 'string'` in `run.ts`.

## Low

- **L1 (fixed).** `src/graph/auth.ts:160` `JSON.parse` of a corrupt token file puts a file snippet in the error, which `emailAll` writes to `run.log` (`src/cli/email.ts`). Fix: catch and throw a fixed message.
- **L2 (fixed).** `src/graph/auth.ts` `write`: `mkdir mode 0700` does not tighten an existing loose directory. Fix: `chmod` the directory.
- **L3.** `src/inbox/request.ts:26` "Request this action" files a public issue per click, no dedupe. Owner-only. Fix: look for an open issue with the same title first.
- **L4.** `src/cli/email.ts:61` plist logs (`run.log`) are created with launchd's default 0644 in a 0700 dir; contents are counts and account names only. Fix: none needed unless logs grow content.

## Info

- `src/email/guard.ts`: move exception is checked before the denied-verb scan; it needs mode `drafts`, one-key body and an owner-approved id/target. Correct.
- `src/inbox/live.ts`: `redirect: 'error'`, guard before every request, Slack error text restricted to `[a-z_]`.
- `src/email/http.ts`: DNS rebinding handled by `pinnedLookup`.
- `src/cli/web.ts:115`: every loopback request is the owner by design; protected by Host and Sec-Fetch-Site checks. Any local process without Origin headers can act as owner.
- `src/api/brief.ts`: route is owner-only and caches per day; failures are not cached.

# Follow-up: M1, M2 and a fresh pass over merged code (PRs 89 to 99)

Scope: ACP driver (spawn, env, permission requests), iPhone auth (tokens, devices, push), Teams/Slack connectors, asks MCP and wake files, meetings API and the `.stack` path rule.
Counts: Critical 0 · High 1 (fixed) · Medium 3 (M1, M2, M5 fixed) · Low 4 (open) · Info 6.

## Fixed in this PR (tests first)

- **M1.** `src/api/brief.ts`: each line's `text` is now the ask's own text; the model sentence moves to `note`. Test: `tests/api/brief-ai.test.ts` (security). Web follow-up: show `note` as a second line (`web/src/briefAi.ts`).
- **M2.** `src/api/brief.ts`: `?refresh=1` spends at most one model call per 60 s; inside the floor it returns the current result with `cached: true`. Test: `tests/api/brief-ai.test.ts` (security).
- **H4. An agent token can rewrite another session's permission prompt.** `src/api/handler.ts` `asks.put` let any `tasks:write` token overwrite `perm-*` asks (title, why, detail, recommend). The owner answers `go` → the broker sends `options[0]` (allow) for the real request. A prompt-injected agent could make the owner approve a misdescribed `Bash` call of another session. Fix: `perm-*` keys are broker-only; a non-owner write is `403`. Test: `tests/security/perm-asks.test.ts`.
- **M5. A token can overwrite any other agent's ask.** `src/core/asks.ts` `putAsk` merged fields onto an existing ask with no writer check (`from` is free text). Fix: a new ask stores `writer` (`token:<name>` or the core actor); a token that is not the writer gets `403`. The owner may update any ask. Asks written before this change have no `writer` and stay open to any writer. Residual: tokens with the same name share asks; `asks.handle` has no writer check, but a wrong handle only denies or closes. Test: `tests/security/ask-writer.test.ts`.

## Low (open)

- **L5.** `src/agents/acp.ts` `onPermission`: an unknown option `kind` becomes `reject_once`, so a `deny` answer can pick an option the agent mislabeled. The agent already runs its own code, so impact is small. Fix: drop options with unknown kinds; deny with `cancelled` when no real reject option exists.
- **L6.** `src/agents/broker.ts`: answer `go` sends `options[0]`, which an agent can order as `allow_always`. Fix: map `go` to the first `allow_once`.
- **L7.** `src/agents/acp.ts` `ENV_ALLOW` passes `NODE_OPTIONS` and `NODE_PATH` to the agent. Parent-controlled today; a `--require` there runs in every agent. Fix: drop both unless set in `env`.
- **L8.** `src/core/storage.ts` `AUX_PATH`: the only `.md` it allows is `.stack/meetings.md` (correct), but `writeAux` accepts it though meetings are read-only. Fix: split read and write rules if a write path for state ever takes input.

## Info

- ACP spawn: `shell: false`, no fs/terminal capability, env allow-list, stderr redacted, a failed or aborted permission returns `cancelled`. Pass.
- Device tokens: hashed (optional pepper), `timingSafeEqual`, expiry and revoke; `/auth/devices/me` binds the token to its own device; admin is owner session only. Pass.
- Push: endpoint allow-list (https, no credentials or port), key shape check, payload is key and title only. Pass. Passkeys are design only (`FR:iphone-access/passkey.design`); nothing to review.
- Teams: guard pins every request (including `@odata.nextLink`) to `GET https://graph.microsoft.com/v1.0/me/chats`, so the bearer token never leaves Graph. Slack: method allow-list, error text `[a-z_]` only. Pass.
- Wake files: `wakePath` slug is `[a-z0-9._-]` with an alphanumeric start, then `WAKE_PATH` and the `..` check. Ask keys match `ASK_PATH`. No traversal. Pass.
- Meetings: `GET /meetings` is owner-only and reads `.stack/meetings.md` only. Pass.
