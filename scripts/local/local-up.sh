#!/usr/bin/env bash
# Local-run harness (#49, epic #45): stand up a browsable Loom on a laptop.
#
# Floci provides the AWS-managed pieces (RDS/Cognito/S3/ECR) via chant; the app
# tier (frontend/backend/proxy) runs from the chant-generated docker-compose
# (`src/local/compose.ts` -> `chant build --lexicon docker`), wired to Floci by
# a generated `.env`. Agents are out of scope locally (Bedrock AgentCore has no
# Floci emulation) — see the local-tier docs.
#
# Not gating CI; on-demand, needs Docker. `just local-up` / `just local-down`.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
ENDPOINT="http://localhost:4566"
export AWS_ENDPOINT_URL="$ENDPOINT" AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION="$REGION"
export LOOM_TIER=light LOOM_ENV="${LOOM_ENV:-local}" LOOM_DB_PASSWORD="${LOOM_DB_PASSWORD:-loomLocalPass123}"
OUT=dist/local
aws() { command aws --endpoint-url "$ENDPOINT" --region "$REGION" "$@"; }

echo "==> [1/7] Floci up"
if ! docker ps --filter name=^floci$ --format '{{.Names}}' | grep -q floci; then
  # AgentCore-enabled Floci fork (loomster#98) — emulates Bedrock AgentCore so the
  # agents wave runs locally. Multiarch image (amd64 + arm64): runs natively on CI
  # runners and Apple Silicon alike.
  docker run -d --rm -p 4566:4566 -v /var/run/docker.sock:/var/run/docker.sock --name floci ghcr.io/lex00/floci:agentcore >/dev/null
  sleep 8
fi

echo "==> [2/7] vendor Loom v1.6.0"
npm run vendor >/dev/null 2>&1

echo "==> [3/7] synth AWS templates + provision infra on Floci (chant)"
npm run synth >/tmp/loom-local-synth.log 2>&1 || { echo "synth failed"; tail -5 /tmp/loom-local-synth.log; exit 1; }
./node_modules/.bin/chant run --components all --env "$LOOM_ENV" >/tmp/loom-local-provision.log 2>&1 || {
  echo "provision failed — see /tmp/loom-local-provision.log"; tail -5 /tmp/loom-local-provision.log; exit 1; }

echo "==> [4/7] build the app images"
docker build -q -t loom-local-backend -f vendor/loom/backend/Dockerfile vendor/loom >/dev/null
docker build -q -t loom-local-frontend vendor/loom/frontend >/dev/null

echo "==> [5/7] shared network + resolve Floci values -> .env"
# Docker isolates separate bridges, so the app tier and Floci (incl. its RDS
# proxy) must share one network. Create it and attach Floci; the backend then
# reaches the DB + AWS APIs at Floci's address on THIS network.
NET=loom-local-net
docker network create "$NET" >/dev/null 2>&1 || true
docker network connect "$NET" floci >/dev/null 2>&1 || true
FLOCI_NET_IP="$(docker inspect floci --format "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" 2>/dev/null)"
db_out() { aws cloudformation describe-stacks --stack-name loom-db --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text 2>/dev/null; }
RDS_PORT="$(db_out oRdsPort)"; RDS_DB="$(db_out oRdsDbName)"
BUCKET="$(aws cloudformation describe-stacks --stack-name shared-foundation --query "Stacks[0].Outputs[?OutputKey=='oArtifactBucket'].OutputValue" --output text 2>/dev/null)"
# LOOM_COGNITO_USER_POOL_ID is intentionally NOT set (#50) — leaving it empty
# engages Loom's own dev-auth bypass (local-dev user, all scopes), since Floci's
# Cognito can't mint validatable JWTs. See src/local/compose.ts.
# The RDS endpoint output is Floci's own address (Floci proxies RDS on RDS_PORT);
# use Floci's address on the shared network so the app tier can reach it.
mkdir -p "$OUT"
cat > "$OUT/.env" <<EOF
LOOM_BACKEND_IMAGE=loom-local-backend:latest
LOOM_FRONTEND_IMAGE=loom-local-frontend:latest
LOOM_DATABASE_URL=postgresql+psycopg2://loom:${LOOM_DB_PASSWORD}@${FLOCI_NET_IP}:${RDS_PORT}/${RDS_DB}
LOOM_ARTIFACT_BUCKET=${BUCKET}
AWS_ENDPOINT_URL=http://${FLOCI_NET_IP}:4566
AWS_REGION=${REGION}
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
LOOM_ALLOWED_ORIGINS=http://localhost:8080
EOF
echo "    RDS=${FLOCI_NET_IP}:${RDS_PORT}/${RDS_DB}  floci-net-ip=${FLOCI_NET_IP}"

echo "==> [6/7] generate compose + nginx config (chant)"
npx tsx scripts/local/gen-nginx.ts
npx chant build src/local --lexicon docker -o "$OUT/docker-compose.yml" >/dev/null

echo "==> [7/7] docker compose up"
docker compose --project-name loom-local -f "$OUT/docker-compose.yml" up -d

echo ""
echo "Loom is coming up at http://localhost:8080  (agents disabled locally — no AgentCore)"
echo "  logs:  docker compose -p loom-local -f $OUT/docker-compose.yml logs -f"
echo "  down:  just local-down"
