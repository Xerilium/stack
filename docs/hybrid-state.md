<!-- @req FR:deploy-stack-xerilium-com/hybrid.design -->
# Mac state on the deployed app (design, not built)

**Problem:** SWA Functions cannot read the Mac's `~/.stack` (`reports.json`, `sessions.json`, `pris.json`). The phone on `stack.xerilium.com` misses agent reports, the Claude session inventory, and pris, so its Needs-you differs from the Mac.

**Decision:** The Mac host pushes a compact snapshot to the deployed API. Push, not pull: the Mac sleeps and has no public address.

- `stack` on the Mac (desktop host tick, or `stack report`) builds `{ v: 1, at, reports, sessions, pris }` from `~/.stack`: ids, states, titles, times only. No transcripts, no prompt text, no LLM call.
- It sends `PUT /api/state/snapshot` with a host token (new scope `state:write`), only when the hash changes, at most once a minute.
- The host stores one file, `.stack/state.json`, on `stack/live` through the storage adapter (one commit per change; no new Azure resource, $0).
- Needs-you on the host reads that file as the Mac's `~/.stack`. It shows "Mac state at h:mm" and greys out after 15 minutes.

**Rejected:** a tunnel to the Mac (public hostname, dies on sleep); pull from GitHub Actions (no Mac access); Table Storage (extra resource).

## Follow-up chunk: `state-snapshot`

Acceptance criteria:

1. New scope `state:write`, owner-minted, 90 days; `PUT /api/state/snapshot` takes JSON at most 256 KiB with strict fields, answers `204`; other scopes get `403`.
2. Snapshot holds no transcript text, no secrets, no file paths outside ids; a test fails on any unknown field.
3. Same Mac state gives the same Needs-you list on the Mac and on `stack.xerilium.com` (parity test on a fixture).
4. Unchanged state sends nothing; a GitHub write happens only on change.
5. Older than 15 minutes shows as stale, with the time, not as empty.
