#!/usr/bin/env bash
# target: floci
# tier: light
# summary: loom-seed on the demo profile exits 0 when every demo step succeeds, and exits non-zero when a demo step fails
#
# The docs say loom-seed fills every Catalog section on the demo profile and
# says loudly when a step fails, rather than skipping it (#42). Against a
# running local-up Loom on Floci (just local-up; pending without one), with a
# token minted as local-up mints it (scripts/local/local-token.sh):
#   plain   run loom-seed on the demo profile the way local-up does and expect
#           exit 0, then check through Loom's API that every section the demo
#           profile fills (agents, memories, MCP servers, A2A agents) has an
#           entry.
#   BREAK   delete the demo A2A agent through the API, then seed with the A2A
#           card URL pointed at a closed port, so the demo-a2a-agent step must
#           fail; expect a non-zero exit. On exit it seeds again the normal
#           way, which registers the A2A agent anew.
# chant prints an Op step's output only when the step fails, so plain is judged
# by the exit status and the API, as local-up judges it.
#
# What Floci cannot prove: IAM (Floci's `test` key is never checked in the
# default local-up), and real agent reasoning (an invoke returns a canned
# reply). backend/deploy-agent and screens/all are the AWS counterparts.
set -euo pipefail

name=seed/demo-loud
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }
log() { echo "[$name] $*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
BASE=http://localhost:8080
OUT=dist/local
command -v jq >/dev/null 2>&1 || { say pending "needs jq"; exit 0; }
[ -x node_modules/.bin/chant ] || { say pending "node_modules/.bin/chant is missing: run npm ci"; exit 0; }
if [ ! -f "$OUT/.env" ] || [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null)" != 200 ]; then
  say pending "needs a running local-up Loom on Floci (just local-up; $BASE/health and $OUT/.env)"; exit 0
fi

# What local-up's own seed step runs with.
export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}" AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
export AWS_REGION="${AWS_REGION:-us-east-1}" LOOM_TIER=light LOOM_ENV="${LOOM_ENV:-local}"
A2A_URL="http://loomProxy:8080/a2a-demo"
TOKEN="$(bash scripts/local/local-token.sh 2>/dev/null)" || { say fail "scripts/local/local-token.sh minted no token against Floci's Cognito"; exit 0; }
AUTHCFG="$(mktemp "${TMPDIR:-/tmp}/loomster-claim-auth.XXXXXX")"
work="$(mktemp -d "${TMPDIR:-/tmp}/loomster-claim-seed.XXXXXX")"
printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" >"$AUTHCFG"
# The seed's run records go to the claims' ledger sandbox, not this repository's
# chant/lifecycle (claims_chant, test/claims-aws.sh).
# shellcheck source=test/claims-aws.sh
. "$ROOT/test/claims-aws.sh"
seed() { # a2a-url
  LOOM_API_TOKEN="$TOKEN" LOOM_SEED_PROFILE=demo LOOM_API_BASE_URL="$BASE" LOOM_DEMO_A2A_URL="$1" \
    claims_chant ./node_modules/.bin/chant run loom-seed --env "$LOOM_ENV"
}
BROKEN=""
on_exit() {
  if [ -n "$BROKEN" ]; then
    log "seeding the demo profile again to register the A2A agent anew"
    seed "$A2A_URL" >/dev/null 2>&1 || log "re-seeding failed; run: just local-up (or npm run seed with a token)"
  fi
  rm -rf "$AUTHCFG" "$work"
}
trap on_exit EXIT
api() { curl -sS -K "$AUTHCFG" "$@"; }

if [ -n "${BREAK:-}" ]; then
  for id in $(api "$BASE/api/a2a/agents" | jq -r '.[].id' 2>/dev/null); do
    api -X DELETE "$BASE/api/a2a/agents/$id" >/dev/null || true
  done
  [ "$(api "$BASE/api/a2a/agents" | jq 'length' 2>/dev/null)" = 0 ] || { say fail "BREAK could not be applied: the A2A agents are still listed after DELETE"; exit 0; }
  BROKEN=1
  if seed "http://127.0.0.1:9/closed" >"$work/seed.log" 2>&1; then
    say fail "with the A2A card URL on a closed port, loom-seed's demo profile still exited 0"
  else
    say caught "with the A2A card URL on a closed port, loom-seed's demo profile exited non-zero$(grep -m1 -oE 'step=demo-a2a-agent verdict=failed[^"]*' "$work/seed.log" | sed 's/^/ (/; s/$/)/' || true)"
  fi
  exit 0
fi

seed "$A2A_URL" >"$work/seed.log" 2>&1 || { say fail "loom-seed's demo profile exited non-zero: $(grep -m1 'verdict=failed' "$work/seed.log" || tail -n 1 "$work/seed.log")"; exit 0; }
problems=""
for path in agents memories mcp/servers a2a/agents; do
  n="$(api "$BASE/api/$path" | jq 'length' 2>/dev/null || echo 0)"
  [ "${n:-0}" -ge 1 ] || problems="$problems /api/$path lists nothing after the demo seed;"
done
if [ -n "$problems" ]; then problems="${problems# }"; say fail "${problems%;}"
else say pass "loom-seed's demo profile exited 0, and agents, memories, MCP servers and A2A agents each list an entry"; fi
