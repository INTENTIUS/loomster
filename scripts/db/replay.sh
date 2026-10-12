#!/usr/bin/env bash
# Replay every migration in db/migrations into a throwaway Postgres and check
# each one ends at the schema it recorded (`yodel lint --replay replay
# --reset`, loomster#78): the baseline builds Loom's v1.9.0 schema from
# nothing, and each later migration moves it exactly where its migration.json
# says. CI runs the same with a Postgres service (REPLAY_POSTGRES_URL set);
# here it starts one with Docker, the RDS engine's major version.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/db"

if [ -z "${REPLAY_POSTGRES_URL:-}" ]; then
  NAME="loomster-db-replay-$$"
  PORT="${LOOM_DB_REPLAY_PORT:-55434}"
  PASSWORD="replay-$(openssl rand -hex 8)"
  trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
  docker run -d --rm --name "$NAME" -p "127.0.0.1:$PORT:5432" \
    -e POSTGRES_USER=loom -e POSTGRES_PASSWORD="$PASSWORD" -e POSTGRES_DB=loom "${LOOM_DB_SCRATCH_IMAGE:-postgres:15}" >/dev/null
  for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U loom -d loom >/dev/null 2>&1 && break; sleep 1; done
  export REPLAY_POSTGRES_URL="postgres://127.0.0.1:$PORT/loom" REPLAY_POSTGRES_USER=loom REPLAY_POSTGRES_PASSWORD="$PASSWORD"
fi

"$ROOT/node_modules/.bin/yodel" lint --replay replay --reset
