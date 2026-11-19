# Shared UI components

<!-- @req FR:ui-kit/catalog @req FR:ui-kit/catalog.current -->

Every view builds on the components in `web/src/ui/`. Read this page before you write markup for a view. The rule is in `.xe/standards/ui.md`; the spec is `.xe/features/ui-kit/spec.md`.

## Catalog

| Component | File | Use it for |
| --- | --- | --- |
| `SelectCard` | `web/src/ui/SelectCard.tsx` | One item in a list that opens a detail pane: top line, title, sub line, tools, chevron. |
| `StatusChip` | `web/src/ui/StatusChip.tsx` | A state word with a dot on a light tint (`neutral`, `info`, `ok`, `warn`, `bad`). Never a button. |
| `Flag` | `web/src/ui/Flag.tsx` | A small note on an item: a flag icon and a muted word. Never a control. |
| `ActionMenu` | `web/src/ui/ActionMenu.tsx` | The `⋯` button and its menu of actions for one item. |
| `ActionBar` | `web/src/ui/ActionMenu.tsx` | The same actions as plain buttons, under a heading, in a detail pane. |
| `Tabs` | `web/src/ui/Tabs.tsx` | A tab bar in a view (ARIA tabs), with an optional note at the right end. |
| `SplitView` | `web/src/ui/SplitView.tsx` | A list with a detail pane: side by side when wide, one at a time on a phone. |
| `DayGrid` | `web/src/ui/DayGrid.tsx` | A day as rows of 30 minutes: each item sits at its start time, with a height for its length. |
| `MessageBox` | `web/src/ui/MessageBox.tsx` | One message from a detail pane: a heading, a text box and one send button. |
| `LinkList` | `web/src/ui/LinkList.tsx` | One labelled line of links that wrap. Web links open in a new tab. |
| `SourceLink` | `web/src/ui/SourceLink.tsx` | A link to where an item came from, named by its kind (PR, issue, session, email, site). |
| `PageHeader` | `web/src/ui/PageHeader.tsx` | The top of a page: an `h1` title, a muted note, a sub line and actions at the right. |
| `EmptyState` | `web/src/ui/States.tsx` | What is empty, then the next step. Text only. |
| `Loading` | `web/src/ui/States.tsx` | Gray bars with a loading note for assistive tech. |
| `ErrorState` | `web/src/ui/States.tsx` | What failed, a next step and an optional Retry button. |

`useWide` (`web/src/ui/useWide.ts`) is the hook that tells `SplitView` when the screen is wide. CSS helpers in `web/src/ui/ui.css`: `ui-cards` (the list around cards) and `ui-tool` (an icon button in a card's tools).

## Add a component

1. Write the requirement in `.xe/features/ui-kit/spec.md`.
2. Write the tests in a `web/tests/ui-*.test.tsx` file.
3. Write the component as its own file in `web/src/ui/`. Put its styles in `web/src/ui/ui.css`.
4. Name the classes and roles it owns with `@owns` tags in the file comment.
5. Add a row to the catalog above.
6. Change each view that has a copy to use the component. The page must look the same.

## The reuse guard

`web/tests/ui-reuse.test.ts` fails when a view writes a class or role that a component owns. The guard logic is `web/src/ui/guard.ts` (test code, not a component).

- A component owns markup with a tag: `@owns class:ui-chip` or `@owns role:tablist`. The test fails on a tag that does not parse in full.
- A view that still has a copy is on the tag: `@owns role:tablist legacy: PrsPanel.tsx=1`. The number is the count the view can keep.
- When you move a view to the component, delete its `legacy:` entry.
- Never add a `legacy:` entry for new code. Use the component, or change the component for every view.

## Copies to remove

Each copy is a help-wanted issue ([open list](https://github.com/Xerilium/stack/issues?q=is%3Aopen+label%3A%22Help+wanted+%E2%9C%A8%22+%22%28ui-kit%29%22)). Each is one small change with the same output. The `legacy:` tags name the views that still copy a component.

- Tab bar, menu and card copies: [274](https://github.com/Xerilium/stack/issues/274), [275](https://github.com/Xerilium/stack/issues/275), [276](https://github.com/Xerilium/stack/issues/276).
- Move `EmptyState`, `Dialog` and `Toasts` from `parts.tsx` to `web/src/ui/`: [277](https://github.com/Xerilium/stack/issues/277).
- New components: `Skeleton` [278](https://github.com/Xerilium/stack/issues/278), `LoadError` [279](https://github.com/Xerilium/stack/issues/279), `CountBadge` [280](https://github.com/Xerilium/stack/issues/280), `MoreButton` [281](https://github.com/Xerilium/stack/issues/281), `ExtLink` [283](https://github.com/Xerilium/stack/issues/283).
- One-line loading, error and empty notes: [282](https://github.com/Xerilium/stack/issues/282).
