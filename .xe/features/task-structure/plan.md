# Plan: Task Structure

## Slices

| PR | Content | State |
| --- | --- | --- |
| 1 | Recursive list, `.stack/` system folders, path-based project IDs | This PR |
| 2 | `T:` task IDs, `stack ids assign`, blockquote metadata, `stack mv`, lint (`task-ids`) | Next |
| 3 | Asks as nested 🙋 tasks (`task-asks`) | After PR 2 |
| 4 | ⭐️ Now, goal frontmatter, agent name resolution (`goal-model`) | After PR 3 |

## PR 1 approach

1. `src/core/task-paths.ts`: path regexes (task, system kinds), `projectId`, `projectPath`, `systemDir`, `isReadme`.
2. `storage.ts`: recursive `FsStorage.list` (skip dot names and symlinks); `listAsks`/`listAgents` walk every `.stack/` level. `MemoryStorage` and `GitHubStorage` filter by the same regexes.
3. Writers: asks, agents, wake, session log write in `tasks/.stack/`. Logs and inboxes write beside the project file.
4. Ask key lookup: `askFile(ctx, key)` maps a key to its listed path; root path when absent. Archive stays in the same `.stack/` folder.
5. Project identity: replace each local `baseName` used as a project name with `projectId`. Readme checks use the last segment.
6. Refs: `REF_RE`, `parseTaskRef`, `formatRef` accept nested IDs.
7. Agent scopes: folder, project, and project/section matching per `FR:id.scope`.
8. Watcher, discovery, bakeoff: nested paths.
9. Update the living specs and docs that name old folders. Regenerate `docs/api/openapi.yaml`.

## Tasks

- [ ] Spec and migration note
- [ ] Failing tests for every FR (`@req FR:task-structure/...`)
- [ ] Implement steps 1-8
- [ ] Update old-path tests and docs (step 9)
- [ ] `pnpm test`, `pnpm lint`, traceability
- [ ] Independent review round
