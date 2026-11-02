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

## A batch flush commits before it syncs with the remote

**Decision**: `flush()` commits the pending paths first, then fetches, rebases, and pushes. A rebase conflict aborts and leaves the commit undone (soft reset), with the files still written.

**Date**: 2026-10-31

**Why**: `GitStorage` syncs before each write, when the work tree holds nothing of its own. A batch holds written, uncommitted files; a pre-commit rebase would stash them, and a stash-apply conflict resets the work tree hard, destroying the owner's edits.

**Rejected**: Sync before commit as `GitStorage` does (loses pending files on a stash conflict); never rebasing (push always fails once the phone has written).

## A batch flush never stashes the owner's own edits

**Decision**: When the remote is ahead and the checkout has uncommitted edits of its own, `BatchedGitStorage.flush()` undoes its commit, keeps the batch, and throws `ConflictError` ("commit or stash them, then save again") instead of rebasing.

**Date**: 2026-10-31

**Why**: Live mode runs on the owner's real checkout. `GitStorage.rebase()` stashes dirty files and, on a stash re-apply conflict, hard-resets the work tree; on a scratch worktree that was acceptable, on the owner's checkout it would destroy a hand edit.

**Rejected**: Stash and rebase as `GitStorage` does (can lose a hand edit); refusing to flush at all while dirty (the common case, a clean remote, would never save).
