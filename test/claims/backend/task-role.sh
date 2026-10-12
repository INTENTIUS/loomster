#!/usr/bin/env bash
# target: static
#
# Claim backend/task-role (loomster#1): the loom-backend ECS task role allows
# every AWS action Loom's backend calls at runtime, per Loom v1.9.0's own
# backend/iac/ecs.yaml TaskRole (plus ListAgentRuntimeVersions/Endpoints, #19).
#
# How: synthesize the loom-backend template, pull out the task role's inline
# policies, resolve the CloudFormation intrinsics against representative
# values, and run `aws iam simulate-custom-policy` (read-only, no resources
# touched) for each action against a representative resource ARN shaped the
# way Loom's backend names things (role/<agent-role>, secret:loom/...,
# delivery-source:loom-..., runtime/..., registry/...).
#
# verdict=pass   every action is allowed
# verdict=fail   at least one action is denied (detail lists them)
# BREAK=1        drops the statement granting iam:PassRole (or the first
#                statement, if none does) before simulating; that action must
#                then come back denied (verdict=caught). If it is still
#                allowed, the claim cannot detect a missing grant and
#                reports verdict=fail.
#
# Needs: node, npx (repo deps installed), jq, aws CLI with credentials that
# may call iam:SimulateCustomPolicy. Prints exactly one CLAIM line on stdout.

set -uo pipefail

CLAIM=backend/task-role
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ACCOUNT="${CLAIM_ACCOUNT_ID:-354867293429}"
REGION="${CLAIM_REGION:-us-east-1}"
BREAK="${BREAK:-0}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/claim-task-role.XXXXXX")"
[ -n "${CLAIM_KEEP:-}" ] || trap 'rm -rf "$WORK"' EXIT

emit() { # verdict detail
  echo "CLAIM claim=$CLAIM verdict=$1${2:+ $2}"
  if [ "$1" = fail ]; then exit 1; fi
  exit 0
}

# ── 1. synthesize ──────────────────────────────────────────────────────────
TEMPLATE="$WORK/loom-backend.template.json"
if ! (cd "$ROOT" && LOOM_TIER="${LOOM_TIER:-production}" npx chant build src/loom-backend --lexicon aws -o "$TEMPLATE") >"$WORK/synth.log" 2>&1; then
  emit fail "synth-failed log=$(tail -1 "$WORK/synth.log" | tr ' ' '_')"
fi

