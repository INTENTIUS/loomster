#!/usr/bin/env bash
# Write db/src/schema.ts from the schema the vendored Loom version creates
# (loomster#78). Loom has no migration tool: its backend runs create_all plus
# a list of ADD COLUMN statements on startup (backend/app/db.py, init_db). So
# the schema of a Loom version is whatever that code creates, and this script
# asks it: a throwaway Postgres (the RDS engine's major version), Loom's own
# init_db run against it from vendor/loom/backend, then SQL Yodeler's import
# (`yodel init --from scratch`) of the result.
#
#   just db-schema       # after npm run vendor (a Loom bump), then:
#   just db new loom-v1.10.0
#
# With no migration in db/migrations yet it also writes the baseline. After
# that it only rewrites db/src/schema.ts, and `yodel new` writes the bump's
# migration from the difference. Needs Docker. Touches no deployment.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PG_IMAGE="${LOOM_DB_SCRATCH_IMAGE:-postgres:15}"     # loom-db's EngineVersion is 15
PY_IMAGE="${LOOM_DB_SCRATCH_PYTHON:-python:3.13-slim}"
PORT="${LOOM_DB_SCRATCH_PORT:-55433}"
NAME="loomster-db-scratch-$$"
NET="$NAME-net"
PASSWORD="scratch-$(openssl rand -hex 8)"

[ -d vendor/loom/backend/app ] || { echo "db-schema: vendor/loom is missing; run npm run vendor first" >&2; exit 1; }
LOOM_TAG="$(sed -n 's/^LOOM_TAG="\${LOOM_TAG:-\(.*\)}"$/\1/p' scripts/vendor-loom.sh)"
# The driver versions Loom's lockfile resolves (requirements.txt only gives a floor).
SQLALCHEMY_VERSION="$(awk '/^name = "sqlalchemy"$/ { getline; gsub(/version = |"/, ""); print; exit }' vendor/loom/backend/uv.lock)"
[ -n "$SQLALCHEMY_VERSION" ] || { echo "db-schema: no sqlalchemy version in vendor/loom/backend/uv.lock" >&2; exit 1; }

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$ROOT/db/.scratch"
}
trap cleanup EXIT

echo "db-schema: Loom $LOOM_TAG (sqlalchemy $SQLALCHEMY_VERSION) on a scratch $PG_IMAGE"
docker network create "$NET" >/dev/null
docker run -d --rm --name "$NAME" --network "$NET" -p "127.0.0.1:$PORT:5432" \
  -e POSTGRES_USER=loom -e POSTGRES_PASSWORD="$PASSWORD" -e POSTGRES_DB=loom "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U loom -d loom >/dev/null 2>&1 && break; sleep 1; done
docker exec "$NAME" pg_isready -U loom -d loom >/dev/null

# Loom's own startup migration, as the backend runs it.
docker run --rm --network "$NET" \
  -v "$ROOT/vendor/loom/backend:/src:ro" -v "$ROOT/scripts/db/loom-init-db.sh:/loom-init-db.sh:ro" \
  -e LOOM_DATABASE_URL="postgresql+psycopg2://loom:$PASSWORD@$NAME:5432/loom" \
  -e PYTHONDONTWRITEBYTECODE=1 -e SQLALCHEMY_VERSION="$SQLALCHEMY_VERSION" \
  -e PSYCOPG2_VERSION="${LOOM_DB_PSYCOPG2_VERSION:-2.9.10}" \
  "$PY_IMAGE" /loom-init-db.sh

export SCRATCH_POSTGRES_URL="postgres://127.0.0.1:$PORT/loom" SCRATCH_POSTGRES_USER=loom SCRATCH_POSTGRES_PASSWORD="$PASSWORD"

if ! ls -d db/migrations/*/ >/dev/null 2>&1; then
  # No migration yet: adopt the scratch database here, which writes the
  # declarations and the baseline (and records it in the scratch history,
  # thrown away with the container).
  (cd db && npx yodel init --from scratch --force && npx chant sql types --output src/sql-types.d.ts)
  echo "db-schema: wrote db/src/schema.ts and the $LOOM_TAG baseline in db/migrations/"
  exit 0
fi

# A later version: import into a copy of the project with no migrations, and
# take back only the declarations. `yodel new` then diffs them against the
# schema the newest migration records.
mkdir -p db/.scratch/src
cp db/chant.config.ts db/yodel.config.ts db/deployment.ts db/.scratch/
(cd db/.scratch && npx yodel init --from scratch --force >/dev/null)
cp db/.scratch/src/schema.ts db/src/schema.ts
(cd db && npx chant sql types --output src/sql-types.d.ts >/dev/null)
echo "db-schema: wrote db/src/schema.ts from Loom $LOOM_TAG"
echo "Next: just db new loom-$LOOM_TAG   (then review db/migrations/<new>/migration.sql and just db lint)"
