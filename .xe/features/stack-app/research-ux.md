# Research: Stack CoS app UX

Question: what UX keeps one owner on the single highest-value task, across tasks, calendar, and all comms, on iPhone and desktop?
Date: 2026-11-05. Method: web search plus existing Stack work. Not run through `/catalyst:explore` (skill not loaded in this session); its explore playbook was followed by hand.

Evidence labels: **(V)** vendor or official page. **(3P)** third-party review, weak. **(U)** unverified; check before a plan depends on it.

## Prior Stack work (read first)

| Source                                                 | What it settled                                                                                         | Gap this research fills                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| PR 79 Top asks home (merged)                           | Home = top task overall + one row per project, live                                                     | No meetings, no messages, no "why"                          |
| PR 81 Brief, `cos-view/research.md`, `audit.md` (open) | One finite screen: meetings, 3 messages, 3 actions, 1 task. Suggest, do not impose (Morgen over Motion) | 5 views now overlap (Home, My day, Needs you, Brief, Inbox) |
| PR 82 Inbox (open)                                     | Mail + Teams + Slack rows with one suggested action. Nothing is sent, ever                              | Channel-first, not person-first. No social                  |
| PR 87 Brief AI (open)                                  | AI summary lines carry one allowed action, with Undo                                                    | No confidence display, no reason line                       |
| PR 75 Auto-priority (merged)                           | `(unblock + urgency + value) / sqrt(effort)`; owner picks and misses as proof                           | No calendar gap, energy, place, or device                   |
| `desktop-app/research.md`                              | PWA now; native shell only for tray/hotkey                                                              | iPhone widgets and Live Activities need native (see F7)     |

**Challenge:** v1 must cut views, not add them. Five overlapping views break "simple, never overwhelming". Section "v1 screens" merges them into 10 screens with one job each.

## 1. Best-in-class UX for focus apps

| Product       | Pattern                                                                                                        | Lesson for Stack                                                                                        | Source                         |
| ------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Sunsama       | Guided morning plan (10-15 min), warns when over-committed, evening shutdown that sums up the day              | Two rituals frame the day. Over-commit warning is a key CoS act                                         | (V) [S1]; (3P) [S2]            |
| Sunsama       | First-run flow teaches the method, then repeats the guided plan for 2 more days                                | Onboarding = do the real ritual once, with data, not a tour                                             | (V) [S1]                       |
| Motion        | Ranks by priority, deadline, duration, dependency; re-plans when the day slips; alerts on a deadline at risk   | Re-plan on change is strong; full auto-placement removes control (PR 81)                                | (V) [S3]; (3P) [S4]            |
| Reclaim       | P1-P4 levels; higher priority may overbook lower; focus time is defended                                       | Priority must decide what yields when time is short                                                     | (V) [S5]                       |
| Akiflow       | Universal inbox; one tap turns a Slack message or email into a task; drag to time-block                        | Capture from comms must be one tap. Critique: shows only flagged mail, does not find what needs a reply | (V) [S6]; (3P) [S7]            |
| Superhuman    | Keyboard-first triage to zero; split inbox; remind me; 30-min 1:1 onboarding                                   | Finite list + keys + coached first session                                                              | (V) [S8]                       |
| HEY           | Screener for new senders; Imbox / Feed / Paper Trail as one system                                             | Gate new senders. Push low-value mail into a digest the owner reads on purpose                          | (V) [S9]; (3P) [S10]           |
| Things 3      | Two Apple Design Awards; custom motion; Magic Plus drags to place a new item in context                        | Delight from motion with a job. Capture where you are                                                   | (V) [S11]; (3P) [S12]          |
| Linear        | Theme from 3 variables (base, accent, contrast) in LCH; Inter Display for headings, Inter for text             | Few tokens, perceptual color space, one family with a display cut                                       | (V, excerpt) [S13]; (3P) [S14] |
| Raycast       | Principles: fast, simple, delightful. Action bar shows actions with their keys                                 | One command surface; keys taught in place                                                               | (V) [S15]                      |
| Arc           | Calm UI; praised onboarding; 1:1 calls with new users in year one. Now in maintenance; Dia is the AI successor | Calm + taught onboarding win love. AI-first rewrite lost some of that love                              | (3P) [S16][S17]                |
| Apple Journal | Suggestions from on-device data; owner picks which data feeds them                                             | Proactive prompts work when the data stays private and the owner holds the dial                         | (V) [S18]                      |
| Finch         | Missed day = pause, not a broken streak. Users still tire of reminders                                         | No streaks, no guilt. Cut reminders to 1-2                                                              | (V) [S19]; (3P) [S20]          |

