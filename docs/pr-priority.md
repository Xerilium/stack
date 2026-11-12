# PR priority

<!-- @req FR:pr-priority/sm.doc @req FR:pr-priority/sm.file @req FR:ask-briefs/brief.pr -->

The owner orders the PRs the Sweep Manager (SM) works. Live state in `~/.stack`, never git. No LLM call. Spec: `.xe/features/pr-priority/spec.md`.

## CLI

- Owner: `stack pr-pri add <PR url>` (top) · `move <ref> --top|--up|--down|--to n` · `pin|unpin|remove <ref>` · `undo` · `ack <ref> --thread <url> --note t`
- Owner decides: `stack pr-pri accept <id>` · `edit <id> --reason t [--rank n] [--note t]` · `reject <id> --reason t`
- Agents: `stack pr-pri recommend <ref> --agent a --reason t [--to-rank n]` (exit `4` = blocked; read the reason, do not retry) · `decisions [--agent a]`
- SM: `stack pr-pri list --json --refresh` · `record <ref> --file rec.json` · `depends <ref> --on <ref>` (or `--file edges.json`) · `escalate --file set.json` (JSON on stdin also works)
- Every edit is idempotent, prints the new order, and takes `--json`. `<ref>` is `owner/repo#n` or a PR url. Exclude a PR (for example 918): `~/.stack/pr-priority.config.json` `{"exclude": ["owner/repo#918"]}`.

## Shapes

- `~/.stack/pr-priority.json` (lean, stable): `{version: 1, rev, updatedAt, items: [{rank, repo, number, url, pinned, note?, by, at}]}`
- `list --json` items add: `pr, title, author, isDraft, assignee, labels, reviewDecision, checks (green|red|pending), mergeable, lastPushAt, headSha, state (open|merged|closed), baseStack [urls], waitsOn [baseStack urls not merged], why, michaelDecision {state, reason, at}, report, acks [], status (approve|review|decide|unblock)`; top level adds `escalations`
- Record (`report`; newest `ts` wins; `stale` when the head moved): `{state: processing|waiting-on-me|blocked-on-me|pending|paused, ts, owner?: Michael|Roland|CI|runner|none, worker?, blocker?: {text, threadUrl?}, nextAction?, headSha?, humanOnly?: bool, bucket?: approve|review|decide|unblock}`
- Edges file: `[{"pr": "owner/repo#715", "on": "owner/repo#718"}]` = 715 merges after 718; all or none
- Escalation set: `{blockedAutopilot: [≤3 {pr, status, exactBlocker, context, recommendedAnswer, brief}], enableAutopilot: [≤3 {pr, whyEasy}], liveValidation: [≤1 {pr, why}]}`; each `escalate` replaces the whole set
- `brief` (every blocked entry): `{problem, solution, risks [1-5], recommendation, evidence? [https]}`, ≤120 words, ≤25 words per sentence. Without it the owner sees **No context yet** and cannot accept in one tap. An ack note that starts `Send a brief` means: add the brief, keep the entry

## Paste into the SM agent prompt

```text
PR priority (Stack). Each sweep, run `stack pr-pri list --json --refresh` and read `items`.
Work PRs in this order; skip none; report progress per PR.
- Rank 1 first, down to the last rank. At most 3 workers at a time.
- Merge only Autopilot PRs whose gates all pass, and never while `waitsOn` is not empty. Add edges with `stack pr-pri depends <pr> --on <pr>`.
- Never add the Autopilot label (Michael applies it). Never un-draft a PR.
- Use `acks[]` (Michael's thread acks) to resolve hold threads.
- After each PR, run `stack pr-pri record <pr> --file rec.json` (shape above). If `report.stale` is true, re-check the PR.
- Keep the escalation set current: `stack pr-pri escalate --file set.json` (≤3 blocked, ≤3 enable, ≤1 live validation).
- Every blocked entry has a `brief` (problem, solution, risks, recommendation, evidence links; ≤120 words). Michael decides from it without opening the PR. If an ack says "Send a brief", add it on the next escalate.
- To raise a PR, run `stack pr-pri recommend <pr> --agent <you> --reason <why> [--to-rank n]`. Exit 4 means Michael said no or it is already ranked: do not ask again.
- Use full PR links in all output. Keep each row under 20 words.
```
