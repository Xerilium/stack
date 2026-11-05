# Research: Comms and Social Connectors

Status: explore. Docs only. No code.
Date: 2026-11-05.

## Goal

Stack must see every place where someone waits for the owner. Each connector turns raw items into one signal: what must the owner do?

Existing: email runner (PR 76), inbox page (PR 82), Teams and Slack runner (PR 84). Agents never merge. Humans apply Autopilot.

## Confidence

Search was one pass per topic. Many sources are vendor blogs. Items marked **[verify]** lack a primary source. Check them on the vendor page before build.

## Signals

All connectors map items to this set:

| Signal | Meaning |
|---|---|
| `reply` | A person asked the owner something |
| `mention` | The owner was named, no direct ask |
| `deadline` | A date is attached (event, due, expiry) |
| `approval` | A review, sign-off or permission is requested |
| `fyi` | No action. Archive or ignore |

## Ranking (value / effort)

Value: how often it holds a real action for the owner. Effort: build + auth + upkeep. Score: H/M/L.

| # | Connector | Value | Effort | Read | Write | Auto level | Risk |
|---|---|---|---|---|---|---|---|
| 1 | GitHub notifications | H | L | Poll, free on 304 | Mark read only | Full read; no replies | Token type [verify] |
| 2 | Calendar (Graph) | H | L | Range read exists; delta later | None needed | Full read | Low |
| 3 | YouTube comments | M | L | Poll, 1 quota unit | Reply: draft only | Read + draft | Quota |
| 4 | Gmail | H* | M-H | Pub/Sub push or poll | Draft only | Read + draft | Google review |
| 5 | Instagram comments | M | M | Poll (webhooks need review) | Reply: draft only | Read + draft | Meta app setup |
| 6 | X mentions | M | M | Poll, paid per read | Skip | Read | Cost |
| 7 | iMessage / SMS | H | M-H | Local DB on a Mac | Human only | Read local | Mac must be on; permissions |
| 8 | LinkedIn | M | H | No personal API | Human only | Human only | ToS, partner gate |
| 9 | WhatsApp (personal) | M | H | No personal API | Human only | Human only | Account ban |

\* Gmail value is H only if the owner has real traffic there. Ask the owner (see Open questions).

Top 3 new connectors: GitHub notifications, Calendar, YouTube comments. Gmail moves up if owner mail is on Google.

## Per-connector notes

### 1. GitHub notifications

