---
id: settings
title: Settings
author: flanakin
description: "One view for accounts, agent delivery and updates. Work views never manage them."
dependencies:
  [
    connect-accounts,
    agent-delivery,
    devops-installer,
    web-shell,
    task-detail-design,
  ]
---

<!-- markdownlint-disable single-title -->

# Feature: Settings

## Purpose

The owner has 6 Microsoft accounts. He wants to see all of them, and their state, on one screen. Now is for the next thing to do, not for setup. Settings is the one place for accounts, agent delivery and updates. Other views show at most one quiet line that links here.

## Scope

- In: the Settings view and its entry points, the Accounts section (`FR:connect-accounts/web.*`), Agents delivery, Updates.
- Later (not built): a Notifications section. Until it exists, Settings shows no empty section and no placeholder.

## Architecture Constraints

- Fluent 2 tokens and controls only (`docs/design-system.md`, `web/src/fluent2.css`): the view root has class `fl`.
- No owner-facing string names a CLI command, a script, an environment variable, a terminal or a docs path (`FR:product-reset/connect.rule`).
- Settings reads the same routes the rest of the app reads. It adds one read: the delivery summary (`FR:agents.api`).

## Scenarios

### FR:view: The view

The owner needs one place to set things up, so the views that do work stay small.

- **FR:view.route** (P1): `#/settings` opens Settings. `#/settings/accounts`, `#/settings/agents` and `#/settings/updates` open it scrolled to that section.
- **FR:view.entry** (P1): The desktop rail footer has a `Settings` item with a gear icon, above `Commands`. On a phone, `More` opens the command palette, which has `Go to Settings`. The chord is `g ,`.
- **FR:view.sections** (P1): Sections, in order: `Accounts`, `Agents`, `Updates`. Each is an `h2` with a one-line summary under it. Accounts is first.
- **FR:view.fit** (P1): At 375 px and at 1280 px wide the view has no horizontal scroll. Touch targets are 44 px high on touch screens. axe finds no violations in light or dark.

### FR:agents: Agents delivery

The owner needs to see whether agents get his messages, so he can fix the sign-in without reading config files.

- **FR:agents.api** (P1): `GET /inbox/delivery` with no `ref` returns `{mode, login}` (owner only; 404 where the host does not deliver). With a `ref` it returns the per-row state (`FR:agent-delivery/state.api`).
- **FR:agents.state** (P1): The section shows one row: `Delivery` with `On` (mode `claude`) or `Off`, and `Claude sign-in` with `Signed in`, `Sign-in expired` or `Unknown`. When the sign-in is expired or unknown it has `Sign in to Claude` (`FR:agent-delivery/login.signin`). When the host does not deliver (404), the section says `Agents answer from Stack on your Mac.` and shows no control.
- **FR:agents.off** (P2): When delivery is off, the row says `Turn it on in Stack settings on your Mac.` No config key is named.

### FR:updates: Updates

The owner needs to pick when updates install from Settings, so he does not wait for the update chip.

- **FR:updates.modes** (P1): The section shows the four update modes as a radio group with the words of `FR:devops-installer/notice.words`. Picking one posts `POST /api/version/mode` (`FR:devops-installer/version.mode`) and announces `Saved`.
- **FR:updates.builds** (P1): Under the modes: the running build and `Up to date` or `Update ready` with `Restart now` when the host can restart (`FR:devops-installer/notice.restart`).
- **FR:updates.none** (P1): When `GET /api/version` is 404 (no installer on this host), the section says `Updates come with the desktop app.` and shows no control.

## Data Model

- **Delivery summary**: `{mode: claude|off, login: ok|expired|unknown}`.
- **Section**: `accounts`, `agents` or `updates`, from `#/settings/<section>`.

## External Dependencies

- None beyond the Stack host routes.

## Dependencies

- connect-accounts (the Accounts section), agent-delivery (delivery summary and Claude sign-in), devops-installer (update modes and restart), web-shell (nav and chords), task-detail-design (design rules).
