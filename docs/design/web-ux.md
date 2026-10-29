# Web UX redesign

> **Update (round 3):** home is now **Today** (`g t`): your day plan from now, **Needs you** (🙋 decisions), **Your AI team** (🤖/🪄 work), and project tiles. The Now view below is **Focus** (`g n`). Source of truth: `.xe/features/web-app/spec.md` (FR:today.*); screens in `screens/r3-*`.

Why: v1 UI mirrored the file (907-row card wall, notes inline, permanent capture box). Acceptance proved parity, not usability. Reference research: designer notes (Linear, Things 3, Superhuman, Akiflow, Sunsama, Todoist).

## Journeys (time budget)

| # | Journey | Budget | Answer |
|---|---|---|---|
| J1 | What do I do NOW | <2s, no scroll | **Now** home: one focus task + the other Active tasks |
| J2 | Start / finish a task | 1 key | `s` start, `d` done on focus or any row; undo toast |
| J3 | Add a task | <5s | `c` or `⌘K`: overlay line, live parse preview, `Enter` |
| J4 | Every project's top task | 1 glance | **Projects** table: top task, open count, capacity bar |
| J5 | Defer / reschedule | 2 keys | `z` menu: 2h, tomorrow, next week (suspend api) |

## Layout

- Slim left rail (192px, dimmed): Now, Projects, All tasks; project list with counts. Collapses to bottom tab bar <800px.
- Content max 760px, centered. Calm: one accent, soft borders, no cards-in-cards.
- **Now**: Focus block (title large, project, chips, Start/Done/Defer with key hints) → "Active" rows grouped by project (top-level tasks only; subtask progress `2/5`) → "Up next" per project: first task only.
- **Projects**: one 40px row per project: emoji+name, top task title, `open`, capacity bar. Enter drills into project.
- **All tasks / project**: single-line rows 32px: checkbox · title · glyph chips · due · `▸ 2/5`. Sections are collapsible headers (Active open, Up next open, rest collapsed). Notes + subtasks expand with `→`/`Space`; never inline by default.
- **Focus mode** (`Enter` on a row): full-height single task, subtasks as checklist, notes rendered, `Esc` back.
- Capture: overlay palette, not a permanent box. Demo/live banner: 24px strip.

## Rows
Title cleaned of markers. Priority/status/effort/impact → small glyph chips (emoji kept, names in tooltip). Due date as text, red when past. Done rows hidden by default.

## Keyboard
`⌘K` palette · `c` capture · `g n/p/a` go · `j/k` move · `Enter` focus · `e` edit · `x` select · `s` start · `d` done · `z` defer · `p t f i` props · `/` search · `?` help. Visible hints in UI.

## Visual
System UI font (SF), 13px rows / 15px body / 28px focus title; tabular nums. Neutral warm grays, accent #5b6cff-family, semantic: red overdue, amber blocked, green done. 150ms ease-out transitions; reduced-motion respected. Dark designed separately. Optimistic writes with undo; no spinners.

## Acceptance
Designer rubric all ≥4; screenshots 1440/1024/390 × light/dark in PR; side-by-side vs Linear + Things 3 recorded in `docs/design/web-ux-review.md`.

## Round 4 (Oct 29): shell

The frame moved to its own spec, `.xe/features/web-shell/spec.md`: Home / My day / Needs you / Projects / Full stack, chords `g h / g d / g k / g p / g a`, phone shell under 720px, `main` fills the window with a 960px measure (1200px on My day). Names and breakpoints above that disagree are superseded by that spec.
## Agent team (AI on every page)

Spec: `.xe/features/agent-team/spec.md`. Every task row carries its active agent as a quiet chip (hover or cursor; always when it carries state: `Working`, `Needs you`, a verdict, `Done · $0.12`). `a` opens a flat inline composer under the row (To picker, text, Keep open, Review / Do it / Plan); `R` runs a read-only review whose verdict replaces the chip (`Partial · needs 4` in the warning color, `Can · 2h` green, `Can't`). The ask card and the Today project tiles carry the same chip and composer. Screens: `screens/team-*.png`. Designer rounds: round 1 scored verdict 2 / mobile density 2 / composer 3; round 2 flattened the composer (no card in a card, ghost Send until text, name-only To), gave verdicts their state color, and hid quiet chips on touch rows that are not the cursor.
