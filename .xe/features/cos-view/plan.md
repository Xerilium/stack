# Plan

1. `web/src/brief.ts`: pure `briefOf` (meetings, messages, actions, one, ninety).
2. `web/tests/brief.test.ts` first (fails), then code.
3. `web/src/BriefView.tsx`: draws it; cards reuse `actionsFor` and `useAsks.answer`.
4. `nav.ts`, `types.ts`, `filters.ts`, `App.tsx`: add `brief` view, `Experimental` tag.
5. `web/e2e/brief.spec.ts`; screenshots 1280 and 375.
6. Draft PR stacked on top-asks home (#79).
