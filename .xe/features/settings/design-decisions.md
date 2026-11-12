# Design Decisions: Settings

---

## Accounts live in Settings, not in Now

**Date**: 2026-11-12

**Decision**: Settings > Accounts is the only place that manages Microsoft accounts. Now shows at most one quiet line that links there. Inbox links there too.

**Why**: The owner has 6 accounts. The panel in Now grew to a full screen of per-account paragraphs and buttons. Now is for the next thing to do. Setup is done rarely and belongs in one place.

**Rejected**:

- _A collapsible panel in Now._ It still pushes the next task down when open, and it is the wrong place to look for setup.
- _A modal from Now._ Modals hide the state they are about; the list must stay visible while a sign-in runs.

---

## One row per account, with a kebab

**Date**: 2026-11-12

**Decision**: Each account is one line: kind icon, address, status dot and one word. A row that needs action has one `Fix` button. Everything else (reply drafts, sign in again, disconnect) is in a row menu.

**Why**: 6 rows must fit on one screen at 1280x800 with room to spare. Per-row paragraphs and three buttons made 3 accounts fill a phone screen.

**Rejected**:

- _A table with a column per setting._ Wide, and it shows switches the owner rarely changes.

---

## Microsoft outages are not sign-in problems

**Date**: 2026-11-12

**Decision**: Graph 401 and consent errors mark an account `expired` (Needs sign-in). 5xx, timeouts and network failures mark it `down` (Microsoft not responding) and retry on their own after 30 s, 2 min, then every 10 min. 429 backs off silently and keeps the last state. Every Graph call has an 8 s cap.

**Why**: On 2026-11-12 Graph returned 502 UnknownError, about 20 s per call, for `calendarView`, `events` and `calendars` on all three accounts. The page said `Click Fix and sign in again`, which could not help and wasted the owner's time.

**Rejected**:

- _Retry inside one request._ A 20 s 502 times 3 retries holds the page for a minute; the next scheduled read retries instead.

---

## The 2026-11-12 calendar failure is not Stack's request

**Date**: 2026-11-12

**Decision**: Keep the `calendarView` request as it is. Log each failed Graph call with its request id to `~/.stack/graph.log`, and say `Microsoft not responding` in the page.

**Why**: A minimal hand-made `curl` with only `Authorization` fails the same way: `/me/mailFolders/inbox` and `/me/calendar` return 502 or 503 `UnknownError` (about 21 s) for every account, mail as well as calendar. `/me` and `$metadata` answer in under 1 s. The same 502 comes back with a token from a different app (Azure PowerShell), a different tenant and a different user. So the app registration, consent, scopes, query format and headers are not the cause; the Graph to Exchange path (West US 2 slice E) is. Example request ids: `9796edf9-9fc2-4464-bac5-72b6733ee307`, `e62261c2-eb9c-428a-…`.

**Rejected**:

- _Add `User.Read` or `Prefer: outlook.timezone`._ Neither changes a call that fails before Exchange answers, and the other app's token has `User.Read` and fails too.
