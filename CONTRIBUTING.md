<!-- @req FR:deploy-docs/docs.process @req FR:deploy-docs/docs.links -->

# Contributing

Stack is built with the [Catalyst](https://github.com/Xerilium/catalyst) process: spec, plan, tests first, code, independent review, squash-merge on green CI.

- Specs and plans: `.xe/features/<id>/spec.md` and `plan.md`; rollouts in `.xe/rollouts/`
- Principles and standards: [.xe/engineering.md](.xe/engineering.md), [.xe/process/development.md](.xe/process/development.md)
- Start work with `/catalyst:create <feature>`, `/catalyst:change`, or `/catalyst:fix`
- Before a PR: `pnpm test && pnpm lint && pnpm build`
- PR titles: `[Stack][Create|Change|Fix|Explore] <title>`, draft first, body starts with `🤖 [AI]`
- Agents never merge to production or deploy; the owner does ([runbook](docs/runbook.md))
