#!/usr/bin/env bash
# target: aws
# tier: light
# summary: Loom's own API deploys an agent on real AWS (the backend task role creates the AgentCore runtime), it reaches READY and answers one invoke
#
# The docs say a seeded Loom can deploy an agent from its Agents screen. On a
# real account that means Loom's backend, running as loomster's backend task
# role, calls AgentCore. No earlier live run proved it (#1): the READY agents
# there were deployed by CloudFormation with the operator's credentials.
#
# Plain:
#   1. deploy the light tier as the tutorial does (`chant run --components all`)
#      under the claims prefix (test/claims-aws.sh), with LOOM_ENV=claims;
#   2. mint a throwaway admin token (scripts/validate/get-user-token.sh; light
#      has no user client, so a temporary one is added to the pool and removed
#      afterwards) and seed the foundation profile through it;
#   3. POST /api/agents (source=deploy, the request ops/lib/seed.ts makes for
#      its demo agent), poll until READY or FAILED, expect READY;
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

# ── what it needs ───────────────────────────────────────────────────────────

for tool in aws jq curl docker python3; do
  command -v "$tool" >/dev/null 2>&1 || { say pending "needs $tool on PATH"; exit 0; }
done
[ -x node_modules/.bin/chant ] || { say pending "node_modules/.bin/chant is missing: run npm ci"; exit 0; }
docker info >/dev/null 2>&1 || { say pending "needs a running Docker daemon (the backend and frontend images build locally)"; exit 0; }
ACCT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
[ -n "$ACCT" ] || { say pending "AWS credentials do not resolve (aws sts get-caller-identity)"; exit 0; }
[ -n "${LOOM_CLAIMS_ACCOUNT_ID:-}" ] \
  || { say pending "set LOOM_CLAIMS_ACCOUNT_ID to the account to deploy into (the credentials resolve to $ACCT)"; exit 0; }
[ "$LOOM_CLAIMS_ACCOUNT_ID" = "$ACCT" ] \
  || { say pending "LOOM_CLAIMS_ACCOUNT_ID is $LOOM_CLAIMS_ACCOUNT_ID but the credentials resolve to $ACCT"; exit 0; }

# shellcheck source=test/claims-aws.sh
. "$ROOT/test/claims-aws.sh"
claims_aws_env || { say fail "no claims prefix (test/claims-aws.sh prefix)"; exit 0; }
export LOOM_TIER=light AWS_ACCOUNT_ID="$ACCT"
if [ -z "${LOOM_CPU_ARCHITECTURE:-}" ]; then
  case "$(uname -m)" in arm64|aarch64) LOOM_CPU_ARCHITECTURE=ARM64 ;; *) LOOM_CPU_ARCHITECTURE=X86_64 ;; esac
fi
export LOOM_CPU_ARCHITECTURE
# One password per claims instance, kept with the instance so a redeploy does
# not change it; the cleanup removes it with the instance.
pwfile="$CA_STATE/db-password"
if [ ! -s "$pwfile" ]; then
  mkdir -p "$CA_STATE"
  (umask 077; echo "Lc$(openssl rand -hex 16)" >"$pwfile")
fi
LOOM_DB_PASSWORD="$(cat "$pwfile")"
export LOOM_DB_PASSWORD

P="$CLAIMS_AWS_PREFIX"
stack_status() { aws cloudformation describe-stacks --stack-name "$P-$1" --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo MISSING; }
stack_output() { aws cloudformation describe-stacks --stack-name "$P-$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text 2>/dev/null || true; }
NEEDED="shared-foundation loom-cognito loom-db loom-backend"
# A status the stack will not leave without another deploy: a failed
# operation, or any rollback (in progress or done).
stack_failed() { case "$1" in *_FAILED|*ROLLBACK*) return 0 ;; *) return 1 ;; esac; }
# The earliest failed resource in the stack's events: "<logical id>: <reason>".
first_failure() { # stack
  aws cloudformation describe-stack-events --stack-name "$P-$1" \
    --query "reverse(StackEvents)[?ends_with(ResourceStatus, '_FAILED')] | [0].[LogicalResourceId, ResourceStatusReason]" \
    --output text 2>/dev/null | awk -F'\t' 'NF && $1 != "None" { print $1 ": " $2; exit }'
}
failure_detail() { # stack status
  local first
  first="$(first_failure "$1")"
  echo "$1 is $2${first:+ (first failed resource $first)}"
}
stacks_ready() {
  local s st
  for s in $NEEDED; do
    st="$(stack_status "$s")"
    case "$st" in
      CREATE_COMPLETE|UPDATE_COMPLETE) ;;
      *) if stack_failed "$st"; then failure_detail "$s" "$st"; else echo "$s is $st"; fi; return 1 ;;
    esac
  done
}

