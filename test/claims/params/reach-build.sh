#!/usr/bin/env bash
# target: static
# tier: any
# summary: LOOM_* build params set in the environment (LOOM_DB_PASSWORD, LOOM_CPU_ARCHITECTURE) land in the synthesized templates
#
# The docs tell you to export LOOM_DB_PASSWORD and LOOM_CPU_ARCHITECTURE
# before a deploy (getting-started/tutorial.md, the E2E scripts). This builds
# loom-db and loom-backend the way `npm run synth` does, with both set to values that are not the defaults
# and checks each one is in the template: the password in loom-db's RDS
# instance and secrets, ARM64 as the backend task definition's
# CpuArchitecture (X86_64 is the default).
#
# BREAK=1 builds with both variables unset, so neither value can be there.
set -euo pipefail

name=params/reach-build
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
[ -x node_modules/.bin/chant ] || { say pending "node_modules/.bin/chant is missing: run npm ci"; exit 0; }
command -v jq >/dev/null 2>&1 || { say pending "needs jq"; exit 0; }

work="$(mktemp -d "${TMPDIR:-/tmp}/loomster-claim-params.XXXXXX")"
trap 'rm -rf "$work"' EXIT
sentinel="claimPw$(date +%s)x7"

# The stack's build as `npm run synth` runs it (package.json's synth:<stack>),
# writing to the work directory instead of dist/.
build() { # stack
  local cmd
  cmd="$(jq -r --arg s "synth:$1" '.scripts[$s] // empty' package.json)"
  [ -n "$cmd" ] || { echo "package.json has no synth:$1 script" >"$work/$1.log"; return 1; }
  cmd="$(sed -E "s#(-o|--output) +[^ ]+#\\1 $work/$1.json#" <<<"$cmd")"
  if [ -n "${BREAK:-}" ]; then
    env -u LOOM_DB_PASSWORD -u LOOM_CPU_ARCHITECTURE PATH="$ROOT/node_modules/.bin:$PATH" \
      bash -c "$cmd" >"$work/$1.log" 2>&1
  else
    LOOM_DB_PASSWORD="$sentinel" LOOM_CPU_ARCHITECTURE=ARM64 PATH="$ROOT/node_modules/.bin:$PATH" \
      bash -c "$cmd" >"$work/$1.log" 2>&1
  fi
}

missing=""
for stack in loom-db loom-backend; do
  if ! build "$stack"; then
    # A build that refuses a missing required param is the property failing loudly.
    missing="$missing chant build src/$stack failed ($(tail -n 1 "$work/$stack.log"));"
  fi
done

if [ -s "$work/loom-db.json" ]; then
  grep -q -- "$sentinel" "$work/loom-db.json" || missing="$missing LOOM_DB_PASSWORD not in loom-db;"
fi
if [ -s "$work/loom-backend.json" ]; then
  arch="$(jq -r '[.. | objects | .RuntimePlatform? | objects | .CpuArchitecture] | first // "none"' "$work/loom-backend.json")"
  [ "$arch" = ARM64 ] || missing="$missing LOOM_CPU_ARCHITECTURE=ARM64 not in loom-backend (CpuArchitecture $arch);"
fi

if [ -n "${BREAK:-}" ]; then
  if [ -n "$missing" ]; then say caught "with the variables unset:${missing%;}"
  else say fail "the values were in the templates with the variables unset"; fi
elif [ -n "$missing" ]; then
  missing="${missing# }"; say fail "${missing%;}"
else
  say pass "the password reached loom-db and ARM64 reached the backend task definition"
fi
