# UI standard

Applies to every view in `web/`. The design language (color, type, space, components) is in `.xe/standards/design.md`. See also `docs/design-system.md`.

## Rule: reuse components, never build UI from scratch

- Every view MUST build on the shared components in `web/src/ui/` (`FR:ui-kit`): `SelectCard`, `StatusChip`, `Flag`, `ActionMenu`, `ActionBar`, `Tabs`, `SplitView`, `MessageBox`, `useWide`, `PageHeader`, `EmptyState`, `Loading`, `ErrorState`. Styles live in `web/src/ui/ui.css`; token values live in `web/src/ui/tokens.css`.
- New UI MUST be a new reusable component in `web/src/ui/`, with tests in `web/tests/ui-kit.test.tsx`. Then the view uses it.
- When a view needs a change to a shared component, change the component (for every view), not a copy.
- Exception: an element that is truly unique and can never be reused elsewhere. Say why in a comment on it.
- Reviews MUST flag view code that rebuilds a card, chip, tab bar or detail pane by hand.
- The reuse guard (`web/tests/ui-reuse.test.ts`, `FR:ui-kit/guard`) fails when a view writes a class or role that a component owns. The catalog is `docs/ui-components.md`.

## Look

- Muted Fluent 2 shapes: neutral surfaces, one accent (Stack indigo: links, the chosen tab, focus, the primary button).
- State is a `StatusChip`: a dot and one word on a light tint.
- A card selects as a whole (`SelectCard`); links on it stay links. The project and agent links live in the detail pane.
