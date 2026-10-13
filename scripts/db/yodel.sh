#!/usr/bin/env bash
# SQL Yodeler for this deployment's Loom database (loomster#78): resolves the
# database from loom-db's outputs, reaches it, reads the credentials, and runs
# `yodel` in db/ against the deployment's environment
# ({LOOM_PROJECT}-{LOOM_ENV}-{LOOM_INSTANCE}, db/deployment.ts).
#
#   scripts/db/yodel.sh status|plan|drift|approve|report   # as the reader
#   scripts/db/yodel.sh apply       # pending migrations, behind the gate (writer)
#   scripts/db/yodel.sh baseline    # record the baseline on a database Loom created (writer)
#   scripts/db/yodel.sh reader      # create the read-only user (writer)
#   scripts/db/yodel.sh watch       # the drift watch Op (reader)
#   scripts/db/yodel.sh sql < file  # run SQL from stdin as the writer, outside yodel
#   scripts/db/yodel.sh lint|new <name>|test|docs|...   # offline, no database
#
# Reaching the database:
# - AWS: the database is in private subnets, so it goes through the SSM
#   tunnel host (`just tunnel-host`, #37): scripts/tunnel.sh forwards a local
#   port to the RDS instance itself (LOOM_TUNNEL_TARGET=instance), not the
#   proxy, since a migration takes a session advisory lock and runs DDL. The
#   tunnel lives as long as this command: it runs in its own process group,
#   and the exit trap ends that group (the AWS CLI and the Session Manager
#   plugin it starts), so no forward outlives the command. RDS requires SSL,
#   so the URL asks for it (scripts/db/connection.ts says why libpq's
#   `require` and not verify-full).
# - local (LOOM_ENV=local, `just local-up`) and floci: Floci serves RDS on its
#   Docker network only, so a small socat container on that network publishes
#   a loopback port to it for the length of this command.
#
# Credentials: the writer is the RDS master user (loom-db's
# oRdsCredentialsSecretArn); the reader is `loom_reader`
# (oRdsReaderSecretArn). A database you bring (LOOM_DB_MODE=reference-existing)
# has no reader secret: set LOOM_DB_READER_USER and LOOM_DB_READER_PASSWORD
# yourself. Passwords stay in this process's environment, never on disk or in
# argv. LOOM_YODEL_URL set by hand skips the forward entirely.
#
# The local port is a free one unless LOOM_DB_LOCAL_PORT names one (a named
# port that is busy is refused).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cmd="${1:-}"
[ -n "$cmd" ] || { sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1; }
shift

PREFIX="${LOOM_PROJECT:-loom}-${LOOM_ENV:-dev}-${LOOM_INSTANCE:-a}"
ENV_NAME="$PREFIX"
YODEL=("$ROOT/node_modules/.bin/yodel")
# The yodel project. LOOM_DB_PROJECT_DIR points at a copy of it, for a scratch
# repository whose approvals stay out of this one's chant/lifecycle.
PROJECT="${LOOM_DB_PROJECT_DIR:-$ROOT/db}"

run_offline() { cd "$PROJECT" && exec "${YODEL[@]}" "$@"; }

case "$cmd" in
  status|plan|drift|approve|report|apply|baseline|reader|watch|sql) ;;
  *) run_offline "$cmd" "$@" ;;
esac
# `sql` reads its statements before the forward opens, so a heredoc or a pipe works.
SQL_IN=""
[ "$cmd" != sql ] || SQL_IN="$(cat)"

onFloci=false
case "${LOOM_ENV:-dev}" in local|floci) onFloci=true ;; esac
if $onFloci; then
  export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}" AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
  export AWS_REGION="${AWS_REGION:-us-east-1}"
fi

out() { aws cloudformation describe-stacks --stack-name "$PREFIX-$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text 2>/dev/null | grep -v '^None$' || true; }
secret_field() { aws secretsmanager get-secret-value --secret-id "$1" --query SecretString --output text | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s)[process.argv[1]]??"")))' "$2"; }

# ── credentials ──────────────────────────────────────────────────────────────
if [ -z "${LOOM_DB_WRITER_USER:-}" ] || [ -z "${LOOM_DB_WRITER_PASSWORD:-}" ]; then
  arn="$(out loom-db oRdsCredentialsSecretArn)"
  [ -n "$arn" ] || { echo "db: $PREFIX-loom-db has no oRdsCredentialsSecretArn; is the deployment up? (or set LOOM_DB_WRITER_USER/PASSWORD)" >&2; exit 1; }
  LOOM_DB_WRITER_USER="$(secret_field "$arn" username)"; LOOM_DB_WRITER_PASSWORD="$(secret_field "$arn" password)"
fi
if [ -z "${LOOM_DB_READER_USER:-}" ] || [ -z "${LOOM_DB_READER_PASSWORD:-}" ]; then
  arn="$(out loom-db oRdsReaderSecretArn)"
  [ -n "$arn" ] || { echo "db: $PREFIX-loom-db has no oRdsReaderSecretArn (a database you bring: set LOOM_DB_READER_USER/PASSWORD)" >&2; exit 1; }
  LOOM_DB_READER_USER="$(secret_field "$arn" username)"; LOOM_DB_READER_PASSWORD="$(secret_field "$arn" password)"
fi
export LOOM_DB_WRITER_USER LOOM_DB_WRITER_PASSWORD LOOM_DB_READER_USER LOOM_DB_READER_PASSWORD

