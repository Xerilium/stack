# Plan: Auto-priority

1. Rules: the existing `applyOverrides` ranks rows. Tests use the real `priorities.json` as a fixture.
2. Tags: `untaggedTasks` lists leaves with no Value/Impact/Priority emoji. CoS tags them.
3. Picks: `pickMatch` counts owner picks in the top 10 of the final ranking. Bake-off run uses it (target >= 8/10).
4. Misses: owner reports a miss to CoS. CoS logs it in `cos-state.md` under `## Auto-pri misses`. `checkMisses` turns each line into a regression check.
5. Code: `src/core/autopri.ts`. Pure. No change to scoring.ts or priorities.ts.

Open: real owner picks are not logged yet. The 8/10 bake-off run waits for them.