# ── 2. extract + resolve the task role's inline policies ───────────────────
# Representative values for the stack's Parameters. Only their shape matters:
# each one is the ARN/name a real deploy would hand the stack.
ACCOUNT="$ACCOUNT" REGION="$REGION" BREAK="$BREAK" node - "$TEMPLATE" "$WORK/policies.json" <<'NODE' 2>"$WORK/extract.err" || emit fail "extract-failed $(grep -m1 Error "$WORK/extract.err" | tr ' ' '_')"
const fs = require("fs");
const [tplPath, outPath] = process.argv.slice(2);
const { ACCOUNT, REGION, BREAK } = process.env;
const t = JSON.parse(fs.readFileSync(tplPath, "utf8"));
const vals = {
  "AWS::Partition": "aws",
  "AWS::Region": REGION,
  "AWS::AccountId": ACCOUNT,
  "AWS::StackName": "loom-dev-a-loom-backend",
  pArtifactBucket: "loom-dev-a-shared-foundation-artifacts-abc123",
  pDatabaseSecretArn: `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:loom-dev-a-loom-db-url-AbCdEf`,
  pSecretsKmsKeyArn: `arn:aws:kms:${REGION}:${ACCOUNT}:key/11111111-2222-3333-4444-555555555555`,
  pEcrKmsKeyArn: `arn:aws:kms:${REGION}:${ACCOUNT}:key/66666666-7777-8888-9999-000000000000`,
  pCognitoUserPoolId: `${REGION}_Example1`,
};
for (const [k, p] of Object.entries(t.Parameters ?? {})) if (!(k in vals) && p.Default !== undefined) vals[k] = String(p.Default);
const getAtt = (r, a) => `arn:aws:cloudformation:${REGION}:${ACCOUNT}:resolved/${r}.${a}`;
const resolve = (v) => {
  if (Array.isArray(v)) return v.map(resolve);
  if (v && typeof v === "object") {
    if ("Ref" in v) { if (!(v.Ref in vals)) throw new Error(`unresolved Ref ${v.Ref}`); return vals[v.Ref]; }
    if ("Fn::GetAtt" in v) return getAtt(...v["Fn::GetAtt"]);
    if ("Fn::Sub" in v) {
      const s = Array.isArray(v["Fn::Sub"]) ? v["Fn::Sub"][0] : v["Fn::Sub"];
      return s.replace(/\$\{([^}]+)\}/g, (_, k) => {
        if (k in vals) return vals[k];
        if (k.includes(".")) { const [r, a] = k.split("."); return getAtt(r, a); }
        throw new Error(`unresolved Sub ${k}`);
      });
    }
    if ("Fn::Join" in v) return resolve(v["Fn::Join"][1]).join(v["Fn::Join"][0]);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]));
  }
  return v;
};
const roles = Object.entries(t.Resources).filter(([, r]) => r.Type === "AWS::IAM::Role" && /task-role"?$/.test(JSON.stringify(r.Properties.RoleName ?? "")));
if (roles.length !== 1) throw new Error(`expected 1 task role, found ${roles.length}`);
const docs = (roles[0][1].Properties.Policies ?? []).map((p) => resolve(p.PolicyDocument));
let dropped = "none";
if (BREAK === "1") {
  const all = docs.flatMap((d, di) => d.Statement.map((s, si) => ({ di, si, s })));
  const hit = all.find(({ s }) => [].concat(s.Action).includes("iam:PassRole")) ?? all[0];
  dropped = [].concat(hit.s.Action)[0];
  docs[hit.di].Statement.splice(hit.si, 1);
}
fs.writeFileSync(outPath, JSON.stringify({ dropped, docs: docs.filter((d) => d.Statement.length).map((d) => JSON.stringify(d)) }));
NODE

DROPPED="$(jq -r .dropped "$WORK/policies.json")"
POLICY_ARGS=()
while IFS= read -r doc; do POLICY_ARGS+=("$doc"); done < <(jq -r '.docs[]' "$WORK/policies.json")

# ── 3. what Loom's backend calls (v1.9.0 backend/iac/ecs.yaml TaskRole) ────
# resource ARN | optional context (key=value) | actions
# Actions IAM models with no resource type (the simulator implicit-denies them
# against any specific ARN, even under Resource "*") are checked against "*",
# which is how AWS evaluates them.
A="$ACCOUNT"; R="$REGION"
# shared-foundation's naming.name("agent-role") for the same naming params.
AGENT_ROLE="${LOOM_PROJECT:-loom}-${LOOM_ENV:-dev}-${LOOM_INSTANCE:-a}-shared-foundation-agent-role"
CASES=$(cat <<EOF
arn:aws:bedrock:$R::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0||bedrock:InvokeModel bedrock:InvokeModelWithResponseStream bedrock:CountTokens
arn:aws:bedrock:$R:$A:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0||bedrock:InvokeModel bedrock:InvokeModelWithResponseStream
*||bedrock:ListFoundationModels bedrock:ListInferenceProfiles cognito-idp:ListUserPools logs:DescribeDeliveries logs:DescribeLogGroups logs:DeleteDeliverySource bedrock-agentcore:ListAgentRuntimeVersions bedrock-agentcore:ListAgentRuntimeEndpoints
arn:aws:bedrock-agentcore:$R:$A:runtime/loom_demo-AbC123||bedrock-agentcore:InvokeAgentRuntime bedrock-agentcore:GetAgentRuntime bedrock-agentcore-control:CreateAgentRuntime bedrock-agentcore-control:CreateAgentRuntimeEndpoint bedrock-agentcore-control:GetAgentRuntime bedrock-agentcore-control:GetAgentRuntimeEndpoint bedrock-agentcore-control:UpdateAgentRuntime bedrock-agentcore-control:UpdateAgentRuntimeEndpoint bedrock-agentcore-control:DeleteAgentRuntime bedrock-agentcore-control:DeleteAgentRuntimeEndpoint bedrock-agentcore-control:ListAgentRuntimeVersions bedrock-agentcore-control:ListAgentRuntimeEndpoints
arn:aws:bedrock-agentcore:$R:$A:workload-identity-directory/default/workload-identity/loom-demo||bedrock-agentcore:CreateWorkloadIdentity bedrock-agentcore:GetWorkloadAccessToken
arn:aws:bedrock-agentcore:$R:$A:token-vault/default/oauth2credentialprovider/loom-demo||bedrock-agentcore:CreateOauth2CredentialProvider bedrock-agentcore:DeleteOauth2CredentialProvider
arn:aws:agent-registry:$R:$A:registry/loomRegistry1||agent-registry:GetRegistry agent-registry:CreateRegistryRecord agent-registry:GetRegistryRecord agent-registry:ListRegistryRecords agent-registry:SubmitRegistryRecordForApproval agent-registry:UpdateRegistryRecordStatus agent-registry:UpdateRegistryRecord agent-registry:DeleteRegistryRecord agent-registry:SearchDiscoverableRegistryRecords
arn:aws:iam::$A:role/aws-service-role/network.bedrock-agentcore.amazonaws.com/AWSServiceRoleForBedrockAgentCoreNetwork|iam:AWSServiceName=network.bedrock-agentcore.amazonaws.com|iam:CreateServiceLinkedRole
arn:aws:iam::$A:role/$AGENT_ROLE||iam:PassRole iam:GetRole iam:ListRolePolicies iam:GetRolePolicy iam:ListRoleTags iam:ListAttachedRolePolicies
arn:aws:logs:$R:$A:log-group:/aws/bedrock-agentcore/runtimes/loom_demo-AbC123-DEFAULT||logs:CreateLogGroup logs:DeleteLogGroup logs:CreateLogStream logs:PutLogEvents logs:FilterLogEvents logs:GetLogEvents logs:DescribeLogStreams
arn:aws:logs:$R:$A:log-group:/aws/vendedlogs/bedrock-agentcore/loom_demo-AbC123||logs:CreateLogGroup logs:DeleteLogGroup logs:FilterLogEvents logs:GetLogEvents
arn:aws:logs:$R:$A:delivery-destination:loom-loom_demo-AbC123-dest||logs:PutDeliveryDestination logs:DeleteDeliveryDestination
arn:aws:logs:$R:$A:delivery-source:loom-loom_demo-AbC123-logs-source||logs:PutDeliverySource
arn:aws:logs:$R:$A:delivery:AbCdEf123456||logs:CreateDelivery logs:DeleteDelivery
arn:aws:secretsmanager:$R:$A:secret:loom/mcp/42/admin-api-key-AbCdEf||secretsmanager:GetSecretValue secretsmanager:CreateSecret secretsmanager:DeleteSecret secretsmanager:PutSecretValue
arn:aws:secretsmanager:$R:$A:secret:bedrock-agentcore-identity!default/oauth2/loom-demo-AbCdEf||secretsmanager:GetSecretValue secretsmanager:CreateSecret secretsmanager:DeleteSecret secretsmanager:PutSecretValue
arn:aws:secretsmanager:$R:$A:secret:loom-dev-a-loom-db-url-AbCdEf||secretsmanager:GetSecretValue
arn:aws:kms:$R:$A:key/11111111-2222-3333-4444-555555555555||kms:Decrypt kms:GenerateDataKey
arn:aws:s3:::loom-dev-a-shared-foundation-artifacts-abc123/agents/demo/artifact.zip||s3:GetObject s3:PutObject
arn:aws:s3:::loom-dev-a-shared-foundation-artifacts-abc123||s3:ListBucket
arn:aws:cognito-idp:$R:$A:userpool/${R}_Example1||cognito-idp:AdminListGroupsForUser cognito-idp:ListUsers cognito-idp:ListUsersInGroup cognito-idp:ListGroups cognito-idp:AdminGetUser cognito-idp:DescribeUserPool
arn:aws:cognito-idp:$R:$A:userpool/${R}_OtherPool||cognito-idp:DescribeUserPool
EOF
)

# ── 4. simulate ────────────────────────────────────────────────────────────
TOTAL=0; DENIED=()
while IFS='|' read -r res ctx actions; do
  [ -n "$res" ] || continue
  extra=()
  if [ -n "$ctx" ]; then
    extra=(--context-entries "ContextKeyName=${ctx%%=*},ContextKeyValues=${ctx#*=},ContextKeyType=string")
  fi
  # IAM rejects one simulation mixing service prefixes, so batch per prefix.
  for prefix in $(tr ' ' '\n' <<<"$actions" | cut -d: -f1 | sort -u); do
    acts=()
    for a in $actions; do [ "${a%%:*}" = "$prefix" ] && acts+=("$a"); done
    out="$(aws iam simulate-custom-policy --region "$REGION" --output json \
      --policy-input-list "${POLICY_ARGS[@]}" \
      --action-names "${acts[@]}" --resource-arns "$res" ${extra[@]+"${extra[@]}"} 2>"$WORK/sim.err")" \
      || emit fail "simulate-failed $(grep -m1 . "$WORK/sim.err" | tr ' ' '_' | cut -c1-200)"
    TOTAL=$((TOTAL + ${#acts[@]}))
    while IFS= read -r d; do [ -n "$d" ] && DENIED+=("$d"); done \
      < <(jq -r --arg r "$res" '.EvaluationResults[] | select(.EvalDecision != "allowed") | "\(.EvalActionName)@\($r | sub("^arn:aws:[^:]*:[^:]*:[^:]*:"; ""))"' <<<"$out")
  done
done <<<"$CASES"

N=${#DENIED[@]}
LIST="$( ( IFS=,; echo "${DENIED[*]:-}" ) | cut -c1-600)"
if [ "$BREAK" = 1 ]; then
  # Caught only when the action whose statement was dropped is now denied.
  for d in ${DENIED[@]+"${DENIED[@]}"}; do
    case "$d" in "$DROPPED@"*) emit caught "dropped=$DROPPED denied=$N/$TOTAL hit=$d" ;; esac
  done
  emit fail "dropped=$DROPPED but $DROPPED is still allowed (denied=$N/$TOTAL)"
fi
if [ "$N" -eq 0 ]; then emit pass "allowed=$TOTAL/$TOTAL"; fi
emit fail "denied=$N/$TOTAL $LIST"
