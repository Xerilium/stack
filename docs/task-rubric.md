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

## Quality gate

`stack check <ref>` runs four checks. No model call. Score 4 is actionable.

| Check      | Passes when                                                                         |
| ---------- | ----------------------------------------------------------------------------------- |
| `next`     | A `Next:` field, or a leaf row whose title starts with a verb (`src/core/verbs.ts`) |
| `doneWhen` | A `Done when:` field, or exactly one linked PR or issue                             |
| `context`  | A `Context:` or `Links:` field, a PR or issue ref in the title, or a note           |
| `single`   | One owner (not both 🙋 and 🤖 without `Owner:`), and no two verbs joined            |

The owner asks for a fill-in with `POST /tasks/{ref}/enrich`. The task agent gets one `enrich` message ([agent-instructions.md](agent-instructions.md)).
