# Design Decisions: CLI

## Live mode serves the owner's checkout on its current branch

**Decision**: `stack web --live` reads and writes `<repo>/tasks/` in the owner's own checkout, on whatever branch is checked out (`main` included), through `BatchedGitStorage`. `--branch` only asserts which branch must be checked out.

**Date**: 2026-10-31

**Why**: The owner edits the same files by hand; two copies of the truth (a `stack-web` worktree branch the owner merges later) meant edits from the app were invisible in the editor and vice versa, and merging was a chore nobody did.

**Rejected**: A dedicated `stack-web` branch in a worktree under `~/.config/stack/live` (safe for `main`, but a second copy of the truth); refusing `main` (protects nothing the owner wants protected, since every commit is theirs).

**Evidence**:

- Owner conversation, 2026-10-31 (rollout `batched-sync`)
