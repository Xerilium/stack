# Plan: task-lifecycle

## Approach

- `src/core/lifecycle.ts` only; `recurring.ts`, `summaries.ts` untouched (roll API called as-is).
- Pure line functions (`applyTaskProps`, `renderProjectFile`, suspend date formatting) hold the legacy text rules; async operations load docs via `Storage`, edit a copy of `project.lines`, and write `lines.join('\n')` with `expectedVersion`. Untouched lines are never rewritten, so BOM/CRLF survive.
- `nextTask` runs `toScoringProject` per file plus `rankTasks`; refs map back by replaying the adapter's Active-section walk (unchecked rows only), so ids line up.
- Dates use wall-clock parts in `config.timezone` (Intl), compared as naive UTC numbers.
- Resume target is the first `🅿️` task in file order (legacy used the README parking-lot order, which is document order).

## Tests (written first)

`tests/core/lifecycle.test.ts` on `MemoryStorage` plus an `FsStorage` temp dir: per-FR cases, lossless (BOM/CRLF) checks, conflict, and golden fixtures in `tests/fixtures/lifecycle/` (synthetic inputs; expected outputs produced by running the legacy PowerShell on a copy of the inputs).

## Decisions

- Legacy whitespace collapse on Set-Task edits is kept (parity); skip/resume do not collapse (parity).
- Due-date escalation and query-task refresh stay out (follow-ups).
- Multi-file ops write file by file; a conflict stops the run and earlier files stay written.
