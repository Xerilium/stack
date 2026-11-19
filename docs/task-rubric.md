# Task rubric

Every agent that creates or edits a task applies this rubric. CoS agents must apply it. Link to this file from each agent file; do not copy it.

```text
Task rubric (apply to every task you create or touch)
1. One thing. Split a row that has two actions or two owners.
2. Title: verb first, under 12 words, says the result, not the topic.
3. Owner: add "Owner: me" or "Owner: <agent id>". Mark 🙋 or 🤖 to match.
4. Agent work never goes to the owner. If the owner must act, add a 🙋 child for that part only.
5. Next: one action the owner can start in under 2 minutes, with the place to do it.
6. Done when: one result anyone can check (merged, sent, booked, decided).
7. Context: 1-3 lines. Why it matters, what was tried, what the owner decides.
8. Links: every PR, issue, doc, thread. Use owner/repo#N, never a bare #N.
9. Decisions: state the options and your recommendation in Context.
10. Blocked by: name the blocker, or omit. Blocked rows never rank.
11. Due date: only a real deadline. Say who set it in Context.
12. Stale: overdue with no activity? Ask "Still true?"; do not re-date silently.
13. Effort: set an effort emoji. Over 2 hours: split it.
14. Parent rows are outcomes; leaf rows are actions.
15. Run the quality gate (stack check <ref>); fix until score 4.
16. If you cannot reach score 4, set Next: "Owner: give <missing>" and stop.
17. Title: the action only, 120 characters or less. No status, no date, no detail.
18. Status and dates go in nested bullets, never in the title (no "done", "waiting", "blocked", "as of Nov 18", "PR 12 merged").
19. Title: at most 1 parenthetical. The (agent: ...) tag and the 1️⃣ 2️⃣ 3️⃣ markers do not count.
20. Every detail is a nested bullet ("- ") under the row. No text after a dash in the title, no plain lines under the row.
21. Run the lint (stack lint); fix every line it prints.
```

## Fields

Fields are nested bullets under the row: `- Next: ...` or `- **Next:** ...`. Bullets nested under a field are part of it.

```markdown
- [ ] 🙋 Answer the acks in flanakin/f4-music#97 📅 Nov 14: 🟢
  - Next: Reply to the 3 open threads in flanakin/f4-music#97
  - Done when: Each thread has a reply and the PR has no open threads
  - Context: The acks decide the cut of Shchedryk and two remakes. Roland set the date.
  - Owner: me
```

## Lint

`stack lint` fails on bloated rows. No model call. It reads open rows only, and skips `🌐` query rows. `stack check <ref>` and `stack update` run it too. `stack add`, `stack capture`, and `stack retitle` refuse a title that breaks a title rule.

| Rule             | Fails when                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title-length`   | The title has more than 120 characters                                                                                                               |
| `title-status`   | The title holds `done`, `waiting`, `blocked`, `merged`, `landed`, `shipped`, `parked`, `on hold`, `as of`, or a date (`Nov 18`, `2026-11-18`)        |
| `title-parens`   | The title has more than 1 parenthetical                                                                                                              |
| `detail-nesting` | The title has text after a dash (`--`, `—`, `–`), or a line under the row is not a bullet (a numbered item, a `>` quote line, and a code fence pass) |

The rules do not read: A link URL (only its label), `(agent: ...)`, the tier markers `1️⃣` `2️⃣` `3️⃣`, the date marks `📅 Nov 5:`, `⏰ Apr 1:`, and `💤 Nov 5:`, and a `🔎` query trigger.

```markdown
<!-- Fails: title-status, title-parens, detail-nesting -->

- [ ] 1️⃣ Portal extension (PR 12 merged) (agent: portal) -- waiting on the reviewer (as of Nov 18)

<!-- Passes -->

- [ ] 1️⃣ Ship the portal extension (agent: portal)
  - Status: PR 12 merged. Waiting on the reviewer, as of Nov 18.
```

## Quality gate

`stack check <ref>` runs four checks. No model call. Score 4 is actionable.

| Check      | Passes when                                                                         |
| ---------- | ----------------------------------------------------------------------------------- |
| `next`     | A `Next:` field, or a leaf row whose title starts with a verb (`src/core/verbs.ts`) |
| `doneWhen` | A `Done when:` field, or exactly one linked PR or issue                             |
| `context`  | A `Context:` or `Links:` field, a PR or issue ref in the title, or a note           |
| `single`   | One owner (not both 🙋 and 🤖 without `Owner:`), and no two verbs joined            |

The owner asks for a fill-in with `POST /tasks/{ref}/enrich`. The task agent gets one `enrich` message ([agent-instructions.md](agent-instructions.md)).
