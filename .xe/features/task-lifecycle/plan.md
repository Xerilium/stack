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
- Multi-file ops write file by file; a conflict stops the run and earlier files stay written.

## Lifecycle-gaps change

- **Due dates**: `sweepDueDates` ports `Update-TaskDates` step 2; runs inside `sweep` after the ⏰/💤 line pass on the re-parsed text. Moves use the parser's section tree. Deviations from legacy: 🔻 is replaced too; the whole task block moves; it lands above the first Active task row, not above the section description.
- **Year**: one helper picks the nearest of last/this/next year for a month/day (and time); used by 💤 and 📅. ⏰ keeps the six-month rule.
- **Ref guard**: optional `TaskRef.text`, checked in `rowAt`; mismatch throws `ConflictError` (CLI exit 3, `--expect`).
- **Single commit**: `Storage.writeMany` (Memory, Fs, Git) plus `writeAll` helper. Git commits all paths once and pushes once. `sweep` and `stack update` use it. `--queries` refresh is opt-in and still writes per file.
- Tests first: lifecycle year/due/guard cases, storage `writeMany` cases, CLI e2e (one commit, --expect, --queries with an injected client).

## Known limitations

- A `TaskRef` without `text` is a bare line index; the file version check still stops silent overwrites.
- `removeCompleted` and query refresh still commit per file.

## Verification

Besides the committed synthetic goldens, a local run on a COPY of the live legacy tasks (never committed) matched: `nextTask` = README top task; start/complete/skip/suspend changed the same line identically to the legacy commands; `removeCompleted` output was byte-identical across all 12 files.
