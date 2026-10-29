<!-- @req NFR:live-deploy/cost @req NFR:live-deploy/security -->
# Hosting decision: deploy Stack, GitHub stays the source

Decided 2026-10-28. Spec: [live-deploy](../.xe/features/live-deploy/spec.md). Setup: [setup-live.md](setup-live.md).

## Decision

**Deploy (option a).** Stack runs on Azure Static Web Apps Free, with sign-in through GitHub. The host reads and writes `flanakin/todo` through the GitHub REST API and commits directly to `main`. There is no local server and no launchd agent.

| Option | Verdict | Why |
| --- | --- | --- |
| a. Deploy (SWA Free + managed Functions) | **Chosen** | Always on, works on phone and Mac, $0, HTTPS (needed to install as an app), and the host was already built (`host/`, `infra/`, deploy workflow) |
| b. Local tray or launchd service | Rejected | Still a server on the Mac: it dies when the Mac sleeps, doesn't reach the phone, and has no HTTPS for app install |
| c. Hybrid | Not needed | Agents already write through git (Claude Code pushes to the repo), and `stack web` stays for development |

## How it works

- **Sign-in.** SWA's built-in GitHub provider works on the Free plan. Custom auth needs Standard ([SWA auth](https://learn.microsoft.com/azure/static-web-apps/authentication-authorization), [custom auth](https://learn.microsoft.com/azure/static-web-apps/authentication-custom)). Sign-in only identifies the user. `STACK_OWNERS=github:<id>` is the allow-list, and no GitHub token reaches the browser.
- **Repo access.** A fine-grained token with Contents read and write on `flanakin/todo` only ([fine-grained tokens](https://docs.github.com/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)). It is kept in SWA app settings and sent only to `api.github.com`. A GitHub App would give short-lived tokens but takes more setup; it's the upgrade path if Stack ever goes multi-user.
- **Why the REST API, not git clone.** Managed functions are HTTP-only and run on the Consumption plan ([SWA + Functions](https://learn.microsoft.com/azure/static-web-apps/apis-functions)). There is no documented git binary, and every cold start would mean a fresh clone. The new `GitHubStorage` adapter reads one tree per head commit and caches blobs by sha. Each write is one commit with a fast-forward-only ref update, so a concurrent agent push makes it rebuild on the new head, never overwrite.
- **Commits to `main`, not a branch or PR.** A branch would split the truth from what Claude Code reads. Every change is still a commit you can `git revert`. Branch protection on a private repo needs GitHub Pro (checked: 403 on `flanakin/todo`), so nothing blocks direct commits.
- **Live updates without a watcher.** The page polls `GET /api/sync` every 15 s while visible, and also on focus and on reconnect. The host checks the branch ref with `If-None-Match`; a `304` doesn't count against the rate limit ([GitHub best practices](https://docs.github.com/rest/using-the-rest-api/best-practices-for-using-the-rest-api)). The page reloads only when the head sha changes. Webhooks plus a push channel (Web PubSub, SignalR) would add a paid resource to save at most 15 s.
- **Agents' asks.** Agents keep writing `tasks/asks/<key>.md` and pushing to `main` (or `POST /api/asks/<key>` with a token). The next poll shows them.
- **Offline.** The existing service worker shows the last saved copy, with a banner. The Asks view shows the sync state with a working action in every state: **Retry now**, or **Sign in**. Writes need a connection (no queue: the pwa spec non-goal stands).
- **Install.** Edge installs any HTTPS site with a manifest and service worker as an app ([web.dev install](https://web.dev/learn/pwa/installation)). The manifest and service worker already ship (pwa feature).

## Security

- Private content: `/api` answers `Cache-Control: no-store`. The service worker cache lives only on your device and is cleared on sign-out (pwa `offline.private`). Only the owner allow-list gets data.
- Tokens: the repo token lives in SWA app settings, never in a repo. The setup script reads it from a hidden prompt and passes it only through a mode-600 temp file it deletes.
- Prompt injection: task and ask text render as text, never as html, and the host never sends it to a model. Agents must treat repo text as untrusted data (agents and email sessions told). Ask fields are already sanitized (`oneLine`).
- The Function must be reachable only through SWA (managed functions satisfy this). See the [threat model](security/threat-model.md).

## Cost

$0. SWA Free includes managed Functions and 100 GB of bandwidth a month ([plans](https://learn.microsoft.com/azure/static-web-apps/plans), [quotas](https://learn.microsoft.com/azure/static-web-apps/quotas)). GitHub allows 5,000 requests an hour per token, and 80 content-creating requests a minute or 500 an hour ([rate limits](https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api)). One open page uses at most 720 conditional checks an hour, mostly free `304`s. Each write costs about 5 calls.

## Limits to know

- Free plan has no SLA. Fine for one user; Standard is $9 a month if that changes.
- Linux Consumption is retiring on 2028-09-30 ([supported languages](https://learn.microsoft.com/azure/azure-functions/supported-languages)). SWA managed functions run on Consumption, so watch for a migration notice before then.
- The repo must fit one GitHub tree read (100,000 entries). `flanakin/todo` is far below that.
