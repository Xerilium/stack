# Tasks: product reset

One PR per group. Tests first in each PR. `@req FR:product-reset/...` on every test.

## Stage 0

- [ ] 0a: Now Done animation and auto-advance (`FR:ui.done`, `FR:ia.now`)
- [ ] 0b: Replace "Go with it" with `Approve: {recommend}` (`FR:ui.askcard`)
- [ ] 0c: Remove `Open {host}` button; autolink refs in `markdown.ts` (`FR:ui.reflink`, `FR:schema.refs`)
- [ ] 0d: `ownerOf` everywhere; agent picker chip in NowChat (`FR:schema.agent`)
- [ ] 0e: Card hover and focus background (`FR:ui.taskcard`)
- [ ] 0f: Owner queue drops agent rows and their unmarked children; ranks the `🙋` child (`FR:rank.owner`, `FR:schema.owner`); stop adding 🪄 on send (`FR:ui.thread`)
- [ ] 0g: Stale overdue cap with a cached last-change map (`FR:rank.stale`, `FR:rank.stale.score`)

## Stage 1: agent-delivery

- [ ] Headless agent run on each thread message; reply posts to the thread (`FR:connect.agents`)
- [ ] `Sign in to Claude` flow with a step list (`FR:connect.flow`)
- [ ] Remote message state (`FR:connect.agents.remote`)

## Stage 2: task-schema

- [ ] Fixture from the live sample shape (anonymized): fields, note trees, mixed markers, owner inheritance
- [ ] Parser: fields, note tree, owner, refs, blocked (`FR:schema.*`)
- [ ] Round-trip test on all fixtures (`FR:schema.compat`)
- [ ] Field writes (`FR:schema.write`)
- [ ] Move `ownerOf` to `src/core/agents.ts` (`FR:schema.agent`)
- [ ] `GET /tasks` summary fields; `GET /tasks/{ref}?view=full`; openapi (`FR:api.summary`, `FR:api.full`)
- [ ] Agent delivery sends `TaskFull` (`FR:connect.agents`)
- [ ] Write preconditions and moved refs (`FR:api.expect`, `FR:api.moved`)

## Stage 3: quality-gate

- [ ] `src/core/verbs.ts`; checks and score (`FR:quality.rules`, `FR:quality.score`)
- [ ] `stack task check` (`FR:cli.check`)
- [ ] Single and bulk enrich routes and batching (`FR:api.enrich`, `FR:quality.enrich`, `FR:quality.enrich.batch`)
- [ ] `docs/task-rubric.md`; link from CoS agent files (`FR:quality.rubric`)
- [ ] Ranker: owner field, gate, blocked, `Checked:` and activity sources (`FR:rank.*`); `GET /rank` fields (`FR:api.rank`)
- [ ] Needs-context item on an empty Now (`FR:rank.needs-context`)
- [ ] Routes for Keep, Update date, Drop (`FR:rank.stale.prompt`)
- [ ] Day plan: separate an empty ranking from a loading or failed one; never restore excluded rows; zero-eligible-tasks test (`FR:web-app/today.plan`)

## Stage 4: components

- [ ] `TaskCard`, `TaskDetail`, `Thread`, `AgentChip`, `AskCard`, `RefLink` (`FR:ui.*`)
- [ ] One-component e2e test (`FR:ui.test`)
- [ ] Remove Composer modes, `AgentTalk`, `RowDetail`
- [ ] Priorities on the shared components (`FR:ia.priorities`)
- [ ] Message state in Thread (`FR:ui.thread`)
- [ ] `Needs context` panel (`FR:quality.ui`) and `Still true?` prompt (`FR:rank.stale.prompt`)

## Stages 5-11

- [ ] 5: Now surface (`FR:ia.now`)
- [ ] 6: Nav, keys, URLs, Back, breadcrumb, pane, Tasks filters, redirects for home, next, focus, projects, list (`FR:ia.nav`, `FR:ia.keys`, `FR:ia.removed`, `FR:ia.back`, `FR:ia.pane`, `FR:ia.tasks`)
- [ ] 7: Microsoft sign-in for calendar and mail; GitHub device flow; no-command string test (`FR:connect.rule`, `FR:connect.rule.test`, `FR:connect.flow`, `FR:connect.calendar`, `FR:connect.mail`, `FR:connect.github`)
- [ ] 8: My day grid with Respond, Validate, Do, Focus blocks (`FR:ia.myday`)
- [ ] 9: Notifications; redirects for asks and inbox (`FR:ia.notifications`, `FR:ia.removed`)
- [ ] 10: Agents org tree (`FR:ia.agents`)
- [ ] 11: CoS wide layout (`FR:ia.cos`)
