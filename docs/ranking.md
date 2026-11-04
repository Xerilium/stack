# Ranking and Needs you

One ranking decides what is next, everywhere: the web Home, `GET /api/rank`, `GET /api/next`, and `stack next`. The `/next` skill calls the CLI, so nothing can drift.

```bash
stack next            # the top task
stack next --top 5    # the first five, one line each: ref score project text
```

The order is the `stack` scoring engine (score, due dates, blockers, time block), then your overrides.

## Overrides: `.stack/priorities.json`

The owner and the Chief of Staff (CoS) edit this file. A missing or broken file means no overrides; bad rules are skipped.

```json
{
  "rules": [
    { "match": "Pay bills", "effect": "top", "why": "tonight", "by": "owner" },
    { "match": "FH 0.10", "effect": "top" },
    { "match": "FOCUS", "effect": "down", "why": "not a priority now", "until": "2026-12-01" }
  ]
}
```

- `match`: a project name or title, or a word or phrase in the task text or in the text of the rows above it (so a leaf under "Pay bills" matches `Pay bills`). Whole words, case-insensitive.
- `effect`: `top` (before everything else, in the order of the rules), `down` (after everything else), `hide` (not ranked).
- `until`: optional `YYYY-MM-DD`; the rule stops on that date. `why` and `by` are notes for the next reader.
- The first matching rule in the file wins.

Each ranked task says which rule applied (`rule`), and a task under a parent says which top-level row it sits under (`root`), which is what Home shows.

## Needs you: `.stack/needs-you.json`

Only the CoS writes this file. Stack lists the items first in Needs you and writes only `answer` onto an item when the owner answers. Anything listed here is not shown on Home.

```json
{
  "items": [
    {
      "id": "pay-bills",
      "title": "Pay bills tonight",
      "recommendation": "Pay USAA first, then the mortgage",
      "default": "I wait until Monday",
      "by": "2026-11-02T17:00:00-08:00",
      "link": "https://github.com/flanakin/todo/blob/main/tasks/finance.md",
      "project": "finance",
      "ref": "finance:12"
    }
  ]
}
```

- `id`: `[a-z0-9-]`, stable. `title` (200), `recommendation` (300), `default` (200, what happens if the owner stays silent), `link` (an `https://` url or a repo path) are required except `default`.
- `ref`: the task row the item is about; that row is held back from Home.
- The owner's answer is added as `answer: { choice: "go" | "defer" | "reply", text?, until?, at }`. The CoS reads it from the same file and removes the item when handled; Undo clears the answer.

## stack.md, README.md and my-day.md

`stack update` writes them with the legacy scorer by default (byte-for-byte what the PowerShell script wrote). To make the files agree with `stack next`, the web Home, and My day:

```bash
stack update --engine stack
```

- Each leaf shows the `stack` engine score (`🟰`), the one `stack next` prints; its breakdown adds one line when the score differs from the formula (`📅 + N due-date lens`, or `↪ inherits N from <task>`).
- Every list orders by that score, then by `.stack/priorities.json` (`top` first, `down` last; a `hide` row sinks to the end instead of disappearing, so the files still list all the work).
- The README top list keeps a `top` row even when the current time block would hide it.