### Findings

| #   | Finding                                                                                                                                                                                                 | Applies to |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| F1  | Onboarding is the real ritual on real data, coached, under 3 min to the first "Now"                                                                                                                     | Onboarding |
| F2  | Empty state = a win state ("Clear. Next: 2:00 call."), never a blank list or a tip                                                                                                                      | All lists  |
| F3  | Density: one line per item, detail on demand. Desktop 32-36 px rows; iPhone 44 pt min                                                                                                                   | Lists      |
| F4  | Type: one system family; a display cut only for the one focal title                                                                                                                                     | All        |
| F5  | Motion has a job: confirm, connect, or show cause. 120-280 ms. Reduced motion = crossfade                                                                                                               | All        |
| F6  | Notifications: Apple's 4 levels. Time Sensitive only for "now or within the next hour". Never for marketing [S21]                                                                                       | Push       |
| F7  | Live Activities and widgets are the glance layer on iPhone. They need a native app (ActivityKit / WidgetKit) [S22]. A home-screen PWA has web push (iOS 16.4+, U) but no widgets or Live Activities (U) | Platform   |
| F8  | Calm tech: live in the periphery, move to the center only when needed [S23]                                                                                                                             | All        |

## 2. AI Chief-of-Staff interaction patterns

| Pattern               | Rule for Stack                                                                                                                                                                        | Source                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Proactive brief       | One brief at day start: meetings, people waiting, decisions, 1 focus task, over-commit warning. Each line has one action. Accept the plan in one tap                                  | PR 81, 87; Gemini Daily Brief (PR 81 cites)                                                                                  |
| Ask, don't nag        | CoS speaks at 3 moments only: morning brief, transitions (a gap opens or a meeting ends), shutdown. All else is pull. Each ask is asked once; "later" sets a time, it does not repeat | Calm tech [S23]; Finch [S20]; Mark: resumption after interruption averaged ~23-25 min, high spread (U on exact figure) [S24] |
| Tier by reversibility | Reversible and internal: act, then show it with Undo. Visible to others: show intent first, owner taps. Irreversible or a send: stop and ask                                          | arXiv agent UI patterns [S25]; Microsoft HAX G9, G16 [S26]                                                                   |
| Confidence            | 3 states only: sure (no mark), likely (dot), check (amber "Check"). No percents. Low confidence never auto-acts                                                                       | PAIR Explainability + Trust: show confidence to calibrate trust [S27]                                                        |
| Label AI text         | AI summaries look different (italic or a glyph) and link to the source                                                                                                                | Apple after the BBC summary errors [S28]                                                                                     |
| Delegation            | "Delegate" on every item. Item leaves the list and shows in Team with status and Undo                                                                                                 | PR 81; Stack `FR:home.delegate`                                                                                              |
| Agent transparency    | Team log: who did what, when, why, Undo. Per-agent autonomy dial. Global pause                                                                                                        | HAX G17 global controls [S26]; [S25]                                                                                         |
| Learn from the owner  | Every "not now" or reorder is a signal. Logged misses become regression checks                                                                                                        | PR 75 `FR:misses`; HAX G13, G15 [S26]                                                                                        |
| Over-gating risk      | Too many approvals train blind "yes". Batch low-risk asks into the brief                                                                                                              | [S25] (3P opinion)                                                                                                           |

## 3. "Highest value now": model and one-line why

PR 75 ranks _what matters_. "Now" also needs _what fits_. Keep them apart so each stays testable.

`now(task) = autopri(task) × fit(task, moment)`

| Fit factor        | Input                                                                      | Rule (proposal)                                                                                       |
| ----------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Gap               | Calendar: minutes until next event                                         | Effort ≤ gap: 1.0. Effort > gap: 0.3 (show, but "won't fit"). Next event < 10 min: only items ≤ 5 min |
| Deadline in reach | Due time vs free gaps left today                                           | Last gap before the due time: × 1.5                                                                   |
| Place             | In person / online / in app / reply (from task tags and calendar location) | Wrong place (for example, "at office" while home): 0                                                  |
| Device            | iPhone or desktop                                                          | iPhone boosts reply, approve, call. Desktop boosts deep work                                          |
| Energy            | Owner's peak hours (set once; learned later)                               | Deep work in peak: × 1.2. Out of peak: × 0.8                                                          |
| Unblocks others   | PR 75 `🔓` and blockers                                                    | Already in `autopri`; do not count twice                                                              |

