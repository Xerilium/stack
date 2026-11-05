# Plan: Top Asks Home

1. `web/src/home.ts`: `homeOf` returns `{one, fits, instead, projects}`; remove `next`, `five`, and `shown`. Add pure `topAsksOf(h)`: the project rows without the NOW project.
2. `web/src/views.tsx` `HomeView`: remove Up next, Only have 5 min, and the fold; draw `Top asks` (`data-testid="top-asks"`) from `topAsksOf`, with the live dot and a polite count region; rows animate on mount once the list is armed.
3. `web/src/App.tsx`: cursor rows = NOW (and fit task) then `topAsksOf` rows; drop `allProjects` state; pass the live status.
4. `web/src/styles.css`: row grid (project, title, time, countdown), `.top-live` dot, fade-in keyframes with a reduced-motion guard.
5. Tests: `web/tests/home.test.ts` (unit, `topAsksOf`), `web/e2e/top-asks.spec.ts` (rows, live update, mobile), update Home specs that read Up next.
6. Docs: `docs/ranking.md`, web-app spec lines for `home.next`, `home2.five`, `home2.fold`, `home.projects`.
