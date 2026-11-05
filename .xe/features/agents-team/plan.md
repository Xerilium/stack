# Plan: Agents: My Team

1. `web/src/chart.ts`: `isPrimary`, `primaryTeam`, `orgChart`, `chatsFor`, `otherSessions` (pure, tested in `web/tests/chart.test.ts`).
2. `SessionsView.tsx`: team mode renders the chart + inline chat (`Drawer inline`); other mode renders `otherSessions` by project; header toggle.
3. `sessions.css`: chart cards, connectors, tabs, inline drawer, 375px list.
4. e2e `sessions.spec.ts`: replace org tree scenarios; screenshots via `e2e/shoot-agents.mjs` at 1280 and 375.

Decision: "primary" is derived (no new field) so no server or file change is needed. PR 66 (task thread) edits `App.tsx`, `views.tsx`, `team.css`; this change touches none of them. PR 73 (merged org tree) is replaced in the Agents view; `org.ts` composer helpers stay.
