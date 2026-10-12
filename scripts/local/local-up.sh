#!/usr/bin/env bash
# Local-run harness (#49, epic #45): stand up a browsable Loom on a laptop.
#
# Floci provides the AWS-managed pieces (RDS/Cognito/S3/ECR) via chant; the app
# tier (frontend/backend/proxy) runs from the chant-generated docker-compose
# (`src/local/compose.ts` -> `chant build --lexicon docker`), wired to Floci by
# a generated `.env`. Agents deploy locally too — Floci (2.2.0+) emulates Bedrock
# AgentCore's control plane — though invoke is a canned stub.
#
# Auth is real (loomster#58): you log in through the frontend against the
# loom-cognito pool on Floci, and Loom validates Floci's RS256 tokens. That
# needs loomster's Loom patch (scripts/loom-patches/), which adds an opt-in
# Cognito endpoint override; Loom's local-dev auth bypass is not used.
#
# Not gating CI; on-demand, needs Docker. `just local-up` / `just local-down`.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
ENDPOINT="http://localhost:4566"
export AWS_ENDPOINT_URL="$ENDPOINT" AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION="$REGION"
export LOOM_TIER=light LOOM_ENV="${LOOM_ENV:-local}" LOOM_DB_PASSWORD="${LOOM_DB_PASSWORD:-loomLocalPass123}"
OUT=dist/local
aws() { command aws --endpoint-url "$ENDPOINT" --region "$REGION" "$@"; }

# Docker isolates separate bridges, so the app tier and Floci (incl. its RDS
# proxy) must share one network. Floci starts on it, and is told to put the
# containers it spawns (RDS, ECS, the ECR registry) there too: Floci 2.x reaches
# its ECR registry by container name, which only resolves on a user-defined
# network. The backend then reaches the DB + AWS APIs at Floci on THIS network.
# Address Floci by its container NAME (`floci`), not its IP: the IP is reassigned
# each time Floci restarts, and a `.env` pinned to a stale IP silently breaks the
# backend's S3 artifact upload on agent deploy (the app still browses, since
# that's all Postgres) — the container name is stable across restarts and
# resolves via Docker's built-in DNS on this network.
NET=loom-local-net
docker network create "$NET" >/dev/null 2>&1 || true

echo "==> [1/8] Floci up"
if ! docker ps --filter name=^floci$ --format '{{.Names}}' | grep -q floci; then
  # Upstream Floci 2.2.0 emulates Bedrock AgentCore's control plane (it replaced
  # the loomster#98 fork), so the agents wave runs locally. Multiarch image
  # (amd64 + arm64): runs natively on CI runners and Apple Silicon alike.
  # FLOCI_DOCKER_RESOURCE_NAMESPACE names every container and volume Floci
  # creates `floci-aws-loom-local-*`, so local-down can remove exactly those
  # (the ECR registry's data volume outlives Floci, and a re-run would fail on
  # "repository already exists") and leave any other Floci's alone.
  # FLOCI_HOSTNAME=floci makes Floci's Cognito issuer http://floci:4566/<pool>:
  # the backend reaches Floci by that name on this network, so the issuer it
  # checks and the JWKS it fetches share one base (LOOM_COGNITO_ENDPOINT_URL).
  docker run -d --rm -p 127.0.0.1:4566:4566 -v /var/run/docker.sock:/var/run/docker.sock \
    --network "$NET" -e FLOCI_SERVICES_DOCKER_NETWORK="$NET" -e FLOCI_SERVICES_ECR_DOCKER_NETWORK="$NET" \
    -e FLOCI_DOCKER_RESOURCE_NAMESPACE=loom-local -e FLOCI_HOSTNAME=floci \
    --name floci "${FLOCI_IMAGE:-floci/floci:2.2.0}" >/dev/null
  sleep 8
fi

echo "==> [2/8] vendor Loom v1.9.0 (+ loomster's Loom patches)"
npm run vendor >/tmp/loom-local-vendor.log 2>&1 || { echo "vendor failed"; tail -5 /tmp/loom-local-vendor.log; exit 1; }

echo "==> [3/8] synth AWS templates + provision infra on Floci (chant)"
npm run synth >/tmp/loom-local-synth.log 2>&1 || { echo "synth failed"; tail -5 /tmp/loom-local-synth.log; exit 1; }
./node_modules/.bin/chant run --components all --env "$LOOM_ENV" >/tmp/loom-local-provision.log 2>&1 || {
  echo "provision failed — see /tmp/loom-local-provision.log"; tail -5 /tmp/loom-local-provision.log; exit 1; }

