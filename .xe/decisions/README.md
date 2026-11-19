# Architecture decisions

One decision per file. Product and design choices stay in [`../features/design-decisions.md`](../features/design-decisions.md).

| #    | Decision                                                                           | Status   |
| ---- | ---------------------------------------------------------------------------------- | -------- |
| 0001 | [Record architecture decisions](0001-record-architecture-decisions.md)             | Accepted |
| 0002 | [Module layers and import rule](0002-module-layers-and-import-rule.md)             | Proposed |
| 0003 | [Task store above storage, stable IDs first](0003-task-store-above-storage-with-stable-ids.md) | Proposed |
| 0004 | [One home for live state](0004-one-home-for-live-state.md)                         | Proposed |
| 0005 | [One writer path per store, one shared lock](0005-single-writer-per-store-with-shared-lock.md) | Proposed |
| 0006 | [Local host runs in the Electron main process](0006-local-host-in-electron-main-process.md) | Accepted |
| 0007 | [Web talks HTTP only; types come from OpenAPI](0007-web-talks-http-only-types-from-openapi.md) | Proposed |
| 0008 | [Test pyramid and CI budget](0008-test-pyramid-and-ci-budget.md)                   | Proposed |

## Rules

- File name: `NNNN-short-title.md`. Numbers never change.
- Status: `Proposed`, `Accepted`, or `Superseded by NNNN`.
- The owner accepts a decision. An agent only proposes.
- Keep each file under one page: Context, Decision, Consequences, Evidence.
- To change a decision, add a new file. Do not rewrite an accepted one.
