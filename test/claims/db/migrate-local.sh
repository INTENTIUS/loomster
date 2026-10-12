#!/usr/bin/env bash
# target: floci
# tier: light
# summary: on the local stack, SQL Yodeler records the v1.9.0 baseline on the database Loom migrated, holds a new migration at its gate until that plan is approved, then applies it, and drift notices an out-of-band change
#
# The docs describe the migration flow for a Loom bump (#78): yodel new writes
# a migration from the declared schema, `just db apply` stops at a gate bound
# to the plan digest, an approval of that plan lets it apply, and the drift
# check reports a schema someone changed by hand. Against a running local-up
# Loom on Floci (pending without one) this runs the flow end to end:
#   1. `just db reader`, then `just db baseline` (approving its gate);
#   2. in a scratch copy of db/ (test/claims-db.sh), declare one new table,
#      loomster_claim_probe_<time>, and write its migration with yodel new;
#   3. `just db apply` must stop at the gate (exit 3); the claim approves the
#      printed plan, and the same apply then succeeds (exit 0);
#   4. `just db status` is up to date and `just db drift` is clean.
# Approvals are recorded in the scratch copy's own repository, never in this
# one's chant/lifecycle. The probe tables stay in the local database until
# `just local-down`.
#
# BREAK=1 changes agents.description from text to varchar(4000) behind yodel's
# back (scripts/db/yodel.sh sql) and expects `just db drift` to report it
# (exit 2); the column is changed back on exit.
#
# What Floci cannot prove: RDS behaviour beyond Postgres itself, and the SSM
# tunnel the AWS path goes through (db/baseline covers that).
set -euo pipefail

name=db/migrate-local
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }
log() { echo "[$name] $*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
OUT=dist/local
for tool in jq docker node; do command -v "$tool" >/dev/null 2>&1 || { say pending "needs $tool"; exit 0; }; done
[ -x node_modules/.bin/yodel ] || { say pending "node_modules/.bin/yodel is missing: run npm ci"; exit 0; }
if [ ! -f "$OUT/.env" ] || [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/health 2>/dev/null)" != 200 ]; then
  say pending "needs a running local-up Loom on Floci (just local-up; http://localhost:8080/health and $OUT/.env)"; exit 0
fi
export LOOM_ENV="${LOOM_ENV:-local}"

# shellcheck source=test/claims-db.sh
. "$ROOT/test/claims-db.sh"
PROJECT="$ROOT/test/.state/claims-db-local"
claims_db_project "$PROJECT"
work="$(mktemp -d "${TMPDIR:-/tmp}/loomster-claim-migrate.XXXXXX")"
BROKEN=""
on_exit() {
  [ -z "$BROKEN" ] || claims_db sql <<<"$CLAIMS_DB_UNBREAK_SQL" >/dev/null 2>&1 \
    || log "could not change agents.description back to text; just local-down resets the local database"
  rm -rf "$work"
}
trap on_exit EXIT

stop() { # detail
  if [ -n "${BREAK:-}" ] && [ -n "$BROKEN" ]; then say caught "$1"
  elif [ -n "${BREAK:-}" ]; then say fail "BREAK could not be applied: $1"
  else say fail "$1"; fi
  exit 0
}

# 1. The reader and the baseline.
claims_db reader >"$work/reader.log" 2>&1 || stop "just db reader failed: $(tail -n 1 "$work/reader.log")"
why="$(claims_db_baseline "$work")" || stop "just db baseline: $why"

if [ -n "${BREAK:-}" ]; then
  claims_db sql <<<"$CLAIMS_DB_BREAK_SQL" >"$work/break.log" 2>&1 || stop "the out-of-band ALTER failed: $(tail -n 1 "$work/break.log")"
  BROKEN=1
  set +e; claims_db drift >"$work/drift.log" 2>&1; rc=$?; set -e
  if [ "$rc" = 2 ]; then stop "with agents.description changed out of band, just db drift reported it (exit 2)"; fi
  say fail "with agents.description changed out of band, just db drift exited $rc, not 2"; exit 0
fi

# 2. A new migration: one table declared in the scratch copy.
probe="loomster_claim_probe_$(date +%s)"
cat >>"$PROJECT/src/schema.ts" <<EOF

export const claimProbe$(date +%s) = table<"public.$probe">\`
  CREATE TABLE public.$probe (
      id serial,
      note text,
      PRIMARY KEY (id)
  )\`;
EOF
(cd "$PROJECT" && "$ROOT/node_modules/.bin/chant" sql types --output src/sql-types.d.ts) >"$work/types.log" 2>&1 \
  || stop "chant sql types failed in the scratch project: $(tail -n 1 "$work/types.log")"
claims_db new "${probe//_/-}" >"$work/new.log" 2>&1 || stop "yodel new failed: $(tail -n 2 "$work/new.log" | tr '\n' ' ')"
git -C "$PROJECT" add -A >/dev/null
git -C "$PROJECT" -c user.name=loomster-claims -c user.email=claims@loomster.invalid commit -q -m "claim: $probe"

# 3. The gate holds, then the approved plan applies.
set +e; claims_db apply --json >"$work/apply.json" 2>"$work/apply.err"; rc=$?; set -e
[ "$rc" = 3 ] || stop "just db apply with $probe pending exited $rc, not 3 (stopped at the gate): $(tail -n 2 "$work/apply.err" | tr '\n' ' ')"
why="$(claims_db_approve "$work/apply.json")" || stop "$why"
set +e; claims_db apply --json >"$work/apply2.json" 2>"$work/apply2.err"; rc=$?; set -e
[ "$rc" = 0 ] || stop "just db apply after the approval exited $rc: $(tail -n 2 "$work/apply2.err" | tr '\n' ' ')"

# 4. Up to date and clean.
set +e; claims_db status >"$work/status.log" 2>&1; status_rc=$?; claims_db drift >"$work/drift.log" 2>&1; drift_rc=$?; set -e
[ "$status_rc" = 0 ] || stop "just db status exited $status_rc after the apply: $(tail -n 1 "$work/status.log")"
[ "$drift_rc" = 0 ] || stop "just db drift exited $drift_rc after the apply: $(tail -n 1 "$work/drift.log")"
say pass "baseline recorded, the $probe migration stopped at its gate (exit 3), applied after its plan was approved, and status and drift are clean"
