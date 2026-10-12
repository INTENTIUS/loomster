#!/usr/bin/env bash
# target: floci
# tier: light
# summary: the local-up app logs in through Floci's Cognito: the SPA's login reaches Floci, and Loom accepts the token with its local-dev bypass off
#
# Needs a running `just local-up` (Floci ${LOOM_CLAIMS_FLOCI_IMAGE:-ghcr.io/lex00/floci:318204f}
# on :4566, the app on :8080); pending otherwise. Plain, it checks the browser
# path the way the SPA runs it:
#   - /api/auth/config serves the Cognito provider with the Floci pool id, and
#     the backend runs without LOOM_ALLOW_UNAUTHENTICATED_LOCAL_DEV;
#   - the built SPA carries the Floci user client id and posts its login to
#     /floci-cognito/ (VITE_COGNITO_ENDPOINT_URL, scripts/loom-patches/);
#   - InitiateAuth (USER_PASSWORD_AUTH) for the local admin, POSTed to the
#     proxy's /floci-cognito/ as the SPA does, returns an access token issued
#     by http://floci:4566/<pool>;
#   - /api/auth/me with that token is 200 with g-admins-super, and 401 without.
#
# BREAK=1 recreates the backend with LOOM_COGNITO_ENDPOINT_URL empty (Loom
# validates against cognito-idp.<region>.amazonaws.com again) and expects the
# same token to get 401. The backend is recreated with the full .env on exit.
set -euo pipefail

name=local/auth
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
BASE=http://localhost:8080
OUT=dist/local
command -v jq >/dev/null 2>&1 || { say pending "needs jq"; exit 0; }
command -v docker >/dev/null 2>&1 || { say pending "needs docker"; exit 0; }
if [ ! -f "$OUT/.env" ] || [ ! -f "$OUT/admin-login.txt" ] \
  || [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null)" != 200 ]; then
  say pending "needs a running local-up Loom on Floci (just local-up; $BASE/health and $OUT/.env)"; exit 0
fi

val() { sed -n "s/^$1=//p" "$2" | tail -n 1; }
POOL="$(val LOOM_COGNITO_USER_POOL_ID "$OUT/.env")"
CLIENT="$(val LOOM_LOCAL_USER_CLIENT_ID "$OUT/.env")"
USER_NAME="$(val username "$OUT/admin-login.txt")"
PASSWORD="$(val password "$OUT/admin-login.txt")"

compose() {
  env -u AWS_ENDPOINT_URL -u AWS_REGION -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
    docker compose --project-name loom-local -f "$OUT/docker-compose.yml" "$@"
}
wait_healthy() { for _ in $(seq 1 45); do [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health")" = 200 ] && return 0; sleep 2; done; return 1; }

problems=""
note() { problems="$problems $*;"; }

# The SPA's view: the auth config it boots from, and what its bundle was built with.
cfg="$(curl -s "$BASE/api/auth/config")"
[ "$(jq -r '.provider_type // empty' <<<"$cfg")" = cognito ] || note "auth/config provider is not cognito ($cfg)"
[ "$(jq -r '.user_pool_id // empty' <<<"$cfg")" = "$POOL" ] || note "auth/config pool is not the Floci pool $POOL"
backend="$(compose ps -q loomBackend)"
if docker inspect "$backend" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -q '^LOOM_ALLOW_UNAUTHENTICATED_LOCAL_DEV=true'; then
  note "the backend still runs with the local-dev auth bypass"
fi
bundle=""
for js in $(curl -s "$BASE/" | grep -oE '/assets/[^"]+\.js' | sort -u); do bundle="$bundle$(curl -s "$BASE$js")"; done
grep -qF '/floci-cognito/' <<<"$bundle" || note "the SPA bundle does not post its login to /floci-cognito/"
grep -qF "$CLIENT" <<<"$bundle" || note "the SPA bundle does not carry the Floci user client id $CLIENT"

# The SPA's login request, through the proxy.
login="$(curl -s -X POST "$BASE/floci-cognito/" -H 'Content-Type: application/x-amz-json-1.1' \
  -H 'X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth' \
  -d "$(jq -cn --arg c "$CLIENT" --arg u "$USER_NAME" --arg p "$PASSWORD" \
        '{AuthFlow: "USER_PASSWORD_AUTH", ClientId: $c, AuthParameters: {USERNAME: $u, PASSWORD: $p}}')")"
TOKEN="$(jq -r '.AuthenticationResult.AccessToken // empty' <<<"$login" 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  say fail "InitiateAuth through $BASE/floci-cognito/ returned no access token: $(head -c 200 <<<"$login")"; exit 0
fi
payload="$(cut -d. -f2 <<<"$TOKEN" | tr '_-' '/+')"
while [ $(( ${#payload} % 4 )) -ne 0 ]; do payload="$payload="; done
iss="$(base64 -d <<<"$payload" 2>/dev/null | jq -r '.iss // empty' || true)"
[ "$iss" = "http://floci:4566/$POOL" ] || note "token issuer is '$iss', expected http://floci:4566/$POOL"

me() { curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/me" ${1:+-H "Authorization: Bearer $1"}; }

if [ -n "${BREAK:-}" ]; then
  restore() { compose --env-file "$OUT/.env" up -d --force-recreate loomBackend >/dev/null 2>&1 || true; wait_healthy || true; }
  trap restore EXIT
  broken="$(mktemp "${TMPDIR:-/tmp}/loomster-claim-auth.XXXXXX")"
  sed 's/^LOOM_COGNITO_ENDPOINT_URL=.*/LOOM_COGNITO_ENDPOINT_URL=/' "$OUT/.env" >"$broken"
  compose --env-file "$broken" up -d --force-recreate loomBackend >/dev/null 2>&1
  rm -f "$broken"
  wait_healthy || { say fail "the backend did not come back without the override"; exit 0; }
  code="$(me "$TOKEN")"
  if [ "$code" = 401 ]; then say caught "with LOOM_COGNITO_ENDPOINT_URL unset, Loom refused the Floci token (401)"
  else say fail "with LOOM_COGNITO_ENDPOINT_URL unset, /api/auth/me still answered $code"; fi
  exit 0
fi

code="$(me "$TOKEN")"
[ "$code" = 200 ] || note "/api/auth/me with the Floci token answered $code"
if [ "$code" = 200 ]; then
  curl -s "$BASE/api/auth/me" -H "Authorization: Bearer $TOKEN" | jq -e '.groups | index("g-admins-super")' >/dev/null \
    || note "/api/auth/me groups lack g-admins-super"
fi
anon="$(me)"
[ "$anon" = 401 ] || note "/api/auth/me without a token answered $anon, expected 401"

if [ -n "$problems" ]; then problems="${problems# }"; say fail "${problems%;}"
else say pass "the SPA logs in at /floci-cognito/ and Loom accepts the Floci token (200 with g-admins-super; 401 without one)"; fi
