# Design principles: Stack CoS app

Evidence: `research-ux.md` (S-numbers). Extends `web/src/styles.css` tokens. Proposal; not built.

## Principles (ranked)

| #   | Principle                                                                                                                                       | Test                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | **One thing.** Each screen has one focal point. Now shows one task; all else is one tap away                                                    | Owner knows what to do in < 2 s, no scroll                       |
| 2   | **Speak only when it matters.** CoS speaks at 3 moments: brief, transitions, shutdown. Push only for "act within 1 hour"                        | ≤ 3 pushes a day; 0 repeats of the same ask                      |
| 3   | **Do, then offer Undo.** Act on reversible work and show it. Show intent before visible work. Stop and ask before a send or an irreversible act | No approval prompt for an undoable act                           |
| 4   | **Every pick has a reason.** One line, top 2 factors + fit. Tap for the full breakdown                                                          | Why line ≤ 60 chars on every Now and Brief item                  |
| 5   | **Calm by default.** Neutral base, one accent, no streaks, no unread counts except "due today". Empty = win state                               | No red unless overdue or blocked                                 |
| 6   | **Same brain, two bodies.** iPhone = glance, triage, go. Desktop = plan, deep work. Same data, words, and actions                               | Every action exists on both; keys on desktop, gestures on iPhone |
| 7   | **Fast as thought.** Optimistic writes < 100 ms, no spinners for writes, every action has a key                                                 | p95 tap-to-feedback < 100 ms                                     |
| 8   | **Accessible is the default.** Not a later pass                                                                                                 | Checks below pass on every screen                                |

## Tokens

| Group                     | Light                             | Dark                              | Note                                                                      |
| ------------------------- | --------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| `bg`                      | `#fbfbfa`                         | `#111113`                         | Keep light value from styles.css; dark value proposed                     |
| `surface` / `surface-2`   | `#ffffff` / `#f4f4f2`             | `#1a1a1d` / `#222226`             | Dark: raise with lighter surface, not shadow                              |
| `ink` / `ink-2` / `muted` | `#1d1d1f` / `#4b4b50` / `#6e6e76` | `#f2f2f3` / `#c4c4c8` / `#8a8a92` | Fix: current light `#8a8a92` is 3.3:1 on `bg` (fails). `#6e6e76` is 4.9:1 |
| `line`                    | `#e7e7e4`                         | `#2c2c31`                         | Hairlines only; no boxes in boxes                                         |
| `accent`                  | `#5b5fe0`                         | `#8b8ff5`                         | One accent. Focus ring = accent                                           |
| `warn` / `ok`             | `#c2410c` / `#15803d`             | `#fb923c` / `#4ade80`             | State only: overdue, blocked, done                                        |
| `ai`                      | `ink-2` + italic                  | same                              | AI text is labeled, not colored (S28)                                     |

- Define colors in OKLCH; generate themes from 3 inputs: base, accent, contrast (Linear, S13).
- Space (4 pt grid): 4, 8, 12, 16, 24, 32, 48.
- Radius: 6 (chip), 10 (row, input), 16 (sheet, card).
- Row: desktop 34 px (`--row`); iPhone 44 pt min (`--tap`).

## Type scale

One family: system (SF Pro / SF Pro Display on Apple). Tabular numerals for times and counts. Line height 1.4-1.5 for text, 1.1-1.2 for titles.

| Role                 | iPhone (pt, Dynamic Type style) | Desktop (px) | Weight           |
| -------------------- | ------------------------------- | ------------ | ---------------- |
| Now title            | 28 (Title 1)                    | 28           | 600, display cut |
| Screen title         | 22 (Title 2)                    | 20           | 600              |
| Body / row           | 17 (Body)                       | 13           | 400              |
| Secondary / why line | 15 (Subheadline)                | 12           | 400              |
| Caption / chip       | 13 (Footnote)                   | 11           | 500              |

- iPhone uses Dynamic Type styles, not fixed sizes, so text scales with user settings.
- Max 4 sizes on one screen.

## Motion

| Token      | Duration | Easing                                | Use                                                  |
| ---------- | -------- | ------------------------------------- | ---------------------------------------------------- |
| `feedback` | 120 ms   | ease-out                              | Press, check, toggle                                 |
| `enter`    | 200 ms   | `cubic-bezier(.2,.7,.2,1)` (`--ease`) | Row in/out, Now swaps to next task                   |
| `sheet`    | 280 ms   | iOS spring / same curve on desktop    | Brief, Capture, Shutdown sheets                      |
| `reduced`  | 0-120 ms | crossfade                             | When `prefers-reduced-motion` or Reduce Motion is on |

- Motion has a job: confirm, connect, or show cause. No idle or decorative loops.
- Done on Now: check, then next task slides up from the list it came from (continuity).
- Haptics (iPhone): light at swipe threshold; success on Done; none on scroll.

## Dark and light

- Design both; do not invert. Check every screen in both.
- Follow system setting; manual override in Settings.
- Dark: lower contrast between surfaces, never pure black behind text; accent lightened (`#8b8ff5`).

## Accessibility checks

| Check         | Bar                                                                           |
| ------------- | ----------------------------------------------------------------------------- |
| Text contrast | ≥ 4.5:1; UI parts and focus ring ≥ 3:1                                        |
| Targets       | iPhone 44 pt; web ≥ 24 px (WCAG 2.2 AA 2.5.8), 44 px on touch                 |
| State         | Never color alone: glyph + text for overdue, blocked, done, AI                |
| Screen reader | Every row reads: title, why line, mode, then actions. Async changes announced |
| Keyboard      | Full tab order; visible focus; focus not hidden by sheets (WCAG 2.4.11)       |
| Text size     | Layout holds at the largest Dynamic Type size and at 200% web zoom            |
| Motion        | Reduced motion honored                                                        |

## Copy

- Shortest words that work. Verbs on buttons: Start, Done, Later, Delegate, Reply.
- Times are relative when near ("in 12 min"), absolute when far ("Thu 2:00").
- No exclamation marks; no guilt ("You missed..."). Say what is next.