Comparable models: WSJF = cost of delay / duration [S29]; Motion and Reclaim use priority, deadline, duration [S3][S5]. Stack's `/ sqrt(effort)` is a softer WSJF.

**One-line why.** Show the top 2 factors by contribution, then the fit. Max ~60 characters.

| Case      | Line                                               |
| --------- | -------------------------------------------------- |
| Unblocker | `Unblocks 2 agents · 20 min fits before your 2:00` |
| Deadline  | `Due 3:00 · last free slot before then`            |
| Value     | `Top FinOps goal · fits your 45-min gap`           |
| Reply     | `Sam waited 2 days · 2-min reply`                  |
| Won't fit | `Highest value, but needs 90 min · next slot 4:00` |

Tap the line: full score breakdown (reuse existing `breakdown`). Gap: `autopri` returns no reason codes yet; a plan must add them.

## 4. Comms and social triage at iPhone scale

| Decision     | Rule                                                                                                          | Source                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Person-first | Group by who waits on you, not by channel. One person on Slack + email = one row                              | Akiflow critique [S7]; PR 82 gap          |
| Row          | Name · one-line AI summary (labeled) · waited time · one suggested action button                              | Superhuman, Gemini in Gmail [S8][S30]     |
| Gestures     | Swipe right = suggested action. Swipe left = later (pick time). Long-press = all actions. Haptic at threshold | iOS Mail convention (U on exact HIG text) |
| Drafts       | Draft is ready; send is always an owner tap. Keeps PR 82 "never send" rule for agents                         | PR 82                                     |
| Screener     | New senders wait in a screener; one tap to let in or block                                                    | HEY [S9]                                  |
| Feed digest  | Newsletters, social mentions, FYI: one digest, read on purpose, never in Now                                  | HEY Feed [S9]                             |
| Mode chip    | Each item shows where it gets done: In person · Online (meeting) · In app (deep link) · Reply                 | Owner vision                              |
| Budget       | Replies screen shows max ~7 people. "More" is honest about the count                                          | Finite list (PR 81 F1)                    |
| Social APIs  | X, LinkedIn, Instagram DM access is limited or paid (U). v1: mentions via email notifications; DMs later      | U: verify per platform before plan        |

## 5. Design system

See `design-principles.md`. It extends the tokens in `web/src/styles.css` (warm neutrals, indigo accent, `--row: 34px`, `--tap: 44px`).

## v1 screens (ranked)

| #   | Screen    | Purpose (1 line)                                                                    | iPhone                                          | Desktop                    |
| --- | --------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------- |
| 1   | Now       | One task, one-line why, Start / Done / Later / Delegate                             | Home tab + widget + Live Activity               | Home, `⌘1`                 |
| 2   | Brief     | 60-second day plan: meetings, people waiting, decisions, 1 focus; accept in one tap | Morning sheet over Now                          | Top of Now until accepted  |
| 3   | Replies   | People waiting on you across all channels, drafts ready                             | Tab, swipe triage                               | Split list + reader, `j/k` |
| 4   | Decisions | Agent and owner asks: approve, answer, defer, with Undo                             | Tab, badge = count due today only               | Panel, `g d`               |
| 5   | Capture   | Add anything by voice or text in under 5 s, parsed live                             | Sheet from any screen, Action Button / Shortcut | `⌘K` / global key          |
| 6   | Day       | Meetings, gaps, and placed focus blocks; in-person and online marked                | Timeline                                        | Calendar column beside Now |
| 7   | Focus     | Single task full screen: steps, notes, timer; Done goes to next                     | Full screen + Live Activity                     | Full window, `Enter`       |
| 8   | Team      | What agents did and are doing; Undo; autonomy per agent; pause all                  | Tab or from Now                                 | Panel                      |
| 9   | Shutdown  | Done today, carry-over, tomorrow's first task                                       | Evening sheet                                   | Prompt at end time         |
| 10  | Connect   | Link accounts and calendar, pick top 3 goals, first Now in under 3 min              | First run, then Settings                        | Same                       |

Merges: Home + Brief + My day become Now + Brief + Day. Needs you becomes Decisions. Inbox becomes Replies. Projects and Full stack move under search and `⌘K`, not tabs.

