---
id: web-app
title: Web App Plan
---

# Plan: Web App

## Approach

`web/` is its own pnpm package (Preact, Vite). Pure logic lives in plain `.ts` modules with unit tests; Preact components stay thin. The api gains two additive routes in `src/api/edit.ts`, wired into `ROUTES`, the scope table, and OpenAPI.

## Contracts

- `web/src/row.ts` (`parseRow`, effort minutes), `markdown.ts` (`renderMarkdown`), `filters.ts`, `reorder.ts` (`moveTarget`), `capacity.ts`, `palette.ts` (`fuzzyScore`, commands), `api.ts` (client), `App.tsx` and views
- `src/api/edit.ts`: `editTask`, `moveTask` over `Storage`

## Decisions

- Preact over vanilla: many stateful views; 4 KB runtime, JSX built by Vite's esbuild (no plugin dependency)
- Hash routing (`#/list?...`) so SWA needs no fallback rule and filters survive reload
- Row chips come from client parsing of the row text; the api stays the single writer
- Drag uses pointer events on a handle (works for mouse and touch); keyboard and buttons give the same move
- Bulk edit is client-side, one `set` per row, ordered; no new bulk route
- CSP forbids inline script; markdown is escaped before formatting
- Tests: vitest + jsdom for units (`web/tests`), Playwright for e2e with `page.route` mocking `/api` and `/.auth/me` against the built app served by `vite preview`; screenshots at 1280x800 and 375x812 saved to `web/e2e/screenshots`
- Root `pnpm lint` and `pnpm build` extend to web; root jest keeps its own roots
