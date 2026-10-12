#!/bin/sh
# Runs inside a python container with the vendored Loom backend mounted at /src
# (scripts/db/schema.sh starts it). Creates Loom's schema in LOOM_DATABASE_URL
# exactly as the backend does on startup: `import app.models` registers every
# table, then `init_db()` runs create_all and Loom's add-column migrations.
# SQLALCHEMY_VERSION and PSYCOPG2_VERSION pin the drivers to the versions
# Loom's uv.lock resolves.
set -eu
pip install --quiet --disable-pip-version-check --root-user-action=ignore \
  "sqlalchemy==${SQLALCHEMY_VERSION}" "psycopg2-binary==${PSYCOPG2_VERSION}"
cd /src
python -c 'import app.models; from app.db import init_db; init_db(); print("loom init_db: done")'
