#!/usr/bin/env bash
# target: aws
# tier: light
# order: 40
# summary: Loom's own API deploys an agent on real AWS (the backend task role creates the AgentCore runtime), it reaches READY and answers one invoke
#
# The docs say a seeded Loom can deploy an agent from its Agents screen. On a
# real account that means Loom's backend, running as loomster's backend task
# role, calls AgentCore. No earlier live run proved it (#1): the READY agents
# there were deployed by CloudFormation with the operator's credentials.
#
# Plain:
#   1. make sure the light tier's shared-foundation, loom-cognito, loom-db and
#      loom-backend are up under the claims prefix (claims_aws_ensure in
#      test/claims-aws.sh: deployed once per run and shared with the other
#      aws claims);
#   2. mint a throwaway admin token through the deployment's user client
#      (claims_aws_token) and seed the foundation profile through it;
#   3. POST /api/agents (source=deploy, the request ops/lib/seed.ts makes for
#      its demo agent) with shared-foundation's agent role, poll until READY
#      or FAILED, expect READY;
#   4. invoke it once through POST /api/agents/<id>/invoke and expect a chunk
#      and no error event; then delete the agent.
# BREAK=1 reuses the deployment and strips the task role's runtime grants (#1,
# fixed in #54) in effect: it attaches an inline Deny on the AgentCore,
# Bedrock, registry and iam:PassRole/CreateRole/CreateServiceLinkedRole
# actions those statements allow. An explicit Deny overrides them without
# editing the CloudFormation-managed policies, so nothing drifts, and the
# claim removes it on exit (the cleanup does too). It expects the agent deploy
# or the invoke to fail.
#
# Needs: aws, jq, curl, docker (running), python3, node_modules (npm ci), AWS
# credentials, and LOOM_CLAIMS_ACCOUNT_ID naming the account they resolve to,
# so a claim never deploys into an account by accident. AWS_REGION (default
# us-east-1) needs Bedrock AgentCore and model access. Prints pending when any
# of that is missing.
#
# Optional: LOOM_CPU_ARCHITECTURE (default from this host: ARM64 on arm64),
# LOOM_CLAIM_AGENT_TIMEOUT seconds to wait for READY (900).
set -euo pipefail