echo "==> [4/8] resolve Floci values + Cognito login -> .env"
# Floci normally started on $NET above; attach it in case it was already running.
docker network connect "$NET" floci >/dev/null 2>&1 || true
# Stack names are namespaced by project+env+instance (#140), as src/lib/stack-name.ts builds them.
SN_PREFIX="${LOOM_PROJECT:-loom}-${LOOM_ENV}-${LOOM_INSTANCE:-a}"
stack_out() { aws cloudformation describe-stacks --stack-name "$SN_PREFIX-$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text 2>/dev/null; }
RDS_PORT="$(stack_out loom-db oRdsPort)"; RDS_DB="$(stack_out loom-db oRdsDbName)"
BUCKET="$(stack_out shared-foundation oArtifactBucket)"
POOL="$(stack_out loom-cognito oCognitoUserPoolId)"
[ -n "$POOL" ] && [ "$POOL" != "None" ] || { echo "no oCognitoUserPoolId on $SN_PREFIX-loom-cognito"; exit 1; }

# Loom checks the token issuer against LOOM_COGNITO_ENDPOINT_URL/<pool>. A Floci
# started without FLOCI_HOSTNAME=floci (one left over from an older local-up)
# issues http://localhost:4566/<pool> tokens, which the backend would refuse.
COGNITO_BASE=http://floci:4566
issuer="$(curl -s "$ENDPOINT/$POOL/.well-known/openid-configuration" | jq -r '.issuer // empty')"
[ "$issuer" = "$COGNITO_BASE/$POOL" ] || {
  echo "Floci's Cognito issuer is '$issuer', expected $COGNITO_BASE/$POOL."
  echo "This Floci was started without FLOCI_HOSTNAME=floci: run 'just local-down', then 'just local-up'."; exit 1; }

# The light tier provisions the pool and the M2M client but no user client and
# no groups (production tiers do). Local login needs both, so they're added here,
# on Floci only: a public user client allowing the password flows the SPA
# (USER_PASSWORD_AUTH) and get-user-token.sh (ADMIN_USER_PASSWORD_AUTH) use, and
# Loom's admin groups.
CLIENT="$(stack_out loom-cognito oUserClientId)"
if [ -z "$CLIENT" ] || [ "$CLIENT" = "None" ]; then
  CLIENT="$(aws cognito-idp list-user-pool-clients --user-pool-id "$POOL" --max-results 60 \
    --query "UserPoolClients[?ClientName=='loom-local-user'].ClientId | [0]" --output text)"
  if [ -z "$CLIENT" ] || [ "$CLIENT" = "None" ]; then
    CLIENT="$(aws cognito-idp create-user-pool-client --user-pool-id "$POOL" --client-name loom-local-user --no-generate-secret \
      --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_ADMIN_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
      --query UserPoolClient.ClientId --output text)"
  fi
fi
for g in t-admin g-admins-super; do
  aws cognito-idp create-group --user-pool-id "$POOL" --group-name "$g" >/dev/null 2>&1 || true
done

# The local admin you log in as. A fresh throwaway password every local-up
# (12+ chars, upper/lower/digit, the pool's policy), printed at the end and kept
# in $OUT/admin-login.txt (dist/ is gitignored).
ADMIN_USER=loom-admin
ADMIN_PASSWORD="Loom-$(openssl rand -hex 6)-$(openssl rand -hex 2 | tr 'a-f' 'A-F')x7"
aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$ADMIN_USER" --message-action SUPPRESS >/dev/null 2>&1 || true
aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --username "$ADMIN_USER" --password "$ADMIN_PASSWORD" --permanent >/dev/null
for g in t-admin g-admins-super; do
  aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$ADMIN_USER" --group-name "$g" >/dev/null
done

