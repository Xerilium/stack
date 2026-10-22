#!/usr/bin/env bash
# Manual spec -> test -> code traceability (stand-in while `catalyst check` is broken in 0.3.2).
# For every requirement `- **FR:<id>**` in .xe/features/<feature>/spec.md, finds `@req FR:<feature>/<id>`
# in src/ (code) and tests/ (test). Prints per-feature counts and lists uncovered ids.
# Usage: scripts/trace.sh [-v]    Exits 1 while any requirement lacks a test or code tag, so it is not yet a CI gate.
cd "$(dirname "$0")/.."
tags() { grep -rhoE "@req (N?FR):[A-Za-z0-9._@-]+/[A-Za-z0-9._@-]+" "$1" | sed 's/^@req //' | sort -u; }
tags src > "${TMPDIR:-/tmp}/trace-code.$$"; tags tests > "${TMPDIR:-/tmp}/trace-test.$$"
trap 'rm -f "${TMPDIR:-/tmp}/trace-code.$$" "${TMPDIR:-/tmp}/trace-test.$$"' EXIT
bad=0; tot=0; nocode=0; notest=0
printf '%-18s %5s %5s %5s\n' feature reqs code test
for spec in .xe/features/*/spec.md; do
  f=$(basename "$(dirname "$spec")")
  ids=$(grep -oE '^- \*\*N?FR:[A-Za-z0-9._@-]+\*\*' "$spec" | sed -E 's/^- \*\*(N?FR):([^*]*)\*\*/\1:'"$f"'\/\2/' | sort -u)
  [ -z "$ids" ] && continue
  n=0; c=0; t=0; miss=""
  for id in $ids; do
    n=$((n+1)); hc=0; ht=0
    grep -qxF "$id" "${TMPDIR:-/tmp}/trace-code.$$" && hc=1
    grep -qxF "$id" "${TMPDIR:-/tmp}/trace-test.$$" && ht=1
    c=$((c+hc)); t=$((t+ht))
    [ $hc -eq 0 ] && nocode=$((nocode+1)); [ $ht -eq 0 ] && notest=$((notest+1))
    [ $hc -eq 0 ] || [ $ht -eq 0 ] && miss="$miss ${id#*/}(${hc}${ht})"
  done
  tot=$((tot+n))
  printf '%-18s %5d %5d %5d\n' "$f" $n $c $t
  [ -n "$miss" ] && { bad=1; echo "  missing (code,test):$miss"; }
done
echo "total reqs $tot; without code tag $nocode; without test tag $notest"
exit $bad
