# UX review: Stack web, after PRs 75-99

Date: 2026-11-10. Build: `main` at 12f48b0. Method: `stack web` demo mode on a copy of the owner's task repo (14 projects, 1086 tasks, 6 asks, 2 CoS escalations, a calendar fixture), clock fixed at 10:00. Every view shot at 375 px (touch) and 1280 px, light and dark. Judged against `design-principles.md` (P1-P8) and `research-ux.md`. Screenshots: `docs/ux-review/before/` and `docs/ux-review/after/`.

## Verdict

Four views show the same task: Now, Home, Brief, and My day. The owner asked for one place: one task at a time, plus meetings and top messages. That place is **Now**. Brief folds into it. Home leaves the nav. My day stays as the plan.

| View   | Job today                                                   | Decision                                                                                                   |
| ------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Now    | One task, why, Done / Defer / Delegate                      | **Keep. It is the one place and the start screen.** Gains next meetings and top messages, one line each    |
| Brief  | Meetings, messages, actions, one task, next 90 min, AI line | **Merge into Now** (meetings, messages, actions). Drop the 90-minute strip (My day has it) and the AI line |
| Home   | One task + I have + top row per project                     | **Demote.** Out of the rail and tab bar. Lives at `#/home` and `g h` as `Top asks`                         |
| My day | The whole day: timeline, budget, at-risk, side panel        | **Keep.** It is the plan layer; a different job                                                            |

Why Now and not Brief or Home: Now is the only screen that passes P1 (one focal point, no scroll, read in under 2 s). Brief has five sections and 1870-2204 px of scroll. Home has the window line, four chips, the hero card, and 11 project rows above the fold. Both are second layers; they cannot be the start.

## Findings (ranked)

| #   | Finding                                                                                                                                                                             | Principle   | Fix in this PR                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------- |
| 1   | Four views show the same task. The rail has nine entries. The phone tab bar does not reach Now at all (Home, My day, +, Needs you, More)                                              | P1, R-F3    | Now first in the rail and the tab bar; Brief removed; Home out of the nav         |
| 2   | Now has no meetings and no messages, so the owner must leave it for Brief or Needs you                                                                                              | Owner ask   | Now shows the next 2 meetings and the top 3 asks under the task, one line each    |
| 3   | A long task title fills the Now screen (6 lines at 375 px, 4 at 1280 px) and pushes the actions down. Row text that carries notes in parentheses is the cause                       | P1, P4      | Title clamps at 4 lines (3 on desktop); the full text stays in the tooltip        |
| 4   | `Experimental` chip in the rail overlaps the `g b` chord hint on the active Brief item (1280 px, both themes)                                                                       | P5          | Gone with Brief                                                                   |
| 5   | My day header carries seven facts in one line (at-risk, meetings, next meeting, Join, estimated, to decide, need you) before the timeline                                            | P1          | Not in this PR. Candidate: keep at-risk and next meeting; the rest into the side |
| 6   | Needs you (phone): the card stacks `Go with it`, `Open`, `Defer`, `Reply`; four actions of equal weight. The due time is warn-colored while not overdue                              | P1, P5      | Not in this PR                                                                   |
| 7   | Agents (phone): `Today 0 tokens · 0 sessions / 7 days 0` wraps into a dangling `7 days 0`                                                                                           | Copy        | Not in this PR                                                                   |
| 8   | Projects: `207.1h won't fit` in warn red on the week bars; it is always red for this repo, so it is not a signal                                                                      | P5          | Not in this PR                                                                   |
| 9   | Dark theme follows the token table (bg `#111113`, surface `#1a1a1d`, accent `#8b8ff5`); no pure black behind text. Light `--muted` is `#6e6e76` (4.9:1). Pass                         | P8          | None                                                                             |
| 10  | No horizontal overflow on any view at 375 or 1280. Empty states are win states on Now, Inbox, Needs you. Reduced motion zeroes the three motion tokens. Pass                           | P5, P8      | None                                                                             |
| 11  | Palette groups (Actions, Go to, Projects) hold at both widths. `Go to Brief (Experimental)` and `Go to Home` name views that are not the one place                                     | P6          | `Go to Brief` removed; `Go to Home` becomes `Go to Top asks`                     |

## Screenshots

Before: `docs/ux-review/before/{view}-{phone|desktop}-{light|dark}.png` for home, now, brief, myday, needs, inbox, agents, projects, stack, palette (40 files).
After: `docs/ux-review/after/now-*.png` (the merged Now) and `docs/ux-review/after/palette-*.png`.

## Out of scope, next

- My day header diet (finding 5).
- Needs you card: one primary action, the rest behind `…` (finding 6).
- Replies and Decisions split per `research-ux.md` v1 screens 3 and 4.
