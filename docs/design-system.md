# Stack design system

<!-- @req FR:task-detail-design/rules.doc -->

Applies to every view. Audit and follow-ups: `.xe/features/task-detail-design/audit.md`.

## Global rules

1. Clickable looks clickable: pointer cursor, hover state, focus ring; a row or card that opens something ends in a chevron (`›`).
2. Looks like a button, acts like one. A fact that cannot change is plain text, never chip or button styling.
3. No shortcut-key badges on buttons, links, or menu items. Chords live in `?` help and the palette.
4. Every control has a plain verb label (`Start`, `Defer`, `Ask`) and a one-line outcome hint on hover/focus or under its group.
5. No unexplained controls. If the outcome needs a sentence, write the sentence next to it.
6. Dropdowns only for long lists (8+). Short choices are chips or a segmented control.
7. Agents always show by display name plus avatar (never a bare slug or `CoS`).
8. Editable fields look editable: a labelled control (`Due Nov 2 ▾`), not a tag.
9. Destructive or irreversible actions confirm first or offer Undo.
10. 44 px targets on touch; 4.5:1 text contrast; light and dark.

## Today (before this change)

`web/src/styles.css` tokens: `--bg --panel --ink --ink2 --muted --line --accent (#5b5fe0) --chip --hover`, 4 pt spacing (`--s-*`), radius 6/10/16, a touch and desktop type scale, 120/200/280 ms motion. Indigo accent, system font, chips for both facts and actions, kbd badges on most buttons.

## Fluent 2 basis

`web/src/fluent2.css`, imported once by `main.tsx`. Tokens on `:root` (`--fl-*`), dark values under `prefers-color-scheme: dark`. A page opts in with class `fl`; other pages are unchanged.

| Group     | Tokens                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------- |
| Color     | `--fl-bg1..3`, `--fl-fg1..3`, `--fl-stroke1..2`, `--fl-brand`, `--fl-brand-hover`, `--fl-on-brand`, `--fl-danger`, `--fl-success`, `--fl-subtle-hover` |
| Type      | Segoe UI Variable / system; caption 12/16, body 14/20, subtitle 16/22 and 20/28, title 28/36          |
| Radius    | `--fl-r-sm 2px`, `--fl-r-md 4px`, `--fl-r-lg 6px`, `--fl-r-xl 8px`, `--fl-r-pill`                     |
| Spacing   | `--fl-s-xs 4`, `-s 8`, `-m 12`, `-l 16`, `-xl 20`, `-xxl 24`, `-xxxl 32`                              |
| Elevation | `--fl-shadow4` (cards), `--fl-shadow16` (popovers)                                                    |
| Motion    | `--fl-fast 100ms`, `--fl-normal 200ms`; zero with reduced motion                                     |

Controls (all under `.fl`): `.fl-btn` (default), `.fl-btn.primary`, `.fl-btn.subtle`; `.fl-input`; `.fl-popover` + `.fl-option` (listbox/menu); `.fl-chip` (toggle, `aria-pressed`); `.fl-seg` (segmented, `radiogroup`); `.fl-card`; `.fl-prop` (labelled editable property); `.fl-hint` (outcome line).

## Why hand-written CSS, not `@fluentui/web-components`

- Size: the v3 components plus `@fluentui/tokens` add the FAST element runtime plus per-control JS and styles (est. 60-100 KB min for the 6 controls used, on a 255 KB app bundle); the Fluent CSS is 9 KB raw, 2.4 KB gzipped.
- Runtime: the components need JS theme setup (`setTheme`) and custom elements inside Preact (events, form state, SSR-free hydration quirks). Plain CSS on native `<button>`, `<input>`, and `role` markup has none of that.
- Fidelity: values are the Fluent 2 web light/dark token values, so pages read as Fluent. No network at runtime.
- Revisit if a page needs a complex control (date grid, combobox with search) that the browser does not provide.
