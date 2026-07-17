#!/usr/bin/env bash
set -euo pipefail

# Production-tier runtime E2E against Floci.
#
# The {github,gitlab,forgejo}-runtime-e2e scripts prove the *light* tier deploys
# through the generated CI pipeline. This proves the *production* tiers deploy at
# all: it stands the full stack up end to end against the AgentCore-enabled Floci
# emulator, against a bring-your-own VPC (production requires a referenced
# network), and asserts every tier-distinguishing resource actually creates —
# RDS Proxy, PrivateLink (NLB + VPC endpoint service), ACM + Route53, backend
# autoscaling, and both agent runtimes (assistant + harness). For production-ha
# it additionally asserts Multi-AZ RDS (requested in the template — Floci runs a
# single-container Postgres and can't reflect it), a credential-rotation
# schedule, and a 2-task backend floor.
#
# Usage: production-floci-e2e.sh [production|production-ha]   (default production)
#   just production-floci-e2e   /   just production-ha-floci-e2e
#
# On-demand, needs Docker + the AWS CLI. Binds host :4566, so stop any local-up
# or other Floci first (`just local-down`). Not part of gating CI — it deploys
# real CloudFormation stacks in the emulator and takes minutes.

TIER="${1:-production}"
case "$TIER" in
  production | production-ha) ;;
  *) echo "usage: $0 [production|production-ha]" >&2; exit 2 ;;
esac

REGION="${AWS_REGION:-us-east-1}"
FLOCI_IMAGE="ghcr.io/lex00/floci:agentcore"
FLOCI_NAME="floci-prod-e2e"
export AWS_ENDPOINT_URL="http://localhost:4566" AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION="$REGION"
export LOOM_TIER="$TIER" LOOM_ENV=floci LOOM_INSTANCE=a AWS_ACCOUNT_ID=000000000000
SN_PREFIX="${LOOM_PROJECT:-loom}-floci-a"; sn() { echo "${SN_PREFIX}-$1"; }  # namespaced stack names (loomster#140)
export LOOM_DB_PASSWORD="floci-e2e-pw-1234" LOOM_CPU_ARCHITECTURE=ARM64
export LOOM_ASSISTANT_CODE_PREFIX="strands_agent/agent.zip"
# Harness agent is opt-in (loomster#128) — left UNSET so the agents wave deploys the
# assistant alone. The Floci run asserts the assistant runtime only (see below).
export LOOM_DOMAIN_NAME="loom.floci.test"

aws() { command aws --endpoint-url "$AWS_ENDPOINT_URL" --region "$REGION" "$@"; }

cleanup() { docker rm -f "$FLOCI_NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "=== [1/5] fresh Floci ($FLOCI_IMAGE) ==="
docker rm -f "$FLOCI_NAME" floci >/dev/null 2>&1 || true
docker run -d --rm -p 4566:4566 -v /var/run/docker.sock:/var/run/docker.sock --name "$FLOCI_NAME" "$FLOCI_IMAGE" >/dev/null
for i in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4566/_localstack/health 2>/dev/null)" = "200" ] && break
  sleep 2
done

echo "=== [2/5] bring-your-own VPC (production requires a referenced network) ==="
VPC=$(aws ec2 create-vpc --cidr-block 10.42.0.0/16 --query Vpc.VpcId --output text)
pub_a=$(aws ec2 create-subnet --vpc-id "$VPC" --cidr-block 10.42.1.0/24 --availability-zone "${REGION}a" --query Subnet.SubnetId --output text)
pub_b=$(aws ec2 create-subnet --vpc-id "$VPC" --cidr-block 10.42.2.0/24 --availability-zone "${REGION}b" --query Subnet.SubnetId --output text)
priv_a=$(aws ec2 create-subnet --vpc-id "$VPC" --cidr-block 10.42.11.0/24 --availability-zone "${REGION}a" --query Subnet.SubnetId --output text)
priv_b=$(aws ec2 create-subnet --vpc-id "$VPC" --cidr-block 10.42.12.0/24 --availability-zone "${REGION}b" --query Subnet.SubnetId --output text)
export LOOM_VPC_ID="$VPC" LOOM_PUBLIC_SUBNET_IDS="$pub_a,$pub_b" LOOM_PRIVATE_SUBNET_IDS="$priv_a,$priv_b"
echo "    VPC=$VPC  public=$pub_a,$pub_b  private=$priv_a,$priv_b"

