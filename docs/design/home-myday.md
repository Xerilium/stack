# Home and My day: design

Feedback: `todo/.stack/stack-v2-feedback-2026-10-28.md` (Time and schedule, Home). Specs: `.xe/features/home`, `.xe/features/schedule`. Supersedes the Today layout in [web-ux.md](web-ux.md). Tokens: `web/src/styles.css` only (owned by stack-ux).

**Split:** Home = what to do *now* and whether it fits. My day = the schedule, wake to bed. Needs you, AI team, project tiles leave Today; Home carries one line for them.

## Journeys

| # | Job | Budget | Answer | References (principle copied) |
|---|---|---|---|---|
| J1 | What now, and does it fit? | <2s, no scroll | Home hero: one task, estimate, due countdown, window | Things 3 Today (one calm list, no chrome); Sunsama focus (one task + its time) |
| J2 | Act on it | 1 key / 1 tap | `s` `d` `n` `a` on hero or any row; optimistic + undo | Superhuman (act, undo toast, never a spinner); Linear (`a` assign, key hints on hover) |
| J3 | Say how much time I have | <3s | Window line + `h` picks (Home); Available ± (My day) | Notion Calendar/Amie menu bar ("Sync in 45m"); Sunsama workload warning |
| J4 | See my day | <5s glance | My day: bands, meetings, tasks, now line; past and no-fit collapsed | Notion Calendar/Amie timeline (bands, now line); Things 3 This Evening (day split by part) |
| J5 | Top of every project | 1 glance | Home: Up next (2) + one row per project | Stack README (Top/Up next/Other priorities); Linear My issues (one line each) |
| J6 | Hand it off | 1 key | `a` marks 🪄, row leaves my plan | Linear assign; Superhuman remind/snooze (leave inbox, come back) |

## Home

```text
Project time · 11:12p                                    My day ▸ 2h 05m free · bed 2:00a   g t
2h 48m until bed                              I have  [15m] [30m] [1h] [2h]   h
┌ Allyte · 1h · due in 2h 48m ────────────────────────────────────────────────┐
│ Add MVP to my LinkedIn profile                                       28px   │
│ [Start s]  [Done d]  [Not now n]  [🪄 Delegate a]                           │
└─────────────────────────────────────────────────────────────────────────────┘
🙋 2 to decide · 4 asks · 1 CI failing                                   g k
UP NEXT
○ Check MVP benefits                              Allyte    12m
○ Send W9 to FOCUS                                FOCUS     30m   1d late
TOP OF EACH PROJECT
○ Pay bills                                       Personal  ~30m  in 3d
○ Schedule FTK v15 blog post                      FinOps    1h    in 1d   … one row per project
```

