# UI standard

Applies to every view in `web/`. See also `docs/design-system.md`.

## Rule: reuse components, never build UI from scratch

- Every view MUST build on the shared kit: `web/src/kit.tsx` (`Chip`, `ItemCard`, `Tabs`, `SplitView`, `useWide`) and its styles in `web/src/kit.css`.
- New UI MUST be a new reusable component in the kit, with tests in `web/tests/kit.test.tsx`. Then the view uses it.
- When a view needs a change to a kit component, change the component (for every view), not a copy.
- Exception: an element that is truly unique and can never be reused elsewhere. Say why in a comment on it.
- Reviews MUST flag view code that rebuilds a card, chip, tab bar or detail pane by hand.

## Look

- Muted Fluent 2: neutral surfaces, one accent (brand: links, the chosen tab, focus). No fills for state.
- State is a `Chip`: outline, icon plus one word.
- A card opens its detail as a whole (`ItemCard`); links on it stay links. The agent link lives in the detail pane.
