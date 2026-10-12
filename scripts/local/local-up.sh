#!/usr/bin/env bash
# Local-run harness (#49, epic #45): stand up a browsable Loom on a laptop.
#
# Floci provides the AWS-managed pieces (RDS/Cognito/S3/ECR) via chant; the app
# tier (frontend/backend/proxy) runs from the chant-generated docker-compose
# (`src/local/compose.ts` -> `chant build --lexicon docker`), wired to Floci by
# a generated `.env`. Agents deploy locally too — Floci (2.2.0+) emulates Bedrock
# AgentCore's control plane — though invoke is a canned stub.
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

echo "==> [1/7] Floci up"
if ! docker ps --filter name=^floci$ --format '{{.Names}}' | grep -q floci; then
  # Upstream Floci 2.2.0 emulates Bedrock AgentCore's control plane (it replaced
  # the loomster#98 fork), so the agents wave runs locally. Multiarch image
  # (amd64 + arm64): runs natively on CI runners and Apple Silicon alike.
  # FLOCI_DOCKER_RESOURCE_NAMESPACE names every container and volume Floci
  # creates `floci-aws-loom-local-*`, so local-down can remove exactly those
  # (the ECR registry's data volume outlives Floci, and a re-run would fail on
  # "repository already exists") and leave any other Floci's alone.
  docker run -d --rm -p 127.0.0.1:4566:4566 -v /var/run/docker.sock:/var/run/docker.sock \
    --network "$NET" -e FLOCI_SERVICES_DOCKER_NETWORK="$NET" -e FLOCI_SERVICES_ECR_DOCKER_NETWORK="$NET" \
    -e FLOCI_DOCKER_RESOURCE_NAMESPACE=loom-local \
    --name floci "${FLOCI_IMAGE:-floci/floci:2.2.0}" >/dev/null
  sleep 8
fi

echo "==> [2/7] vendor Loom v1.9.0"
npm run vendor >/dev/null 2>&1

echo "==> [3/7] synth AWS templates + provision infra on Floci (chant)"
npm run synth >/tmp/loom-local-synth.log 2>&1 || { echo "synth failed"; tail -5 /tmp/loom-local-synth.log; exit 1; }
./node_modules/.bin/chant run --components all --env "$LOOM_ENV" >/tmp/loom-local-provision.log 2>&1 || {
  echo "provision failed — see /tmp/loom-local-provision.log"; tail -5 /tmp/loom-local-provision.log; exit 1; }

echo "==> [4/7] build the app images"
docker build -q -t loom-local-backend -f vendor/loom/backend/Dockerfile vendor/loom >/dev/null
docker build -q -t loom-local-frontend vendor/loom/frontend >/dev/null

echo "==> [5/7] shared network + resolve Floci values -> .env"
# Floci normally started on $NET above; attach it in case it was already running.
docker network connect "$NET" floci >/dev/null 2>&1 || true
# Stack names are namespaced by project+env+instance (#140), as src/lib/stack-name.ts builds them.
SN_PREFIX="${LOOM_PROJECT:-loom}-${LOOM_ENV}-${LOOM_INSTANCE:-a}"
db_out() { aws cloudformation describe-stacks --stack-name "$SN_PREFIX-loom-db" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text 2>/dev/null; }
RDS_PORT="$(db_out oRdsPort)"; RDS_DB="$(db_out oRdsDbName)"
BUCKET="$(aws cloudformation describe-stacks --stack-name "$SN_PREFIX-shared-foundation" --query "Stacks[0].Outputs[?OutputKey=='oArtifactBucket'].OutputValue" --output text 2>/dev/null)"
# LOOM_COGNITO_USER_POOL_ID is intentionally NOT set (#50, #3) — leaving it
# empty engages Loom's own dev-auth bypass (local-dev user, all scopes). Floci's
# Cognito does mint RS256 JWTs, but Loom only validates Cognito tokens against
# cognito-idp.<region>.amazonaws.com and only fetches OIDC JWKS over https from
# public addresses. compose.ts sets LOOM_ALLOW_UNAUTHENTICATED_LOCAL_DEV and the
# proxy reaches the backend over loopback, which Loom v1.8.1+ requires.
mkdir -p "$OUT"
cat > "$OUT/.env" <<EOF
LOOM_BACKEND_IMAGE=loom-local-backend:latest
LOOM_FRONTEND_IMAGE=loom-local-frontend:latest
LOOM_DATABASE_URL=postgresql+psycopg2://loom:${LOOM_DB_PASSWORD}@floci:${RDS_PORT}/${RDS_DB}
LOOM_ARTIFACT_BUCKET=${BUCKET}
AWS_ENDPOINT_URL=http://floci:4566
AWS_REGION=${REGION}
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
LOOM_ALLOWED_ORIGINS=http://localhost:8080
EOF
echo "    RDS=floci:${RDS_PORT}/${RDS_DB}  AWS_ENDPOINT=http://floci:4566"

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
# registers against the static card the proxy serves (see gen-nginx.ts), reached
# by the backend at http://loomBackend:8080/a2a-demo (the proxy shares the
# backend's network namespace). Seed and validation go through the proxy on
# localhost:8080, which the backend sees as a loopback client.
for i in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/health 2>/dev/null)" = "200" ] && break
  sleep 2
done
# chant prints the op's script rather than its output, so judge by exit status
# and keep the full log.
if LOOM_SEED_PROFILE=demo LOOM_API_BASE_URL=http://localhost:8080 LOOM_DEMO_A2A_URL=http://loomBackend:8080/a2a-demo \
  npm run seed >/tmp/loom-local-seed.log 2>&1; then
  echo "    seeded (log: /tmp/loom-local-seed.log; check with 'npm run validate')"
else
  echo "  (seed failed — see /tmp/loom-local-seed.log, then re-run 'npm run seed')"
fi

echo ""
echo "Loom is coming up at http://localhost:8080  (agents deploy against Floci's AgentCore emulation; invoke is a stub)"
echo "  auth:  none — Loom's local-dev bypass (admin 'local-dev' user), reachable from this machine only"
echo "  logs:  docker compose -p loom-local -f $OUT/docker-compose.yml logs -f"
echo "  down:  just local-down"