- **Hero** = the first ranked candidate (`planCandidates`) that fits the window. Eyebrow `{Project} · {estimate} · {countdown}`; no chips, no tags. Title 28px, wraps max 2 lines then ellipsis.
- **Fits** = `min(estimate, 120) ≤ window`; unset effort counts 30m and shows `~30m`; a task over 2h shows `4h · 2h now`.
- **Top doesn't fit** → line above hero, hero = the fitting task: `No time for {title} ({est}): {window} until {what}. This fits:`. Quiet button `Start anyway` (no key). Title truncates at 40ch.
- **Nothing fits, window ≥10m** → `Nothing fits in {window}.` + the smallest candidate as hero labelled `Smallest`.
- **Window <10m** → hero = the commitment: `{what} in 8m` + `Join J` when it has a link; Up next stays.
- **Window** = minutes until the next of: busy meeting, personal block start, bed. Copy `{span} until {Allyte sync | Family time | bed}`. At ≤5m the line turns `--accent`.
- **I have**: picks 15m/30m/1h/2h; the pick matching the default is outlined. A pick overrides the window from now until it elapses, then reverts (memory only; `stack.available` stays the only stored key). Shown as `You have 30m · Reset`. Overrides personal time and bed (he decides, the app doesn't lecture).
- **Up next** = ranked 2..3 (mine, not 🙋/🤖/🪄), excluding the hero. **Top of each project** = each project's top task not already shown above (else its next one); project order = README order; projects with nothing open are hidden.
- **Asks line**: one line, counts only, hidden at zero. Each count is a link to Asks (`g k`). Never a card on Home.
- **My day link** (top right): `{free} free · bed {time}`; in a personal block `{label} until {time}`.

### Home states

| State | Show |
|---|---|
| In a meeting | Hero: `In {subject} · {span} left` + `Join J`. Below: `After: {task} ({est})` as Up next #1. No Start button |
| Personal block | Eyebrow `{label} · until {time}`; hero only from tasks with the block's emoji; else `{label} time. Back at {time}: {task}` muted, no buttons. `h` still overrides |
| After bed (awake) | Eyebrow `Past bed · 2:00a`; hero = first task, muted, label `First up tomorrow`; window line `I have` picks only. A pick restores the full hero |
| Asleep / before wake | Header `Tomorrow from 8:00a`; same as above |
| No schedule | 9a-6p frame; window line suffix `· set your hours` (link to docs on time blocks), once |
| No calendar | Window ignores meetings; suffix `· no calendar` muted |
| Nothing open | `Nothing on the stack.` + `Add one: c` |
| 900 tasks | Never more than 1 + 2 + 12 rows; ranking memoized per task-list change |
| Load error | Existing gate; Home never shows stale "offline" without a working Retry |

## My day

```text
Thursday, Oct 29 · 8:00a–2:00a                                 Available  [−] 2h 45m [+]  Reset
2h 05m planned · 1 meeting · bed 2:00a
[day bar: wake ─ bands ─ meetings ─ blocks ─ now ─ bed, proportional]
▸ Earlier · 8:00a–11:00p · 6 done · 3 meetings
PROJECT · 11:00p–2:00a                                         sticky band header
11:12p ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ now line
11:15p  ○ Add MVP to my LinkedIn profile        Allyte · 12m · due in 2h      ▶ ↷ 🪄
11:30p  ▍ Allyte founders sync  11:30p–12:00a                                  Join
12:00a  ○ Send W9 to FOCUS                       FOCUS · 30m · 1d late         ▶ ↷ 🪄
12:30a  ┄ 1h 30m free
▸ 41 don't fit · 3 due soon                                                  +30m ]
```

- **Frame**: wake→bed (`dayFrame`). Past bands collapse into one `Earlier` row (expandable: done tasks struck, meetings dimmed). Current band onward is open.
- **Bands** = schedule blocks as sticky 28px headers `{LABEL} · {start}–{end}`; personal bands use `--muted` text and a 3px hatched left rule; an empty personal band is the header only.
- **Rows** (34px, one line): time gutter 56px · tick · title · `{project} · {est} · {countdown}` · actions. Meetings: 3px `--line` rule, `--chip` fill, `Join` link. Free gaps ≥15m: dashed, `{span} free`, no action. Gaps <15m are not drawn.
- **Now line**: 2px `--accent` between rows at the current minute, gutter label `11:12p`; a row in progress gets an accent left edge.
- **Doesn't fit**: one collapsed line at the end; `{n} don't fit` + `· {k} due soon` in `--warn` when any are at risk. Expanded: at-risk first, max 12, then `{n} later`. The header never carries a red at-risk line.
- **Available ±** stays (30m steps, `[` `]`, Reset); default = focus time left (`budgetOf`). Header h1 `{planned} planned` with `of {available}` dimmed.
- Removed from this view: Needs you cards, AI team, project tiles, the big lead card (Home owns it).

### My day states

| State | Show |
|---|---|
| Empty plan, time left | `Nothing planned. ] adds time, c adds a task.` |
| Available 0 | `No time set. Add some: ]` |
| No schedule | 9a–6p; header suffix `· default hours` |
| No calendar | Header suffix `· no calendar`; meetings absent |
| After bed / asleep | Next waking day from wake, header `Tomorrow from 8:00a`; today collapses into `Earlier` |
| 900 tasks | Plan holds only what fits; no-fit list capped at 12 |

## Countdowns (every due, both views)

Date-only due = bed of that date's waking day (else 11:59p). Ticks on the minute, no animation.

| Time to due | Copy | Style |
|---|---|---|
| ≥7d | `Nov 12` | `--muted` |
| 1–6d | `in 3d` | `--muted` |
| 3–24h | `in 5h` | `--ink2`, 600 |
| 1–3h | `in 2h 48m` | `--ink2`, 600 |
| <1h | `in 42m` | `--warn` |
| late <24h | `5h late` | `--warn` |
| late 1–30d | `3d late` | `--warn` |
| late >30d | `stale` | `--muted` |

Hero eyebrow prefixes `due ` (`due in 2h 48m`); rows omit it. Tabular numerals.

## Keyboard (new keys `n` `a` `h` are unbound in `App.tsx`)

| Key | Home | My day |
|---|---|---|
| `s` / `d` | Start / Done (hero, or cursor row) | same, cursor row |
| `n` | Not now: defer 2h, one key (= `z 1`) | same |
| `z` | Defer menu (1 later today, 2 tomorrow, 3 next week) | same |
| `a` | Delegate: add 🪄, row leaves the plan | same |
| `h` then `1`–`4`, `0` | I have 15m/30m/1h/2h, `0` resets | — |
| `[` `]` | — | Available ∓30m |
| `j` `k` / `Enter` | Move hero → Up next → projects / Focus mode | Move rows / Focus mode |
| `J` | Join meeting now or within 10m | same |
| `g h` / `g t` | Home / My day (`g t` keeps its muscle memory) | |

Touch: tick 44px; tap a row opens an inline 44px strip `Start · Not now · 🪄 · Open`; tap again closes. Key hints hidden on touch.

## Copy (exact)

Buttons `Start` `Done` `Not now` `Delegate` `Start anyway` `Join` `Reset`. Toasts (with `Undo`): `Done` · `Not now: back at {time}` · `🪄 Delegated to the {project} agent` · `Deferred: tomorrow`. Labels `Up next` `Top of each project` `Earlier` `I have` `Available`.

## Layout

| Width | Home | My day |
|---|---|---|
| 1440 | 2 cols: left 640 (window, hero, asks line, Up next), right 360 (Top of each project). All visible at 900px tall | 1 col 760 centered; actions visible on cursor/hover |
| 1024 | 1 col 720: projects below Up next | 1 col 720 |
| 390 | 1 col, 16px gutter. Window line, then picks as 4×44px chips. Hero: `Start` full width, then `Done` `Not now` `🪄` in a row. Projects show 5 + `{n} more` | Gutter 48px, meta drops project, actions via tap strip |

## Motion

Done/Delegate/Not now on the hero: hero fades out 120ms, Up next #1 slides into the hero slot 180ms ease-out (FLIP), list closes up 150ms. Collapse/expand 150ms height. Window going ≤5m: color change only. Now line: no animation. `prefers-reduced-motion`: instant. Live region (polite) announces state changes only: `Allyte sync started`, `Window: 30m`.

## Requests to stack-ux (nav, one line each)

- Add `Home` as first tab and default view (`g h`); rename `Today` → `My day` (`g t`); retire the `Focus` tab (`g n` aliases Home; Focus mode via `Enter` stays). Mobile tabs: Home, My day, Asks, Projects, +.
- Asks view takes the 🙋 task decisions and AI-team status that leave Today, so Home's one line has one destination.

Open questions for Michael: none.
