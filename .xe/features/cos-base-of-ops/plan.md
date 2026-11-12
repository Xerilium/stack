# Plan

Tests first, then code. Compose; never copy.

1. `tests/api/reports.test.ts`: `GET /reports` (owner, 403 token, 404 no store). Then the route in `src/api/handler.ts`, `src/api/openapi.ts`, `pnpm openapi`.
2. `web/tests/cos.test.ts`: `cosReport`, `reportState`, `stateLine`, `anchorFor`, `prSummary`. `web/tests/nav.test.ts`, `web/tests/filters.test.ts`: `cos` first, `g c`, `#/prs`. `web/tests/pris.test.ts`: `priAge`.
3. `web/e2e/cos.spec.ts`: header, stale line, Ask for a report, brief, decisions answer, priorities, PR deep link, message send; axe; 375 and 1280.
4. `web/src/cos.ts` (pure), `web/src/CosView.tsx`, `web/src/cos.css`.
5. Shared: `PrsPanel.tsx` exports `usePrBoard` and opens on `#/prs`; `PrisSessions.tsx` shows the age and stale flag.
6. `App.tsx`: the view, rail label, `prisSessions` active on `cos`.
7. `docs/cos-reporting.md`.