mkdir -p "$OUT"
( umask 077; printf 'url=http://localhost:8080\nusername=%s\npassword=%s\n' "$ADMIN_USER" "$ADMIN_PASSWORD" > "$OUT/admin-login.txt" )
cat > "$OUT/.env" <<EOF
LOOM_BACKEND_IMAGE=loom-local-backend:latest
LOOM_FRONTEND_IMAGE=loom-local-frontend:latest
LOOM_DATABASE_URL=postgresql+psycopg2://loom:${LOOM_DB_PASSWORD}@floci:${RDS_PORT}/${RDS_DB}
LOOM_ARTIFACT_BUCKET=${BUCKET}
LOOM_COGNITO_USER_POOL_ID=${POOL}
LOOM_COGNITO_ENDPOINT_URL=${COGNITO_BASE}
LOOM_LOCAL_USER_CLIENT_ID=${CLIENT}
AWS_ENDPOINT_URL=http://floci:4566
AWS_REGION=${REGION}
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
LOOM_ALLOWED_ORIGINS=http://localhost:8080
EOF
echo "    RDS=floci:${RDS_PORT}/${RDS_DB}  AWS_ENDPOINT=http://floci:4566  pool=${POOL}  user client=${CLIENT}"

echo "==> [5/8] build the app images"
docker build -q -t loom-local-backend -f vendor/loom/backend/Dockerfile vendor/loom >/dev/null
# The SPA bakes its Cognito client id in at build time (as on the real tiers),
# and, via the Loom patch, the endpoint its login form posts to: the proxy's
# same-origin /floci-cognito/ path, which forwards to Floci.
docker build -q -t loom-local-frontend \
  --build-arg VITE_COGNITO_USER_CLIENT_ID="$CLIENT" --build-arg VITE_COGNITO_ENDPOINT_URL=/floci-cognito/ \
  vendor/loom/frontend >/dev/null

echo "==> [6/8] generate compose + nginx config (chant)"
npx tsx scripts/local/gen-nginx.ts
npx chant build src/local --lexicon docker -o "$OUT/docker-compose.yml" >/dev/null

echo "==> [7/8] docker compose up"
# --force-recreate so a re-run always applies the freshly written .env; plain
# `up -d` leaves already-running containers on their old (possibly stale)
# environment, which is exactly how a stale endpoint survives a re-run.
# Compose interpolation prefers the shell's environment over --env-file, and this
# script exports the host-side AWS_* values (AWS_ENDPOINT_URL=localhost:4566,
# unreachable from a container). Unset them so the compose file gets .env's
# in-network values (http://floci:4566).
env -u AWS_ENDPOINT_URL -u AWS_REGION -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
  docker compose --project-name loom-local -f "$OUT/docker-compose.yml" --env-file "$OUT/.env" up -d --force-recreate

echo "==> [8/8] seed demo defaults (loom-seed)"
# Wait for the backend to accept requests, then seed via Loom's own API so the
# app is usable out of the box: security role + authorizer + a loomster tag
# profile, and every Catalog section (agent, memory, MCP, A2A). The A2A agent
# registers against the static card the proxy serves (see gen-nginx.ts), which
# the backend reaches at http://loomProxy:8080/a2a-demo. Seed authenticates
# with a token minted the way scripts/validate/get-user-token.sh does on the
# real tiers (scripts/local/local-token.sh).
for i in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/health 2>/dev/null)" = "200" ] && break
  sleep 2
done
# chant prints the op's script rather than its output, so judge by exit status
# and keep the full log.
if ! TOKEN="$(bash scripts/local/local-token.sh 2>/tmp/loom-local-token.log)"; then
  echo "  (could not mint a token — see /tmp/loom-local-token.log; seed skipped)"
elif LOOM_API_TOKEN="$TOKEN" LOOM_SEED_PROFILE=demo LOOM_API_BASE_URL=http://localhost:8080 LOOM_DEMO_A2A_URL=http://loomProxy:8080/a2a-demo \
  npm run seed >/tmp/loom-local-seed.log 2>&1; then
  echo "    seeded (log: /tmp/loom-local-seed.log; check with 'npm run validate')"
else
  echo "  (seed failed — see /tmp/loom-local-seed.log, then re-run with LOOM_API_TOKEN=\$(bash scripts/local/local-token.sh) npm run seed)"
fi

echo ""
echo "Loom is coming up at http://localhost:8080  (agents deploy against Floci's AgentCore emulation; invoke is a stub)"
echo "  login: $ADMIN_USER / $ADMIN_PASSWORD   (Cognito on Floci; throwaway, new each local-up; also in $OUT/admin-login.txt)"
echo "  token: export LOOM_API_TOKEN=\$(bash scripts/local/local-token.sh)"
echo "  logs:  docker compose -p loom-local -f $OUT/docker-compose.yml logs -f"
echo "  down:  just local-down"
