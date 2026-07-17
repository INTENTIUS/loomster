#!/usr/bin/env bash
set -euo pipefail

# Production-tier LIVE E2E against a real AWS account (#125).
#
# The Floci variant (production-floci-e2e.sh) proves the prod tiers *synthesize
# and deploy* against an emulator. This proves they apply to a real account: real
# ALB + RDS Proxy + PrivateLink + ACM/Route53 + Bedrock AgentCore, with a real
# CloudFormation apply, live resource assertions, and a gated teardown.
#
# Usage: production-live-e2e.sh [production|production-ha]   (default production)
#   AWS creds must already resolve (aws sts get-caller-identity).
#
# Required env:
#   LOOM_HOSTED_ZONE_ID   an EXISTING, delegated Route53 zone (e.g. loom.intentius.io).
#                         The ACM cert is provisioned and DNS-validated into it, so
#                         the zone must be delegated from the parent first. Run
#                         `LOOM_DOMAIN_NAME=<domain> npm run dns-setup` to create it
#                         and wait for delegation (see the operations/production-live-e2e
#                         runbook), or validation hangs.
#   LOOM_DOMAIN_NAME      the hostname served (e.g. loom.intentius.io).
#   LOOM_DB_PASSWORD      RDS master password.
#
# Optional env:
#   AWS_REGION            default us-east-2.
#   LOOM_ENV/LOOM_INSTANCE   naming segments; default prod / a.
#   LOOM_CPU_ARCHITECTURE    ARM64 (default here — matches an Apple-Silicon local
#                            image build) or X86_64. Must match the built images.
#   LOOM_VPC_ID + LOOM_PUBLIC_SUBNET_IDS + LOOM_PRIVATE_SUBNET_IDS
#                            reference an existing network instead of provisioning a
#                            throwaway one. When unset, this script builds a VPC with
#                            a NAT gateway (private-subnet Fargate tasks run with
#                            AssignPublicIp=DISABLED and must reach ECR).
#   LOOM_E2E_TEARDOWN=1      tear the stacks + throwaway VPC down at the end. Default
#                            leaves them up for inspection (real cost accrues).

TIER="${1:-production}"
case "$TIER" in production|production-ha) ;; *) echo "usage: $0 [production|production-ha]" >&2; exit 2 ;; esac

REGION="${AWS_REGION:-us-east-2}"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"
export LOOM_TIER="$TIER"
export LOOM_ENV="${LOOM_ENV:-prod}" LOOM_INSTANCE="${LOOM_INSTANCE:-a}"
export LOOM_CPU_ARCHITECTURE="${LOOM_CPU_ARCHITECTURE:-ARM64}"
export LOOM_ASSISTANT_CODE_PREFIX="${LOOM_ASSISTANT_CODE_PREFIX:-strands_agent/agent.zip}"
# Harness agent is opt-in (loomster#128): only a real, existing container image
# should be set here. Left UNSET by default so the agents wave deploys the assistant
# alone — no-code harnesses are created on demand through Loom's app, not here.
# (Set LOOM_HARNESS_AGENT_IMAGE_URI to a real image to exercise a BYO container agent.)

: "${LOOM_HOSTED_ZONE_ID:?set LOOM_HOSTED_ZONE_ID to a delegated Route53 zone}"
: "${LOOM_DOMAIN_NAME:?set LOOM_DOMAIN_NAME (e.g. loom.intentius.io)}"
: "${LOOM_DB_PASSWORD:?set LOOM_DB_PASSWORD}"

ACCT=$(aws sts get-caller-identity --query Account --output text)
export AWS_ACCOUNT_ID="$ACCT"
echo "=== LIVE $TIER on account $ACCT / $REGION, domain $LOOM_DOMAIN_NAME ==="
echo "    (real resources, real cost — teardown=${LOOM_E2E_TEARDOWN:-0})"