# ── exit: undo what this run added ──────────────────────────────────────────

AUTHCFG="$(mktemp "${TMPDIR:-/tmp}/loomster-claim-auth.XXXXXX")"
DEPLOY_PID="" TEMP_CLIENT="" POOL="" MINTED="" BREAK_ROLE="" AGENT_ID="" BASE=""
on_exit() {
  [ -z "$DEPLOY_PID" ] || kill "$DEPLOY_PID" 2>/dev/null || true
  if [ -n "$AGENT_ID" ] && [ -n "$BASE" ]; then
    curl -fsS -K "$AUTHCFG" -X DELETE "$BASE/api/agents/$AGENT_ID" >/dev/null 2>&1 || log "could not delete agent $AGENT_ID; the cleanup removes its runtime"
  fi
  if [ -n "$BREAK_ROLE" ]; then
    aws iam delete-role-policy --role-name "$BREAK_ROLE" --policy-name "$CLAIMS_BREAK_POLICY" >/dev/null 2>&1 \
      || log "could not remove $CLAIMS_BREAK_POLICY from $BREAK_ROLE; the cleanup removes it"
  fi
  if [ -n "$MINTED" ]; then
    LOOM_E2E_POOL_ID="$POOL" LOOM_E2E_CLIENT_ID="$TEMP_CLIENT" bash scripts/validate/get-user-token.sh --delete >/dev/null 2>&1 || true
  fi
  if [ -n "$TEMP_CLIENT" ]; then
    aws cognito-idp delete-user-pool-client --user-pool-id "$POOL" --client-id "$TEMP_CLIENT" >/dev/null 2>&1 || true
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

# ── 1. the light tier ───────────────────────────────────────────────────────

if [ -n "${BREAK:-}" ] && stacks_ready >/dev/null; then
  log "reusing the deployment under $P"
else
  log "deploying the light tier under $P to $ACCT/$AWS_REGION ($LOOM_CPU_ARCHITECTURE)"
  npm run vendor || stop "npm run vendor failed"
  # The agents wave (last) may fail where AgentCore is unavailable; this claim
  # needs only the waves through loom-backend, checked below.
  # A failed status a stack already had before this run (a rollback left by
  # an earlier attempt) is not this run failing. Once the stack's status has
  # moved off it, any failed status counts.
  for s in $NEEDED; do printf -v "BEFORE_${s//-/_}" '%s' "$(stack_status "$s")"; done
  ./node_modules/.bin/chant run --components all --env "$LOOM_ENV" &
  DEPLOY_PID=$!
  # Watch the stacks this claim needs while chant works: stop at the first one
  # that fails or rolls back instead of waiting for the rest of the run, and
  # print a line a minute so a granted run's watch sees progress.
  ticks=0
  while kill -0 "$DEPLOY_PID" 2>/dev/null; do
    line=""
    for s in $NEEDED; do
      st="$(stack_status "$s")"
      line="$line$s=$st "
      var="BEFORE_${s//-/_}"
      [ "$st" = "${!var}" ] || printf -v "$var" '%s' moved
      if stack_failed "$st" && [ "${!var}" = moved ]; then
        kill "$DEPLOY_PID" 2>/dev/null || true
        wait "$DEPLOY_PID" 2>/dev/null || true
        DEPLOY_PID=""
        stop "deploy: $(failure_detail "$s" "$st")"
      fi
    done
    [ $((ticks % 4)) -ne 0 ] || log "$line"
    ticks=$((ticks + 1))
    sleep 15
  done
  wait "$DEPLOY_PID" || log "chant run exited non-zero; checking the stacks this claim needs"
  DEPLOY_PID=""
fi
why="$(stacks_ready)" || stop "deploy: $why"

DOMAIN="$(stack_output shared-foundation oDomainName)"
[ -n "$DOMAIN" ] && [ "$DOMAIN" != None ] || stop "shared-foundation has no oDomainName output"
BASE="http://$DOMAIN"
code=000
for _ in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null || echo 000)"
  [ "$code" = 200 ] && break
  log "waiting for $BASE/health ($code)"
  sleep 15
done
[ "$code" = 200 ] || stop "the backend never answered $BASE/health (last $code)"

# ── 2. a token, and the foundation seed ─────────────────────────────────────

POOL="$(stack_output loom-cognito oCognitoUserPoolId)"
[ -n "$POOL" ] && [ "$POOL" != None ] || stop "loom-cognito has no oCognitoUserPoolId output"
TEMP_CLIENT="$(aws cognito-idp create-user-pool-client --user-pool-id "$POOL" --client-name "$P-claim-client" \
  --explicit-auth-flows ALLOW_ADMIN_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH --no-generate-secret \
  --query UserPoolClient.ClientId --output text)" || stop "could not add a temporary client to the pool $POOL"
