---
id: perf
title: Init performance
description: Time and CPU budgets for `stack web` start, the first API calls, and the first page load
dependencies: [cli, api, scoring-engine, web-app]
---

<!-- markdownlint-disable single-title -->

# Feature: Init performance

## Purpose

Owner needs `stack web` to open fast on a busy machine so that the first screen never waits on avoidable work. Wall time on a loaded machine scales with CPU time and with the number of round trips, so the budgets bound both.

## Scenarios

### FR:rank: Ranking

Owner needs ranking to cost little CPU so that Home draws quickly on a repo of hundreds of tasks.

- **FR:rank.cost** (P1): Ranking 1,200 tasks MUST use at most 70 ms of CPU (best of 5, warm)
  - Baseline: 141 ms. Measured with `process.cpuUsage`, not wall time
- **FR:rank.scale** (P1): Ranking 4,800 tasks MUST use at most 350 ms of CPU
  - Blocker resolution, parked checks, and inheritance MUST NOT repeat work per task that one pass can share
- **FR:rank.same** (P1): Faster ranking MUST return the same order, scores, and breakdowns as before
  > - @req FR:scoring-engine/parity.golden
- **FR:rank.cache** (P1): Ranking twice over unchanged files, rules, and clock minute MUST score once
  - The cache key holds the version of every task file, the priorities file, the options, and the minute
  - A write changes a version, so the next rank scores again

### FR:load: Reading

- **FR:load.parallel** (P1): Reading all task files MUST run in parallel
  - With 25 files at 40 ms each, `GET /api/tasks` MUST answer in under 500 ms (serial: 1,000 ms)

### FR:watch: File watcher

- **FR:watch.scope** (P1): `stack web` MUST watch only `tasks/` and `.stack/` (recursive), plus the repo root without recursion to notice either folder appearing
  - It MUST NOT watch `.git`, `node_modules`, or other large folders
  - A `.stack/` folder created after start MUST still raise changes

### FR:serve: Static files

- **FR:serve.assets** (P2): Files under `/assets/` (content-hashed names) MUST be served with `cache-control: public, max-age=31536000, immutable`; `index.html` and the API stay `no-store`
- **FR:serve.gzip** (P2): `stack web` MUST gzip (level 6) a static file or API reply over 1 KB when `Accept-Encoding` allows `gzip` and the type is text (`html`, `js`, `css`, `json`, `svg`, `webmanifest`), with `content-encoding: gzip` and `vary: accept-encoding`; the main JS bundle MUST transfer at least 60% smaller
  - **FR:serve.gzip.skip** (P2): Event streams (`text/event-stream`), images and other binary types MUST NOT be compressed
  - **FR:serve.gzip.cache** (P3): The gzip of each `/assets/` file MUST be made once and kept in memory

### FR:client: First page load

- **FR:client.parallel** (P1): The page MUST start loading data without waiting for `/.auth/me`
- **FR:client.pages** (P1): `tasks()` MUST fetch pages after the first in parallel
  - The first page gives `total`; the rest go out together
- **FR:client.paint** (P1): The first screen MUST NOT wait for the all-day ranking (`blocks=any`); that ranking fills in when it arrives

### FR:bench: Benchmark

- **FR:bench.script** (P2): `scripts/perf/bench.mjs` MUST time start, each first call, and the client load sequence (wall and CPU, min and median over runs) on a synthetic repo or `--repo`
  - Baseline and latest numbers live in `baseline.md`

## Budgets (end to end, idle machine, 500-task repo)

| Step                         | Budget      |
| ---------------------------- | ----------- |
| `stack web` start            | < 2 s       |
| `GET /api/tasks` warm        | < 300 ms    |
| `GET /api/rank` warm         | < 300 ms    |
| Client load CPU (all calls)  | < 150 ms    |
| Client load requests on path | <= 16, depth <= 3 |
| First paint (data ready)     | < 1 s       |
