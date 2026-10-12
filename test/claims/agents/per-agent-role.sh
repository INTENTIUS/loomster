#!/usr/bin/env bash
# target: aws
# tier: light
# order: 60
# summary: just agent-role creates one agent's execution role stack and registers it in Loom, and an agent Loom deploys with that role reaches READY and answers
#
# The docs say Loom v1.9.0 never creates IAM itself, so each agent deploys with
# a role that exists and is registered under Security > Roles, and that
# `just agent-role <agent> <group>` (the loom-agent-role Op, #2) makes one
# the way Loom's role.yaml does. On the shared claims deployment
# (claims_aws_ensure loom-backend) this:
#   1. runs the Op for agent loomster_claim_<instance>_role in group loomster,
#      with Loom's API and an admin token, so it deploys
#      <prefix>-agent-role-<agent> and registers the role in Loom;
#   2. checks GET /api/security/roles lists the role's ARN with loom:group set;
#   3. deploys that agent through POST /api/agents with the role, expects
#      READY, and invokes it once (the same steps as backend/deploy-agent).
#
# BREAK=1 attaches an inline Deny on bedrock:InvokeModel* and Converse* to the
# per-agent role after it is registered, and expects the agent's deploy or
# its invoke to fail. The Deny is removed on exit; the role stack itself goes
# with the cleanup (it carries the claims prefix).
set -euo pipefail

name=agents/per-agent-role
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }
log() { echo "[$name] $*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

# shellcheck source=test/claims-aws.sh
. "$ROOT/test/claims-aws.sh"
why="$(claims_aws_needs)"
[ -z "$why" ] || { say pending "$why"; exit 0; }
claims_aws_light_env || { say fail "no claims prefix (test/claims-aws.sh prefix)"; exit 0; }

AGENT="loomster_claim_${CLAIMS_AWS_INSTANCE}_role"
GROUP=loomster
STACK="$CLAIMS_AWS_PREFIX-agent-role-${AGENT//_/-}"
AUTHCFG="$(mktemp "${TMPDIR:-/tmp}/loomster-claim-auth.XXXXXX")"
BREAK_ROLE="" AGENT_ID="" BASE=""
on_exit() {
  if [ -n "$AGENT_ID" ] && [ -n "$BASE" ]; then
    curl -fsS -K "$AUTHCFG" -X DELETE "$BASE/api/agents/$AGENT_ID?cleanup_aws=true" >/dev/null 2>&1 \
      || log "could not delete agent $AGENT_ID; the cleanup removes its runtime"
  fi
  [ -z "$BREAK_ROLE" ] || aws iam delete-role-policy --role-name "$BREAK_ROLE" --policy-name "$CLAIMS_BREAK_POLICY" >/dev/null 2>&1 \
    || log "could not remove $CLAIMS_BREAK_POLICY from $BREAK_ROLE; the cleanup removes it"
  rm -f "$AUTHCFG"
}
trap on_exit EXIT

BROKEN=""
stop() { # detail
  if [ -n "${BREAK:-}" ] && [ -n "$BROKEN" ]; then say caught "with bedrock model calls denied to the per-agent role: $1"
  elif [ -n "${BREAK:-}" ]; then say fail "BREAK could not be applied: $1"
  else say fail "$1"; fi
  exit 0
}

log "making sure loom-backend and what it needs are up under $CLAIMS_AWS_PREFIX"
why="$(claims_aws_ensure loom-backend)" || stop "deploy: $why"
BASE="$(claims_aws_base)" || stop "the backend never answered /health"
TOKEN="$(claims_aws_token)" || stop "scripts/validate/get-user-token.sh minted no token through the user client"
printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" >"$AUTHCFG"

# 1. The Op, as `just agent-role $AGENT $GROUP` runs it.
LOOM_AGENT_ROLE_AGENT="$AGENT" LOOM_AGENT_ROLE_GROUP="$GROUP" LOOM_API_BASE_URL="$BASE" LOOM_API_TOKEN="$TOKEN" \
  claims_heartbeat "loom-agent-role" claims_chant ./node_modules/.bin/chant run loom-agent-role \
  || stop "chant run loom-agent-role failed"
TOKEN=""
ROLE_ARN="$(aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='oAgentRoleArn'].OutputValue | [0]" --output text 2>/dev/null || true)"
[ -n "$ROLE_ARN" ] && [ "$ROLE_ARN" != None ] || stop "the Op left no $STACK stack with an oAgentRoleArn output"

# 2. Registered in Loom, in the group.
registered="$(ca_api "$AUTHCFG" "$BASE/api/security/roles" | jq -c --arg a "$ROLE_ARN" '[.[] | select(.role_arn == $a)][0] // empty' 2>/dev/null || true)"
[ -n "$registered" ] || stop "GET /api/security/roles does not list $ROLE_ARN"
tagged="$(jq -r '(.tags // {})["loom:group"] // empty' <<<"$registered")"
[ "$tagged" = "$GROUP" ] || stop "Loom lists $ROLE_ARN with loom:group '${tagged:-none}', not $GROUP"

if [ -n "${BREAK:-}" ]; then
  BREAK_ROLE="${ROLE_ARN##*/}"
  aws iam put-role-policy --role-name "$BREAK_ROLE" --policy-name "$CLAIMS_BREAK_POLICY" --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Deny", "Resource": "*",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ConverseStream"] }]
  }' || { BREAK_ROLE=""; stop "could not attach the deny to $ROLE_ARN"; }
  BROKEN=1
  log "denied bedrock model calls to $BREAK_ROLE; waiting 30 s for IAM to apply it"
  sleep 30
fi

# 3. An agent on that role, through Loom.
NAME="${AGENT}_$([ -n "${BREAK:-}" ] && echo brk || echo run)_$(date +%s)"
AGENT_ID="$(claims_aws_agent_deploy "$BASE" "$AUTHCFG" "$NAME" "$ROLE_ARN" "loomster claim agents/per-agent-role")" \
  || { why="$AGENT_ID"; AGENT_ID=""; stop "$why"; }
result="$(claims_aws_agent_wait "$BASE" "$AUTHCFG" "$AGENT_ID")" || {
  read -r status elapsed reason <<<"$result"
  stop "agent $NAME ended $status after ${elapsed}s${reason:+ ($reason)}"
}
read -r _ elapsed _ <<<"$result"
why="$(claims_aws_agent_invoke "$BASE" "$AUTHCFG" "$AGENT_ID")" || stop "$why"

if [ -n "${BREAK:-}" ]; then
  say fail "with bedrock model calls denied to the per-agent role, the agent still reached READY and answered"
else
  say pass "loom-agent-role made $STACK and registered it in Loom (loom:group $GROUP); an agent on it reached READY in ${elapsed}s and answered one invoke"
fi
