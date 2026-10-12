#!/usr/bin/env bash
# Mint a real Cognito access token for the local run (loomster#58): the same
# throwaway-admin flow scripts/validate/get-user-token.sh runs against a real
# tier (user `e2e-validator` in t-admin + g-admins-super), pointed at Floci's
# Cognito and the pool/user client local-up wrote to dist/local/.env.
#
#   export LOOM_API_TOKEN=$(bash scripts/local/local-token.sh)
#
# local-up runs this for seed; `npm run validate` runs it itself when it targets
# the local proxy with no LOOM_API_TOKEN set. Prints only the token.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/dist/local/.env"
[ -f "$ENV_FILE" ] || { echo "local-token: $ENV_FILE is missing (run just local-up first)" >&2; exit 1; }
val() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
POOL="$(val LOOM_COGNITO_USER_POOL_ID)"
CLIENT="$(val LOOM_LOCAL_USER_CLIENT_ID)"
[ -n "$POOL" ] && [ -n "$CLIENT" ] || { echo "local-token: no pool/user client in $ENV_FILE (re-run just local-up)" >&2; exit 1; }

AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION="$(val AWS_REGION)" AWS_DEFAULT_REGION="$(val AWS_REGION)" \
  LOOM_E2E_POOL_ID="$POOL" LOOM_E2E_CLIENT_ID="$CLIENT" \
  bash "$ROOT/scripts/validate/get-user-token.sh"
