# Stack rebuild roadmap

Goal: replace the legacy markdown todo prototype (`~/dev/todo`) with `@xerilium/stack`. Full feature breakdown lives in the blueprint ([PR 5](https://github.com/Xerilium/stack/pull/5)); this is the build order. Legacy specs: `~/dev/todo/.xe/specs/*`.

| # | Slice | Legacy spec | Status |
| - | ----- | ----------- | ------ |
| 1 | Recurring roll (pure fn) | recurring-rows | PR 6 |
| 2 | Task file parser + lossless serializer (`src/core/parser.ts`) | project-summary, set-task-properties | this PR |
| 3 | Emoji model + config (weights, time blocks) | config-management, task-scoring | next |
| 4 | Scoring + sort (effort divisor, outcome effort, placement) | task-scoring | |
| 5 | Lifecycle ops: start, complete (calls recurring roll), skip/park, resume, suspend, remove-completed, set-properties | start/complete/skip/resume/suspend-task, remove-completed-tasks | |
| 6 | Summaries: README.md, stack.md, projects.md, my-day | main/stack/project/daily-summary, update-summary | |
| 7 | Start-date/suspend sweeps (⏰, 💤) | update-start-dates | |
| 8 | CLI (`src/cli`): init, add-project, all ops, update | npm-scripts, add-project, claude-commands | |
| 9 | Git commit layer + GitHub Actions | github-actions | |
| 10 | 🔎 GitHub query tasks | github-query-tasks | |
| 11 | AI commands (triage/assist), iMessage | ai-assist, agent-imessage | |

Rules: spec first, tests first, one draft PR per slice, never auto-merge.

Known legacy format quirks the parser must tolerate: UTF-8 BOM, `> ` blockquote notes under tasks, `🔄 Weekly: 📅 Mondays:` (🔄 before 📅, non-date 📅), metadata bullets (`- **Key:** value`), section headings like `## 🔄 Active`.