# --- DNS preflight: the zone must be delegated or the ACM cert never validates ----
NS_EXPECTED=$(aws route53 get-hosted-zone --id "$LOOM_HOSTED_ZONE_ID" --query "DelegationSet.NameServers[0]" --output text)
NS_LIVE=$(dig +short NS "$LOOM_DOMAIN_NAME" @8.8.8.8 | head -1 | sed 's/\.$//')
if [ -z "$NS_LIVE" ]; then
  echo "PREFLIGHT FAIL: $LOOM_DOMAIN_NAME has no public NS delegation yet." >&2
  echo "  Add an NS record for $LOOM_DOMAIN_NAME at your DNS provider pointing to:" >&2
  aws route53 get-hosted-zone --id "$LOOM_HOSTED_ZONE_ID" --query "DelegationSet.NameServers" --output text >&2
  exit 1
fi
echo "    DNS delegation live ($NS_LIVE); ACM validation will resolve."

MADE_VPC=0
if [ -z "${LOOM_VPC_ID:-}" ]; then
  echo "=== provisioning a throwaway BYO VPC (public + private + NAT) ==="
  VPC=$(aws ec2 create-vpc --cidr-block 10.42.0.0/16 --query Vpc.VpcId --output text)
  aws ec2 create-tags --resources "$VPC" --tags Key=Name,Value="loomster-live-e2e-$TIER"
  aws ec2 modify-vpc-attribute --vpc-id "$VPC" --enable-dns-hostnames
  IGW=$(aws ec2 create-internet-gateway --query InternetGateway.InternetGatewayId --output text)
  aws ec2 attach-internet-gateway --internet-gateway-id "$IGW" --vpc-id "$VPC"
  pub_a=$(aws ec2 create-subnet --vpc-id "$VPC" --cidr-block 10.42.1.0/24 --availability-zone "${REGION}a" --query Subnet.SubnetId --output text)
  pub_b=$(aws ec2 create-subnet --vpc-id "$VPC" --cidr-block 10.42.2.0/24 --availability-zone "${REGION}b" --query Subnet.SubnetId --output text)
  priv_a=$(aws ec2 create-subnet --vpc-id "$VPC" --cidr-block 10.42.11.0/24 --availability-zone "${REGION}a" --query Subnet.SubnetId --output text)
  priv_b=$(aws ec2 create-subnet --vpc-id "$VPC" --cidr-block 10.42.12.0/24 --availability-zone "${REGION}b" --query Subnet.SubnetId --output text)
  # public route table -> IGW
  rt_pub=$(aws ec2 create-route-table --vpc-id "$VPC" --query RouteTable.RouteTableId --output text)
  aws ec2 create-route --route-table-id "$rt_pub" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW" >/dev/null
  aws ec2 associate-route-table --route-table-id "$rt_pub" --subnet-id "$pub_a" >/dev/null
  aws ec2 associate-route-table --route-table-id "$rt_pub" --subnet-id "$pub_b" >/dev/null
  # one NAT gateway in pub_a -> private subnets egress (ECR pull for DISABLED tasks)
  eip=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
  nat=$(aws ec2 create-nat-gateway --subnet-id "$pub_a" --allocation-id "$eip" --query NatGateway.NatGatewayId --output text)
  echo "    waiting for NAT gateway $nat ..."
  aws ec2 wait nat-gateway-available --nat-gateway-ids "$nat"
  rt_priv=$(aws ec2 create-route-table --vpc-id "$VPC" --query RouteTable.RouteTableId --output text)
  aws ec2 create-route --route-table-id "$rt_priv" --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "$nat" >/dev/null
  aws ec2 associate-route-table --route-table-id "$rt_priv" --subnet-id "$priv_a" >/dev/null
  aws ec2 associate-route-table --route-table-id "$rt_priv" --subnet-id "$priv_b" >/dev/null
  export LOOM_VPC_ID="$VPC" LOOM_PUBLIC_SUBNET_IDS="$pub_a,$pub_b" LOOM_PRIVATE_SUBNET_IDS="$priv_a,$priv_b"
  MADE_VPC=1
  echo "    VPC=$VPC  public=$pub_a,$pub_b  private=$priv_a,$priv_b  nat=$nat"
fi

