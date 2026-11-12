# Design audit: every view against the global rules

Rules: `docs/design-system.md`. Severity: **H** = breaks trust or hides a feature; **M** = confusing or inconsistent; **L** = polish. Status: **Fixed** = in this PR (global CSS or the targeted surfaces); **Next** = proposed follow-up, for review before the per-page Fluent restyle.

Global fixes in this PR (all views): pointer, hover, and focus ring on clickable rows and cards; key badges hidden on every button, link button, and menu item (chords stay in `?` help and the palette); `span.chip` facts drawn as plain text.

## Now

| Violation                                                          | Sev | Fix                                                           | Status |
| ------------------------------------------------------------------ | --- | ------------------------------------------------------------- | ------ |
| `Done d` / `Defer n` show key badges                               | M   | Global: badges hidden                                         | Fixed  |
| Message composer `To` is a select of agents                        | H   | Use the shared `Composer` chips (owning agent first)          | Next   |
| No outcome hint on Done / Defer                                    | M   | One-line hint under the actions, as in the task detail        | Next   |

## My day

| Violation                                                          | Sev | Fix                                                           | Status |
| ------------------------------------------------------------------ | --- | ------------------------------------------------------------- | ------ |
| Rows open only on double-click; no pointer, hover, or chevron      | H   | Click/tap opens the detail; pointer, hover, focus, `›`        | Fixed  |
| Delegate (🪄) on rows, which no longer makes sense                 | H   | Message `<agent>` icon opens the composer                     | Fixed  |
| Don't-fit rows open only on double-click                           | M   | Click opens; pointer and hover                                | Fixed  |
| `+30m ]`, `Only Thu ⏎`, `Every Thu ⇧⏎` key badges                  | M   | Global: badges hidden                                         | Fixed  |
| Header times look like text but are a button                       | M   | Underline on hover plus pencil icon                           | Next   |
| `Reply` on agent rows has no outcome hint                          | L   | Shared composer with Ask / Do it                              | Next   |

## Task detail (Focus mode and the in-row detail)

| Violation                                                          | Sev | Fix                                                           | Status |
| ------------------------------------------------------------------ | --- | ------------------------------------------------------------- | ------ |
| `Start s` / `Done d` / `Defer z` key badges                        | H   | Plain verbs plus one-line outcome hint                        | Fixed  |
| `Critical`, `30 min` look like buttons, do nothing                 | H   | Priority and effort pickers that save with Undo               | Fixed  |
| `Nov 2` does not say start or due; not editable                    | H   | `Due Nov 2` with a date picker and `No date`                  | Fixed  |
| `To` dropdown; `CoS` name                                          | H   | Agent chips with avatars; role when the name is the slug      | Fixed  |
| `Assign` / `Review` / `Keep open` unclear                          | H   | `Ask` \| `Do it` segmented control with a one-line outcome    | Fixed  |
| In-row detail `⤢ ⏎` icon-only Open button                          | M   | Label it `Open`                                               | Fixed  |

## Needs you (Asks)

| Violation                                                          | Sev | Fix                                                           | Status |
| ------------------------------------------------------------------ | --- | ------------------------------------------------------------- | ------ |
| 13 key badges on action buttons (`Details o`, `Show details e`, …) | M   | Global: badges hidden                                         | Fixed  |
| Ask composer uses the `To` select and Keep open                    | H   | Shared `Composer`                                             | Next   |
| Collapsed rows: no chevron                                         | M   | Trailing `›`; the card opens in place                         | Next   |
| `Reject` acts at once                                              | M   | Undo toast (exists); add the outcome hint                     | Next   |

## Inbox

| Violation                                                          | Sev | Fix                                                           | Status |
| ------------------------------------------------------------------ | --- | ------------------------------------------------------------- | ------ |
| Rows are clickable, no chevron                                     | M   | Trailing `›`; pointer and hover (global)                      | Next   |
| Row actions have no outcome hint                                   | L   | One-line hint under the action group                          | Next   |

## Agents (Sessions)

| Violation                                                          | Sev | Fix                                                           | Status |
| ------------------------------------------------------------------ | --- | ------------------------------------------------------------- | ------ |
| 10 key badges (`New n`, `Usage c`, `Stop s`, `Send ⏎`, …)          | M   | Global: badges hidden                                         | Fixed  |
| Project scope chips (`all projects`) look like buttons             | M   | Plain text (global)                                           | Fixed  |
| `Stop` ends a run with no confirm or Undo                          | H   | Confirm: `Stop <agent>? Work so far is kept.`                 | Next   |
| Agent names: some are slugs (`allyte-cos`)                         | M   | One display-name rule (`displayName`) everywhere              | Next   |
| PRIs status uses a select of 5 values                              | L   | Segmented control                                             | Next   |
| PRIs `Remove item` acts at once                                    | M   | Undo toast                                                    | Next   |

## Projects

| Violation                                                          | Sev | Fix                                                           | Status |
| ------------------------------------------------------------------ | --- | ------------------------------------------------------------- | ------ |
| Project rows open the list, no chevron                             | M   | Trailing `›`                                                  | Next   |
| Load bar has no text for the over state                            | L   | `Over by 2h` text                                             | Next   |

## Full stack (list)

| Violation                                                          | Sev | Fix                                                           | Status |
| ------------------------------------------------------------------ | --- | ------------------------------------------------------------- | ------ |
| Filters are 5 selects of short lists (State, Status, …)            | M   | Chips or segmented controls; keep select for Project          | Next   |
| Row chips (`Crit`, `30m`) open a picker but read as tags           | M   | Same picker control as the task detail                        | Next   |
| `＋` set-properties chip hidden until hover                         | M   | Always visible on touch; label `Set properties`               | Next   |
| Expanded row detail had key badges                                 | H   | Shared task detail actions                                    | Fixed  |

## Home / Top asks

| Violation                                                          | Sev | Fix                                                           | Status |
| ------------------------------------------------------------------ | --- | ------------------------------------------------------------- | ------ |
| `Start s`, `Done d`, `More time ]`, `I have 1–4` key badges        | M   | Global: badges hidden                                         | Fixed  |
| `…` menu offers Delegate                                           | M   | Replace with Message `<agent>` (shared composer)              | Next   |
| Top-ask rows: no chevron                                           | M   | Trailing `›`                                                  | Next   |

## Settings

| Violation                                                          | Sev | Fix                                                           | Status |
| ------------------------------------------------------------------ | --- | ------------------------------------------------------------- | ------ |
| No Settings view: schedule, calendar, and agents are set in files  | M   | A Settings page on the Fluent tokens                          | Next   |

## Onboarding

| Violation                                                          | Sev | Fix                                                           | Status |
| ------------------------------------------------------------------ | --- | ------------------------------------------------------------- | ------ |
| Step buttons say `Next` without the outcome                        | L   | `Connect calendar`, `Save schedule`                           | Next   |
| Uses its own colors, not tokens                                    | L   | Move to `--fl-*` tokens                                       | Next   |

## Cross-view

| Violation                                                          | Sev | Fix                                                           | Status |
| ------------------------------------------------------------------ | --- | ------------------------------------------------------------- | ------ |
| Floating row composer (`AgentTalk`, Today tiles, Asks) keeps the select and Keep open | H | Replace with the shared `Composer` | Next |
| Rail chords show on hover                                          | L   | Keep (nav hint, not a button action); review                  | Next   |
