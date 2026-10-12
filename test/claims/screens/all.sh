#!/usr/bin/env bash
# target: aws
# tier: light
# order: 30
# summary: after loom-seed's demo profile, every screen check (npm run validate) passes against the deployed light tier
#
# The docs say a seeded Loom shows every screen populated, and the screen
# reference lists the checks scripts/validate/checks.ts runs. On the shared
# claims deployment (loom-backend and what it needs, claims_aws_ensure) this
# mints an admin token through the user client, runs loom-seed's demo profile
# (agent deploy, memory, MCP, A2A, approvals, evaluations; the skill is
# skipped without a registry, which the checks allow), then runs every screen
# check with the demo profile's assertions and expects all of them to pass.
#
# BREAK=1 deletes the seeded demo MCP server through Loom's API after the seed,
# so the MCP Servers check (which needs one on the demo profile) must fail; the
# claim expects validate to report it. On exit it seeds the demo profile again,
# which recreates the server, so later claims see the seeded Loom.
set -euo pipefail

name=screens/all
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }
log() { echo "[$name] $*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

# shellcheck source=test/claims-aws.sh
. "$ROOT/test/claims-aws.sh"
why="$(claims_aws_needs)"
[ -z "$why" ] || { say pending "$why"; exit 0; }
claims_aws_light_env || { say fail "no claims prefix (test/claims-aws.sh prefix)"; exit 0; }

AUTHCFG="$(mktemp "${TMPDIR:-/tmp}/loomster-claim-auth.XXXXXX")"
work="$(mktemp -d "${TMPDIR:-/tmp}/loomster-claim-screens.XXXXXX")"
BASE="" TOKEN="" BROKEN=""
on_exit() {
  if [ -n "$BROKEN" ] && [ -n "$BASE" ] && [ -n "$TOKEN" ]; then
    log "seeding the demo profile again to put the MCP server back"
    claims_aws_seed "$BASE" "$TOKEN" demo >/dev/null 2>&1 || log "re-seeding failed; a later claim that needs the demo MCP server will say so"
  fi
  rm -rf "$AUTHCFG" "$work"
}
trap on_exit EXIT

stop() { # detail
  if [ -n "${BREAK:-}" ] && [ -n "$BROKEN" ]; then say caught "$1"
  elif [ -n "${BREAK:-}" ]; then say fail "BREAK could not be applied: $1"
  else say fail "$1"; fi
  exit 0
}

log "making sure loom-backend and what it needs are up under $CLAIMS_AWS_PREFIX"
why="$(claims_aws_ensure loom-backend)" || stop "deploy: $why"
BASE="$(claims_aws_base)" || stop "the backend never answered /health"
TOKEN="$(claims_aws_token)" || stop "scripts/validate/get-user-token.sh minted no token through the user client"
printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" >"$AUTHCFG"

claims_aws_seed "$BASE" "$TOKEN" demo >"$work/seed.log" 2>&1 \
  || stop "loom-seed (demo) failed: $(grep -m1 'verdict=failed' "$work/seed.log" || tail -n 1 "$work/seed.log")"

if [ -n "${BREAK:-}" ]; then
  mcp="$(ca_api "$AUTHCFG" "$BASE/api/mcp/servers" | jq -r '[.[] | select(.name | test("loomster"; "i"))][0].id // .[0].id // empty' 2>/dev/null || true)"
  [ -n "$mcp" ] || stop "the demo profile seeded no MCP server to delete"
  ca_api "$AUTHCFG" -X DELETE "$BASE/api/mcp/servers/$mcp" >/dev/null || stop "DELETE /api/mcp/servers/$mcp failed"
  # Delete every remaining one too, so the demo assertion (at least one) cannot hold.
  for id in $(ca_api "$AUTHCFG" "$BASE/api/mcp/servers" | jq -r '.[].id' 2>/dev/null); do
    ca_api "$AUTHCFG" -X DELETE "$BASE/api/mcp/servers/$id" >/dev/null || true
  done
  BROKEN=1
fi

if LOOM_API_BASE_URL="$BASE" LOOM_API_TOKEN="$TOKEN" LOOM_SEED_PROFILE=demo \
    ./node_modules/.bin/tsx scripts/validate/run.ts >"$work/validate.log" 2>&1; then
  summary="$(grep -E 'screens passed' "$work/validate.log" | tail -n 1)"
  if [ -n "${BREAK:-}" ]; then say fail "with the demo MCP server deleted, validate still passed ($summary)"
  else say pass "loom-seed's demo profile, then every screen check passed against $BASE (${summary:-validate exited 0})"; fi
else
  failed="$(grep -E '^\s*FAIL' "$work/validate.log" | sed -E 's/^\s*FAIL\s+//; s/\s+/ /g' | paste -sd ';' - | head -c 400)"
  summary="$(grep -E 'screens passed' "$work/validate.log" | tail -n 1)"
  # Under BREAK only the MCP check failing is the property noticing; anything
  # else failing is a problem of its own.
  if [ -n "${BREAK:-}" ] && ! grep -qE '^\s*FAIL\s+MCP Servers' "$work/validate.log"; then
    say fail "with the demo MCP server deleted, validate failed but not on MCP Servers: ${failed:-$(tail -n 1 "$work/validate.log")}"; exit 0
  fi
  stop "${summary:-validate failed}: ${failed:-$(tail -n 1 "$work/validate.log")}"
fi
