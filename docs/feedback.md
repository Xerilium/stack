# Feedback

The feedback icon (rail footer on desktop, top bar on phone, `Shift+F`) sends the owner's notes on the app to a local file. An agent session tails the file and farms out the work.

## Files

All files live in `~/.stack` (or `STACK_HOME`). Files are `0600`; folders are `0700`. They are never in git.

| File | What |
| --- | --- |
| `feedback.jsonl` | One JSON object per line. Append-only. |
| `feedback/<id>.png` | The screenshot for an item, when sent. |
| `feedback.done.jsonl` | One `{id, at}` per line for each handled item. Append-only. |
| `feedback.lock` | The writer lock. Do not touch it. |

## Line shape

```json
{"id":"fb-20261112180000123-a1b2c3","at":"2026-11-12T18:00:00.123Z","text":"Rail is too wide","route":"/#/now","viewport":"1280x800","theme":"dark","appVersion":"0.0.1","sha":"abc1234","screenshotPath":"/Users/me/.stack/feedback/fb-20261112180000123-a1b2c3.png"}
```

- `id` and `at` are always present. `id` sorts by time.
- `route`, `viewport`, `theme`, `appVersion`, `sha` and `screenshotPath` are optional.
- Token-like strings in `text` and the query string of `route` are removed before the write. No headers, cookies or tokens are stored.

## Write rules

- Each writer holds `feedback.lock` and writes the whole line in one append (`O_APPEND`, then `fsync`). A reader never sees a partial line.
- The screenshot is written (temp file, then rename) before its line, so `screenshotPath` always exists when you read the line.
- The file is never rewritten. `tail -F` keeps its place.

## Consume

Tail the file and act on each new line:

```sh
tail -n 0 -F ~/.stack/feedback.jsonl
```

Or poll with the CLI:

```sh
stack feedback list --since <last id> --json   # items after <last id>, each with done
stack feedback done <id>                        # appends to feedback.done.jsonl
stack feedback add "text" [--route r]           # add one from the shell
```

`done` on an unknown id exits `4`. A second `done` is a no-op.

## API

`POST /api/feedback` (owner only): `{text, route?, viewport?, theme?, capture?, png?}` returns `201 {id, at, screenshot}`. `capture: true` asks the desktop host to capture its window. `png` is a base64 PNG from the browser, up to 700 KB. See `docs/api/openapi.yaml`.