## Open questions (owner or plan)

| Q                         | Recommendation                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Native iPhone app or PWA? | Native SwiftUI shell for widgets, Live Activities, haptics, Action Button. Same API. Verify F7 first |
| Energy input              | Ask peak hours once in Connect; learn from start/done times later                                    |
| Social DMs in v1?         | No. Mentions via email only (U on APIs)                                                              |

## Sources

- S1 Sunsama help, setup: <https://help.sunsama.com/docs/setting-up-your-sunsama>
- S2 Sunsama reviews (3P): <https://clickup.com/blog/sunsama-review/> ; <https://www.usecarly.com/blog/sunsama-review/>
- S3 Motion, auto-scheduling: <https://usemotion.com/help/time-management/auto-scheduling/concept-auto-scheduling>
- S4 Motion review (3P, competitor): <https://www.morgen.so/blog-posts/motion-review>
- S5 Reclaim priorities: <https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically> ; <https://help.reclaim.ai/en/articles/8291694>
- S6 Akiflow features: <https://akiflow.com/features>
- S7 Akiflow critique (3P, competitor): <https://get-alfred.ai/blog/is-akiflow-worth-it>
- S8 Superhuman onboarding: <https://blog.superhuman.com/the-fastest-way-to-inbox-zero-a-single-coaching-session/> ; AI: <https://help.superhuman.com/article/519-ai>
- S9 HEY: <https://www.hey.com/how-it-works/> ; <https://hey.com/features/the-imbox/>
- S10 HEY case study (3P): <https://every.to/divinations/product-case-study-hey-627136>
- S11 Things 3 App Store: <https://apps.apple.com/app/id904237743>
- S12 Things 3 review (3P): <https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/>
- S13 Linear UI redesign (excerpts only; U on full text): <https://linear.app/now/how-we-redesigned-the-linear-ui>
- S14 Linear analysis (3P): <https://sspai.com/post/104449>
- S15 Raycast, A fresh look and feel: <https://raycast.com/blog/a-fresh-look-and-feel>
- S16 Arc (3P): <https://en.wikipedia.org/wiki/Arc_(web_browser)>
- S17 Arc paused for Dia (3P): <https://www.theregister.com/2025/05/27/arc_browser_development_ends/> ; <https://tidbits.com/2025/06/20/dia-browser-debuts-with-contextual-ai-chat-but-arc-users-feel-left-behind/>
- S18 Apple Journaling Suggestions privacy: <https://apple.com/legal/privacy/data/en/journaling-suggestions>
- S19 Finch approach: <https://help.finchcare.com/hc/en-us/articles/37935669335309-Our-Approach-to-Self-Care>
- S20 Finch review (3P): <https://makeheadway.com/blog/finch-app-review/>
- S21 Apple HIG, managing notifications: <https://developer.apple.com/design/human-interface-guidelines/managing-notifications>
- S22 WWDC23 Meet ActivityKit: <https://developer.apple.com/videos/play/wwdc2023/10184>
- S23 Calm technology: <https://en.wikipedia.org/wiki/Calm_technology> ; Case, O'Reilly: <https://oreilly.com/content/principles-calm-technology-we-are-not-bad-at-technology-technology-is-bad-at-us>
- S24 Interruption cost, Mark et al. (secondary summary; U): <https://www.toolsforhumans.ai/blog/the-47-second-attention-crisis-what-the-research-actually-says-and-doesnt>
- S25 UI patterns for AI agent governance (arXiv): <https://arxiv.org/pdf/2512.00742>
- S26 Microsoft Guidelines for Human-AI Interaction: <https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/>
- S27 Google PAIR, Explainability + Trust: <https://pair.withgoogle.com/chapter/explainability-trust/>
- S28 Apple AI summary labels after BBC errors (3P): <https://www.macrumors.com/2025/01/16/ios-18-3-news-notifications-removed/> ; <https://www.engadget.com/ai/apple-will-more-clearly-label-apple-intelligence-notification-summaries-soon-215159614.html>
- S29 WSJF: <https://framework.scaledagile.com/wsjf/> ; <https://blackswanfarming.com/wsjf-weighted-shortest-job-first/>
- S30 Gemini in Gmail: <https://support.google.com/mail/answer/16831098>
- WCAG 2.2 target size (secondary): <https://dequeuniversity.com/rules/axe/4.8/target-size>
