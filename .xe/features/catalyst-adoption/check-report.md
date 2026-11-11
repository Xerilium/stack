# Catalyst conformance check

Date: 2026-11-10. Branch: `xe/catalyst-conformance`. Base: `main` at `33d5f66` (PRs 75-119 merged). Catalyst: plugin and `@xerilium/catalyst` 0.3.3.

## Verdict

Mostly conforms. The flow (specs, `@req` tests, branches, PR titles, draft PRs) is followed. Drift is in spec format, frontmatter dependencies, and the blueprint. Headless Catalyst skills still fail on login, so the playbooks ran by hand and through the `catalyst` CLI.

## Method

| Check          | How                                                  | Result                                                                                            |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Config         | Read `.xe/config/catalyst.json`                      | Valid. Code and test paths match the repo. Traceability at `warning` (per `FR:flow.traceability`) |
| Plugin         | `.claude/settings.json`                              | `catalyst@xerilium` enabled at project scope. `@xerilium/catalyst` 0.3.3 is a devDependency       |
| Headless skill | `claude -p "reply OK"`                               | Fail: "OAuth session expired". Same as the pilot                                                  |
| Doc quality    | `npx catalyst check`                                 | 0 errors, 607 warnings                                                                            |
| Traceability   | `npx catalyst traceability`                          | 96% (1,344 reqs). Code 84%, test 94%. 56 uncovered                                                |
| Dependencies   | `npx catalyst deps`                                  | 129 errors in 12 features (exit 1)                                                                |
| Blueprint      | `start-blueprint.md` by hand                         | Updated (issue 4)                                                                                 |
| PR conventions | `gh pr list` for 75-119                              | All conform                                                                                       |
| PR review      | `review-pull-request.md` phases 1-4 on 112, 113, 117 | 8 findings, all new to humans                                                                     |

## What conforms

- Layout: 55 feature folders in `.xe/features/{id}/` with `spec.md`. `plan.md` where work was planned. Root docs (`product.md`, `architecture.md`, `engineering.md`, `customer-journey.md`, `process/development.md`, `standards/`) are present
- `process/development.md` follows the Catalyst template. It is changed on purpose to autonomous mode (agents do not wait on a human)
- Branches: all `xe/{rollout-id}`
- PR titles: all `[Stack][Create|Change|Fix|Explore] {title}`. Bodies start with `🤖 [AI]`
- Rollouts: `.xe/rollouts/` holds only `README.md`. No stale rollout files
- Traceability: P1 coverage 97%

## What drifts

| #   | Drift                                                                                                                                           | Size   | Action                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| 1   | Blueprint listed 21 of 55 features; the roadmap had no spec links                                                                               | Large  | Fixed: regenerated from spec frontmatter                    |
| 2   | `CONTRIBUTING.md` said `[Catalyst][Create]` titles                                                                                              | Small  | Fixed                                                       |
| 3   | `FR:catalyst-adoption/flow.pr` left out `Explore`                                                                                               | Small  | Fixed                                                       |
| 4   | `config` uses `@req FR:recurring-rows/...` but did not list it as a dependency                                                                  | Small  | Fixed                                                       |
| 5   | 128 frontmatter dependencies have no `@req` link in the spec (`catalyst deps`)                                                                  | Medium | Open: add one `@req` per dependency, or drop the dependency |
| 6   | `spec.opener` (212) and `spec.refs` (203): FRs start with code, not a plain sentence                                                            | Medium | Open: fix when each spec is next changed                    |
| 7   | `spec.sections` (107): specs miss `Data Model`, `Architecture Constraints`, or `External Dependencies`                                          | Medium | Open: add "None" sections when touched                      |
| 8   | `spec.one-req` (52): one FR holds more than one MUST                                                                                            | Medium | Open: split when touched                                    |
| 9   | `comms-connectors`, `stack-app`, `security-review` have no `spec.md` (research only). `now-screen` and `ux-consolidation` depend on `stack-app` | Small  | Open: move research to an explore folder or write specs     |
| 10  | `agents-team` and `agent-team` are two features with near-same names                                                                            | Small  | Open: merge or rename                                       |
| 11  | Rollout files were committed and left behind for many PRs. They were cleaned in 119. Catalyst treats them as untracked scratch                  | Small  | Open: add `.xe/rollouts/rollout-*.md` to `.gitignore`       |
| 12  | Catalyst default PR title is Conventional Commits. Stack overrides it. The override is only in `CONTRIBUTING.md` and the catalyst-adoption spec | Small  | OK: the playbook prefers repo rules                         |
| 13  | Phase 2 features (Now, Home, shell) depend on Phase 3 features (ask queue). Phases do not follow the strategy order                             | Note   | Recorded in the blueprint                                   |
| 14  | `catalyst-adoption` has 0 of 19 requirements traced                                                                                             | Small  | Open: tag the docs and config that meet them                |

