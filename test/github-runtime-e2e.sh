#!/usr/bin/env bash
set -euo pipefail

# GitHub Actions runtime E2E — the `act` counterpart to
# `./gitlab-runtime-e2e.sh`. Builds the real, discovered-component GitHub
# workflow and ACTUALLY RUNS it in Docker via `act` (nektos/act), deploying the
# light tier's infra components (shared-foundation, loom-cognito, loom-db,
# downstream-stub) against Floci (a local AWS emulator) — no real AWS account.
# This proves the generated workflow's job / `needs:` / artifact mechanics
# execute, including the real cross-stack output threading loom-db/
# downstream-stub need from shared-foundation across a `needs:` edge (uploaded
# by actions/upload-artifact, downloaded by actions/download-artifact).
#
# loom-backend/loom-frontend are excluded — their build phase docker-builds
# Loom's real images from vendor/loom, a separate, heavier concern (same scope
# as gitlab-runtime-e2e.sh).
#
# On-demand only — NOT part of gating CI. Needs Docker + act; run it yourself:
#
#   just github-runtime-e2e        (or)   bash test/github-runtime-e2e.sh
#
# Exit codes: 0 pass or cleanly skipped (no Docker / no act); non-zero on a real
# failure.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT/test/github-runtime-e2e"

skip() { echo "SKIP: $1"; exit 0; }

# ── Preconditions ────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || skip "docker not installed"
docker info >/dev/null 2>&1 || skip "docker daemon not reachable"
command -v act >/dev/null 2>&1 || skip "act not installed (brew install act)"

# ── Floci (local AWS emulator) ───────────────────────────────────────────────
FLOCI_NAME="floci-ghe2e-$$"
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

# ── Bootstrap a throwaway VPC + subnets (loom-db's BYO-network input) ─────────
echo "=== Bootstrapping VPC/subnets in Floci ==="
VPC_ID=$(aws --endpoint-url "$ENDPOINT" ec2 create-vpc --cidr-block 10.0.0.0/16 --query 'Vpc.VpcId' --output text)
PUB1=$(aws --endpoint-url "$ENDPOINT" ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.1.0/24 --availability-zone us-east-1a --query 'Subnet.SubnetId' --output text)
PUB2=$(aws --endpoint-url "$ENDPOINT" ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.2.0/24 --availability-zone us-east-1b --query 'Subnet.SubnetId' --output text)
PRIV1=$(aws --endpoint-url "$ENDPOINT" ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.11.0/24 --availability-zone us-east-1a --query 'Subnet.SubnetId' --output text)
PRIV2=$(aws --endpoint-url "$ENDPOINT" ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.12.0/24 --availability-zone us-east-1b --query 'Subnet.SubnetId' --output text)

# ── 1. Build the runtime-E2E workflow → test/github-runtime-e2e/ci.yml ────────
echo "=== Building runtime-E2E workflow (infra components only) ==="
(cd "$ROOT" && npx tsx "$FIXTURE/build.ts" "$FIXTURE")

# ── 2. Run it in Docker via act, against Floci ───────────────────────────────
# `container: node:22` jobs run the steps in that image; map ubuntu-latest to a
# small image so act doesn't pull a multi-GB default runner. Jobs reach Floci on
# the host via host.docker.internal. Cross-job artifacts go through act's
# artifact server (--artifact-server-path).
echo "=== Running workflow (act) ==="
cd "$ROOT"
set +e
act workflow_dispatch \
  -W "test/github-runtime-e2e/ci.yml" \
  -P ubuntu-latest=node:22 \
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

# ── 3. Assert the light tier actually deployed (real CFN stacks in Floci) ─────
echo "=== Verifying deployed stacks ==="
for stack in shared-foundation loom-cognito loom-db downstream-stub; do
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

echo "PASS: chant-generated GitHub workflow deployed the light tier's infra components against Floci"
