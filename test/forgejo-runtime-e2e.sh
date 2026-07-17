#!/usr/bin/env bash
set -euo pipefail

# Forgejo Actions runtime E2E — the Forgejo counterpart to
# ./github-runtime-e2e.sh. Forgejo Actions is a GitHub-Actions dialect and runs
# on the same engine as `act`, so this builds the real, discovered-component
# Forgejo workflow and ACTUALLY RUNS it in Docker via `act` (a Forgejo runner,
# act_runner, would run the same file), deploying the light tier's infra
# components (shared-foundation, loom-cognito, loom-db, downstream-stub) against
# Floci — no real AWS account. Proves the generated workflow's job / `needs:` /
# artifact mechanics execute, including cross-stack output threading across a
# `needs:` edge.
#
# loom-backend/loom-frontend are excluded — their build phase docker-builds
# Loom's real images from vendor/loom, a separate, heavier concern.
#
# On-demand only — NOT part of gating CI. Needs Docker + act; run it yourself:
#
#   just forgejo-runtime-e2e        (or)   bash test/forgejo-runtime-e2e.sh
#
# Exit codes: 0 pass or cleanly skipped (no Docker / no act); non-zero on a real
# failure.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT/test/forgejo-runtime-e2e"

skip() { echo "SKIP: $1"; exit 0; }

command -v docker >/dev/null 2>&1 || skip "docker not installed"
docker info >/dev/null 2>&1 || skip "docker daemon not reachable"
command -v act >/dev/null 2>&1 || skip "act not installed (brew install act; or use a Forgejo runner / act_runner)"

FLOCI_NAME="floci-fje2e-$$"
ARTIFACTS="$(mktemp -d)"
LOG="$(mktemp)"
cleanup() {
  docker rm -f "$FLOCI_NAME" >/dev/null 2>&1 || true
  docker ps -aq --filter "name=^floci-" 2>/dev/null | xargs -r docker rm -f >/dev/null 2>&1 || true
  rm -rf "$FIXTURE/ci.yml" "$ARTIFACTS" "$LOG"
}
trap cleanup EXIT

echo "=== Starting Floci ==="
# AgentCore-enabled Floci fork (loomster#98) — emulates Bedrock AgentCore so the
# agents wave is exercisable locally. Multiarch image (amd64 + arm64): runs
# natively on CI runners and Apple Silicon alike.
docker run -d --rm -p 4566:4566 -v /var/run/docker.sock:/var/run/docker.sock \
  --name "$FLOCI_NAME" ghcr.io/lex00/floci:agentcore >/dev/null

for _ in $(seq 1 30); do
  curl -sf http://localhost:4566/_localstack/health >/dev/null 2>&1 && break
  sleep 1
done
curl -sf http://localhost:4566/_localstack/health >/dev/null 2>&1 || {
  echo "FAIL: Floci did not become healthy"
  exit 1
}

export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1
ENDPOINT="http://localhost:4566"

echo "=== Bootstrapping VPC/subnets in Floci ==="
VPC_ID=$(aws --endpoint-url "$ENDPOINT" ec2 create-vpc --cidr-block 10.0.0.0/16 --query 'Vpc.VpcId' --output text)
PUB1=$(aws --endpoint-url "$ENDPOINT" ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.1.0/24 --availability-zone us-east-1a --query 'Subnet.SubnetId' --output text)
PUB2=$(aws --endpoint-url "$ENDPOINT" ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.2.0/24 --availability-zone us-east-1b --query 'Subnet.SubnetId' --output text)
PRIV1=$(aws --endpoint-url "$ENDPOINT" ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.11.0/24 --availability-zone us-east-1a --query 'Subnet.SubnetId' --output text)
PRIV2=$(aws --endpoint-url "$ENDPOINT" ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.12.0/24 --availability-zone us-east-1b --query 'Subnet.SubnetId' --output text)

echo "=== Building runtime-E2E workflow (infra components only) ==="
(cd "$ROOT" && npx tsx "$FIXTURE/build.ts" "$FIXTURE")

# Forgejo jobs are `runs-on: docker`; map that label to node:22 for act. Jobs
# reach Floci via host.docker.internal; cross-job artifacts go through act's
# artifact server.
echo "=== Running workflow (act) ==="
cd "$ROOT"
set +e
act workflow_dispatch \
  -W "test/forgejo-runtime-e2e/ci.yml" \
  -P docker=node:22 \
  --artifact-server-path "$ARTIFACTS" \
  --env AWS_ENDPOINT_URL="http://host.docker.internal:4566" \
  --env AWS_ACCESS_KEY_ID=test \
  --env AWS_SECRET_ACCESS_KEY=test \
  --env AWS_REGION=us-east-1 \
  --env LOOM_VPC_ID="$VPC_ID" \
  --env LOOM_PUBLIC_SUBNET_IDS="$PUB1,$PUB2" \
  --env LOOM_PRIVATE_SUBNET_IDS="$PRIV1,$PRIV2" \
  --env LOOM_DB_PASSWORD="e2e-test-password-1234" \
  --env LOOM_TIER=light 2>&1 | tee "$LOG"
STATUS=${PIPESTATUS[0]}
set -e

if [ "$STATUS" -ne 0 ]; then
  echo "FAIL: act reported a job failure"
  exit 1
fi

echo "=== Verifying deployed stacks ==="
SN="${LOOM_PROJECT:-loom}-${LOOM_ENV:-dev}-${LOOM_INSTANCE:-a}"
for stack in "$SN-shared-foundation" "$SN-loom-cognito" "$SN-loom-db" "$SN-downstream-stub"; do
  status=$(aws --endpoint-url "$ENDPOINT" cloudformation describe-stacks --stack-name "$stack" --query 'Stacks[0].StackStatus' --output text 2>&1) || {
    echo "FAIL: stack \"$stack\" was not deployed: $status"
    exit 1
  }
  if [ "$status" != "CREATE_COMPLETE" ]; then
    echo "FAIL: stack \"$stack\" is \"$status\", expected CREATE_COMPLETE"
    exit 1
  fi
  echo "  $stack: $status"
done

echo "PASS: chant-generated Forgejo workflow deployed the light tier's infra components against Floci"
