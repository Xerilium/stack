#!/usr/bin/env bash
# Acceptance parity of Stack against a legacy checkout. READ ONLY on the legacy folder.
# @req FR:cli/parity.script (`pnpm run parity` runs tests/parity/cli-parity.test.ts; this script is the full legacy comparison)
#
#   STACK_LEGACY_DIR=~/dev/todo scripts/parity.sh
#
# Needs: pnpm (deps installed), node, pwsh. The legacy folder must hold tasks/, src/PowerShell,
# README.md, projects.md and optionally .xe/config/stack.json. Everything runs on a scratch copy.
# Checks: (a) byte-exact round trip, (c) scoring golden, (b) `update` output vs legacy generator at
# three frozen clocks, and `next` vs the legacy time-filtered top score. Prints counts only, never
# task text. Exit 0 = all pass. Optional: STACK_PARITY_CLOCKS="iso1 iso2 ..." (offset required).
set -euo pipefail

: "${STACK_LEGACY_DIR:?set STACK_LEGACY_DIR to the legacy repo folder}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LEGACY="$(cd "$STACK_LEGACY_DIR" && pwd)"
export TZ="${TZ:-America/Los_Angeles}"
CLOCKS=(${STACK_PARITY_CLOCKS:-2026-10-22T09:00:00-07:00 2026-10-24T15:30:00-07:00 2026-10-26T06:15:00-07:00})

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/stack-parity.XXXXXX")"
KEEP=0
trap '[ "$KEEP" -eq 1 ] || rm -rf "$SCRATCH"' EXIT
CASE="$SCRATCH/case"; REPO="$SCRATCH/repo"
mkdir -p "$CASE/prior" "$CASE/.xe" "$REPO/.xe"
cp -R "$LEGACY/tasks" "$CASE/tasks"; cp -R "$LEGACY/tasks" "$REPO/tasks"
cp -R "$LEGACY/src" "$REPO/src"
if [ -d "$LEGACY/.xe/config" ]; then cp -R "$LEGACY/.xe/config" "$CASE/.xe/config"; cp -R "$LEGACY/.xe/config" "$REPO/.xe/config"; fi
for f in README.md projects.md; do [ -f "$LEGACY/$f" ] && cp "$LEGACY/$f" "$CASE/prior/$f"; done
i=0; for c in "${CLOCKS[@]}"; do if [ $i -eq 0 ]; then echo "$c" > "$CASE/now.txt"; else echo "$c" > "$CASE/now-c$i.txt"; fi; i=$((i+1)); done

cd "$ROOT"
echo "== build"; pnpm run build:cli >/dev/null

echo "== legacy golden + generator (pwsh)"
pwsh tests/fixtures/scoring/generate-golden.ps1 -LegacyRoot "$REPO" -TasksPath "$REPO/tasks" -OutFile "$CASE/golden.json" >/dev/null
pwsh tests/parity/generate-legacy.ps1 -LegacyRoot "$REPO" -CaseDir "$CASE" >/dev/null

fail=0
echo "== (a)+(c) round trip and scoring golden"
if STACK_PARITY_CASE="$CASE" pnpm exec jest tests/parity/real-data --silent >/dev/null 2>&1; then echo "PASS"; else
  echo "FAIL"; fail=1; KEEP=1
  echo "  rerun: STACK_PARITY_CASE=$CASE pnpm exec jest tests/parity/real-data"
  echo "  case dir kept (contains task data, do not share): $CASE"
fi

echo "== (b) update vs legacy, ${#CLOCKS[@]} clocks"
i=0
for c in "${CLOCKS[@]}"; do
  W="$SCRATCH/work$i"; mkdir -p "$W"; cp -R "$CASE/tasks" "$W/tasks"
  [ -d "$CASE/.xe" ] && cp -R "$CASE/.xe" "$W/.xe"
  cp "$CASE"/prior/* "$W/" 2>/dev/null || true
  E="$CASE/expected"; [ $i -gt 0 ] && E="$E/c$i"
  node dist/cli/index.js update --dir "$W" --no-commit --now "$c" >/dev/null
  same=0; total=0
  for f in README.md stack.md projects.md my-day.md; do
    total=$((total+1))
    if [ ! -f "$E/$f" ] && [ ! -f "$W/$f" ]; then same=$((same+1)); elif cmp -s "$W/$f" "$E/$f"; then same=$((same+1)); else echo "  DIFF $f ($(diff "$W/$f" "$E/$f" 2>/dev/null | grep -c '^[<>]') lines)"; fi
  done
  tasks_changed=$(diff -rq "$CASE/tasks" "$W/tasks" | wc -l | tr -d ' ')
  echo "  clock $c: $same/$total identical; task files changed by update: $tasks_changed"
  [ "$same" -eq "$total" ] && [ "$tasks_changed" -eq 0 ] || fail=1
  i=$((i+1))
done

echo "== (c) next vs legacy time-filtered top score"
GOLDEN="$CASE/golden.json" TASKS="$CASE" CLI="$ROOT/dist/cli/index.js" SCRATCH="$SCRATCH" node -e '
const fs = require("fs"), cp = require("child_process");
const g = JSON.parse(fs.readFileSync(process.env.GOLDEN, "utf8"));
const score = new Map(g.tasks.map(t => [t.id, t.score]));
let ok = 0, n = 0;
for (const f of g.filtered) {
  const dir = process.env.SCRATCH + "/next"; fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(process.env.TASKS + "/tasks", dir + "/tasks", { recursive: true });
  if (fs.existsSync(process.env.TASKS + "/.xe")) fs.cpSync(process.env.TASKS + "/.xe", dir + "/.xe", { recursive: true });
  const r = cp.spawnSync("node", [process.env.CLI, "next", "--json", "--dir", dir, "--no-commit", "--now", f.at], { encoding: "utf8" });
  const want = f.ids.length ? score.get(f.ids[0]) : null;
  const got = r.status === 4 ? null : JSON.parse(r.stdout).score;
  n++; if (want === got) ok++; else console.log("  MISMATCH at " + f.at);
}
console.log("  " + ok + "/" + n + " instants: top score equals legacy");
process.exit(ok === n ? 0 : 1);
' || fail=1

[ $fail -eq 0 ] && echo "PARITY: PASS" || { echo "PARITY: FAIL"; exit 1; }
