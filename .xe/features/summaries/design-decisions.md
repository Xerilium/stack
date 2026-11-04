# Design Decisions: Summaries

## The files can use the same scorer as the app, as an opt-in

**Decision**: `generateSummaries` takes `engine` (`legacy` default, `stack`) and the text of `.stack/priorities.json`. `stack update --engine stack` writes README.md, stack.md and my-day.md with the `stack` engine scores and the owner's overrides; the default output stays byte-for-byte the PowerShell output.

**Date**: 2026-11-01

**Why**: The owner reads the files and acts on the app and `stack next`; when the legacy scorer ranks differently (no due-date lens, no time-block bypass for a `top` rule), the three disagree and nobody knows which to trust. Parity with the PowerShell output is still the default so a repo can switch when it is ready.

**Rejected**: Switching the default (breaks the parity tests and any repo still running the PowerShell update); a score multiplier or a second sort pass in each file builder (the order would drift per file); hiding `hide` rows from the files (they list all the work; they sink to the end instead).