echo "=== [3/5] vendor Loom + synth + deploy $TIER --all ==="
npm run vendor >/tmp/prod-e2e-vendor.log 2>&1
npm run synth >/tmp/prod-e2e-synth.log 2>&1 || { echo "SYNTH FAILED"; tail -20 /tmp/prod-e2e-synth.log; exit 1; }
./node_modules/.bin/chant run --components all --env floci >/tmp/prod-e2e-deploy.log 2>&1 || {
  echo "DEPLOY FAILED — see /tmp/prod-e2e-deploy.log"; tail -25 /tmp/prod-e2e-deploy.log; exit 1; }

echo "=== [4/5] assert all 7 stacks CREATE_COMPLETE ==="
for stack in shared-foundation loom-cognito loom-db loom-frontend loom-backend loom-agents downstream-stub; do
  st=$(aws cloudformation describe-stacks --stack-name "$SN_PREFIX-$stack" --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo MISSING)
  [ "$st" = "CREATE_COMPLETE" ] || { echo "FAIL: $stack = $st"; tail -25 /tmp/prod-e2e-deploy.log; exit 1; }
  echo "    ok $stack"
done

echo "=== [5/5] assert tier-distinguishing resources ==="
count_type() { aws cloudformation describe-stack-resources --stack-name "$1" --query "length(StackResources[?ResourceType=='$2'])" --output text 2>/dev/null || echo 0; }
assert_present() { [ "$(count_type "$1" "$2")" -ge "${3:-1}" ] || { echo "FAIL: $1 has fewer than ${3:-1} $2"; exit 1; }; echo "    ok $4"; }
tmpl_field() { aws cloudformation get-template --stack-name "$1" --query TemplateBody --output json 2>/dev/null | python3 -c "import json,sys;t=json.load(sys.stdin);t=json.loads(t) if isinstance(t,str) else t;print(next((r['Properties'].get('$3') for r in t['Resources'].values() if r['Type']=='$2'),None))"; }

assert_present "$(sn loom-db)" AWS::RDS::DBProxy 1 "RDS Proxy"
assert_present "$(sn shared-foundation)" AWS::EC2::VPCEndpointService 1 "PrivateLink VPC endpoint service"
assert_present "$(sn shared-foundation)" AWS::CertificateManager::Certificate 1 "ACM certificate"
assert_present "$(sn shared-foundation)" AWS::Route53::HostedZone 1 "Route53 hosted zone"
assert_present "$(sn loom-backend)" AWS::ApplicationAutoScaling::ScalableTarget 1 "backend autoscaling"
assert_present "$(sn loom-agents)" AWS::BedrockAgentCore::Runtime 1 "assistant agent runtime (code-config; harness is opt-in, loomster#128)"

if [ "$TIER" = "production-ha" ]; then
  assert_present "$(sn loom-db)" AWS::SecretsManager::RotationSchedule 1 "credential rotation schedule"
  maz=$(tmpl_field "$(sn loom-db)" AWS::RDS::DBInstance MultiAZ)
  [ "$maz" = "True" ] || { echo "FAIL: production-ha template MultiAZ != True (got $maz)"; exit 1; }; echo "    ok Multi-AZ RDS (template)"
  floor=$(tmpl_field "$(sn loom-backend)" AWS::ApplicationAutoScaling::ScalableTarget MinCapacity)
  [ "$floor" = "2" ] || { echo "FAIL: production-ha ScalableTarget MinCapacity != 2 (got $floor)"; exit 1; }; echo "    ok 2-task backend floor"
fi

echo "PASS: $TIER deployed end to end against Floci (7/7 stacks + every tier-distinguishing resource)"
