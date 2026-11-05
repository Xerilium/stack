# Init performance: baseline and results

Run: `pnpm build:core build:cli build:api build:web && node scripts/perf/bench.mjs --repo <dir> --runs 7`
Cells are `min/median`. CPU is `process.cpuUsage` user+sys (ms). **Trust CPU, not wall:** the machine had load average 100 to 160 during all runs, so wall time is inflated by scheduling.
Machine: macOS, node 22.17. Repos: a read-only copy of `~/dev/todo` (12 projects, ~480 open tasks, no `.git` history) and a 500-task synthetic repo.

## Findings

- Server CPU per page load was about 220 ms (16 requests). On a machine starved by load, wall time scales by the contention factor, so ~30 s is plausible at load > 100 and ~100x slowdown.
- Top hotspots (`node --cpu-prof`, 40 ranks): `scoring.ts` `present`/`baseEmojis` (lowercase + scan per row, repeated per ancestor), `resolveBlockers` (every row scans every row), `inherited` (BFS repeated for each ancestor of each leaf), `leaves.indexOf` (N^2), `formatToParts` per row for due dates, GC.
- Each page load ranks twice (`now` and `blocks=any`), reads every task file 6 times (rank x2, tasks x3 pages, projects), one file at a time.
- Client: `/.auth/me` blocked all data loads; task pages were fetched one after another; the first screen waited for the all-day ranking.
- Watcher: `fs.watch(repo, { recursive: true })` covers `.git` and `node_modules` (817 MB `.git` in the real repo). Cheap on macOS (FSEvents) but a full tree walk on Linux and Windows.
- Not a problem: bundle (1 JS file 197 kB, 66 kB gzip; CSS 91 kB), service worker (shell cache, data network-first), server start (2 to 4 ms).

## Before (main @ 77c068f)

todo copy:

| Step              | Wall (ms) | CPU (ms) |
| ----------------- | --------- | -------- |
| start             | 1/2       | 2/2      |
| tasks cold        | 22/143    | 9/13     |
| rank cold         | 122/245   | 55/74    |
| rank warm         | 158/243   | 52/68    |
| first-load burst  | 235/343   | 85/102   |
| client load       | 1124/1449 | 221/271  |

Client load = 16 requests (`/.auth/me`, schedule, agents, inbox, calendar, rank x2, tasks x3, projects, needs-you).

Scoring alone, 1,200 tasks: 141 ms CPU. 9,600 tasks: 2,121 ms.

## After

todo copy:

| Step              | Wall (ms) | CPU (ms) |
| ----------------- | --------- | -------- |
| start             | 3/3       | 2/3      |
| tasks cold        | 5/11      | 5/7      |
| rank cold         | 19/88     | 20/28    |
| rank warm         | 13/55     | 6/8      |
| first-load burst  | 28/76     | 19/21    |
| client load       | 681/1185  | 139/157  |

500-task synthetic (after only; the client-load step was added after its baseline run): client load CPU 77/89 ms, 14 requests. Burst before 24/27, after 13/15.

Scoring alone, 1,200 tasks: ~48 ms CPU (was 141). 9,600 tasks: ~275 ms (was 2,121).

Output check: `/api/rank` for the todo copy is byte-identical before and after (both `blocks` modes).

## Left

- Task files are still read and parsed on every request (`lstat` per path part, read, parse). A watcher-invalidated document cache would remove it; deferred because a stale read window after an external edit needs a design decision.
- The two rankings per load (`now`, `any`) still score twice on a cold cache.
