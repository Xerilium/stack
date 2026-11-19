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

`useWide` (`web/src/ui/useWide.ts`) is the hook that tells `SplitView` when the screen is wide. CSS helpers in `web/src/ui/ui.css`: `ui-cards` (the list around cards) and `ui-tool` (an icon button in a card's tools).

## Add a component

1. Write the requirement in `.xe/features/ui-kit/spec.md`.
2. Write the tests in a `web/tests/ui-*.test.tsx` file.
3. Write the component as its own file in `web/src/ui/`. Put its styles in `web/src/ui/ui.css`.
4. Name the classes and roles it owns with `@owns` tags in the file comment.
5. Add a row to the catalog above.
6. Change each view that has a copy to use the component. The page must look the same.

## The reuse guard

`web/tests/ui-reuse.test.ts` fails when a view writes a class or role that a component owns.

- A component owns markup with a tag: `@owns class:ui-chip` or `@owns role:tablist`.
- A view that still has a copy is on the tag: `@owns role:tablist legacy: PrsPanel.tsx=1`. The number is the count the view can keep.
- When you move a view to the component, delete its `legacy:` entry.
- Never add a `legacy:` entry for new code. Use the component, or change the component for every view.

## Copies to remove

These views still build markup that a shared component does, or that more than one view repeats. Each row is one small change with the same output.

| Markup | Views with a copy | Component |
| --- | --- | --- |
| Tab bar (`role="tablist"`) | `PrsPanel`, `SessionsView` | `Tabs` |
| Menu (`role="menu"`) and its arrow keys | `views` (More), `InboxView`, `ConnectAccounts`, `Composer` | `ActionMenu` |
| Card class by hand (`ui-card`) | `PrioritiesTables` | `SelectCard` |
| Empty state, dialog, toasts (shared, but in `parts.tsx`) | every view | move to `web/src/ui/` |
| Loading rows (`sk`) | `App`, `AsksView`, `PrsPanel`, `SessionsView` | new `Skeleton` |
| Load error with `Retry` | `AsksView`, `SessionsView`, `PrsPanel`, `views` | new `LoadError` |
| Count badge (`badge`) | `App`, `PrsPanel` | new `CountBadge` |
| `Show N more` button | `AsksView`, `SessionsView`, `PrisSessions` | new `MoreButton` |
| One-line loading, error and empty notes | `InboxView`, `LivePanel`, `QmView`, `PrisSessions`, `SettingsView`, `ConnectAccounts` | `EmptyState` or a new note |
| Dialog by hand (`role="dialog"`) | `FeedbackPanel`, `TaskDetail`, `NowChat` | `Dialog` |
| Link in a new tab (`target="_blank"`) | 12 files | new `ExtLink` |
