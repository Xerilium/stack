# Plan

Tests first, one target at a time.

1. `web/tests/nav.test.ts`, `web/tests/filters.test.ts`: new rail, tab bar, chords, default view, `#/brief` alias (fail).
2. `web/src/nav.ts`, `web/src/filters.ts`, `web/src/types.ts`: drop `brief`, Now first, `home` out of RAIL and TABBAR, `LABEL.home = 'Top asks'`.
3. `web/e2e/nowscreen.spec.ts`: meetings, messages, one-tap answer, `{n} more`, empty lines, clamp, 44 px (fail). `web/e2e/shell.spec.ts`: nav words. Delete `web/e2e/brief.spec.ts`. Home tests go to `#/home` on purpose.
4. `web/src/NowView.tsx` + `nowscreen.css`: `Next` and `Waiting on you` sections from `briefOf`; title clamp.
5. `web/src/App.tsx`: pass `brief` and `layer` to Now; remove `BriefView`, `briefAi`, the AI fetch, the `go-brief` command. Delete `BriefView.tsx`, `briefAi.ts`, `tests/brief-ai.test.ts`; drop `api.briefSummary`.
6. `web/src/styles.css`: delete `.brief-*` and `.exp` rules that nothing uses.
7. Screenshots after: `docs/ux-review/after/`. Stop the server. Draft PR.
