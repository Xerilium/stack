# Web UX review (designer loop)

Shots: `docs/design/screens/`. Before = v1 list (907 tasks as cards). Reference = Linear app (`ref-linear.png`, linear.app hero); Things 3 read from MacStories review (no app access).

## Scores (1-5), final round

| Rubric | Score | Note |
|---|---|---|
| Journey fit | 4 | Now answers "what now" in one screen; hero is the engine's `/next` pick |
| Hierarchy | 4 | One focal block; rail dimmed; section labels quiet |
| Density | 4 | 34px single-line rows, subtasks/notes on demand; 100+ rows scan |
| Keyboard | 4 | j/k, Enter focus, s/d/z, c, ⌘K, g-chords; hints on buttons |
| Typography | 4 | SF/Inter, 14px rows, 28px hero, tabular nums |
| Color | 4 | Neutral + one accent; red only for overdue |
| Motion | 4 | 120-180ms fades, reduced-motion honored |
| Accessibility | 4 | Real buttons, dialogs trap focus, aria-current/selected; touch targets 44px on mobile |
| Dark | 4 | Separate palette, checked |
| States | 3 | Empty/error ok; no skeleton loading yet |

## Side by side

| | Stack (now) | Linear | Things 3 |
|---|---|---|---|
| Row height / density | 34px, 1 line | ~32px, 1 line | ~36px, airy |
| Chrome | dim rail, no top bar | dim sidebar, header bar | none; whitespace |
| Properties | emoji chips in fixed slots | monochrome icons | tags only |
| Focus | full-screen task + checklist | issue detail pane | task opens as card |
| Capture | overlay + live parse preview | C opens modal | Magic Plus |
| Defer | `z` menu (3 choices) | snooze/cycle | `This Evening`, Someday |

## Honest gaps
- Emoji chips are louder than Linear's monochrome icons; they are the user's data format, so tamed (28px slots, name on hover) not replaced. Next: optional monochrome glyph mode.
- Hero comes from `/next` scoring. In the demo data it picks a Feb 2027 recurring tax task; that is a scoring-engine issue, not UI. Follow-up: far-future due dates must not outrank Active work.
- No loading skeleton; no drag between sections; no calendar/time blocking (Sunsama/Akiflow) by design.
- Capacity bars removed: every project is over its weekly capacity on real data, so the bar carried no signal. Hours shown as text.
