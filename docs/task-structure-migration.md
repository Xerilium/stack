# Task structure migration (for CoS)

Spec: `.xe/features/task-structure/spec.md`. This is a breaking change. Stack has no fallback for the old folders.

## What changes

- Stack reads `.md` task files at any depth under `tasks/` (for example `tasks/xerilium/stack/goal.md`).
- A project ID is its path under `tasks/` without `.md` (`xerilium/stack/goal`). Flat files keep their old IDs (`tasks/alpha.md` is `alpha`).
- System files move to `.stack/` folders: `tasks/.stack/{asks,agents,logs,inbox,wake}/`.
- Logs and inboxes live in the `.stack/` folder beside their project file.
- Stack skips every dot folder when it lists tasks.

## Steps (in the task repo, in one commit)

1. Stop `stack web` and every agent loop.
2. Move the system folders:

   ```sh
   mkdir -p tasks/.stack
   for d in asks agents logs inbox wake; do [ -d tasks/$d ] && git mv tasks/$d tasks/.stack/$d; done
   ```

3. Move a task file into a folder:

   ```sh
   mkdir -p tasks/xerilium/stack
   git mv tasks/stack.md tasks/xerilium/stack/goal.md
   ```

4. Move that project's log and inbox beside it, with the new base name:

   ```sh
   mkdir -p tasks/xerilium/stack/.stack/logs tasks/xerilium/stack/.stack/inbox
   git mv tasks/.stack/logs/stack.md tasks/xerilium/stack/.stack/logs/goal.md
   git mv tasks/.stack/inbox/stack.md tasks/xerilium/stack/.stack/inbox/goal.md
   ```

   Also move the rolled logs (`stack.2.md` to `goal.2.md`, and so on).

5. Fix the refs that name the old path or ID (see below). Then commit and start `stack web`.

`stack ids assign` is not in this release. It comes with `#id` task refs, which wait for an owner decision.

## What breaks

- An old folder that you do not move (`tasks/asks/` and the others) becomes a task folder. Its files show as projects.
- Refs to a moved file break: `ref: tasks/stack.md:12` lines in asks and inbox entries, and `project:line` refs that agents hold.
- Agent `scope` and project `Agents` lines that name the old ID. Use the new ID (`xerilium/stack/goal`) or a folder (`xerilium`).
- `--project` arguments and `GET /projects/{name}` use the new ID. In a URL, encode `/` as `%2F`.
- Review ask keys (`rev-<project>-<line>-...`) change for nested projects. Open review asks for a moved project are not matched again; close them by hand.
- Two projects with the same base name in different folders are fine. Two in the same folder that differ only in punctuation share a log file (as before).
