# Explore: Priorities view

UX design only. No code. Storage is out of scope. Mockups: [option-a.html](option-a.html), [option-b.html](option-b.html), [option-c.html](option-c.html). Open each file in a browser. Each has a theme toggle (auto, light, dark) and works at phone width.

## TL;DR

- **Recommend Option A (Day ledger).** One row per project. Each row shows today's pick, your one action, done today, and the time of the last check.
- A **replaces** Top asks (Home) and the Priorities block in Needs you. It becomes the first rail item. Now stays, one step down.
- You talk to the CoS from the view. Select a row to open its thread. A docked box at the bottom talks about the whole day.
- 5 yes/no decisions are at the end.

## Inputs

| Source                                                                | What it adds                                                                                                                                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `todo/.stack/daily-pris.md`, "CURRENT PRIORITIES (Nov 17)"            | The list, the weekday rules, the daily goal, "as of <time>" on every status.                                                                                                |
| [179](https://github.com/Xerilium/stack/pull/179) `pri-first-ranking` | `slot` and `days` per priority. Day order from the clock. `done today` per project from `GET /rank?daily=1`. One action per priority from the newest note after `Michael:`. |
| [181](https://github.com/Xerilium/stack/pull/181) task model          | "Show one next action, not a list." Day plan holds picks and done-today per project. Max 3 more on demand.                                                                  |
| [152](https://github.com/Xerilium/stack/issues/152)                   | "Priorities gets its own nav item (not merged with Notifications)." Every PR ref is a link. No shortcut-key badges.                                                         |
| [171](https://github.com/Xerilium/stack/issues/171)                   | Tasks need a next action and done-when. The pick text depends on this.                                                                                                      |
| [174](https://github.com/Xerilium/stack/issues/174)                   | No live-check button and no auto refresh on the PR page; keep "updated N ago". One card design everywhere.                                                                  |
| `docs/design-system.md`, `web/src/fluent2.css`                        | Fluent 2 tokens. Facts are text, not chips. Clickable rows end in `›`. 44 px targets on touch.                                                                              |
| `web/src/nav.ts`, `now-screen` spec, `pris-sessions-ui` spec          | Today: Now (one task + composer), Top asks (one row per project, off the rail), Needs you (Priorities block on top).                                                        |

## Findings

1. **Duplication exists today.** Three views show priorities or per-project picks: Top asks (one row per project, plus `done today` after [179](https://github.com/Xerilium/stack/pull/179)), the Priorities block in Needs you, and Now (row 1's pick). A new view must remove at least one of them. Else it adds noise.
2. **The day rules are data now.** [179](https://github.com/Xerilium/stack/pull/179) stores `slot` and `days`. The view only needs to show _why_ a row moved ("Wed: #1"). It does not need its own rule logic.
3. **"Pick" and "your action" are different things.** The pick is the project's task for today. Agents may own it. The human action is the one step only Michael can do. Often it is "None". A row must show both, or Michael cannot tell "agents on it" from "stuck on me".
4. **Live check needs two times.** View level: "As of 9:42 AM". Row level: the last check of that row. A row is stale after 30 min (proposal). Stale shows a ⚠ glyph plus the time, never color alone.
5. **Converse needs a scope.** A message must carry the row (priority id) or "whole day". The inbox already takes `kind: instruction` with a ref (`FR:now.compose`). A row message can use the priority id as the ref. No new channel is needed.
6. **Word budget.** Michael reads ≤20 words per row. Row = project (1-2) + pick (≤6) + action (≤4) + done glyph + time. About 14 words. The day header is ≤12 words.
7. **13 rows on Wed.** Money, QM, FH Premium, FH 0.11, FTK 16, FOCUS, PRs, Personal, then F4 (incl. Korr, Cid), Printer, Stack, Arc, Catalyst. The daily goal counts all 13. The "Then" group is visually quieter.

## Options

All three use the same row data, the same day rules and the same "as of" stamps. They differ in where the view lives and how talk works.

### Option A: Day ledger (recommended)

[option-a.html](option-a.html)

- **Where:** New first rail item **Priorities**. It replaces Top asks (`g h`) and the Priorities block in Needs you. Now stays on the rail.
- **Shape:** A table. Columns: #, Project (+ day rule), Today's pick, Your action (a button, or "None. Agents on it."), Today (✓ Done / ○ Not yet), Checked (time; ⚠ when stale).
- **Header:** Date, the active day rule, daily goal `4/13` with dots, "As of 9:42 AM", `Recheck all`.
- **Talk:** Select a row: a thread pane opens on the right (a bottom sheet on phone). It is scoped to that row. A docked box at the bottom talks about the whole day.
- **Pros:** Every row shows pick and action at a glance. Scans fast. Removes two views. Matches the [152](https://github.com/Xerilium/stack/issues/152) ask for its own nav item.
- **Cons:** A new rail item. 13 rows is more than the "1 + 3 more" rule in [181](https://github.com/Xerilium/stack/pull/181). The rows are a daily checklist, not a task list, so the rule still holds for tasks.

### Option B: Top of Now

[option-b.html](option-b.html)

- **Where:** Inside Now. No new nav item. Top asks goes away.
- **Shape:** A compact strip on top: one line per project (`pick → action`), done glyph, check time. "Then" folds into one line. Under it, the Now focus card shows the selected row's action, large.
- **Talk:** The existing Now composer. A segmented control sets scope: `This row` or `Whole day`.
- **Pros:** No new nav. Reuses Now and its composer. Strong focus on one action.
- **Cons:** It breaks the Now rule "one task, nothing competing" (`FR:now.one`). Rows truncate at narrow widths. The action is text, not a button, until selected. Now and Priorities can no longer change on their own.

### Option C: CoS thread

[option-c.html](option-c.html)

- **Where:** A rail item **Priorities** that is the CoS chat. The priorities card is pinned on top of the thread.
- **Shape:** The card lists the rows (`pick → action`, done glyph, check time, `↩` reply). Below it is the chat with the CoS.
- **Talk:** `↩` on a row quotes it into the box with an "About: FH 0.11" chip. No chip = whole day.
- **Pros:** Talk comes first. The full history is in one place. Best fit for "converse-able".
- **Cons:** Status and chat mix. The card takes a full phone screen. The chat grows, so noise grows. It overlaps the Agents view (CoS thread).

## Analysis

| Need                                       | A                                                     | B                 | C                            |
| ------------------------------------------ | ----------------------------------------------------- | ----------------- | ---------------------------- |
| One row per project, pick + action visible | Yes, columns                                          | Partly, truncates | Yes, in the card             |
| Day-aware, with the reason shown           | Yes                                                   | Yes               | Yes                          |
| Done today per project + goal              | Yes, dots                                             | Yes, count        | Yes, count                   |
| "As of" and stale marks                    | View + row                                            | View + row        | View + row                   |
| Talk scoped to a row or the day            | Pane + dock                                           | Segmented control | Quote chip                   |
| ≤20 words, no noise                        | Yes                                                   | Yes               | No, chat adds noise          |
| No new nav item                            | Adds 1, removes Top asks                              | Adds 0            | Adds 1                       |
| Removes duplicate views                    | Top asks + Needs you block                            | Top asks          | Needs you block              |
| Fits current code                          | New view; reuses `homeOf` rows and the inbox composer | Changes Now spec  | New view; reuses thread code |

## Recommendation

**Option A.** Reasons:

1. It is the only option where every row shows the pick and the action as a button, with no tap. That is the core ask.
2. It removes two duplicate views, so the net nav count does not grow (Top asks was off the rail; the Needs you block goes away).
3. Now keeps its "one thing" rule. Michael can use Priorities to plan and Now to do.
4. Row-scoped talk is a side pane, so chat never pushes the rows off screen. This fixes the main C problem.
5. Take one idea from C: show the last CoS reply as one muted line under a row that has a new reply. This is a later step, not v1.

## Decisions for Michael

1. **Option A?** yes / no (no = name B or C).
2. **Priorities is the first rail item and opens first?** yes / no (no = Now opens first).
3. **Priorities replaces Top asks and the Priorities block in Needs you?** yes / no.
4. **A row is stale after 30 min without a check?** yes / no (no = give the time).
5. **Row messages go to the CoS, not the project's agent?** yes / no (no = they go to the project agent, for example Allyte CoS).

## Next step

After the decisions: `/catalyst:create priorities-view` writes `spec.md` from Option A. It depends on [179](https://github.com/Xerilium/stack/pull/179) for day order and done-today.