## PR review: findings humans missed

None of the 3 PRs had inline human comments. Copilot did not run (quota). Every finding below is new.

| PR                                                | Severity   | Where                                                               | Problem                                                                                                     | On main      |
| ------------------------------------------------- | ---------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------ |
| [112](https://github.com/Xerilium/stack/pull/112) | Should fix | `src/host/push.ts:84`                                               | Push check runs before the ask-write response. One dead endpoint can hold the write for 10 s or more        | Open         |
| [112](https://github.com/Xerilium/stack/pull/112) | Should fix | `src/api/push.ts:108-116`                                           | Ledger read and write have no lock. Cron and ask-write checks can overlap and push twice                    | Open         |
| [112](https://github.com/Xerilium/stack/pull/112) | Suggestion | `src/host/runtime.ts:141`                                           | Check lists 200 asks by score, not deadline. A low-score ask that is due soon can be skipped                | Open         |
| [113](https://github.com/Xerilium/stack/pull/113) | Should fix | `desktop/src/shell.ts:96-97`                                        | `activate` or `second-instance` before the host starts reads `host!.url` and crashes the main process       | Open         |
| [113](https://github.com/Xerilium/stack/pull/113) | Suggestion | `.xe/features/desktop-shell/spec.md:36`, `desktop/src/policy.ts:38` | Spec lists a `cwd` input that `hostPlan` does not take. Same-origin window-open behavior is not in the spec | Open         |
| [117](https://github.com/Xerilium/stack/pull/117) | Should fix | `.xe/features/cos-view/spec.md`                                     | Prose deprecation tags, and FRs still active after the Brief page was removed                               | Fixed in 119 |
| [117](https://github.com/Xerilium/stack/pull/117) | Suggestion | `web/e2e/mock.ts:7-8`                                               | `dueTier` and `STALE_DAYS` are copied from core with no parity test                                         | Open         |

Next: open one `[Stack][Fix]` PR for the 3 push and desktop should-fix items (each needs a failing test first).

## Cost

| Item                                       | Tokens                     | Wall time                        |
| ------------------------------------------ | -------------------------- | -------------------------------- |
| `catalyst check` + `traceability` + `deps` | 0 (local CLI)              | under 2 s total                  |
| PR review, 3 PRs (phases 1-4)              | about 92K each, 275K total | about 45 s each, run in parallel |
| Blueprint update (script from frontmatter) | about 30K                  | about 5 min                      |
| Whole check (this session)                 | about 450K                 | about 25 min                     |
| Targeted tests (`deploy`, `reliability`)   | 0                          | 53 s                             |

## What broke

- Headless `claude -p` fails with "OAuth session expired". No `/catalyst:*` skill can run unattended
- Each plugin skill runs a bootstrap that installs `@xerilium/catalyst` if missing. It is already a devDependency, so the pilot note "no Catalyst npm dependency is needed" is out of date
- `pr-review` phases 5-6 need a human choice (AUQ) and then post to GitHub. They were skipped: the PRs are merged, so posting would only add noise
- `catalyst deps` exits 1 on frontmatter warnings, so it cannot gate CI yet

## Human-only steps

1. Run `claude /login` so headless `/catalyst:*` skills work
2. Review the blueprint update for issue 4: phase placement and the Phase 2/3 note
3. Decide on drift 10 (`agents-team` and `agent-team`)
