# Stack rebuild: assumptions, open questions, review gates

## Assumptions made so far

1. Date format is `Mon D` (optional `, YYYY`); missing year = current year.
2. Recurring row shape is `📅 date: 🔄 Cadence: title`; cadences limited to Daily/Weekly/Monthly/Quarterly/Yearly.
3. Weekend due dates always shift to Monday (all cadences).
4. Rolled rows reset subtasks to `[ ]`.
5. Parser keeps the original lines and edits in place (lossless), rather than regenerating files.
6. Monthly = same day-of-month, clamped to month end.
7. Build order in `.xe/roadmap.md` (parser, config, scoring, lifecycle, summaries, CLI) is right.
8. Legacy `~/dev/todo` files are the compatibility target (same format, no migration).

## Open questions (ranked), with recommendation

1. **Compatibility vs. clean break:** keep the legacy format exactly, or evolve it? Rec: exact compatibility through CLI parity, then evolve.
2. **Weekend-shift drift** (15th shifts to Mon 17th, then rolls from the 17th). Rec: store nominal day in a hidden marker, e.g. `<!-- day:15 -->`; or no shift and just display.
3. **Recurring row forms:** support both `📅 date: 🔄 X:` and legacy `🔄 Weekly: 📅 Mondays:`? Rec: support both; add weekday names ("Mondays") as a cadence.
4. **WA quarterly rule** ("last day of following month"). Rec: cadence token `Quarterly-EOM+1`; generalize later only if a second case appears.
5. **Where recurring roll fires:** `complete` rolls the row (stays `[ ]`) vs. checks it and adds a new row. Rec: roll in place, per original spec.
6. **Config location/format:** `.xe/config/stack.json` as in legacy, or a new `stack.config.json` at repo root? Rec: keep legacy path, JSON, defaults baked in.
7. **Scoring parity:** match legacy weights and formula exactly, verified by golden outputs from your real task files? Rec: yes; generate goldens from legacy PowerShell.
8. **Scope of Phase 1:** drop 🔎 GitHub query tasks, iMessage, and AI commands from the first release? Rec: yes; core + CLI + summaries first.

## Proposed review gates

1. **Spec gate:** you approve each slice's spec (requirements + decisions above) before any code.
2. **Test gate:** you skim the test list (names only) before implementation; tests are the contract.
3. **PR gate:** one slice per draft PR, CI green, you merge. Agents never merge.
4. **Parity gate** (before CLI replaces legacy): run Stack and legacy on a copy of your real tasks; diff outputs; you sign off.
5. **Cutover gate:** you choose the date to switch; legacy stays frozen until then.
