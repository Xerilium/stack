---
id: ui-kit
title: Shared UI components
author: flanakin
description: "One token file and one component set for every view: cards, chips, actions, tabs, split view, day grid, header, states."
dependencies: [web-shell]
---

<!-- markdownlint-disable single-title -->

# Feature: Shared UI components

## Purpose

The owner needs every list view to look and act the same so that he reads a PR, a priority, or a task the same way. Views build on these components; they do not build cards, flags, chips, or menus from scratch.

## Scope

- In: every component in `web/src/ui/` `web/src/ui/ui.css`, and the design tokens in `web/src/ui/tokens.css`. The list is `docs/ui-components.md`.
- Out: what a view puts in them (its words, tones, and actions), and the written UI rule (`ux-consolidation`).

## Scenarios

### FR:card: Selectable card

- **FR:card** (P1): `SelectCard` is one list item: an optional top line (links, flags, chips), a title, an optional sub line, an optional tools column, and a chevron (`›`). One button covers the card; a tap or click anywhere that is not a link or a tool selects it, and Enter or Space on it does the same. Links and tools sit above it. `selected` sets `aria-current` and a focus-colored outline. `sr` is text read after the title by assistive tech only. With `label`, the title and sub line sit outside the button, so links in them stay links, and the button (the chevron, stretched over the card) is named `label`. A view sets the tone with the CSS variables `--ui-edge`, `--ui-soft`, `--ui-strong`, `--ui-ink`, `--ui-ink2`, and the class `strong`. Cards in a `ui-cards` list have 14 px between them and 14 px padding inside

### FR:flag: Flag

- **FR:flag** (P1): `Flag` notes something about an item: a 12 px flag icon and the word in muted text. It is a `span`: no fill, no border, no hover state, default cursor, not focusable, no role. `hidden` hides it from assistive tech when the same words are read elsewhere. In a card top line it sits at the right

### FR:chip: Status chip

- **FR:chip** (P1): `StatusChip` shows a state word: a dot and the word on a light tint of the tone (`neutral`, `info`, `ok`, `warn`, `bad`). It is a `span`: no border, no hover state, default cursor, not focusable. It is never a button. Text meets WCAG AA in light and dark

### FR:menu: Actions menu

- **FR:menu** (P1): `ActionMenu` is one quiet icon button `⋯` (name from `name`, `aria-haspopup="menu"`, `aria-expanded`; no fill until hover or open) and a menu (`role=menu`, same name) of `menuitem`s. An item with `href` is a link in a new tab; else a button that runs `onSelect`, or is disabled. Opening moves focus to the first item. ArrowUp and ArrowDown wrap, Home and End jump, and they skip disabled items. Enter or Space runs. Escape closes and returns focus to the button, and does not close a dialog under it. Tab or a pointer down outside closes. The menu opens under the button, or above it when the screen bottom or the phone tab bar leaves no room. An open menu sits above the cards below

### FR:bar: Actions bar

- **FR:bar** (P1): `ActionBar` shows the same items as `ActionMenu` as plain buttons and links, in the same order, under a heading, for a details pane

### FR:tabs: Tabs

- **FR:tabs** (P1): `Tabs` is a tab bar (ARIA tabs pattern: one selected tab with `tabIndex` 0, arrow keys, Home and End pick and focus). An optional `aside` sits small at the right end of the bar

### FR:split: Split view

- **FR:split** (P1): `SplitView` shows a list and a detail pane. Wide (`useWide(query)`), they sit side by side and the pane shows `empty` until a card is picked. Narrow, the open detail replaces the list, with `‹ Back`, and its heading gets focus

### FR:daygrid: Day grid

- **FR:daygrid** (P1): `DayGrid` shows a span of a day as rows of 30 minutes
  - **FR:daygrid.rows** (P1): Every row has the same height (60 px, 112 px on touch), and a row with no item is empty. The time column names each hour (`10a`)
  - **FR:daygrid.items** (P1): An item sits at its start time with a height in proportion to its length, so 30 minutes is one row and 60 minutes is exactly two. An item is clipped to the grid span and keeps its cut size
    - **FR:daygrid.items.least** (P1): An item under 12 minutes (the shortest effort) has the height of 12 minutes, so a target is at least 24 px (44 px on touch)
  - **FR:daygrid.lanes** (P1): Items that overlap sit side by side in lanes. Overlap is judged on the drawn height, so each item stays clear of the others
  - **FR:daygrid.bands** (P2): A band labels a time range in the time column, in the row that holds its start. A `muted` band tints its own minutes
  - **FR:daygrid.now** (P2): `now` draws one line at that time when it is inside the span
  - **FR:daygrid.a11y** (P1): Items are a list in time order, and each item names the band it starts in. The rows, the tint and the hour labels are decoration, hidden from assistive tech
### FR:links: Link list

