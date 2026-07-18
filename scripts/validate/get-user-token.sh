#!/usr/bin/env bash
set -euo pipefail

# Mint a real Cognito USER access token for authenticated screen validation against
# a live deployment (loomster#147). Loom derives a user's scopes from their
# `cognito:groups` claim (backend/app/dependencies/auth.py: `derive_scopes(groups)`),
# and an admin needs `t-admin` + a single `g-admins-*` group. loomster seeds no
# users or groups, so this creates a throwaway admin end-to-end:
#   1. ensure the `t-admin` + `g-admins-super` groups exist (idempotent),
#   2. create a throwaway user with a permanent password,
#   3. add it to both groups,
#   4. ADMIN_USER_PASSWORD_AUTH (the user client enables ALLOW_ADMIN_USER_PASSWORD_AUTH)
#      and print the access token — which carries `cognito:groups`, so Loom grants the
#      full scope set and every screen authorizes.
#
#   export LOOM_API_TOKEN=$(bash scripts/validate/get-user-token.sh)
#   LOOM_API_BASE_URL=https://loom.intentius.io npm run validate
#   bash scripts/validate/get-user-token.sh --delete   # remove the throwaway user
#
# Stack names are namespaced by project+env+instance (#140). E2E-only — a real
# deployment brings its own users; never leave this user on a real tenant.

SF="${LOOM_PROJECT:-loom}-${LOOM_ENV:-dev}-${LOOM_INSTANCE:-a}-loom-cognito"
POOL=$(aws cloudformation describe-stacks --stack-name "$SF" --query "Stacks[0].Outputs[?OutputKey=='oCognitoUserPoolId'].OutputValue | [0]" --output text 2>/dev/null)
CLIENT=$(aws cloudformation describe-stacks --stack-name "$SF" --query "Stacks[0].Outputs[?OutputKey=='oUserClientId'].OutputValue | [0]" --output text 2>/dev/null)
USERNAME="${LOOM_E2E_USER:-e2e-validator}"
PASSWORD="${LOOM_E2E_PASSWORD:-E2e-Validate-9x7q2w!}"
[ -n "$POOL" ] && [ "$POOL" != "None" ] || { echo "get-user-token: no $SF pool (deploy loom-cognito first)" >&2; exit 1; }

if [ "${1:-}" = "--delete" ]; then
  aws cognito-idp admin-delete-user --user-pool-id "$POOL" --username "$USERNAME" 2>/dev/null || true
  echo "get-user-token: deleted throwaway user $USERNAME" >&2
  exit 0
fi

aws cognito-idp create-group --user-pool-id "$POOL" --group-name t-admin 2>/dev/null || true
aws cognito-idp create-group --user-pool-id "$POOL" --group-name g-admins-super 2>/dev/null || true
aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$USERNAME" --message-action SUPPRESS 2>/dev/null || true
aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --username "$USERNAME" --password "$PASSWORD" --permanent
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$USERNAME" --group-name t-admin
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$USERNAME" --group-name g-admins-super

TOKEN=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id "$POOL" --client-id "$CLIENT" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=$USERNAME,PASSWORD=$PASSWORD" \
  --query "AuthenticationResult.AccessToken" --output text 2>/dev/null)
[ -n "$TOKEN" ] && [ "$TOKEN" != "None" ] || { echo "get-user-token: auth failed (check ALLOW_ADMIN_USER_PASSWORD_AUTH on $CLIENT)" >&2; exit 1; }
echo "$TOKEN"
