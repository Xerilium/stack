# Design decisions: PR Page

| # | Decision | Why | Rejected |
| - | -------- | --- | -------- |
| 1 | Active agent = a `running` inventory session that links an open PR; WIP label only as the fallback | The inventory knows which session works which PR. A WIP label goes stale when an agent dies | WIP label first: shows agents that are gone |
| 2 | Blocked on me = Michael-only gates (Needs attention label, 🧭 ask, own hold, workflow approval) or a Sweep Manager report that names him | Agents fix checks, conflicts, and bot threads. Counting them as his made Blocked noisy | The first ask's list (failing check, conflict, bot thread = blocked). Kept as rule 7: a stall, shown in Processing |
| 3 | The report wins only when its `headSha` matches the PR head | A report from an older push is stale | Newest report always wins |
| 4 | GraphQL, two calls per poll (search, then cached detail), no ETags on GraphQL | REST cannot read thread resolution. GraphQL is a POST, so it has no ETag. About 10 points a poll, under 20% of the hourly budget at 45 s | REST with ETags: one call per PR per field, no thread state |
| 5 | The host polls only while a page holds a 3-minute lease; the page renews it each minute while visible | No GitHub calls when nobody looks | Always poll: wastes rate limit overnight |
| 6 | Queue writes run `stack pr-pri` through `PrQueue`; reads parse the store files | The store belongs to `pr-priority`; one writer. Reading the files avoids a child process per board build | Import the store in-process: two writers in one host |
| 7 | One-tap Accept; a confirm sheet for every GitHub write; queue moves undo with `pr-pri undo` | GitHub writes are public. The store has no unack, and a new answer replaces the old one | An unack command in this PR (out of scope; a follow-up on main if needed) |
| 8 | The flyout owns the keys while open | App shortcuts (`t`, `d`, `p`) would act on tasks under the flyout | Shared keys |
| 9 | Phone breakpoint 720 px, the app's own | One layout switch for the whole app | 768 px |
