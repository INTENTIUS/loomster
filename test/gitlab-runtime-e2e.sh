#!/usr/bin/env bash
set -euo pipefail

# GitLab runtime E2E (chant#892): build the real, discovered-component GitLab
# pipeline shape and ACTUALLY RUN it in Docker via gitlab-ci-local, deploying
# the light tier's infra components (shared-foundation, loom-cognito, loom-db,
# downstream-stub) against Floci (a local AWS emulator) — no real AWS account.
#
# `loom-backend`/`loom-frontend` are deliberately excluded here: their `build`
# phase docker-builds Loom's real application images from `vendor/loom`
# (upstream awslabs/loom, not vendored into this repo — see
# `src/components/loom-backend.component.ts`'s docstring). Proving those
# deploy is a separate, heavier concern than this issue's scope (validating
# the GitLab generator's stage/needs/artifact mechanics against real
# `cfn-deploy` cross-stack output threading, which the 4 infra components
# already exercise in full: shared-foundation has no deps, loom-db/
# downstream-stub each consume its outputs across a real `needs:` edge).
#
# Mirrors chant's own `test/gitlab-runtime-e2e.sh` pattern (build a fixture,
# run it with gitlab-ci-local, assert it passed) but — unlike that pipeline's
# self-contained alpine fixture — these jobs run this project's REAL
# composites against a REAL (emulated) AWS endpoint, so this script also
# handles what a real CI runner would: installing `chant`'s runtime deps
# (`awscli`, `npm ci`), synthesizing `dist/*.template.json` (gitignored, never
# committed — see README.md's "Deploy" section), and bootstrapping a
# throwaway VPC/subnets for `LOOM_VPC_ID`/`LOOM_PUBLIC_SUBNET_IDS`/
# `LOOM_PRIVATE_SUBNET_IDS` (loom-db's BYO-network seam, chant#898 — light
# tier has no from-scratch VPC->subnet-id handoff into loom-db yet, so a
# reference-existing network, even a fake one Floci accepts, is required).
#
# On-demand only — NOT part of the gating CI (`.github/workflows/ci.yml`).
# Needs Docker + network; run it yourself:
#
#   just gitlab-runtime-e2e        (or)   bash test/gitlab-runtime-e2e.sh
#
# Exit codes: 0 pass or cleanly skipped (no Docker / no sibling chant
# checkout); non-zero on a real failure.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT/test/gitlab-runtime-e2e"

skip() { echo "SKIP: $1"; exit 0; }

# ── Preconditions ────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || skip "docker not installed"
docker info >/dev/null 2>&1 || skip "docker daemon not reachable"

# `@intentius/chant`/`@intentius/chant-lexicon-gitlab` are dev-linked
# (`file:../chant/...`, see README.md) ahead of a published release — the
# sibling checkout must exist for `npm ci` to resolve them, on the host AND
# (via `--volume` below) inside the job containers.
CHANT_SIBLING="$(cd "$ROOT/../chant" 2>/dev/null && pwd || true)"
[ -n "$CHANT_SIBLING" ] || skip "no sibling ../chant checkout (see README.md's dev-link section)"

# gitlab-ci-local copies the git-tracked working tree into an isolated
# `/builds/<owner>/<repo>` path per job (not a bind mount of $ROOT), so the
# `file:../chant/...` symlinks `npm ci` creates inside a job resolve to a
# sibling that doesn't exist there unless mounted at the same relative path.
REMOTE_PATH="$(git -C "$ROOT" config --get remote.origin.url 2>/dev/null | sed -E 's#^(https://github\.com/|git@github\.com:)##; s#\.git$##')"
[ -n "$REMOTE_PATH" ] || REMOTE_PATH="INTENTIUS/loomster"
PROJECT_OWNER="${REMOTE_PATH%%/*}"
BUILDS_CHANT_PATH="/builds/$PROJECT_OWNER/chant"

