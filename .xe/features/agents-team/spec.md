---
id: agents-team
title: Agents: My Team
author: flanakin
description: "The Agents page opens on an org chart of the owner's primary agents; selecting one shows its chat below; other sessions sit behind a toggle"
dependencies: [agent-team, agent-sessions, web-app]
---

# Feature: Agents: My Team

## Purpose

The org tree with every session under every agent is noisy. The owner keeps one session per primary agent. The Agents page shows those agents as a chart, one chat at a time, and hides the rest.

## Scope

- In: the web Agents page (`SessionsView`), pure helpers in `web/src/chart.ts`.
- Out: server, API, agent definitions, the new-session composer (unchanged), PR 66 task thread.

## Scenarios

### FR:chart: My team chart

- **FR:chart.primary** (P1): A primary agent is the roll-up, or an agent with a definition file that covers a project or has a report. Metadata-only agents and workers with no scope are not primary
- **FR:chart.tree** (P1): `orgChart` returns the primary agents as a tree by `reportsTo`, the roll-up first. A primary agent whose manager is not primary moves under its nearest primary ancestor, else it is a root. Siblings follow project priority, then team order. A cycle never recurses
- **FR:chart.card** (P1): Each agent is one card with its own border and gap: name, role, project chips, a state dot (needs you, running) and the chat count. Each card is one button; clicking it selects the agent
- **FR:chart.layout** (P1): At 720px and wider the chart is a top-down tree with connector lines; below 720px it is an indented list with a left rail. No horizontal page scroll at 375px
- **FR:chart.keys** (P2): `j`/`k` or arrows move the selection through the chart in paint order

### FR:chat: Primary chat

- **FR:chat.list** (P1): `chatsFor` returns the sessions matched to the agent, newest first (title match as in `FR:agent-team/org.match`)
- **FR:chat.show** (P1): Selecting an agent opens its newest chat under the chart, inline (no overlay). The roll-up is selected on first paint
- **FR:chat.tabs** (P1): With more than one chat, tabs list them, newest first and selected; clicking a tab opens that chat. One chat shows no tabs
- **FR:chat.empty** (P1): An agent with no chat shows a quiet note and a `Start chat` button that opens the new-session composer with the agent chosen

### FR:other: Other sessions

- **FR:other.hidden** (P1): By default no session of a non-primary agent or of no agent appears. `otherSessions` returns every session not matched to a primary agent
- **FR:other.toggle** (P1): A two-button toggle `My team` / `Other sessions` switches the page. The choice survives a reload (existing `stack.agents.group` key: `team` is My team, anything else is Other sessions)
- **FR:other.list** (P1): Other sessions is the project-grouped list (existing rows, drawer and pins). Without a team the page shows this list only
