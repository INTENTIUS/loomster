#!/usr/bin/env bash
# A person grants a coding agent runs of named claims or E2Es, without typing
# "run" for each (test/human-gate.sh).
#
#   test/grant.sh <name>... [--runs N] [--hours H]   grant: N runs each (2), for H hours (4)
#   test/grant.sh --show                             what the grant holds now
#   test/grant.sh --end                              end the grant
#
# A name is a claim (`test/claims.sh --list`), an area of claims (`backend`
# grants every backend/ claim), or an E2E: e2e/<name> for test/<name>-e2e.sh
# (`e2e` alone grants all of them). Granting replaces any grant before it. The
# agent passes the gate only for the names here, a run at a time, and each
# granted run stops itself when it goes quiet.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test/human-gate.sh
. "$HERE/human-gate.sh"

case "${1:-}" in
  --show)
    if [ -f "$GRANT_FILE" ]; then
      expires="$(awk '$1 == "expires" { print $2 }' "$GRANT_FILE")"
      if [ "$(date +%s)" -lt "${expires:-0}" ]; then
        echo "until $(date -r "$expires" '+%Y-%m-%d %H:%M' 2>/dev/null || date -d "@$expires" '+%Y-%m-%d %H:%M'):"
        awk 'NR > 1 { print "  " $1 ": " $2 " run" ($2 == 1 ? "" : "s") " left" }' "$GRANT_FILE"
        exit 0
      fi
    fi
    echo "no grant"; exit 0 ;;
  --end)
    if [ -f "$GRANT_FILE" ]; then printf 'expires 0\n' > "$GRANT_FILE"; fi
    echo "no grant"; exit 0 ;;
  ""|-h|--help) sed -n 2,13p "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

runs=2 hours=4 asked=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --runs) runs="${2:?--runs takes a number}"; shift 2 ;;
    --hours) hours="${2:?--hours takes a number}"; shift 2 ;;
    -*) echo "grant: unknown flag $1" >&2; exit 2 ;;
    *) asked+=("$1"); shift ;;
  esac
done
[[ "$runs" =~ ^[1-9][0-9]*$ ]] || { echo "grant: --runs takes a whole number from 1" >&2; exit 2; }
[[ "$hours" =~ ^[1-9][0-9]*$ ]] || { echo "grant: --hours takes a whole number from 1" >&2; exit 2; }
[ "${#asked[@]}" -gt 0 ] || { echo "grant: name at least one claim, area or e2e/<name>" >&2; exit 2; }

known="$(bash "$HERE/claims.sh" --list | awk '{ print $1 }')"
e2es="$(for f in "$HERE"/*-e2e.sh; do b="$(basename "$f" .sh)"; echo "e2e/${b%-e2e}"; done)"
# An area or `e2e` expands to its names here, so the gate matches exact names.
names=()
for n in "${asked[@]}"; do
  if grep -qx -- "$n" <<<"$known" || grep -qx -- "$n" <<<"$e2es"; then
    names+=("$n")
  elif [ "$n" = e2e ]; then
    while read -r x; do names+=("$x"); done <<<"$e2es"
  elif grep -q -- "^$n/" <<<"$known"; then
    while read -r x; do names+=("$x"); done < <(grep -- "^$n/" <<<"$known")
  else
    echo "grant: $n is not a claim, an area of claims (test/claims.sh --list), or e2e/<name> (one of: $(tr '\n' ' ' <<<"$e2es"))" >&2
    exit 2
  fi
done

# Only a person grants: with no terminal this stops (LOOM_HUMAN_RUN does not count here).
unset LOOM_HUMAN_RUN
human_gate "a grant letting a coding agent run ${names[*]}, $runs time$([ "$runs" = 1 ] || echo s) each, for $hours hour$([ "$hours" = 1 ] || echo s)"

mkdir -p "$(dirname "$GRANT_FILE")"
{
  echo "expires $(( $(date +%s) + hours * 3600 ))"
  for n in "${names[@]}"; do echo "$n $runs"; done
} > "$GRANT_FILE"
"$0" --show