- API: `GET /notifications`. Built for polling with `Last-Modified`. No change returns `304` and costs no rate limit. Obey `X-Poll-Interval` (60 s, may grow). Source: [GitHub REST notifications](https://docs.github.com/en/rest/activity/notifications).
- Signal: `reason` field. `review_requested` -> `approval`. `mention`, `team_mention` -> `mention`. `assign` -> `reply`/task. `author`, `subscribed` -> `fyi`. A thread reason can change over time, so do not cache it.
- Token: the notifications endpoint is reported to reject GitHub App tokens and fine-grained PATs. Use a classic PAT with `notifications` scope. **[verify]** Source: [GHES docs](https://docs.github.com/enterprise-server@3.12/rest/activity/notifications).
- Push: no webhook found for the personal feed. **[verify]** Poll every 60 s.
- Cost: free.
- Personal vs work: one PAT per account. Org SSO may need PAT authorization.
- Auto: read all. Do not post comments. Agents never merge.

### 2. Calendar

- Graph: `GET /me/calendarView/delta` (or `/me/events/delta`). First call is a full sync, then use the delta link. Delta does not accept `$filter`, `$expand`, `$orderby`, `$search`. Scope `Calendars.Read` (delegated, works for personal accounts). Source: [event delta](https://learn.microsoft.com/en-us/graph/api/event-delta).
- Read already exists on main: `createGraphCalendar` (`day-inputs`) reads `calendarView` with `Calendars.Read` through `createCalendarGuard`. No new scope. The new work is the signal map.
- Delta needs a guard change: the guard allows only `calendarView` and a fixed key list, so `/calendarView/delta` is denied today. Keep the range read first; add delta only if polling cost matters.
- Calendar change notifications (push) exist in Graph but were not confirmed in this pass. **[verify]** Poll with delta first.
- Signal: invite not answered -> `approval`. Event in the next 24 h -> `deadline`. Conflicts -> `reply`.
- Write: none. Accept/decline stays human.
- Google Calendar: same shape, with `events.list` + sync token. Not researched in depth. **[verify]**

### 3. YouTube comments

- API: `commentThreads.list` costs 1 quota unit. `comments.insert` and `update` cost 50. Default quota 10,000 units/day, resets at midnight PT. Source: [quota cost](https://developers.google.com/youtube/v3/determine_quota_cost).
- Replies need the `youtube.force-ssl` scope. **[verify]**
- Push: none found. Poll hourly. Cost is tiny.
- Auth: Google OAuth. The `youtube` scopes were not checked for the CASA rule. **[verify]**
- Signal: new top-level comment on the owner's channel -> `reply`. Question mark or "?" -> higher rank. Spam -> `fyi`.
- Auto: read + draft. Human posts. Public replies are brand risk.

### 4. Gmail

- Push: `users.watch` sends changes to Cloud Pub/Sub. A watch must be renewed. Docs say at least every 7 days; renew daily. Source: [Gmail push](https://developers.google.com/gmail/api/guides/push).
- Scopes: `gmail.readonly`, `gmail.modify`, `gmail.compose` are **restricted**. Public apps need verification and an annual third-party security assessment (CASA). `gmail.send` is sensitive, not restricted. Sources are secondary: [Nylas scopes](https://developer.nylas.com/docs/cookbook/use-cases/build/google-oauth-scopes/), [SO mirror](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/72935714/how-to-avoid-security-assessment-for-gmail-api-integration). **[verify]**
- Personal use: keep the OAuth app in Testing mode (up to 100 test users, no review). Refresh tokens then expire in 7 days, so the owner re-signs in weekly. **[verify]** Source: [Nylas](https://developer.nylas.com/docs/cookbook/use-cases/build/fix-google-access-denied/).
- Workspace accounts: an `Internal` app avoids review. Needs admin. **[verify]**
- Alternative: IMAP with an app password. No Google review. Weaker (no push, no labels). Not researched. **[verify]**
- Cost: $0 in testing mode. A published app costs a security assessment. One 2022 comment says about $75K. Anecdote only.
- Write: create drafts only. Same safety rules as `FR:cli.nosend` in email-runner.
- Reuse: the triage, voice and inbox-zero modules are pure. Only the mailbox adapter is new.

### 5. Instagram comments

- Needs a professional (creator or business) account. Reply, hide, delete and read comments on own media. Source: [comment moderation](https://developers.facebook.com/docs/instagram-platform/comment-moderation).
- Own account only: Standard Access, no App Review. Source: [IG platform](https://developers.facebook.com/documentation/instagram-platform/overview).
- Comment webhooks need Advanced Access (App Review). Source: [webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-instagram). So poll instead.
- Permission names differ by login type (`instagram_business_manage_comments` vs `instagram_manage_comments`).
- Facebook page comments: not researched. **[verify]**
- Auto: read + draft. Human posts.

### 6. X (Twitter)

- Pay-per-use. Post read $0.005, user read $0.010 per resource. Your own mentions may bill at $0.001. DM read price conflicts across sources. Source: [X pricing docs](https://docs.x.com/x-api/getting-started/pricing.md) and blogs ([OpenTweet](https://opentweet.io/x-api-pricing)). **[verify]**
- Poll mentions every 15 min. A low credit cap prevents runaway cost.
- Signal: mention or reply to the owner -> `mention`. DM -> `reply`.
- Auto: read. Skip posting. Low value per cost unless the music project is active on X.

### 7. iMessage / SMS

- No official Apple API. Common method: read `~/Library/Messages/chat.db` on a Mac. Needs Full Disk Access. Send only via AppleScript. Sources: [BlueBubbles FAQ](https://bluebubbles.app/faq/), [imessage-cli](https://github.com/ClementWalter/imessage-cli).
- Private API features (reactions, edits) need SIP off. Do not use.
- Stack runs in the cloud. This needs a small local agent on the owner's Mac. It fits the planned desktop app. Message text leaves the Mac, so the owner must opt in.
- SMS on Android: not researched. **[verify]**
- Signal: any unread thread from a known contact -> `reply`.
- Auto: read only. Replies are human only.

### 8. LinkedIn

- No public API for a member's inbox. Messaging endpoints sit behind a private, paid partner program. The only official messaging API is Page Messaging for Company Pages. Sources are vendor blogs: [Nubela](https://nubela.co/blog/automate-linkedin-messaging-without-api), [Kondo](https://www.trykondo.com/blog/linkedin-messaging-api-inbox-access). **[verify]**
- Scraping or browser automation: LinkedIn terms were not checked in this pass, but vendors treat them as prohibited. Do not build. **[verify]**
- Cheap path: LinkedIn sends notification emails. Parse them from the mailbox the email runner already reads. Signal comes free.
- Auto: none. Human only.

### 9. WhatsApp (personal)

- The official Business Platform is for businesses, with per-message fees since 1 July 2025. A personal chat is not reachable. Source: [Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md).
- Unofficial tools break the terms. Vendors report account bans. Source (vendor): [bot.space](https://www.bot.space/blog/whatsapp-api-vs-unofficial-tools-a-complete-risk-reward-analysis-for-2025). **[verify]**
- Do not build. If the owner has a WhatsApp Business number for the music project, revisit.
- Auto: none.

## Already covered (no new research)

| Connector | Note |
|---|---|
| Outlook mail | Email runner. Graph delta |
| Teams | Per-user chats need delegated `Chat.Read`. Tenant-wide needs app permission and admin consent. Teams APIs reportedly stopped being metered on 25 Aug 2025 **[verify]**. Source: [Graph chat notifications](https://learn.microsoft.com/en-us/graph/teams-changenotifications-chat) |
| Slack | Own internal app keeps normal limits. A commercial app not in the Marketplace gets 1 request/min on `conversations.history`. Source: [Slack changelog](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps). Keep Stack as an internal app per workspace |

## Cross-cutting findings

1. **Poll first.** Most useful push channels need app review or public endpoints (Gmail Pub/Sub, Instagram webhooks, Graph notifications). A 1 to 15 min poll from the existing runner is enough.
2. **Read-only default.** Replies stay drafts. Public replies (YouTube, Instagram, X) are brand risk. Human posts.
3. **Personal vs work.** One account record per connection: `{connector, account, kind: personal|work}`. A work account may block tokens or need admin consent. Stack must never mix data between accounts.
4. **Hard walls.** LinkedIn inbox and WhatsApp personal have no safe route. Do not build workarounds. Use email notifications for LinkedIn.
5. **Cost.** All but X, WhatsApp and a published Gmail app are free at one-owner scale.
6. **Prompt injection.** All inbound text is untrusted. Fence it as data, as the email runner does (`FR:model.classify`).

## Open questions for the owner

1. Which mail is real traffic: Outlook, Gmail, both?
2. Is the music project on a Google account (YouTube) and a Meta professional account (Instagram)?
3. Do you accept a local Mac agent for iMessage?
4. Is X active enough to pay per read?
5. Does the music project use a WhatsApp Business number?
