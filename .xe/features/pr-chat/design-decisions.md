# Design decisions: PR Chat

| # | Decision | Why | Rejected |
| - | -------- | --- | -------- |
| 1 | Reuse `agent-sessions` runs and its SSE stream | It already streams driver updates with replay; the SDK and ACP drivers share one vocabulary | A new WebSocket or a PR-specific stream |
| 2 | One session per PR, mapped in `<home>/pr/<owner>/<repo>/<n>.chat.json` | Sits next to the live check file; the agent keeps context across messages | A session per message (no memory); keys in the queue store (owned by `pr-priority`) |
| 3 | Context is short: url, title, branch, next action, check file, sign-off asks | The agent reads the body and diff with its own tools; a short prompt starts fast | Sending the diff (slow, costly, stale) |
| 4 | Paint once per animation frame | Token-by-token updates without layout thrash | Re-render per chunk |
| 5 | Its own spec PR | The chat touches routes, streams, and a new shared component; PR 220 ships the flags, actions, and check file now | One large PR |
