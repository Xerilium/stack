---
id: catalyst-adoption
title: Catalyst adoption
description: Stack runs all feature, change, and fix work through the Catalyst flow, and retires the todo legacy commands
dependencies: [config]
---

# Feature: Catalyst adoption

## Purpose

Make Catalyst the only way work enters Stack code. Spec first, tests before code, PR loop to ready. Replace the todo legacy commands `/investigate-bug` and `/implement-feature`.

## Scenarios

### FR:flow: End-to-end flow

Owner needs one flow for all work so that every change has a spec, tests, and a draft PR.

- **FR:flow.create** (P1): New capability MUST use `/catalyst:create`
  - Output: `.xe/features/{id}/spec.md`, tests with `@req` tags, code, draft PR
- **FR:flow.change** (P1): Change to an existing feature MUST use `/catalyst:change`
  - Spec is edited to the new end state (living spec), not a diff
- **FR:flow.fix** (P1): A bug MUST use `/catalyst:fix`
  - A failing test that reproduces the bug MUST exist before the fix
- **FR:flow.branch** (P1): Agent branches MUST be `xe/{rollout-id}`; manual branches `{user}/{rollout-id}`
- **FR:flow.pr** (P1): Every PR MUST be a draft, titled `[Stack][Create|Change|Fix|Explore] {title}`, body prefixed `🤖 [AI]`
- **FR:flow.loop** (P2): `/catalyst:pr-loop` SHOULD run review rounds until findings are resolved or max rounds is reached
- **FR:flow.merge** (P1): Agents MUST NOT merge. Owner or sweep manager merges after gates pass
- **FR:flow.traceability** (P1): `catalyst.json` traceability MUST stay at `warning` until pilot passes, then move to `error` for `src/`

### FR:config: Project config

- **FR:config.paths** (P1): `.xe/config/catalyst.json` MUST list code paths (`src/`, `web/src/`, `scripts/`, `docs/`) and test paths. Already true
- **FR:config.bootstrap** (P2): The Catalyst plugin bootstrap MUST succeed in a clean clone (`pnpm install` then plugin setup)
- **FR:config.rollouts** (P2): Rollout files in `.xe/rollouts/` MUST be deleted when the PR is ready

### FR:pilot: Pilot change

- **FR:pilot.scope** (P1): One real, small change MUST run through `/catalyst:change` end to end before wider use
  - Candidate: add `stack start|complete|skip|resume --json` output to the `cli` feature (needed by todo tasks-only)
  - Fallback candidate: any open P2 item in `cli` or `summaries` specs
- **FR:pilot.measure** (P1): Pilot MUST record tokens, wall time, and human touches in the PR body
- **FR:pilot.exit** (P1): Pilot passes if: spec updated, failing tests written first, `@req` coverage clean, CI green, zero human edits to code
  - If it fails, record gaps in `design-decisions.md` and fix the playbook gap upstream in Catalyst

### FR:deprecate: Legacy command deprecation

todo has `.claude/commands/investigate-bug.md` and `implement-feature.md` (about 1,800 lines of commands in total). They use role-based subagents and a 1-2K token cap.

- **FR:deprecate.map** (P1): Mapping MUST be: `/investigate-bug` -> `/catalyst:fix`; `/implement-feature` -> `/catalyst:create` or `/catalyst:change`
- **FR:deprecate.stub** (P1): Phase 1: replace each legacy file body with a 3-line stub that names the Catalyst command. Keep the file name so old habits and docs still resolve
- **FR:deprecate.remove** (P2): Phase 2: delete the stubs after 2 weeks with no use, or when todo goes tasks-only (see todo `.xe/specs/todo-tasks-only`)
- **FR:deprecate.refs** (P1): All references in CLAUDE.md, agents, and docs MUST be updated in Phase 1
- **FR:deprecate.nogap** (P1): Before Phase 1, confirm Catalyst covers: spec-first, TDD, bug repro test, token budget. Any gap blocks Phase 1

## Architecture constraints

- No fork of Catalyst playbooks in Stack. Gaps go upstream (Xerilium/catalyst)
- Legacy PowerShell workflows are out of scope. Only the command wrappers are retired

## Dependencies

- Catalyst plugin and `@xerilium/catalyst` npm package
- `.xe/process/development.md`