teardown() {
  [ "${LOOM_E2E_TEARDOWN:-0}" = "1" ] || { echo "leaving resources up (LOOM_E2E_TEARDOWN!=1)"; return; }
  echo "=== teardown ==="
  for s in downstream-stub loom-agents loom-backend loom-frontend loom-db loom-cognito shared-foundation; do
    aws cloudformation delete-stack --stack-name "$s" 2>/dev/null || true
  done
  for s in downstream-stub loom-agents loom-backend loom-frontend loom-db loom-cognito shared-foundation; do
    aws cloudformation wait stack-delete-complete --stack-name "$s" 2>/dev/null || true
  done
  if [ "$MADE_VPC" = "1" ]; then
    echo "  (throwaway VPC $LOOM_VPC_ID + NAT left for manual cleanup — NAT/EIP/subnets)"
  fi
}
trap teardown EXIT

echo "=== vendor + synth + deploy $TIER --all (live) ==="
npm run vendor >/tmp/live-e2e-vendor.log 2>&1
npm run synth  >/tmp/live-e2e-synth.log  2>&1 || { echo "SYNTH FAILED"; tail -20 /tmp/live-e2e-synth.log; exit 1; }
./node_modules/.bin/chant run --components all --env "$LOOM_ENV" 2>&1 | tee /tmp/live-e2e-deploy.log

echo "=== assert all 7 stacks CREATE/UPDATE_COMPLETE ==="
for stack in shared-foundation loom-cognito loom-db loom-frontend loom-backend loom-agents downstream-stub; do
  st=$(aws cloudformation describe-stacks --stack-name "$stack" --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo MISSING)
  case "$st" in CREATE_COMPLETE|UPDATE_COMPLETE) echo "    ok $stack ($st)";;
    *) echo "FAIL: $stack = $st"; exit 1;; esac
done

echo "=== assert tier-distinguishing resources (live) ==="
count_type() { aws cloudformation describe-stack-resources --stack-name "$1" --query "length(StackResources[?ResourceType=='$2'])" --output text 2>/dev/null || echo 0; }
assert_present() { [ "$(count_type "$1" "$2")" -ge "${3:-1}" ] || { echo "FAIL: $1 has fewer than ${3:-1} $2"; exit 1; }; echo "    ok $4"; }
assert_present loom-db AWS::RDS::DBProxy 1 "RDS Proxy"
assert_present shared-foundation AWS::EC2::VPCEndpointService 1 "PrivateLink VPC endpoint service"
assert_present shared-foundation AWS::CertificateManager::Certificate 1 "ACM certificate"
assert_present shared-foundation AWS::Route53::RecordSet 1 "Route53 alias record"
assert_present loom-backend AWS::ApplicationAutoScaling::ScalableTarget 1 "backend autoscaling"
assert_present loom-agents AWS::BedrockAgentCore::Runtime 1 "assistant agent runtime (code-config; harness is opt-in, loomster#128)"
if [ "$TIER" = "production-ha" ]; then
  assert_present loom-db AWS::SecretsManager::RotationSchedule 1 "credential rotation schedule"
fi

echo "=== assert the app is served on https://$LOOM_DOMAIN_NAME ==="
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$LOOM_DOMAIN_NAME/" 2>/dev/null || echo 000)
  [ "$code" = "200" ] && { echo "    ok app served (HTTP $code)"; break; }
  echo "    waiting for app ($code) ..."; sleep 20
done
[ "$code" = "200" ] || { echo "FAIL: app not served (last $code)"; exit 1; }

echo "=== authenticated screen validation ==="
if [ -n "${LOOM_API_TOKEN:-}" ]; then
  LOOM_API_BASE_URL="https://$LOOM_DOMAIN_NAME" npx tsx scripts/validate/run.ts || { echo "FAIL: screen validation"; exit 1; }
  echo "PASS: $TIER validated live on $ACCT/$REGION (7/7 stacks + tier resources + app served + authed screens)"
else
  echo "    SKIPPED: real Cognito enforces auth; set LOOM_API_TOKEN (M2M bearer) to validate screens."
  echo "PASS: $TIER deployed + served live on $ACCT/$REGION (7/7 stacks + tier resources + app served). Screen validation pending a token."
fi
