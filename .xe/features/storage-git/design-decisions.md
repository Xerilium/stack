# Design Decisions: Task Storage (Git)

## Detect concurrent edits with a content hash, not a git sha

**Decision**: `version` is the sha256 of the file's UTF-8 bytes. Every adapter (memory, disk, git, GitHub) derives it the same way.

**Date**: 2026-10-22

**Why**: Surfaces compare versions across adapters (a web page reads through GitHub storage, the CLI through git); a commit sha would differ per adapter and change on every unrelated commit.

**Rejected**: Git blob or commit sha (adapter-specific; a rebase changes it); file mtime (not stable across clones).

## Commit live edits in batches, not one per write

**Decision**: `BatchedGitStorage` writes each file at once and commits the pending paths as one summarized commit after a quiet stretch (default 5 minutes), on an explicit flush, and on close. `GitStorage` keeps the one-commit-per-write behavior for the CLI and agents.

**Date**: 2026-10-31

**Why**: The owner edits the same checkout by hand and from the app; the files are the source of truth, and the git history should read as sessions ("done 2, deferred 1") rather than as taps. Phone access depends on the push, not on the commit, so the host flushes when the page is hidden.

**Rejected**: One commit per write (noisy history, a git round-trip per tap); daily commits (a change made before leaving the desk is not on the phone until tomorrow); a manual "cart" of unsaved changes (puts the chore on the owner).

**Evidence**:

- Owner conversation, 2026-10-31 (rollout `batched-sync`)
