# Content Standards

Rules for every word Stack shows: web UI, CLI output, errors, empty states, and docs. Check each copy change against this file.

## Voice and tone

- **Plain language** (ISO 24495-1): the reader finds, understands, and uses the text on the first read.
- **Simplified Technical English** (ASD-STE100): one idea per sentence, active voice, at most 20 words, one meaning per word.
- **Talk to "you"**: the owner is "you". Stack is "Stack". An agent is the agent's name, or "the agent".
- **Calm**: no exclamation marks, no blame, no hype, no jokes in errors.
- **Short**: say what happened and what to do next. Cut words that do not help the reader act.

Tone by message type:

| Type    | Tone                                    | Example                                                            |
| ------- | --------------------------------------- | ------------------------------------------------------------------ |
| Success | Brief; state the result, then move on   | `Sent to stack-architect`                                          |
| Info    | Neutral; state the fact                 | `As of Tue, Nov 18, 11:00 AM`                                      |
| Warning | Direct; name the risk and the fix       | `Offline: changes need a connection`                               |
| Error   | Factual; what happened, then what to do | `Can't reach Stack at localhost:4190. Is stack web still running?` |

## Style

- **Sentence case** for every label, heading, button, and menu item: `Pull requests`, not `Pull Requests`.
- **Ellipsis character** (`…`, U+2026) in progress text: `Loading…`, `Saving…`. Never three dots.
- **Periods** only on full sentences. Labels, buttons, chips, and table cells take no period.
- **Errors** say what happened and what to do: `The plan file is broken. An agent must write it again.` Never show a raw exception (`SyntaxError`, `Failed to fetch`, `HTTP 502`) alone.
- **Empty states** name the next step: `No plan yet.` plus who or what makes one.
- **Line numbers** are 1-based in every place a human reads them (UI, CLI, logs).
- **Numbers**: compact counts in dense views (`25M`, `636k`); raw value in `title`. Durations in plain units (`30m`, `2h`).
- **Dates and times** use the reader's locale; relative time (`5 min ago`) where recency matters more than the exact time.
- **Keys** in `<kbd>`; chords as typed (`g k`).
- **Agent and session ids** never show as visible text; put them in `title` or a details panel.

## Glossary

Current names, recorded as they are. A conflict here is an open item, not a rename. Do not change UI labels to match this table without a decision from the creative director.

| Term            | Meaning                                                  | UI label                                       | CLI name                         | Avoid                         |
| --------------- | -------------------------------------------------------- | ---------------------------------------------- | -------------------------------- | ----------------------------- |
| Task            | One row in a project markdown file                       | Task                                           | `add`, `capture`, task `ref`     | Item, todo, ticket            |
| Project         | One markdown file in `tasks/` with its tasks             | Projects                                       | `<project>` argument             | Board, list                   |
| Now             | The one place to start: the next thing to do             | Now                                            | `next`                           | Dashboard                     |
| Home            | Ranked tasks for the time you have                       | Top asks (see open item 2)                     | `next --top n`, `rank`           | Feed                          |
| My day          | Today's plan around meetings                             | My day                                         | `next --daily`                   | Agenda, today                 |
| Full stack      | Every task, filterable                                   | Full stack                                     | n/a                              | All tasks, backlog            |
| Ask             | A question or approval an agent needs from you           | Needs you (view), Ask (palette), Asks (region) | `asks`                           | Request, ping, ticket         |
| Answered        | An ask you answered that waits on the agent              | Answered                                       | `asks`                           | Done, sent                    |
| Defer           | Hide a task or ask until a later time                    | Defer, Defer 2 hours, Deferred                 | `suspend --days n \| --hours n`  | Snooze (in UI text)           |
| Skip            | Park a task with no return time                          | Skip                                           | `skip`, `park` (alias), `resume` | Ignore, drop                  |
| Complete        | Check off a task                                         | Mark done                                      | `complete`                       | Close, finish                 |
| Capture         | Add a task from a short phrase                           | New task                                       | `capture`                        | Quick add                     |
| Priority        | An owner priority; ranks before other work               | Priorities                                     | `pris`                           | Goal, OKR                     |
| Agent           | A named AI worker with a role and projects               | Agents (view)                                  | `agent`, `agents`                | Bot, assistant                |
| Session         | One agent run in a folder, with its transcript and cost  | Session; `No agent (plain session)`            | `sessions`                       | Chat, conversation            |
| Delegate        | Hand a task to an agent                                  | Delegate to an agent (🪄)                      | `triage --agent`                 | Assign (when no agent runs)   |
| Pull request    | A GitHub PR on the board                                 | Pull requests                                  | `prs`                            | PR in headings, merge request |
| Inbox           | Mail and replies to triage                               | Inbox                                          | `inbox`, `email`, `triage`       | Mail, messages                |
| Live review     | The live validation checklist for the one PR in the lane | `#/live` page; chip `Ready for you`            | `live`                           | QA, test pass                 |
| QM plan         | The weekly plan for spare agent quota                    | QM plan                                        | `qm`                             | Quota-maxxing (in UI text)    |
| Needs you state | A session or PR agent that waits on you (not an ask)     | Needs you (see open item 3)                    | n/a                              | n/a                           |

## Open items

Conflicts for the creative director. Each item keeps the current names until decided.

1. **Ask has three names.** The nav says `Needs you` (`web/src/nav.ts:9`), the list region is `Asks` (`web/src/AsksView.tsx:257`), and palette items start with `Ask:` (`web/src/App.tsx:772-775`). Pick one noun for the thing and one label for the view.
2. **Home is "Top asks" but shows tasks.** `web/src/nav.ts:9` labels Home `Top asks`; the view ranks tasks, not asks. Pick a label that names tasks.
3. **"Needs you" means three things.** The asks view (`web/src/nav.ts:9`), a session state (`web/src/sessions.ts:23`), and a PR agent state (`web/src/agents.ts:4`). Pick one meaning; rename the others.
4. **Hiding a task has five words.** The UI says `Defer` and `Skip` (`web/src/App.tsx:796-799`). The CLI says `skip`, `park`, and `suspend` (`src/cli/run.ts:85-88`). Map each UI word to one CLI verb.
5. **Agents view has the id `sessions`.** The view label is `Agents` but its id, chord hint, and code are `sessions` (`web/src/nav.ts:9`). Session text says `plain session` (`web/src/SessionsView.tsx:104`). Decide whether "session" is a user-facing word.
6. **Loading text is not consistent.** UI shows `Loading`, `Loading…`, and `Loading accounts…` (`web/src/*.tsx`). Apply the ellipsis rule and decide whether loading text names the thing.
