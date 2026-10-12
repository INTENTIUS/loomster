#!/usr/bin/env bash
# target: aws
# tier: light
# order: 50
# summary: the chant-managed assistant runtime (loom-agents, on AgentCore Runtime V2) reaches READY and answers an invoke on real AWS
#
# The docs say loom-agents deploys the Strands assistant as a code artifact on
# AgentCore, on platform version V2 like the agents Loom deploys (#7). On the
# shared claims deployment (claims_aws_ensure loom-agents, which brings
# loom-backend and its dependencies) this checks:
#   - the assistant runtime (loom-agents' oAssistantRuntimeArn) is READY;
#   - the deployed template asks for PlatformVersion V2, and AgentCore
#     accepted it (the stack is complete);
#   - one InvokeAgentRuntime on its DEFAULT endpoint streams a reply with no
#     error, as a client of the runtime would call it.
#
# BREAK=1 attaches an inline Deny on bedrock:InvokeModel* to the runtime's own
# execution role, so the agent can't reach its model, and expects the invoke to
# fail or stream an error. The Deny is removed on exit (the cleanup removes it
# too).
set -euo pipefail

name=agents/ready-and-invoke
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }
log() { echo "[$name] $*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

# shellcheck source=test/claims-aws.sh
. "$ROOT/test/claims-aws.sh"
why="$(claims_aws_needs)"
[ -z "$why" ] || { say pending "$why"; exit 0; }
claims_aws_light_env || { say fail "no claims prefix (test/claims-aws.sh prefix)"; exit 0; }

work="$(mktemp -d "${TMPDIR:-/tmp}/loomster-claim-assistant.XXXXXX")"
BREAK_ROLE=""
on_exit() {
  [ -z "$BREAK_ROLE" ] || aws iam delete-role-policy --role-name "$BREAK_ROLE" --policy-name "$CLAIMS_BREAK_POLICY" >/dev/null 2>&1 \
    || log "could not remove $CLAIMS_BREAK_POLICY from $BREAK_ROLE; the cleanup removes it"
  rm -rf "$work"
}
trap on_exit EXIT

BROKEN=""
stop() { # detail
  if [ -n "${BREAK:-}" ] && [ -n "$BROKEN" ]; then say caught "with bedrock:InvokeModel* denied to the runtime's role: $1"
  elif [ -n "${BREAK:-}" ]; then say fail "BREAK could not be applied: $1"
  else say fail "$1"; fi
  exit 0
}

log "making sure loom-agents and what it needs are up under $CLAIMS_AWS_PREFIX"
why="$(claims_aws_ensure loom-agents)" || stop "deploy: $why"
ARN="$(claims_aws_output loom-agents oAssistantRuntimeArn)"
[ -n "$ARN" ] || stop "loom-agents has no oAssistantRuntimeArn output"
ID="${ARN##*/}"

problems=""
note() { problems="$problems $*;"; }

# READY, waiting a while for a runtime that is still settling.
status=""
for _ in $(seq 1 40); do
  rt="$(aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$ID" --output json 2>/dev/null || true)"
  status="$(jq -r '.status // empty' <<<"$rt")"
  case "$status" in READY|*FAILED*) break ;; esac
  log "assistant runtime $ID is ${status:-unknown}"
  sleep 15
done
[ "$status" = READY ] || stop "the assistant runtime $ID is ${status:-unknown}, not READY"
reported="$(jq -r '.platformVersion // empty' <<<"$rt")"
asked="$(aws cloudformation get-template --stack-name "$CLAIMS_AWS_PREFIX-loom-agents" --query TemplateBody --output json 2>/dev/null \
  | jq -r '[(if type == "string" then fromjson else . end).Resources[] | select(.Type == "AWS::BedrockAgentCore::Runtime") | .Properties.PlatformVersion] | unique | join(",")' 2>/dev/null || true)"
[ "$asked" = V2 ] || note "the deployed loom-agents template asks for platform version '${asked:-none}', not V2"
[ -z "$reported" ] || [ "$reported" = V2 ] || note "AgentCore reports platform version $reported for $ID"

if [ -n "${BREAK:-}" ]; then
  role_arn="$(jq -r '.roleArn // empty' <<<"$rt")"
  [ -n "$role_arn" ] || stop "get-agent-runtime gave no roleArn for $ID"
  BREAK_ROLE="${role_arn##*/}"
  aws iam put-role-policy --role-name "$BREAK_ROLE" --policy-name "$CLAIMS_BREAK_POLICY" --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Deny", "Resource": "*",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ConverseStream"] }]
  }' || { BREAK_ROLE=""; stop "could not attach the deny to $role_arn"; }
  BROKEN=1
  log "denied bedrock:InvokeModel* to $BREAK_ROLE; waiting 30 s for IAM to apply it"
  sleep 30
fi

# One invoke, as a client calls the runtime (a session id of 33+ characters).
session="loomster-claim-$CLAIMS_AWS_INSTANCE-$(date +%s)-$(openssl rand -hex 8)"
if ! aws bedrock-agentcore invoke-agent-runtime --agent-runtime-arn "$ARN" --qualifier DEFAULT \
    --runtime-session-id "$session" --content-type application/json --accept text/event-stream \
    --cli-binary-format raw-in-base64-out --payload '{"prompt":"Reply with the single word ready."}' \
    "$work/reply" >"$work/meta.json" 2>"$work/err.log"; then
  stop "InvokeAgentRuntime failed: $(head -c 300 "$work/err.log")"
fi
reply="$(cat "$work/reply" 2>/dev/null || true)"
if grep -qiE 'AccessDenied|not authorized|"error"|event: error|ValidationException|Throttling' <<<"$reply"; then
  stop "the invoke streamed an error: $(grep -m1 -iE 'AccessDenied|not authorized|error|Exception' <<<"$reply" | head -c 300)"
fi
[ -n "$(tr -d '[:space:]' <<<"$reply")" ] || stop "the invoke returned an empty reply"

if [ -n "${BREAK:-}" ]; then
  say fail "with bedrock:InvokeModel* denied to the runtime's role, the assistant still answered: $(head -c 160 <<<"$reply")"; exit 0
fi
if [ -n "$problems" ]; then problems="${problems# }"; say fail "${problems%;}"
else say pass "the assistant runtime $ID is READY on platform version V2 and answered one invoke ($(wc -c <<<"$reply" | tr -d ' ') bytes, no error)"; fi
