#!/usr/bin/env bash
set -euo pipefail

# Fetch a Cognito M2M (client-credentials) bearer token for a LIVE loomster
# deployment, so scripts/validate/run.ts can validate screens behind real auth
# (#125). Reads the loom-cognito stack's outputs, pulls the M2M client secret and
# its granted scopes, and does the client_credentials grant against the pool's
# token endpoint. Prints the access_token to stdout.
#
#   export LOOM_API_TOKEN=$(bash scripts/validate/get-m2m-token.sh)
#   LOOM_API_BASE_URL=https://loom.intentius.io npm run validate
#
# Needs AWS creds for the deployed account/region. The M2M token carries the
# resource-server scopes granted to the client, not a user identity — whether Loom
# accepts it for a given screen depends on that endpoint's scope requirement.

out() { aws cloudformation describe-stacks --stack-name loom-cognito --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text; }

POOL_ID=$(out oCognitoUserPoolId)
M2M_ID=$(out oM2MClientId)
TOKEN_URL=$(out oCognitoTokenUrl)
[ -n "$POOL_ID" ] && [ "$POOL_ID" != "None" ] || { echo "no loom-cognito outputs (deploy first)" >&2; exit 1; }

SECRET=$(aws cognito-idp describe-user-pool-client --user-pool-id "$POOL_ID" --client-id "$M2M_ID" --query "UserPoolClient.ClientSecret" --output text)
SCOPES=$(aws cognito-idp describe-user-pool-client --user-pool-id "$POOL_ID" --client-id "$M2M_ID" --query "join(' ', UserPoolClient.AllowedOAuthScopes)" --output text)

RESP=$(curl -s -X POST "$TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "$M2M_ID:$SECRET" \
  -d "grant_type=client_credentials" \
  ${SCOPES:+-d "scope=$SCOPES"})

TOKEN=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)
[ -n "$TOKEN" ] || { echo "token fetch failed: $RESP" >&2; exit 1; }
echo "$TOKEN"
