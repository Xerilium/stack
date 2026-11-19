# Design decisions: Priorities report

| # | Decision | Why | Rejected |
| - | -------- | --- | -------- |
| 1 | A message from the report goes through `POST /sessions/{id}/prompt` with the inventory `cli` id | The route exists (`FR:agent-sessions/run.prompt`) and resumes the agent's own session with its full context. No new send route | The inbox (`POST /inbox`): agent delivery runs a new headless agent, not the session that did the work |
| 2 | The CoS of a priority is `cos` in `pris.json`, else `CoS`; its session is found by title, like an agent | The owner's list already holds labels, sessions and windows. The team scope cannot name the CoS of a project today | Find the CoS from agent file scopes: the sub-CoS files have no `scope` line |
| 3 | The gap action says who, by when, what, in that order | The card shows one line. Who and when stay in view at 375 px | `Gap: No tiered task in tasks/`: the owner did not know who must act |
| 4 | By when is `today`, else the start of the row (`by 3 PM`, `by Thu`) | Tiers are goals, not due dates. The row must be ready when the owner can work it | A fixed due date |
| 5 | Ask CoS is the same `MessageBox`, with the request as its start text | One component. The owner sees the text and can change it before it goes | A one-tap button: sends text the owner did not see |
| 6 | With no `cli` id the box is off and says why | A send that cannot reach a session must not look sent | Hide the box: the owner asks where it went |
