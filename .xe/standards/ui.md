# UI standard

Applies to every view in `web/`. The design language (color, type, space, components) is in `.xe/standards/design.md`. See also `docs/design-system.md`.

## Rule: reuse components, never build UI from scratch

- Every view MUST build on the shared components in `web/src/ui/` (`FR:ui-kit`). The catalog is `docs/ui-components.md`. Styles live in `web/src/ui/ui.css`; token values live in `web/src/ui/tokens.css`.
- New UI MUST be a new reusable component in `web/src/ui/`, with tests in `web/tests/ui-*.test.tsx`. Then the view uses it.
- When a view needs a change to a shared component, change the component (for every view), not a copy.
- Exception: an element that is truly unique and can never be reused elsewhere. Say why in a comment on it.
- Reviews MUST flag view code that rebuilds a card, chip, tab bar or detail pane by hand.
- The reuse guard (`web/tests/ui-reuse.test.ts`, `FR:ui-kit/guard`) fails when a view writes a class or role that a component owns.

## Rule: a send shows its text and waits for a click

- Text to an agent, a session or a person goes out only from a form: the text is in a box the owner can change, and the submit button names the effect (`Send to Xe CoS`). Use `MessageBox`.
- Ready text (a quick prompt, a start text) fills the box. It never goes out on the click that offers it.
- A button that sends or deletes names its effect: a verb and an object (`Send for design review`, `Remove account`). Never a bare noun.
- A one-step button may send only a fixed decision (`Approve`, `Done`), and its file must be in the audit list.
- The send guard (`web/tests/send-guard.test.ts`, `FR:ui-kit/send.guard`) fails when an element handler other than a form submit sends.
- Work that is not the owner's job (a gap the CoS must fill) goes to the agent in a file or an API. Never add a button for it.

## Look

- Muted Fluent 2 shapes: neutral surfaces, one accent (Stack indigo: links, the chosen tab, focus, the primary button).
- State is a `StatusChip`: a dot and one word on a light tint.
- A card selects as a whole (`SelectCard`); links on it stay links. The agent link lives in the detail pane.
