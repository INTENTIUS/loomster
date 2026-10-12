#!/usr/bin/env bash
# target: aws
# tier: light
# order: 20
# summary: the light tier serves Loom on its ALB, and a user signs in through the web app's own Cognito user client and gets an authorized session
#
# The docs say the light tier serves Loom at the ALB's address and that the
# deployed web app signs in (#75). On the shared claims deployment (every
# component but loom-agents, claims_aws_ensure) this checks what a browser does:
#   - GET / serves the SPA, and its bundle carries loom-cognito's user client
#     id (VITE_COGNITO_USER_CLIENT_ID baked in at build time);
#   - GET /health is 200 and /api/auth/config names the deployment's pool;
#   - a user in t-admin and g-admins-super (made with
#     scripts/validate/get-user-token.sh, as an operator's first admin would
#     be) signs in with InitiateAuth USER_PASSWORD_AUTH against the client id
#     read from the bundle, the call the SPA's form makes;
#   - the access token carries g-admins-super, and /api/auth/me and
#     /api/agents answer 200 with it (401 without one).
#
# BREAK=1 takes the user out of g-admins-super before signing in. Loom derives
# every resource scope from a g-* group, so the same sign-in must give a token
# /api/agents refuses (403); the claim expects that. The user is deleted on
# exit either way.
set -euo pipefail

name=tier/light-live
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }
log() { echo "[$name] $*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

# shellcheck source=test/claims-aws.sh
. "$ROOT/test/claims-aws.sh"
why="$(claims_aws_needs)"
[ -z "$why" ] || { say pending "$why"; exit 0; }
claims_aws_light_env || { say fail "no claims prefix (test/claims-aws.sh prefix)"; exit 0; }

USER_NAME="claims-signin"
PASSWORD="Ls-$(openssl rand -hex 12)-9!"
POOL=""
on_exit() { [ -z "$POOL" ] || aws cognito-idp admin-delete-user --user-pool-id "$POOL" --username "$USER_NAME" >/dev/null 2>&1 || true; }
trap on_exit EXIT

BROKEN=""
stop() { # detail
  if [ -n "${BREAK:-}" ] && [ -n "$BROKEN" ]; then say caught "$1"
  elif [ -n "${BREAK:-}" ]; then say fail "BREAK could not be applied: $1"
  else say fail "$1"; fi
  exit 0
}

log "making sure loom-frontend, loom-backend and what they need are up under $CLAIMS_AWS_PREFIX"
why="$(claims_aws_ensure loom-frontend loom-backend)" || stop "deploy: $why"
BASE="$(claims_aws_base)" || stop "the backend never answered /health"
POOL="$(claims_aws_output loom-cognito oCognitoUserPoolId)"
CLIENT="$(claims_aws_output loom-cognito oUserClientId)"
[ -n "$POOL" ] && [ -n "$CLIENT" ] || stop "loom-cognito has no oCognitoUserPoolId/oUserClientId output"

problems=""
note() { problems="$problems $*;"; }

# The page and the bundle it loads.
html="$(curl -s "$BASE/")"
assets="$(grep -oE '/assets/[^"]+\.js' <<<"$html" | sort -u || true)"
[ -n "$assets" ] || stop "GET $BASE/ served no SPA bundle ($(head -c 120 <<<"$html"))"
bundle=""
for js in $assets; do bundle="$bundle$(curl -s "$BASE$js")"; done
grep -qF "$CLIENT" <<<"$bundle" || note "the served bundle does not carry loom-cognito's user client id $CLIENT"
cfg="$(curl -s "$BASE/api/auth/config")"
[ "$(jq -r '.user_pool_id // empty' <<<"$cfg" 2>/dev/null)" = "$POOL" ] || note "/api/auth/config does not name the pool $POOL ($(head -c 160 <<<"$cfg"))"

# The first admin, made the way an operator makes one, then (BREAK) taken out
# of the resource group.
LOOM_ENV=claims LOOM_INSTANCE="$CLAIMS_AWS_INSTANCE" LOOM_E2E_USER="$USER_NAME" LOOM_E2E_PASSWORD="$PASSWORD" \
  bash scripts/validate/get-user-token.sh >/dev/null || stop "could not create the user $USER_NAME in $POOL"
if [ -n "${BREAK:-}" ]; then
  aws cognito-idp admin-remove-user-from-group --user-pool-id "$POOL" --username "$USER_NAME" --group-name g-admins-super >/dev/null \
    || stop "could not take $USER_NAME out of g-admins-super"
  BROKEN=1
fi

# The SPA's sign-in: InitiateAuth with the client id the page carries.
signin="$(aws cognito-idp initiate-auth --client-id "$CLIENT" --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=$USER_NAME,PASSWORD=$PASSWORD" --output json 2>&1 || true)"
TOKEN="$(jq -r '.AuthenticationResult.AccessToken // empty' <<<"$signin" 2>/dev/null || true)"
[ -n "$TOKEN" ] || stop "InitiateAuth (USER_PASSWORD_AUTH) with the web app's client returned no token: $(head -c 200 <<<"$signin")"
payload="$(cut -d. -f2 <<<"$TOKEN" | tr '_-' '/+')"
while [ $(( ${#payload} % 4 )) -ne 0 ]; do payload="$payload="; done
groups="$(base64 -d <<<"$payload" 2>/dev/null | jq -c '."cognito:groups" // []' || echo '[]')"

code() { curl -s -o /dev/null -w '%{http_code}' "$BASE$1" ${2:+-H "Authorization: Bearer $2"}; }
me="$(code /api/auth/me "$TOKEN")"
agents="$(code /api/agents "$TOKEN")"
anon="$(code /api/agents)"

if [ -n "${BREAK:-}" ]; then
  case "$agents" in
    401|403) stop "without g-admins-super the web app's sign-in gave a token (groups $groups) that /api/agents refused ($agents)" ;;
    *) say fail "without g-admins-super, /api/agents still answered $agents to the token (groups $groups)"; exit 0 ;;
  esac
fi

jq -e 'index("g-admins-super")' <<<"$groups" >/dev/null || note "the token's groups are $groups, without g-admins-super"
[ "$me" = 200 ] || note "/api/auth/me answered $me with the token"
[ "$agents" = 200 ] || note "/api/agents answered $agents with the token"
[ "$anon" = 401 ] || note "/api/agents answered $anon without a token, expected 401"
if [ -n "$problems" ]; then problems="${problems# }"; say fail "${problems%;}"
else say pass "$BASE serves the SPA with the user client $CLIENT baked in; signing in through it gave a g-admins-super token that /api/auth/me and /api/agents accept (401 without one)"; fi
