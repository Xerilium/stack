# Design decisions: status-ingest

## Live state in a local store, never git

**Decision**: Reports live in `~/.stack/reports.json` (or `STACK_HOME`), owned by the desktop host. The CLI posts to the host when `~/.stack/host.json` names one that answers; otherwise it writes the file itself. Report asks reach Needs you from this store.

**Date**: 2026-11-11

**Why**: Owner rule: live state must not go to the content repo; git holds durable task docs only. Reports change often and are replaced, so git commits would be noise. The host's port is random, so the host publishes it in `host.json`.

**Rejected**: `.stack/reports.json` in the content repo (commits per report); asks written as `tasks/asks/*.md` (git); SQLite (a native dependency for one small file; JSON with an atomic rename and a lock file is enough at this size).

## One JSON file, atomic rename, lock file

**Decision**: One file for all pairs. Writes go to a temp file, then rename. One writer at a time holds `reports.lock` (exclusive create, holding its pid); a lock whose pid is not running is taken over at once; a lock with no pid yet after 30 s.

**Why**: Host and CLI may both write. A rename is atomic on one file system, so readers need no lock. The stale-lock rule keeps a crashed writer from blocking forever.

## Strict schema in the core, not the flat route spec

**Decision**: `parseReport` validates the nested body for both CLI and API; the OpenAPI request body is authored by hand. Bad input is `400` (API) or exit `2` (CLI) and lists every issue.

**Why**: The route `Spec` type is flat; a nested schema there would add a second validator. One function keeps CLI and API in step.

## Report asks are Needs you items

**Decision**: `GET /needs-you` appends report asks (key `rp.<agent>.<project>.<id>`) after the CoS items; `POST /needs-you/{id}/answer` writes the answer into the store for `rp.` keys.

**Why**: Needs you already has the answer flow (go, defer, reply, undo) and the web list. Reusing it adds no UI. A dropped ask is moot, so it leaves with its answer; a kept ask keeps the answer.
