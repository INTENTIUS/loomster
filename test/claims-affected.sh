#!/usr/bin/env bash
#
# The claims a change can affect, one name per line, for
# `test/claims.sh --only` (`just claims-affected`).
#
#   test/claims-affected.sh [base]   base defaults to origin/main
#
# The change is everything between the merge base with <base> and the working
# tree (committed, staged, unstaged and untracked). A file picks claims this way:
#
#   test/claims/<area>/<part>.sh   that claim
#   anything else                  the claim globs test/claim-paths.txt gives its
#                                  path; ALL picks every claim, and a path the
#                                  file does not name picks none
#
# Each reason goes to stderr, so a run says why it runs what it runs.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
base="${1:-origin/main}"
cd "$ROOT"

mb="$(git merge-base "$base" HEAD)" || { echo "claims-affected: no merge base with $base" >&2; exit 2; }
all="$(bash "$HERE/claims.sh" --list | awk '{ print $1 }')"
picked=""
pick() { # reason, claim...
  local why="$1" c
  shift
  [ "$#" -gt 0 ] || { echo "claims-affected: $why: no claim" >&2; return 0; }
  echo "claims-affected: $why: $*" >&2
  for c in "$@"; do picked="$picked$c"$'\n'; done
}

files="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard; } | sort -u)"
[ -n "$files" ] || { echo "claims-affected: nothing changed since $(git rev-parse --short "$mb")" >&2; exit 0; }

# The globs in claim-paths.txt are patterns, never file names.
set -f
while read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    test/claims/*/*.sh)
      c="${f#test/claims/}"
      c="${c%.sh}"
      # A deleted claim has nothing left to run.
      if grep -qx -- "$c" <<<"$all"; then pick "$f" "$c"; else echo "claims-affected: $f: removed" >&2; fi
      ;;
    *)
      globs="$(awk -v f="$f" '!/^#/ && NF > 1 && index(f, $1) == 1 { $1 = ""; print; exit }' "$HERE/claim-paths.txt")"
      if [ -z "$globs" ]; then
        echo "claims-affected: $f: no claim" >&2
        continue
      fi
      out=""
      for g in $globs; do
        if [ "$g" = ALL ]; then out="$all"; break; fi
        for c in $all; do
          # shellcheck disable=SC2254 # the glob is the pattern
          case "$c" in $g) out="$out$c"$'\n' ;; esac
        done
      done
      # shellcheck disable=SC2046 # one name per word
      pick "$f" $(sort -u <<<"$out")
      ;;
  esac
done <<<"$files"

sort -u <<<"$picked" | grep . || true
