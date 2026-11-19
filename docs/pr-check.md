# PR live check file

Sweepers write one file per PR that needs the owner to check it live. The PR page shows it in the PR details. Spec: `.xe/features/pr-page/spec.md` (`FR:check.*`).

## Path

`<home>/pr/<owner>/<repo>/<number>.md`. `<home>` is `STACK_HOME` or `~/.stack`. Example: `~/.stack/pr/Xerilium/stack/188.md`. Never in git.

## Format

Bullets under 10 words. Max 16 KB. At most 20 items a list.

```markdown
- Ask: Check sign-in on the phone
- Server: `pnpm web --port 5180`
- As of: 2026-11-18T10:00:00Z

## Steps

1. Open http://localhost:5180 on the phone
2. Sign in with the test account

## Pass

- Home shows your tasks

## Fail

- An error toast shows
```

| Part | Rule |
| --- | --- |
| `- Ask:` | What the owner must decide or check, one line |
| `- Server:` | The command that starts the server; the page has a Copy button |
| `- As of:` | ISO time the sweeper last checked the file |
| `## Steps` | Numbered steps, in order |
| `## Pass`, `## Fail` | What a pass and a fail look like |

Other lines are ignored. A PR whose next action is Validate with no file, or no steps, shows `Not actionable: no server/steps yet`.

## Lifecycle

- Write or update the file when the PR needs live validation.
- Update `As of` on each sweep that checks it.
- Delete it after the PR merges or closes.