MINTED=1
TOKEN="$(LOOM_E2E_POOL_ID="$POOL" LOOM_E2E_CLIENT_ID="$TEMP_CLIENT" bash scripts/validate/get-user-token.sh)" \
  || stop "scripts/validate/get-user-token.sh minted no token"
# Kept out of argv: curl reads the header from a config file.
printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" >"$AUTHCFG"

LOOM_API_BASE_URL="$BASE" LOOM_SEED_PROFILE=foundation LOOM_API_TOKEN="$TOKEN" \
  ./node_modules/.bin/chant run loom-seed --env "$LOOM_ENV" || stop "loom-seed (foundation) failed"
TOKEN=""

api() { curl -sS -K "$AUTHCFG" -H 'Content-Type: application/json' "$@"; }

# ── BREAK: deny the task role what an agent deploy and invoke need ──────────

if [ -n "${BREAK:-}" ]; then
  cluster="$(stack_output shared-foundation oEcsClusterName)"
  service="$(stack_output loom-backend oServiceName)"
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

MODEL="$(api "$BASE/api/agents/models" 2>/dev/null | jq -r '[.. | .model_id? // empty] | .[0] // empty' || true)"
[ -n "$MODEL" ] || stop "GET /api/agents/models listed no model"
AGENT_ROLE="$(stack_output shared-foundation oAgentRoleArn)"
[ -n "$AGENT_ROLE" ] && [ "$AGENT_ROLE" != None ] || stop "shared-foundation has no oAgentRoleArn output"
AGENT_NAME="loomster_claim_${CLAIMS_AWS_INSTANCE}_$([ -n "${BREAK:-}" ] && echo brk || echo run)_$(date +%s)"
body="$(jq -cn --arg n "$AGENT_NAME" --arg m "$MODEL" --arg r "$AGENT_ROLE" '{
  source: "deploy", name: $n, description: "loomster claim backend/deploy-agent",
  model_id: $m, role_arn: $r, protocol: "HTTP", network_mode: "PUBLIC",
  tags: {"loom:application": "loomster", "loom:group": "loomster", "loom:owner": "loomster"} }')"
resp="$(api -w '\n%{http_code}' -X POST "$BASE/api/agents" -d "$body" || true)"
code="$(tail -n 1 <<<"$resp")"
resp="$(sed '$d' <<<"$resp")"
case "$code" in 2??) ;; *) stop "POST /api/agents returned $code: $(head -c 300 <<<"$resp")" ;; esac
AGENT_ID="$(jq -r '.id // empty' <<<"$resp")"
[ -n "$AGENT_ID" ] || stop "POST /api/agents returned no id"
log "agent $AGENT_NAME (id $AGENT_ID, model $MODEL) deploying"

timeout_s="${LOOM_CLAIM_AGENT_TIMEOUT:-900}"
started="$(date +%s)" status="" agent=""
while :; do
  agent="$(api "$BASE/api/agents/$AGENT_ID" 2>/dev/null || true)"
  status="$(jq -r '.status // empty' <<<"$agent" 2>/dev/null || true)"
  log "status=$status deployment_status=$(jq -r '.deployment_status // empty' <<<"$agent" 2>/dev/null || true)"
  case "$status" in READY|FAILED) break ;; esac
  [ $(( $(date +%s) - started )) -lt "$timeout_s" ] || break
  sleep 15
done
elapsed=$(( $(date +%s) - started ))
if [ "$status" != READY ]; then
  reason="$(jq -r '[.deployment_status, .status_reason] | map(select(. != null and . != "")) | join(": ")' <<<"$agent" 2>/dev/null || true)"
  stop "agent $AGENT_NAME ended ${status:-without a status} after ${elapsed}s${reason:+ ($reason)}"
fi

# ── 4. invoke it once ───────────────────────────────────────────────────────

out="$(api -N --max-time 180 -X POST "$BASE/api/agents/$AGENT_ID/invoke" \
  -d '{"prompt":"Reply with the single word ready."}' 2>&1 || true)"
if grep -q '^event: error' <<<"$out"; then
  stop "invoke streamed an error: $(grep -A1 '^event: error' <<<"$out" | sed -n 's/^data: //p' | head -c 300)"
fi
grep -q '^event: chunk' <<<"$out" || stop "invoke streamed no chunk: $(head -c 300 <<<"$out")"

if [ -n "${BREAK:-}" ]; then
  say fail "with AgentCore, Bedrock, the registry and iam:PassRole denied to the task role, the agent still reached READY and answered"
else
  say pass "Loom deployed $AGENT_NAME to READY in ${elapsed}s on $ACCT/$AWS_REGION and it answered one invoke"
fi
