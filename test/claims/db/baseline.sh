#!/usr/bin/env bash
# target: aws
# tier: light
# order: 80
# summary: through the SSM tunnel, just db reader and just db baseline record Loom v1.9.0's baseline on a database Loom migrated itself, and status and drift then report it clean
#
# The docs say SQL Yodeler owns Loom's schema (#78): on a deployment that
# already runs, `just db reader` makes the read-only user, `just db baseline`
# checks the live schema is the v1.9.0 baseline and records it (behind its
# gate), and `just db status` / `just db drift` then report the deployment up
# to date and clean. On the shared claims deployment (claims_aws_ensure
# loom-backend, whose first start migrated the schema) and through the tunnel
# host (claims_aws_tunnel_host; scripts/db/yodel.sh opens the tunnel to the
# RDS instance itself) this runs those commands in order.
#
# The baseline's gate is real: the run stops there (exit 3) and the claim
# approves the printed plan in a scratch copy of db/ with no remote
# (test/claims-db.sh), then runs it again, as a person runs `just db approve`
# and then `just db baseline`. Nothing reaches this repository's ledger.
#
# BREAK=1 changes a column's type behind yodel's back (agents.description from
# text to varchar(4000), with `scripts/db/yodel.sh sql`), so the live schema
# no longer matches what the history records, and expects `just db drift` to
# report the difference (exit 2). The column is changed back on exit.
set -euo pipefail

name=db/baseline
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }
log() { echo "[$name] $*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

# shellcheck source=test/claims-aws.sh
. "$ROOT/test/claims-aws.sh"
# shellcheck source=test/claims-db.sh
. "$ROOT/test/claims-db.sh"
why="$(claims_aws_needs session-manager-plugin node)"
[ -z "$why" ] || { say pending "$why"; exit 0; }
claims_aws_light_env || { say fail "no claims prefix (test/claims-aws.sh prefix)"; exit 0; }

work="$(mktemp -d "${TMPDIR:-/tmp}/loomster-claim-db.XXXXXX")"
BROKEN=""
on_exit() {
  [ -z "$BROKEN" ] || claims_db sql <<<"$CLAIMS_DB_UNBREAK_SQL" >/dev/null 2>&1 \
    || log "could not change agents.description back to text; the cleanup deletes the database"
  rm -rf "$work"
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
claims_aws_base >/dev/null || stop "the backend never answered /health (it creates the schema on its first start)"
INSTANCE="$(claims_aws_tunnel_host)" || stop "$INSTANCE"
claims_db_project "$CA_STATE/db-project"

claims_db reader >"$work/reader.log" 2>&1 || stop "just db reader failed: $(tail -n 1 "$work/reader.log")"
why="$(claims_db_baseline "$work")" || stop "just db baseline: $why"

if [ -n "${BREAK:-}" ]; then
  claims_db sql <<<"$CLAIMS_DB_BREAK_SQL" >"$work/break.log" 2>&1 || stop "the out-of-band ALTER failed: $(tail -n 1 "$work/break.log")"
  BROKEN=1
  set +e; claims_db drift >"$work/drift.log" 2>&1; rc=$?; set -e
  if [ "$rc" = 2 ]; then
    stop "with agents.description changed out of band, just db drift reported it (exit 2): $(grep -m1 -i "description" "$work/drift.log" | head -c 200)"
  fi
  say fail "with agents.description changed out of band, just db drift exited $rc, not 2"; exit 0
fi

set +e; claims_db status >"$work/status.log" 2>&1; status_rc=$?; set -e
set +e; claims_db drift >"$work/drift.log" 2>&1; drift_rc=$?; set -e
applied="$(claims_db_applied)"
problems=""
[ "$status_rc" = 0 ] || problems="$problems just db status exited $status_rc ($(tail -n 1 "$work/status.log"));"
[ "$drift_rc" = 0 ] || problems="$problems just db drift exited $drift_rc ($(tail -n 1 "$work/drift.log"));"
[ "${applied:-0}" -ge 1 ] 2>/dev/null || problems="$problems the history records ${applied:-no} migrations;"
if [ -n "$problems" ]; then problems="${problems# }"; say fail "${problems%;}"
else say pass "through the tunnel host $INSTANCE: the reader user exists, the v1.9.0 baseline is recorded (gate approved in a scratch project), status is up to date and drift is clean"; fi
