---
id: task-detail-design
title: Task detail, message composer, and the global design rules
author: flanakin
description: "Controls say what they do and do what they look like. One task detail and one message composer, shared by every view; Fluent 2 tokens in one stylesheet any page can opt in to."
dependencies: [home, agent-thread, agent-team, web-app, ux-consolidation]
---

<!-- markdownlint-disable single-title -->

# Feature: Task detail, composer, and design rules

## Purpose

Owner feedback (Nov 11): My day feels like a mess. Rows do not look clickable (only double-click opened them). The detail view has buttons with key badges he does not trust. `Critical` and `30 min` look like buttons and do nothing. `Nov 2` does not say start or due. The agent dropdown is poor and shows `CoS`, not a real name. `Assign`, `Review`, and `Keep open` are unclear. He wants a Fluent 2 look, and the design rules apply to the whole app. Rules: `docs/design-system.md`. Audit of every view: `audit.md`.

## Scenarios

### FR:rules: Global design rules (every view)

- **FR:rules.doc** (P1): `docs/design-system.md` (at most 60 lines) states the global rules, the tokens, the control styles, and the choice of hand-written CSS on Fluent 2 tokens
- **FR:rules.tokens** (P1): Fluent 2 tokens (`--fl-*`: color, type ramp, radius, spacing, elevation, motion) live in one stylesheet (`web/src/fluent2.css`), imported once by the app entry, with light and dark values. Any page opts in with the class `fl`. No network at runtime; no new runtime dependency
- **FR:rules.clickable** (P1): Every clickable row and card shows a pointer cursor, a hover state, and a visible focus ring
- **FR:rules.nokeys** (P1): No button shows a shortcut-key badge. Chords live only in the `?` help and the command palette. The rail keeps its hover hint (a nav, not a button action)
- **FR:rules.facts** (P1): A fact that cannot be changed renders as plain text, never with chip or button styling

### FR:detail: The task detail

- **FR:detail.open** (P1): One click or tap on a My day row opens the task detail. Double-click and Enter on the row do the same. The row shows a pointer cursor, a hover and focus state, and a trailing chevron (`›`)
- **FR:detail.actions** (P1): The detail actions are `Start`, `Done`, and `Defer`, each with a plain verb label and no key badge. One line under the group explains the outcome of the focused or hovered action (`Start: marks it in progress`, `Done: checks it off; Undo for 8 s`, `Defer: hides it until a time you pick`). The same text is each button's `title`
- **FR:detail.undo** (P1): Done shows a toast with Undo. Defer opens the defer picker (nothing changes until a time is picked)
- **FR:detail.priority** (P1): Priority is a labelled control (`Priority: Critical`) that opens a picker: Critical, High, Normal, Low. Normal clears the marker. A row marked `Raised` shows `Raised` until changed
- **FR:detail.effort** (P1): Effort is a labelled control (`Effort: 30 min`) that opens a picker: 30 min, 1 hour, 2 hours, 4 hours, 8+ hours, None, and `Custom` (minutes). Custom saves the nearest step and says so (`Saved as 1 hour`)
- **FR:detail.due** (P1): The `📅` tag is a due date. The control reads `Due Nov 2` (`No due date` when absent) and opens a date picker with `No date`. Saving writes `📅 MMM d:` at the front of the row (`, yyyy` when not this year) through `POST /tasks/edit` with `expect`
- **FR:detail.save** (P1): Each property saves at once. The control shows `Saving…`, then `Saved` for 2 s; the toast offers Undo, which restores the previous row text. A failure shows the error and keeps the old value
- **FR:detail.facts** (P2): Project, section, and status show as plain text in the eyebrow

### FR:compose: The message composer (shared)

- **FR:compose.to** (P1): Recipients are chips with avatars, not a dropdown. The task's owning agent is first and selected. Other agents sit behind `+ Other agent`, a popover list. Each chip shows the agent's display name: its `name`, except when the name is only the slug in other case (`CoS` for `cos`), where the role is used (`Chief of Staff`). The avatar is the agent `icon` (emoji or image), else the monogram
- **FR:compose.text** (P1): The box placeholder is `Message <Name>…`. Enter sends
- **FR:compose.mode** (P1): A segmented control `Ask` | `Do it` replaces Assign, Review, and Keep open. One line under it explains the choice: `Ask: <Name> answers here; nothing changes on the task.` / `Do it: <Name> takes the task and starts work; your note goes with it.` The send button says `Ask` or `Do it`
- **FR:compose.doit** (P1): Do it assigns the task to the chosen agent with the note (if any) in the assign prompt (`POST /tasks/{ref}/assign` with `note`, at most 1000 characters), so the agent reads it at the start. Once assigned, the note is recorded on the task as a handled instruction, so the thread shows it and the inbox never hands it out again. A refused or failed assign writes nothing. Without a runner Do it is disabled with the reason (`Runs in stack web on your machine`); Ask still saves on the task
- **FR:compose.nokeep** (P2): There is no `Keep open` toggle: the reply lands in the thread above; `Open the session` reaches the live run

### FR:myday: My day rows

- **FR:myday.message** (P1): Each My day row has a message icon button (`title` and label `Message <Name>`) in place of Delegate. It opens the task detail with the composer focused and addressed to the owning agent
- **FR:myday.nodelegate** (P1): No Delegate (🪄) button on My day rows

### FR:a11y: Access

- **FR:a11y.targets** (P1): Every control in the detail, the composer, and a My day row is at least 44 px tall on touch and at 375 px. Axe reports no violations on My day and the detail at 375 and 1280 px, light and dark
- **FR:a11y.names** (P1): Pickers are buttons with `aria-haspopup` and `aria-expanded`; the segmented control is a `radiogroup`; chips are `aria-pressed` toggle buttons

## Architecture Constraints

- Shared components: `web/src/TaskDetail.tsx`, `web/src/Composer.tsx`. Pure rules (labels, options, due text) in `web/src/detail.ts`
- Preact only; Fluent 2 by hand-written CSS on tokens (decision in `docs/design-system.md`)

## Dependencies

home (`FR:myday.*`), agent-thread (thread, ask, assign), agent-team (avatars, agents for a task), web-app (focus mode), ux-consolidation (global rules apply to every view).