# ── Floci (local AWS emulator) ───────────────────────────────────────────────
FLOCI_NAME="floci-e2e-$$"
LOG="$(mktemp)"
cleanup() {
  docker rm -f "$FLOCI_NAME" >/dev/null 2>&1 || true
  # Floci starts real backing containers for emulated services that need one
  # (RDS's `floci-rds-*` postgres, ECR's `floci-ecr-registry`, ...) — these
  # outlive the main Floci container's own `--rm` teardown, so sweep them too.
  docker ps -aq --filter "name=^floci-" 2>/dev/null | xargs -r docker rm -f >/dev/null 2>&1 || true
  rm -f "$FIXTURE/.gitlab-ci.yml" "$LOG"
}
trap cleanup EXIT

echo "=== Starting Floci ==="
docker run -d --rm -p 4566:4566 -v /var/run/docker.sock:/var/run/docker.sock \
  --name "$FLOCI_NAME" floci/floci:1.5.30 >/dev/null

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

# ── Bootstrap a throwaway VPC + subnets (loom-db's BYO-network input) ────────
echo "=== Bootstrapping VPC/subnets in Floci ==="
VPC_ID=$(aws --endpoint-url "$ENDPOINT" ec2 create-vpc --cidr-block 10.0.0.0/16 --query 'Vpc.VpcId' --output text)
PUB1=$(aws --endpoint-url "$ENDPOINT" ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.1.0/24 --availability-zone us-east-1a --query 'Subnet.SubnetId' --output text)
PUB2=$(aws --endpoint-url "$ENDPOINT" ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.2.0/24 --availability-zone us-east-1b --query 'Subnet.SubnetId' --output text)
PRIV1=$(aws --endpoint-url "$ENDPOINT" ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.11.0/24 --availability-zone us-east-1a --query 'Subnet.SubnetId' --output text)
PRIV2=$(aws --endpoint-url "$ENDPOINT" ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.12.0/24 --availability-zone us-east-1b --query 'Subnet.SubnetId' --output text)

# ── 1. Build the runtime-E2E pipeline → test/gitlab-runtime-e2e/.gitlab-ci.yml
echo "=== Building runtime-E2E pipeline (infra components only) ==="
(cd "$ROOT" && npx tsx "$FIXTURE/build.ts")
echo "--- generated .gitlab-ci.yml ---"
cat "$FIXTURE/.gitlab-ci.yml"
echo "--------------------------------"

# ── 2. Run it in Docker via gitlab-ci-local, against Floci ───────────────────
echo "=== Running pipeline (gitlab-ci-local) ==="
cd "$ROOT"
set +e
npx --yes gitlab-ci-local@4 \
  --file "test/gitlab-runtime-e2e/.gitlab-ci.yml" \
  --volume "$CHANT_SIBLING:$BUILDS_CHANT_PATH" \
  --extra-host "host.docker.internal:host-gateway" \
  --variable AWS_ENDPOINT_URL="http://host.docker.internal:4566" \
  --variable AWS_ACCESS_KEY_ID=test \
  --variable AWS_SECRET_ACCESS_KEY=test \
  --variable AWS_REGION=us-east-1 \
  --variable LOOM_VPC_ID="$VPC_ID" \
  --variable LOOM_PUBLIC_SUBNET_IDS="$PUB1,$PUB2" \
  --variable LOOM_PRIVATE_SUBNET_IDS="$PRIV1,$PRIV2" \
  --variable LOOM_DB_PASSWORD="e2e-test-password-1234" \
  --variable LOOM_TIER=light \
  --no-color \
  loom-db loom-cognito downstream-stub --needs 2>&1 | tee "$LOG"
STATUS=${PIPESTATUS[0]}
set -e

if [ "$STATUS" -ne 0 ]; then
  echo "FAIL: gitlab-ci-local reported a job failure"
  exit 1
fi

# ── 3. Assert the light tier actually deployed (real CFN stacks in Floci) ────
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

echo "PASS: chant-generated GitLab pipeline deployed the light tier's infra components against Floci"