# ── reaching the database ────────────────────────────────────────────────────
FORWARD_PID="" FORWARD_CONTAINER=""
cleanup() {
  # The tunnel's whole process group: killing only its first process (the AWS
  # CLI) would leave the Session Manager plugin holding the port.
  if [ -n "$FORWARD_PID" ]; then
    kill -TERM -- "-$FORWARD_PID" 2>/dev/null || kill "$FORWARD_PID" 2>/dev/null || true
    wait "$FORWARD_PID" 2>/dev/null || true
  fi
  [ -z "$FORWARD_CONTAINER" ] || docker rm -f "$FORWARD_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
free_port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})'; }

if [ -z "${LOOM_YODEL_URL:-}" ]; then
  # A forward an interrupted run left behind.
  ! $onFloci || docker rm -f "$PREFIX-db-forward" >/dev/null 2>&1 || true
  if [ -n "${LOOM_DB_LOCAL_PORT:-}" ]; then
    PORT="$LOOM_DB_LOCAL_PORT"
    port_open "$PORT" && { echo "db: 127.0.0.1:$PORT (LOOM_DB_LOCAL_PORT) is already in use" >&2; exit 1; }
  else
    PORT="$(free_port)"
  fi
  DBNAME="$(out loom-db oRdsDbName)"; DBNAME="${DBNAME:-loom}"
  if $onFloci; then
    RDS_PORT="$(out loom-db oRdsPort)"
    [ -n "$RDS_PORT" ] || { echo "db: $PREFIX-loom-db has no oRdsPort; is the local stack up? (just local-up)" >&2; exit 1; }
    FORWARD_CONTAINER="$PREFIX-db-forward"
    docker run -d --rm --name "$FORWARD_CONTAINER" --network "${LOOM_DB_DOCKER_NETWORK:-loom-local-net}" \
      -p "127.0.0.1:$PORT:$PORT" "${LOOM_DB_FORWARD_IMAGE:-alpine/socat:1.8.0.3}" \
      "tcp-listen:$PORT,fork,reuseaddr" "tcp-connect:${LOOM_DB_FLOCI_HOST:-floci}:$RDS_PORT" >/dev/null
  else
    # The SSM tunnel to the RDS instance (scripts/tunnel.sh), in the background.
    LOG="$(mktemp "${TMPDIR:-/tmp}/loomster-db-tunnel.XXXXXX")"
    # Job control gives the background tunnel a process group of its own
    # (its id is FORWARD_PID), which the exit trap ends whole.
    set -m
    LOOM_TUNNEL_TARGET=instance bash "$ROOT/scripts/tunnel.sh" "$PORT" >"$LOG" 2>&1 &
    FORWARD_PID=$!
    set +m
  fi
  for _ in $(seq 1 60); do port_open "$PORT" && break; sleep 1
    [ -z "$FORWARD_PID" ] || kill -0 "$FORWARD_PID" 2>/dev/null || { echo "db: the tunnel exited:" >&2; cat "$LOG" >&2; exit 1; }
  done
  port_open "$PORT" || { echo "db: nothing answered on 127.0.0.1:$PORT within 60 s" >&2; [ -z "${LOG:-}" ] || cat "$LOG" >&2; exit 1; }
  if $onFloci; then export LOOM_YODEL_URL="postgres://127.0.0.1:$PORT/$DBNAME"
  # RDS requires SSL (scripts/db/connection.ts AWS_SSL_QUERY).
  else export LOOM_YODEL_URL="postgres://127.0.0.1:$PORT/$DBNAME?uselibpqcompat=true&sslmode=require"; fi
fi

cd "$PROJECT"
writer() { YODEL_CREDENTIALS="writer:$ENV_NAME" "$@"; }
case "$cmd" in
  status|plan|drift|report) "${YODEL[@]}" "$cmd" "$ENV_NAME" "$@" ;;
  approve) "${YODEL[@]}" approve "$ENV_NAME" "$@" ;;
  apply)
    # A database Loom created and yodel never recorded holds the baseline's
    # tables already: applying the baseline there would fail on its first
    # CREATE. Record it instead (`baseline`), which first checks the live
    # schema is the baseline's. A brand new, empty database may take the
    # baseline as a migration: LOOM_DB_APPLY_BASELINE=1.
    applied="$("${YODEL[@]}" status "$ENV_NAME" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.slice(s.indexOf("{")));console.log((j.applied??[]).length)}catch{console.log("")}})' || true)"
    if [ "$applied" = 0 ] && [ "${LOOM_DB_APPLY_BASELINE:-}" != 1 ]; then
      echo "db: $ENV_NAME's history records no migration. If Loom already created the schema (any deployment that has run), record the baseline first: just db baseline. For a new, empty database: LOOM_DB_APPLY_BASELINE=1 just db apply." >&2
      exit 4
    fi
    writer "${YODEL[@]}" apply "$ENV_NAME" "$@" ;;
  baseline) writer "${YODEL[@]}" init --baseline "$ENV_NAME" "$@" ;;
  reader) (cd "$ROOT" && "$ROOT/node_modules/.bin/tsx" scripts/db/reader.ts) ;;
  # An out-of-band change, as an operator's psql session would make it: the
  # claims use it to make the live schema differ from the declared one
  # (scripts/db/sql.ts; credentials from the environment, never argv).
  sql) (cd "$ROOT" && SQL_IN="$SQL_IN" "$ROOT/node_modules/.bin/tsx" scripts/db/sql.ts) ;;
  watch) "$ROOT/node_modules/.bin/chant" run "watch-$ENV_NAME" "$@" ;;
esac
