## A row action that answers keeps the open notification

**Decision**: Approve, Reject, and Done from a row menu answer that row and keep the selected notification. Reply, Defer and `Ask for context` select their row. `Ask for context` opens the reply box with the question as text and never sends it: no text goes out that the owner did not read (`FR:ui-kit/send.box.fill`).

**Date**: 2026-11-19

**Why**: The answered row leaves the list. Selecting it first closed the card the owner had open, then scrolled the page to a neighbor. Reply and Defer need the card, so they still select it.

**Rejected**: Selecting the row for every action (the card jumps); selecting the next row after the answer (same jump).

## At phone width, who and the source link share one line

**Decision**: At 375 px, a row puts who and the source link on one line and the why under them.

**Date**: 2026-11-19

**Why**: The source link needs a 44 px touch target. Alone on its own line it added a full line to every row. Sharing the line with who saves that line per row.

**Rejected**: A smaller source link (fails the touch target); hiding the source link on phones (loses the link to the source).
