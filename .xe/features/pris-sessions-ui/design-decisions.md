# Design decisions: pris-sessions-ui

## Priorities collapsed by default

**Decision**: Each priority shows one line (number, title, status, progress, next open item). A tap opens it to show all items and the edit controls. One open at a time. The first 5 open priorities show; the rest are behind `Show n more`.

**Date**: 2026-11-11

**Why**: Design principle 1 (one thing). Up to 30 priorities with 20 items each would push the asks off the screen. The next open item is the line that matters at a glance.

**Rejected**: All items always visible (Needs you falls below the fold at 375 px); a separate Priorities page (the owner asked for the block above Needs you).

## Rebase the edit on a 409

**Decision**: An edit is a function of the list. On `409` the page reads the new list, applies the same function, and sends once more. When it cannot apply or fails again, the server list wins and a toast says so.

**Why**: Two windows (desktop and iPhone) edit the same file. A blind retry would lose the other change; a plain reload would lose the owner's edit. One rebase keeps both in the common case.

**Rejected**: Field-level merge (more code, rare case); last write wins (`rev` exists to stop that).

## Sessions under the asks, not mixed in

**Decision**: Sessions are their own section under the agent asks, grouped by project in server order. The asks list and its keys do not change.

**Why**: An ask has actions in place (approve, reply, defer). A session has one action: open it in the Claude app. Mixing them would give rows with different keys in one cursor list.

## Badge counts sessions only

**Decision**: The dock and tray badge show the inventory `needsYou` count.

**Why**: The owner asked for a Needs-you count on the tray. Agent asks already raise web notifications; sessions have no other signal outside the app. The count comes from one cheap cached call. It breaks principle 5 (no unread counts) on purpose: the owner asked for it, and the count is "needs you", not "unread".

**Rejected**: Asks plus sessions (the asks total also merges task rows and escalations on the client; the shell would need the whole client merge).

## Desktop opens only epitaxy links

**Decision**: The desktop link policy opens `claude://claude.ai/epitaxy/<id>` in the Claude app. Every other custom scheme stays blocked.

**Why**: The deep link is the whole point of the Sessions row. A narrow pattern keeps the safe-navigate rule: no other scheme, host, or path can launch an app.

## Copy ids, no archive call

**Decision**: Archive candidates only copy ids (one per line).

**Why**: The app archive call is not public yet. The owner can paste ids to an agent that archives them.
