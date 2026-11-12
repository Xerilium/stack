---
id: cos-base-of-ops
title: Chief of Staff view (base of ops)
author: flanakin
description: "The page the owner opens first each day: the CoS's latest report, then compact summaries of decisions, priorities, PRs, agents, and the next meetings. It composes the views that already exist; it holds no state of its own. No LLM call."
dependencies: [cos-view, ux-consolidation, status-ingest, ask-queue, pris-sessions-ui, pr-page, session-inventory, agent-inbox, agent-team]
---

<!-- markdownlint-disable single-title -->

# Feature: Chief of Staff view

## Purpose

The owner said: "CoS isn't as helpful right now because I don't have a CoS view in Stack v2. I need Stack to be my trusted base of ops." This page is that base. It is a composition, never a second copy: each section is a compact summary drawn by the same component as its full view, with a link to that view. The only new content is the CoS's own brief and the `Message the CoS` box. Agent contract: `docs/cos-reporting.md`.

## Scope

- In: `#/cos`, its nav entry, the brief from the CoS's latest `stack report`, the message box, the composed sections, `GET /reports`, `#/prs` deep links.
- Out: new stores, new actions for things other views already do, model calls, delivery of inbox messages to a running agent (`agent-delivery`).

## Overlap

Every section reads one data source through one component. The CoS view keeps no copy of any data and no store.

| View | What it shows | What the CoS view shows | One source |
| --- | --- | --- | --- |
| Needs you | Every open ask, with every answer | Top 3 asks as `NowAsks` cards, `{n} more in Needs you` | `useAsks` (`GET /asks`, `GET /needs-you`) |
| Needs you, Priorities block | Every priority, inline edit | `PrisBlock` (same rows, same inline status edit) | `usePrisSessions` (`GET /pris`) |
| Needs you, Sessions block | Sessions that wait on the owner or are stuck | `SessionsBlock` | `usePrisSessions` (`GET /session-inventory`) |
| Pull requests flyout | PR rows per group, escalation set, every PR action | Count per group and the escalation PRs, each a link that opens the flyout | `usePrBoard` (the one shared PR store, `GET /prs`) |
| Now | One task, next meetings, top asks | `NowNext` (next 2 meetings) | the App's calendar and weekly schedule |
| Agents | Team chart, sessions, talk | Link only | `useTeam`, `useSessions` |
| (new) | — | The CoS's brief: top 3, blockers, progress, report age | `GET /reports` (`~/.stack/reports.json`) |
| (new) | — | `Message the CoS` | `POST /inbox` |

## Scenarios

### FR:route: Route and nav

- **FR:route.view** (P1): `#/cos` opens the Chief of Staff view. `#/prs` and `#/prs?tab={group}` also open it, with the PR flyout open on that tab (`blocked`, `waiting`, `processing`, `pending`, `paused`, `escalations`). Closing the flyout leaves `#/cos`
- **FR:route.nav** (P1): The rail lists the view first, before Now, named with the CoS's display name (`name` of the roll-up agent, `FR:agent-team/agent.team.rollup`) and avatar; with no roll-up agent the name is `Chief of Staff`. The chord is `g c`. The palette entry is `Go to Chief of Staff`. The phone tab bar does not change; the view is under More
- **FR:route.landing** (P2): An empty hash still opens Now (`FR:ux-consolidation/one.start`). Reason: Now owns the one task; parallel work depends on that default. The owner can pin `#/cos` as the start page

### FR:state: Honest state

- **FR:state.none** (P1): The view keeps no state of its own. Every section reads the shared hook or store of its full view; an answer, edit, or nudge goes through that view's component
- **FR:state.report** (P1): The CoS report is the newest report in `GET /reports` whose `agent` is the roll-up agent's slug. A report for project `all` wins over a newer one for a single project
- **FR:state.age** (P1): The header shows the CoS avatar and name and `Last report 12m ago` (`just now`, `{n}m`, `{n}h`, `{n}d`). The full time is in the `title`
- **FR:state.stale** (P1): With no report, the header says `CoS has not reported yet`. With a report older than 24 h, it says `CoS has not reported since {weekday, month, day, time}`. Both show `Ask for a report`, which sends the instruction of `FR:msg.ask`. A stale report still shows, under the line `From {age} ago`
- **FR:state.line** (P1): One line under the name: `{n} need you` (open asks), `{n} blocked` (blockers in a fresh CoS report), `{n} moving` (running sessions). A part shows only when its source loaded; a missing source is never a `0`. With no part: no line
- **FR:state.off** (P1): A section whose source is absent on this host (404) says so in one line (`PR board is off on this host`, `No priorities store on this host`); it never shows an empty list as if there were no items