- **FR:links** (P1): `LinkList` shows one labelled line of links: a small muted label, then the links, which wrap. A web link (`http`, `https`) opens in a new tab with `rel="noopener noreferrer"`; any other link opens in place. With no items it shows nothing. It takes links only; the caller checks each target

### FR:message: Message box

- **FR:message** (P1): `MessageBox` sends one message from a details pane: a heading, a text box named `Message <to>` (at most 4000 characters, optional start text), and one button (`Send`, or `send`). The button is off while the text is empty or a send runs. After `onSend` resolves it clears the text and says `Sent to <to>` in a status line; after it rejects it keeps the text and says the error. With `off` (a reason), the box and button are off and the reason shows

### FR:tokens: Design tokens

The owner needs one palette and one type ramp on every page so that the app reads as one product.

- **FR:tokens.source** (P1): `web/src/ui/tokens.css` is the only stylesheet that sets color, type, space, radius, elevation, and motion values
- **FR:tokens.alias** (P1): Each `--fl-*` color name is a `var()` alias of a base role token
- **FR:tokens.contrast** (P1): Text tokens reach 4.5:1 on each surface token, light and dark

### FR:header: Page header

The owner needs every page to start the same way so that the owner finds the title and actions in one place.

- **FR:header** (P1): `PageHeader` shows an `h1` title, an optional muted `meta`, an optional `sub` line, and optional `actions` at the right
- **FR:header.wrap** (P1): On a narrow screen `PageHeader` wraps the actions under the title

### FR:empty: Empty state

The owner needs an empty view to say what to do next so that the owner never stares at a blank pane.

- **FR:empty** (P1): `EmptyState` shows left-aligned text with no art: what is empty (`what`), then the next step (`next`)

### FR:loading: Loading state

The owner needs to see that data is on the way so that a slow load does not look like an empty view.

- **FR:loading** (P1): `Loading` is a `role="status"` block whose text, `Loading {what}`, only assistive tech reads
- **FR:loading.bars** (P1): `Loading` shows `rows` gray bars, 3 by default, hidden from assistive tech
- **FR:loading.motion** (P1): The `Loading` bars stay still when the user asks for reduced motion

### FR:error: Error state

The owner needs a failed load to say what happened so that the owner can fix it or try again.

- **FR:error** (P1): `ErrorState` is a `role="alert"` block that shows what happened (`what`) and an optional next step (`next`)
- **FR:error.retry** (P1): With `onRetry`, `ErrorState` shows a `Retry` button that calls `onRetry`

### FR:dialog: Dialog

Owner needs every dialog to open, trap focus and close the same way so that the keyboard works the same in each one.

- **FR:dialog** (P1): `Dialog` MUST show a titled modal box over a scrim (`role="dialog"`, `aria-modal`, named by `title`)
  - **FR:dialog.focus** (P1): `Dialog` MUST keep Tab inside the box and return focus to the opener on close
  - **FR:dialog.close** (P1): `Dialog` MUST close on Escape and on a tap on the scrim
  - **FR:dialog.sheet** (P3): `Dialog` MUST be a bottom sheet on a phone unless `sheet` is false

### FR:toasts: Toasts

Owner needs the result of each action in one place so that he sees it and can undo it.

- **FR:toasts** (P1): `Toasts` MUST show every toast in one polite live region
  - **FR:toasts.actions** (P2): `Toasts` MUST give each toast Dismiss, and Undo when the toast has one

### FR:a11y: Access

- **FR:a11y** (P1): Every target is at least 44 px on touch and 24 px on desktop. Axe finds no serious or critical violation where a view uses them

### FR:guard: Reuse guard

Developer needs a failing test when a view builds markup a shared component owns, so that one-off copies never reach the owner.

- **FR:guard.owns** (P2): Each component file in `web/src/ui/` MUST name the classes and roles it owns with `@owns` tags (`@owns class:ui-chip`, `@owns role:tablist`)
- **FR:guard.fail** (P2): Guard MUST fail when a view file outside `web/src/ui/` writes an owned class or role in its markup
  - **FR:guard.fail.legacy** (P3): Guard MUST allow a view the count its `legacy:` entry on the tag names (`legacy: PrsPanel.tsx=1`)
  - **FR:guard.fail.message** (P3): Guard MUST name the file, the markup, and the component to use

### FR:catalog: Component catalog

Developer needs one page that says which component to use so that he finds it before he builds a copy.

- **FR:catalog** (P3): `docs/ui-components.md` MUST say what each shared component is for
  - **FR:catalog.current** (P3): Catalog MUST name only components that exist in `web/src/ui/`

## Architecture Constraints

- Each component is its own file in `web/src/ui/` with tests in `web/tests/ui-*.test.tsx`. The reuse guard is `web/tests/ui-reuse.test.ts`. Styles live in `web/src/ui/ui.css`, tokens only.
- A view adds a component here when it needs new UI that another view could use. Only UI that no other view could use stays in the view.
