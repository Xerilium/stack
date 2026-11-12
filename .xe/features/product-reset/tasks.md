# Tasks: product reset

One PR per group. Tests first in each PR. `@req FR:product-reset/...` on every test.

## Stage 0

- [ ] 0a: Now Done animation and auto-advance (`FR:ui.done`, `FR:ia.now`)
- [ ] 0b: Replace "Go with it" with `Approve: {recommend}` (`FR:ui.askcard`)
- [ ] 0c: Remove `Open {host}` button; autolink refs in `markdown.ts` (`FR:ui.reflink`, `FR:schema.refs`)
- [ ] 0d: `ownerOf` everywhere; agent picker chip in NowChat (`FR:schema.agent`)
- [ ] 0e: Card hover and focus background (`FR:ui.taskcard`)
- [ ] 0f: Owner queue drops agent rows; ranks the `🙋` child (`FR:rank.owner`)
- [ ] 0g: Stale overdue cap (`FR:rank.stale`, `FR:rank.stale.score`)

## Stage 1: agent-delivery

- [ ] Headless agent run on each thread message; reply posts to the thread (`FR:connect.agents`)
- [ ] `Sign in to Claude` flow with a step list (`FR:connect.flow`)

## Stage 2: task-schema

- [ ] Fixture from the live sample shape (anonymized) with fields, note trees, column-0 notes, mixed markers
- [ ] Parser: fields, note tree, owner, refs (`FR:schema.*`)
- [ ] Round-trip test on all fixtures (`FR:schema.compat`)
- [ ] Field writes (`FR:schema.write`)
- [ ] `GET /tasks` summary fields; `GET /tasks/{ref}?view=full` (`FR:api.summary`, `FR:api.full`); openapi

## Stage 3: quality-gate

- [ ] `fixtures/verbs.txt`; checks and score (`FR:quality.rules`, `FR:quality.score`)
- [ ] `stack task check` (`FR:api.check`); `POST /tasks/{ref}/enrich` (`FR:api.enrich`)
- [ ] `docs/task-rubric.md`; link from CoS agent files (`FR:quality.rubric`)
- [ ] Ranker: owner field, gate, blocked, stale activity sources (`FR:rank.*`); `GET /rank` fields (`FR:api.rank`)
- [ ] `Still true?` actions: Keep, Update date, Drop (`FR:rank.stale.prompt`)

## Stage 4: components

- [ ] `TaskCard`, `TaskDetail`, `Thread`, `AgentChip`, `AskCard`, `RefLink` (`FR:ui.*`)
- [ ] Test: no page draws an entity outside these components
- [ ] Remove Composer modes, `AgentTalk`, `RowDetail`

## Stages 5-11

- [ ] 5: Now surface (`FR:ia.now`)
- [ ] 6: Nav, URLs, Back, breadcrumb, pane, Tasks filters, redirects (`FR:ia.nav`, `FR:ia.removed`, `FR:ia.back`, `FR:ia.pane`, `FR:ia.tasks`)
- [ ] 7: Microsoft sign-in for calendar and mail; no-command string test (`FR:connect.rule`, `FR:connect.calendar`, `FR:connect.mail`)
- [ ] 8: My day grid with Respond, Validate, Focus blocks (`FR:ia.myday`)
- [ ] 9: Notifications (`FR:ia.notifications`)
- [ ] 10: Agents org tree (`FR:ia.agents`)
- [ ] 11: CoS wide layout (`FR:ia.cos`)
