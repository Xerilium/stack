---
id: ui-kit
title: Shared UI components
author: flanakin
description: "One component set for list views: a selectable card, a flag, a status chip, an actions menu, and an actions bar."
dependencies: [web-shell]
---

<!-- markdownlint-disable single-title -->

# Feature: Shared UI components

## Purpose

The owner needs every list view to look and act the same so that he reads a PR, a priority, or a task the same way. Views build on these components; they do not build cards, flags, chips, or menus from scratch.

## Scope

- In: `web/src/ui/` (`SelectCard`, `Flag`, `StatusChip`, `ActionMenu`, `ActionBar`, `Tabs`, `SplitView`, `useWide`) and `web/src/ui/ui.css`.
- Out: what a view puts in them (its words, tones, and actions), and the written UI rule (`ux-consolidation`).

## Scenarios

### FR:card: Selectable card

- **FR:card** (P1): `SelectCard` is one list item: an optional top line (links, flags, chips), a title, an optional sub line, an optional tools column, and a chevron (`›`). The chevron is 28 px, in a 44 px column at the right edge, centred on the full card height. One button covers the card; a tap or click anywhere that is not a link or a tool selects it, and Enter or Space on it does the same. Links and tools sit above it. `selected` sets `aria-current` and a focus-colored outline. `sr` is text read after the title by assistive tech only. With `label`, the title and sub line sit outside the button, so links in them stay links, and the button (the chevron, stretched over the card) is named `label`. A view sets the tone with the CSS variables `--ui-edge`, `--ui-soft`, `--ui-strong`, `--ui-ink`, `--ui-ink2`, and the class `strong`. Cards in a `ui-cards` list have 14 px between them and 14 px padding inside

### FR:flag: Flag

- **FR:flag** (P1): `Flag` notes something about an item: a 12 px flag icon and the word in muted text. It is a `span`: no fill, no border, no hover state, default cursor, not focusable, no role. `hidden` hides it from assistive tech when the same words are read elsewhere. In a card top line it sits at the right

### FR:chip: Status chip

- **FR:chip** (P1): `StatusChip` shows a state word: a dot and the word on a light tint of the tone (`neutral`, `info`, `ok`, `warn`, `bad`). It is a `span`: no border, no hover state, default cursor, not focusable. It is never a button. Text meets WCAG AA in light and dark

### FR:menu: Actions menu

- **FR:menu** (P1): `ActionMenu` is one quiet icon button `⋯` (name from `name`, `aria-haspopup="menu"`, `aria-expanded`; no fill until hover or open) and a menu (`role=menu`, same name) of `menuitem`s. An item with `href` is a link in a new tab; else a button that runs `onSelect`, or is disabled. Opening moves focus to the first item. ArrowUp and ArrowDown wrap, Home and End jump, and they skip disabled items. Enter or Space runs. Escape closes and returns focus to the button, and does not close a dialog under it. Tab or a pointer down outside closes. The menu opens under the button, or above it when the screen bottom or the phone tab bar leaves no room. An open menu sits above the cards below

### FR:bar: Actions bar

- **FR:bar** (P1): `ActionBar` shows the same items as `ActionMenu` as plain buttons and links, in the same order, under a heading, for a details pane

### FR:tabs: Tabs

- **FR:tabs** (P1): `Tabs` is a tab bar (ARIA tabs pattern: one selected tab with `tabIndex` 0, arrow keys, Home and End pick and focus). An optional `aside` sits small at the right end of the bar, with 12 px of space after it

### FR:split: Split view

- **FR:split** (P1): `SplitView` shows a list and a detail pane. Wide (`useWide(query)`), they sit side by side and the pane shows `empty` until a card is picked. Narrow, the open detail replaces the list, with `‹ Back`, and its heading gets focus

### FR:a11y: Access

- **FR:a11y** (P1): Every target is at least 44 px on touch and 24 px on desktop. Axe finds no serious or critical violation where a view uses them

## Architecture Constraints

- Each component is its own file in `web/src/ui/` with tests in `web/tests/ui-kit.test.tsx`. Styles live in `web/src/ui/ui.css`, tokens only.
- A view adds a component here when it needs new UI that another view could use. Only UI that no other view could use stays in the view.
