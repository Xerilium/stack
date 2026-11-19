# Design decisions: Priorities report

| # | Decision | Why | Rejected |
| - | -------- | --- | -------- |
| 1 | A message from the report goes through `POST /sessions/{id}/prompt` with the inventory `cli` id | The route exists (`FR:agent-sessions/run.prompt`) and resumes the agent's own session with its full context. No new send route | The inbox (`POST /inbox`): agent delivery runs a new headless agent, not the session that did the work |
| 2 | The CoS of a priority is `cos` in `pris.json`, else `CoS`; its session is found by title, like an agent | The owner's list already holds labels, sessions and windows. The team scope cannot name the CoS of a project today | Find the CoS from agent file scopes: the sub-CoS files have no `scope` line |
| 3 | The gap action says who, by when, what, in that order | The card shows one line. Who and when stay in view at 375 px | `Gap: No tiered task in tasks/`: the owner did not know who must act. The `Gap:` word is gone in the web and the CLI |
| 4 | By when is `today`, else the start of the row (`by 3 PM`, `by Thu`) | Tiers are goals, not due dates. The row must be ready when the owner can work it | A fixed due date |
| 5 | A gap goes to the CoS in a file (`~/.stack/gaps.json`), with no message and no button. The card says `<CoS> will add a task` | Gaps are the CoS's job. The owner clicked `Ask CoS` and a message he did not write went to the CoS session | An `Ask CoS` box with start text: the button read as `open`, not `send`. A message per gap from the host: noise in the CoS session |
| 7 | The report build writes the gap file, and only when the list changes | No timer and no new process. The CoS reads one small file; `at` says when the list last changed. `stack priorities --json` gives the same rows live | A host timer: a second clock to keep right. An API route only: the CoS must hold a token |
| 6 | With no `cli` id the box is off and says why | A send that cannot reach a session must not look sent | Hide the box: the owner asks where it went |
