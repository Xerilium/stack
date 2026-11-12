# Status reports

An agent sends one structured status report per project. Stack checks it with a fixed schema and keeps the latest report per agent and project in a local live store (`~/.stack/reports.json`, never git). Each ask shows in **Needs you**. No LLM call. Spec: `.xe/features/status-ingest/spec.md`. Scheduled tasks: [scheduled-reporting.md](scheduled-reporting.md).

## CLI

```sh
stack report --agent <name> --project <p> [--file report.json] [--json] < report.json
```

- Reads JSON from `--file`, else from stdin. Needs no content repo.
- Posts to the running desktop host (url and pid in `~/.stack/host.json`); if no live Stack host answers, writes the store directly under a lock. A demo host uses its own store and is never posted to.
- Exit `0` stored, `2` bad input (every issue is named; nothing is written), `1` the host refused it or the store stayed locked (`busy`); retry.

## API

`POST /api/reports` on the desktop host (a token needs `tasks:write`). The body is the JSON below plus `agent` and `project`. A bad body returns `400` with `error.details` (one `{field, message}` per issue).

## Sample

```json
{
  "top": [
    { "text": "Ship status ingest", "link": "https://github.com/Xerilium/stack/pull/130" },
    { "text": "Fix flaky e2e test" },
    { "text": "Plan chunk 2 UI" }
  ],
  "asks": [
    {
      "id": "pr-130",
      "ask": "Apply Autopilot to PR 130",
      "link": "https://github.com/Xerilium/stack/pull/130",
      "by": "2026-11-12T17:00:00Z",
      "kind": "approve",
      "recommend": "Approve",
      "priority": "high"
    }
  ],
  "blockers": [{ "text": "Waiting on CI runner" }],
  "progress": [{ "text": "Spec and tests merged" }]
}
```

## Rules

- `top`: at most 3. `blockers`, `progress`: at most 10. Each item is `{text, link?}`; `text` is one line, 1-200 characters.
- `asks`: at most 10. Required: `id` (`[a-z0-9][a-z0-9-]{0,23}`, unique), `ask` (1-200), `link` (`https`), `by` (ISO date or date-time). Optional: `kind` (`approve`, `review`, `go-do`, `answer`; default `answer`), `recommend`, `why`, `default`, `priority` (`crit`, `high`, `normal`, `low`).
- `agent` and `project`: `[a-z0-9][a-z0-9-]{0,23}`. Unknown keys, line breaks, and control characters are rejected.
- Each ask shows in Needs you as `rp.<agent>.<project>.<id>`. Send the same `id` to update it; the owner's answer is kept.
- A new report replaces the prior one. An ask the new report drops leaves Needs you. Send `{}` for the pair to clear it.
- An `id` names one item. Use a new `id` for a new item, or it inherits the owner's answer on the old one.
- The result's `asks.answers` maps each kept ask key to the owner's answer (`{choice, text?, until?, at}`); read it with `--json` and act (a scheduled task saves it and acts in its next run: [scheduled-reporting.md](scheduled-reporting.md)).
- On a host with token auth, the first token to write a pair owns it; another token gets `403`. The desktop host treats loopback callers as the owner, so this rule does not apply there.
- `--agent`/`--project` must match `agent`/`project` in the body when the body has them.
- Stored in `~/.stack/reports.json` (`STACK_HOME` overrides `~/.stack`). Never in git.
