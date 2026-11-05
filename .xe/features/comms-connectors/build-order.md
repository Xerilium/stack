# Build Order

Each step is one PR. Each is read-only first.

| Step | Work | Why this order |
|---|---|---|
| 0 | Connector contract + `Item`/`signal` types; port email and Teams/Slack onto it | Removes per-source glue |
| 1 | GitHub notifications | Lowest effort. Free. Deterministic signals |
| 2 | Calendar (Graph delta) | Reuses sign-in. Gives `deadline` signals |
| 3 | YouTube comments (read + draft) | Cheap. Owner's music project |
| 4 | Gmail, in Testing mode, if owner uses it | Highest value if true. Weekly re-auth. Defer review |
| 5 | Instagram comments (poll, own account) | Needs Meta app setup |
| 6 | iMessage via local Mac agent | Needs desktop app. Privacy opt-in |
| 7 | X mentions | Only if cost is justified |
| - | LinkedIn: parse notification emails (no connector) | Free from step 0 |
| - | LinkedIn inbox, WhatsApp personal | Do not build |

Gate before step 4: owner answers open questions in research.md.
