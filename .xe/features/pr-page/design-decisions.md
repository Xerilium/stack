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
| 10 | The local host reads the token from `GITHUB_TOKEN`, else `gh auth token`; the in-app sign-in runs `gh auth login --web` | A Dock-launched macOS app has no shell environment, so a `GITHUB_TOKEN`-only gate hid the PR page in the installed app. `gh` is already signed in on the owner's machine and holds the token in its own store. Running `gh` uses its own registered OAuth app | A Stack OAuth app with its own device flow: needs an app registration and a token store; follow-up if a machine without `gh` needs it |
| 11 | Signed out is a state, not `off` | An empty or hidden board reads as "no PRs". One line and one button says what to do | Hide the icon (PR 145): the cause of the bug |
| 12 | My repos default to the owner plus the orgs the owner admins | Those orgs are the owner's own work. Big orgs he only joined (microsoft) would flood Waiting with PRs that are not his | Every org membership; project `Repository:` lines (FTK, FOCUS are shared repos) |
| 13 | A nav entry (`#/prs`) plus the top bar icon | The icon alone was easy to miss; the rail is where the owner looks. The icon keeps the one-tap flyout on any screen | Icon only; a sixth phone tab (the bar keeps five slots) |
| 14 | Detail reads run 3 at a time | The first poll of a 60-PR board took 28 s; now about 14 s, and the app loads the board at start | Fully parallel: GitHub secondary rate limits |
