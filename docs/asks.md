# Asks: agent contract

Agents bring the owner decisions through ask files, never chat. One ask is one exact decision. The owner sees the top few, ranked by Stack, with your recommendation and default-if-silent. Keep asks rare, specific, and answerable in one tap.

Spec: [.xe/features/ask-queue/spec.md](../.xe/features/ask-queue/spec.md). Design: [docs/design/ask-queue.md](design/ask-queue.md).

## Put an ask

```bash
stack asks put pr-879-approve \
  --ask "Approve merging PR 879 into dev" --kind approve --from allyte-cos --project allyte \
  --why "Go-live is Oct 29; Roland re-approved and CI is green" \
  --recommend Approve --default "Merges Oct 29 8:00am" --reversible yes \
  --by 2026-10-29T15:00:00Z --link https://github.com/example/repo/pull/879 \
  --priority high --effort 2m --blocks 3 [--detail-file notes.md]
```

- `--dir <repo folder>` points at the served folder (`stack web` prints it). Over HTTP: `POST /api/asks/<key>` with the same fields and an API token (`tasks:write`); `from` defaults to the token's name.
- The key is yours and stable. Writing it again updates the ask. A `done` ask needs `--reopen` to open again.
- `ask` is one line, at most 200 characters, a decision not a topic ("Approve X", "Pick Y or Z", "Review draft to Dana").
- `kind`: `approve` (yes/no), `decide` (give `--options "A|B"`, recommend one), `review` (open the link, then "Looks good" or "Needs changes"), `go-do` (a human-only step), `answer` (you need a fact in words).
- `recommend` always; `default` and `--reversible yes` only when silence is safe. Irreversible, costly, or external actions never get a default.
- `by` is the real deadline. `blocks` is how many things wait on this. `priority`: `crit`, `high`, `normal`, `low`.
- `--from <agent>` is required: it names you on the page and in `waiting on <agent>`.
- Never answer for the owner. Over HTTP always send your token (a token on `/answer` gets `403`); without a token the local server treats the request as the owner's page. Never edit `answer` or `state` in an ask file by hand.
- Never put secrets, tokens, or full message bodies in an ask. Detail is for the owner's eyes only and renders as plain text.

## Read the answer

```bash
stack asks list --state answered --json
```

Each item has `answer` (`go`, `no`, `option` with `text`, `reply` with `text`, `ask` with a question in `text`, `done`) and `answered`. Act on it, then close the loop:

```bash
stack asks handle pr-879-approve --outcome handled --note "Merged"          # acted on the answer
stack asks handle pr-879-approve --outcome resolved --note "Closed upstream" # moot; no answer needed
stack asks handle pr-879-approve --outcome defaulted                         # deadline passed; applied the default
stack asks handle pr-879-approve --outcome reopen --reply "Yes, all 14 checks pass."  # answer his question
```

At the deadline, a reversible ask with a default is yours to apply (`defaulted`). Stack never acts for you.

## Keep the queue small

```bash
stack asks archive            # moves done asks untouched for 14 days to tasks/asks/archive/
stack asks archive --days 3   # sooner
```

Run it at the start of each run (one commit, nothing is lost). The archive is never shown or ranked.

## Rules of thumb

1. Write an ask only when the owner must decide or do something. Status is not an ask.
2. One ask per decision. Never a list, never "FYI".
3. Check `stack asks list` before adding; update instead of duplicating.
4. Resolve asks that became moot (`resolved`) so the owner never sees stale work.

## For a CoS agent file

> Bring Michael decisions only through `stack asks put` (see `docs/asks.md`). After each state update, upsert the asks for every open decision and `resolve` the ones no longer needed. Read `stack asks list --state answered` at the start of every run and act on the answers, then `stack asks archive`. Do not message him in chat.

## Quick triage: a few questions, answered in one sitting

When you want several decisions from the owner, put them as one **flow**: the same `--flow <slug>` on each ask with `--seq 1, 2, 3…`. The page shows them together, in order, as `Quick triage · 2 of 5`, and moves to the next one after each answer.

Say what the answer should do to the task, so Stack applies it at once and you do not have to come back:

```bash
stack asks put tri-1 --flow triage-oct29 --seq 1 --kind answer  --ask "What is top of mind?" --ref finance:4 --from finance-cos
stack asks put tri-2 --flow triage-oct29 --seq 2 --kind decide  --ask "Pay bills first?" --ref finance:4 --options "Yes, critical|Later" --applies "set priority=🚨|suspend 7d" --recommend "Yes, critical" --from finance-cos
stack asks put tri-3 --flow triage-oct29 --seq 3 --kind approve --ask "Archive the old board?" --ref finance:7 --apply complete --from finance-cos
```

- `--ref project:line` is the row as the api names it (`GET /tasks` refs; the line is 0-based, so the row on line 5 of the file is `:4`). It must exist when you put the ask; Stack remembers the row's text, finds the row again if a note above it moved it, and refuses the action (`409`, ask reopened) if the text changed.
- `--apply` runs on `go`; `--applies` is one action per option (`-` for none). Actions: `set priority=🚨 effort=🟡`, `due Nov 3`, `suspend 7d` / `suspend 2h`, `skip`, `complete`, `start`, `resume`, `note <text>`.
- A `kind answer` question with a `--ref` writes the owner's text under that row as `> 🙋 <date>: <text>`.
- The thread records `applied: <action> → <row after>`; read it with `stack asks list --state answered --json`.