name=backend/deploy-agent
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }
log() { echo "[$name] $*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

# shellcheck source=test/claims-aws.sh
. "$ROOT/test/claims-aws.sh"
why="$(claims_aws_needs)"
[ -z "$why" ] || { say pending "$why"; exit 0; }
claims_aws_light_env || { say fail "no claims prefix (test/claims-aws.sh prefix)"; exit 0; }

# ── exit: undo what this run added ──────────────────────────────────────────

AUTHCFG="$(mktemp "${TMPDIR:-/tmp}/loomster-claim-auth.XXXXXX")"
BREAK_ROLE="" AGENT_ID="" BASE=""
on_exit() {
  if [ -n "$AGENT_ID" ] && [ -n "$BASE" ]; then
    curl -fsS -K "$AUTHCFG" -X DELETE "$BASE/api/agents/$AGENT_ID?cleanup_aws=true" >/dev/null 2>&1 \
      || log "could not delete agent $AGENT_ID; the cleanup removes its runtime"
  fi
  if [ -n "$BREAK_ROLE" ]; then
    aws iam delete-role-policy --role-name "$BREAK_ROLE" --policy-name "$CLAIMS_BREAK_POLICY" >/dev/null 2>&1 \
      || log "could not remove $CLAIMS_BREAK_POLICY from $BREAK_ROLE; the cleanup removes it"
  fi
  rm -f "$AUTHCFG"
}
trap on_exit EXIT

# Every failure ends the run here: before the BREAK is in place the claim
# cannot say anything (fail); after it, a failure is what BREAK expects.
BROKEN=""
stop() { # detail
  if [ -n "${BREAK:-}" ] && [ -n "$BROKEN" ]; then say caught "with the task role denied: $1"
  elif [ -n "${BREAK:-}" ]; then say fail "BREAK could not be applied: $1"
  else say fail "$1"; fi
  exit 0
}

# ── 1. the light tier, shared with the run's other aws claims ───────────────

log "making sure loom-backend and what it needs are up under $CLAIMS_AWS_PREFIX ($AWS_REGION, $LOOM_CPU_ARCHITECTURE)"
why="$(claims_aws_ensure loom-backend)" || stop "deploy: $why"
BASE="$(claims_aws_base)" || stop "the backend never answered /health"

# ── 2. a token, and the foundation seed ─────────────────────────────────────

TOKEN="$(claims_aws_token)" || stop "scripts/validate/get-user-token.sh minted no token through the user client"
# Kept out of argv: curl reads the header from a config file.
printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" >"$AUTHCFG"
claims_aws_seed "$BASE" "$TOKEN" foundation || stop "loom-seed (foundation) failed"
TOKEN=""

# ── BREAK: deny the task role what an agent deploy and invoke need ──────────

if [ -n "${BREAK:-}" ]; then
  cluster="$(claims_aws_output shared-foundation oEcsClusterName)"
  service="$(claims_aws_output loom-backend oServiceName)"
  taskdef="$(aws ecs describe-services --cluster "$cluster" --services "$service" --query 'services[0].taskDefinition' --output text 2>/dev/null || true)"
  role_arn="$(aws ecs describe-task-definition --task-definition "$taskdef" --query 'taskDefinition.taskRoleArn' --output text 2>/dev/null || true)"
  [ -n "$role_arn" ] && [ "$role_arn" != None ] || stop "no task role on the backend service ($cluster/$service)"
  BREAK_ROLE="${role_arn##*/}"
  aws iam put-role-policy --role-name "$BREAK_ROLE" --policy-name "$CLAIMS_BREAK_POLICY" --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Deny", "Resource": "*",
      "Action": ["bedrock-agentcore:*", "bedrock-agentcore-control:*", "bedrock:*", "agent-registry:*",
                 "iam:PassRole", "iam:CreateRole", "iam:CreateServiceLinkedRole"] }]
  }' || { BREAK_ROLE=""; stop "could not attach the deny to $role_arn"; }
  BROKEN=1
  log "denied AgentCore, Bedrock, the registry and iam:PassRole to $BREAK_ROLE; waiting 30 s for IAM to apply it"
  sleep 30
fi

# ── 3. deploy an agent through Loom ─────────────────────────────────────────

AGENT_ROLE="$(claims_aws_output shared-foundation oAgentRoleArn)"
[ -n "$AGENT_ROLE" ] || stop "shared-foundation has no oAgentRoleArn output"
AGENT_NAME="loomster_claim_${CLAIMS_AWS_INSTANCE}_$([ -n "${BREAK:-}" ] && echo brk || echo run)_$(date +%s)"
AGENT_ID="$(claims_aws_agent_deploy "$BASE" "$AUTHCFG" "$AGENT_NAME" "$AGENT_ROLE" "loomster claim backend/deploy-agent")" \
  || { why="$AGENT_ID"; AGENT_ID=""; stop "$why"; }
result="$(claims_aws_agent_wait "$BASE" "$AUTHCFG" "$AGENT_ID")" || {
  read -r status elapsed reason <<<"$result"
  stop "agent $AGENT_NAME ended $status after ${elapsed}s${reason:+ ($reason)}"
}
read -r _ elapsed _ <<<"$result"

# ── 4. invoke it once ───────────────────────────────────────────────────────

why="$(claims_aws_agent_invoke "$BASE" "$AUTHCFG" "$AGENT_ID")" || stop "$why"

if [ -n "${BREAK:-}" ]; then
  say fail "with AgentCore, Bedrock, the registry and iam:PassRole denied to the task role, the agent still reached READY and answered"
else
  say pass "Loom deployed $AGENT_NAME to READY in ${elapsed}s on $AWS_REGION and it answered one invoke"
fi
