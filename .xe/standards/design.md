# Design standard

The one design language for every Stack view. Tokens: `web/src/ui/tokens.css`. Components: `web/src/ui/` (`FR:ui-kit`). Build rule: `.xe/standards/ui.md`. Control rules: `docs/design-system.md`.

## Principles

- Calm. Neutral surfaces, one accent. Color means state, never decoration.
- One shape for one job. A page header, a card, a chip, and a flag look the same on every page.
- Text first. A fact is plain text. Only a control looks like a control.
- The whole target. A card or a row that opens something is one click target.

## Color

| Role          | Token                                       | Use                                                             |
| ------------- | ------------------------------------------- | --------------------------------------------------------------- |
| Page          | `--bg`                                      | The page background.                                            |
| Surface       | `--panel`                                   | Cards, panes, inputs, menus.                                    |
| Sunken        | `--sunken`, `--chip`                        | Wells, code, neutral chips, loading bars.                       |
| Hover, press  | `--hover`, `--pressed`                      | Row, card and quiet button states.                              |
| Ink           | `--ink`, `--ink2`, `--muted`                | Titles and body, secondary text, meta and captions.             |
| Line          | `--line`, `--line2`, `--line-strong`        | Dividers, faint dividers, control borders.                      |
| Accent        | `--accent`, `--accent-fg`, `--accent-soft`  | Primary button, links and the chosen item, the chosen-item fill. |
| Focus         | `--focus`                                   | The 2 px focus ring.                                            |
| State         | `--ok`, `--warn`, `--danger`                | Passing or done, needs attention, failed or destructive.        |

- One accent: Stack indigo. Do not add a second accent or a per-page color.
- At most one primary (filled accent) button in a view. Other buttons are default or subtle.
- Do not write a hex value in a view stylesheet. Add a token when a role is missing.
- Text is 4.5:1 on its surface. The focus ring and control borders that carry meaning are 3:1. Light and dark both.
- The `--fl-*` color names are aliases of these roles. They are valid in existing code.

## Type

One font (`--fl-font`, the system font). Five sizes. Weights: 400 body, 600 emphasis and controls, 650 titles.

| Step     | Size / line | Token          | Use                                              |
| -------- | ----------- | -------------- | ------------------------------------------------ |
| Caption  | 12 / 16     | `--fl-caption` | Meta, counts, times, flags, chips, table heads.  |
| Body     | 14 / 20     | `--fl-body`    | Rows, body text, controls.                       |
| Subtitle | 16 / 22     | `--fl-sub2`    | Card titles, section headings.                   |
| Heading  | 20 / 28     | `--fl-sub1`    | The page title (`PageHeader`).                   |
| Title    | 28 / 36     | `--fl-title`   | Full-screen moments only: Now, install, onboarding. |

- No text under 12 px.
- A section label is caption size, 600, uppercase, `--muted`. Use it for group names in a list, not for page titles.
- Sentence case everywhere. Numbers use tabular figures.
- `--fs-*` are older names. Do not use them in new code.

## Space

4 px grid: 4, 8, 12, 16, 20, 24, 32, 48 (`--fl-s-xs` to `--fl-s-xxxl`, `--s-48`).

- Inside a control: 8 to 12. Inside a card or pane: 16. Between cards: 12. Between sections: 32.
- Page header to content: 20.
- Every page starts at the same left edge and top edge of the main pane. A page does not add its own outer margin.
- Reading measure: 960 px. A form or settings page: 720 px.

## Shape and depth

- Radius: 4 px for controls and chips, 8 px for cards and panes, pill for counts only. `--r-*` are older names.
- Flat by default: a 1 px `--line` border. `--fl-shadow4` only for a card that floats over content. `--fl-shadow16` for menus and dialogs.
- Motion: 100 ms for feedback, 200 ms to enter. None with reduced motion.

## Components

| Need                         | Use                         | Rule                                                                                          |
| ---------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| Page top                     | `PageHeader`                | Every page has one `h1`. Meta (a count, an "as of" time) follows it. Actions sit at the right. |
| State of an item             | `StatusChip`                | A dot and one word on a tint. Tones: neutral, info, ok, warn, bad. Never a button.            |
| A note on an item            | `Flag`                      | An icon and a muted word. No fill, no border, no hover, not focusable.                        |
| A list item that opens       | `SelectCard`                | The whole card is the target. Links and tools on it stay separate. It ends in a chevron.      |
| Actions on an item           | `ActionMenu`, `ActionBar`   | The menu on a card; the same actions as a bar in a detail pane.                               |
| Views of one page            | `Tabs`                      | The chosen tab has the accent underline.                                                      |
| List and detail              | `SplitView`                 | Side by side when wide. The detail replaces the list when narrow.                             |
| Nothing to show              | `EmptyState`                | What is empty, then the next step. Left-aligned text, no art.                                 |
| Data on the way              | `Loading`                   | Gray bars where rows will be. Not the word "Loading" alone.                                   |
| Load failed                  | `ErrorState`                | What happened, what to do, and `Retry`.                                                   |

- A status word has one tone on every page: the same word never shows in two colors.
- A row in a plain list (a table of projects, a task list) is one target too: the row has the hover state and the pointer, not only its title.
- Counts in navigation are a pill. Counts in content are plain text.

## Access

- WCAG 2.2 AA. Targets: 44 px on touch, 24 px on desktop.
- Every state shows in text, not by color alone.
- Phone first: every page works at 375 px with no sideways scroll.

## Migration

Views move to this standard one page per PR. A moved page uses `PageHeader`, the page states, `StatusChip` and `Flag`, the type ramp, and no hex values.
