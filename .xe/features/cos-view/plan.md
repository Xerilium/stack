# Plan

1. `web/src/brief.ts`: pure `briefOf` (meetings, messages, actions, one, ninety).
2. `web/tests/brief.test.ts` first (fails), then code.
3. `web/src/BriefView.tsx`: draws it; cards reuse `actionsFor` and `useAsks.answer`.
4. `nav.ts`, `types.ts`, `filters.ts`, `App.tsx`: add `brief` view, `Experimental` tag.
5. `web/e2e/brief.spec.ts`; screenshots 1280 and 375.
6. Draft PR stacked on top-asks home (#79).

## Meetings source

1. `src/core/meetings.ts`: `parseMeetings` (pure) and `readMeetings`; route `GET /meetings`; openapi.
2. `web/src/weekly.ts`: `expandWeekly`, `enrich`; `brief.ts`: owner, topic, `freeUntil`.
3. `App.tsx`: fetch `/meetings` with the calendar; pick the layer; `BriefView` shows them.
4. Tests first: `tests/core/meetings.test.ts`, `tests/api/meetings.test.ts`, `web/tests/weekly.test.ts`, `brief.test.ts`, `brief.spec.ts`.
5. `.stack/meetings.md` sample from the owner's weekly schedule.