### FR:brief: The CoS brief (new content)

- **FR:brief.top** (P1): `Top 3` lists the report's `top` items in order. An item with a `link` is a link (new tab)
- **FR:brief.blockers** (P1): `Blockers` lists the report's blockers, warn tone. Hidden when there are none
- **FR:brief.progress** (P1): `Progress` lists the report's progress items. Hidden when there are none
- **FR:brief.asks** (P1): The report's asks are not drawn here: they are Needs you items and show in `Decisions` (`FR:compose.decisions`)

### FR:compose: Composed sections

- **FR:compose.decisions** (P1): `Decisions` draws the top 3 open asks with `NowAsks` (its head reads `Waiting on you`, as on Now), the same list and order as Now (`FR:ux-consolidation/one.messages`). Every answer (approve, choose, answer, snooze, open) is the card's own (`FR:ux-consolidation/one.expand`, `FR:ux-consolidation/one.answer`). `{n} more in Needs you`, else `Open Needs you`, opens Needs you
- **FR:compose.pris** (P1): `Priorities` draws `PrisBlock` from the same hook as Needs you: order, status, items done of total, and inline status edit. `PrisBlock` shows the last update age per priority and flags a stale one (no status, or the newest of `statusAt` and the newest weekly note is older than 7 days, the `stack pris gaps` rule `FR:pris-aware-ranking/cos.gaps.kinds`). Needs you shows the same flags, because it is the same component
- **FR:compose.prs** (P1): `Pull requests` shows, from the one PR store, a count per group in the PR page order with its PR page label (`TAB_LABEL`), and up to 3 escalation PRs (blocked first, then enable, then live validation), each with its title and blocker. Each count and each PR opens the PR flyout on its tab (`#/prs?tab=…`); the PR's own link opens GitHub in a new tab. The actions (Accept, Apply Autopilot, queue moves) stay in the flyout
- **FR:compose.team** (P1): `Agents` draws `SessionsBlock` (sessions that wait on the owner or are stuck, by project) and `{n} running` from the inventory, with `Open Agents`
- **FR:compose.today** (P1): `Today` draws `NowNext` (next 2 meetings, calendar honesty) and `Open My day`

### FR:msg: Message the CoS (new content)

- **FR:msg.box** (P1): A labelled field `Message the CoS` and `Send` sit at the top. `Enter` sends, `Shift+Enter` is a line break (folded to ` / `). Text is 1-1000 characters
- **FR:msg.send** (P1): Send calls `POST /inbox` with `kind: 'instruction'` on the CoS anchor row and shows `Sent to {name}`. The field clears only on success. On failure the text stays and the toast names the error
- **FR:msg.anchor** (P1): The anchor row is the first open top-level task whose owner is the CoS (`ownerOf`, `FR:task-detail-design/compose.to`), Active sections first; else the first open top-level task. With no open task, the box is disabled and says `Add a task first: messages attach to a task`
- **FR:msg.ask** (P1): `Ask for a report` sends `Send your status report now (docs/cos-reporting.md).` as an instruction through `FR:msg.send`

### FR:api: Read the reports

- **FR:api.list** (P1): `GET /reports` (route `reports.list`, scope `tasks:read`, owner only; a token gets `403`) returns `{items}`: `ReportStore.list()` (`FR:status-ingest/store.read`). A host with no store returns `404`. The route is in `docs/api/openapi.yaml`

### FR:layout: Layout and look

- **FR:layout.grid** (P1): At 375 px: one column, no horizontal scroll, 44 px targets. At 1100 px and wider: the brief and Decisions in the main column; Priorities, Pull requests, Agents, Today in the side column
- **FR:layout.look** (P1): Fluent 2 tokens (`fluent2.css`), plain labels, section heads as eyebrows, no shortcut badges. Links look like links (accent, underline on hover); buttons look like buttons. axe finds no violation

### FR:doc: Agent contract

- **FR:doc.contract** (P1): `docs/cos-reporting.md` (at most 50 lines) says what the CoS sends each check-in so this view is complete: the report (`stack report --agent <cos> --project all` with top, asks with briefs, blockers, progress), priority status (`stack pris note`), the PR escalation set (`stack pr-pri escalate`), and reading the inbox. It ends with a copy-paste final-step block
