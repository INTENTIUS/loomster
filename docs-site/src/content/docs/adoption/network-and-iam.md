---
title: Network & IAM
description: The two load-bearing reference-existing seams — bring your own VPC/subnets and your own IAM roles. reference-existing is first-class here, not a fallback.
---

Most platform teams don't let an application stack provision its own VPC or IAM
roles — a platform/security team owns those centrally. So for both, `reference-existing`
is the first-class path, not a fallback. See the [seam matrix](/loomster/adoption/overview/#the-seam-matrix)
for the exact option/default/replacement of each.

## Network

`shared-foundation`'s `network` seam takes a VPC id and public/private subnet ids
by AZ. `reference-existing` wires the ALB, ECS tasks, and security groups straight
into the given ids; chant creates no VPC, subnet, route table, or internet gateway.

```
export LOOM_VPC_ID=<vpc id>
export LOOM_PUBLIC_SUBNET_IDS=<subnet>,<subnet>     # >=2, across 2 AZs
export LOOM_PRIVATE_SUBNET_IDS=<subnet>,<subnet>    # required once PrivateLink is in play
```

`provision` builds two public subnets and nothing else — it exists for a
from-scratch light/local synth, and the composite **refuses it on `production` /
`production-ha`**: there's no provisioned path to the private subnets PrivateLink
requires. So the production tiers always reference an existing network. The
deployable fails fast with a tier-specific message when those vars are missing,
rather than surfacing a generic error deep in synthesis.

Every downstream network consumer (`loom-db`, `loom-backend`, `loom-frontend`,
`loom-agents`) reads the VPC/subnet ids back out of `shared-foundation`'s own
outputs, so you set them once.

### Behind a TLS-inspecting proxy

If egress goes through a proxy that re-signs TLS with a corporate CA, set
`LOOM_USE_SYSTEM_TRUST_STORE=true` before deploying `loom-backend`. The backend
then verifies TLS against the OS trust store (Loom v1.6.1+, `truststore`) rather
than certifi's bundle, so the corporate CA has to be in the image's OS store.
Off by default, as in Loom's own template.

### Model endpoints

Loom v1.8.0+ calls two Bedrock endpoints: `bedrock-runtime` and
`https://bedrock-mantle.<region>.api.aws`, which some models (Gemma 4, the
OpenAI-compatible Responses API) only serve. On a private network, the backend
needs egress to both (a NAT, or an interface endpoint for each). Agents built on
Strands reach models through `bedrock-runtime` only.

## IAM

IAM is first-class reference-existing across the board:

- **`shared-foundation`'s `agentRole`** — the shared AgentCore execution role that
  loom-seed imports and the demo agent runs as. It carries Loom v1.9.0
  `role.yaml`'s statements for any agent (workload identity, token-vault
  credential providers named `loom-*`, `bedrock-agentcore-identity!*` and
  `loom/agents/*` secrets, runtime logs including `logs:PutResourcePolicy`,
  memory, Code Interpreter) plus pull/read on that stack's ECR, artifact bucket
  and ECR KMS key. `provision | reference-existing | omit`.
  Set `LOOM_AGENT_ROLE_ARN` to hand over the least-privilege role a security team
  already built (`LOOM_AGENT_ROLE=omit` drops it). `src/examples/byo/` wires it at
  the composite level; the deployable reads the env var (#120).
- **One role per agent** — what Loom itself expects since v1.9.0, where Loom never
  creates IAM and every deploy names an existing, registered role. See
  [per-agent execution roles](#per-agent-execution-roles).
- **`loom-backend`'s execution + task roles** — `provision | reference-existing`
  via `LOOM_BACKEND_EXECUTION_ROLE_ARN` / `LOOM_BACKEND_TASK_ROLE_ARN`. A referenced
  execution role needs ECR-pull + logs-write; the task role needs whatever the app
  itself calls (see [what a BYO backend task role must grant](#what-a-byo-backend-task-role-must-grant)).
- **`loom-frontend`'s execution role** — `provision | reference-existing` via
  `LOOM_FRONTEND_EXECUTION_ROLE_ARN`. It needs ECR-pull + logs-write; there's no task
  role, matching Loom's own template.

None of this forks a composite. `src/examples/byo/` wires every one of these to
`reference-existing` against one set of platform-owned resources, with no edits
under `src/composites/`.

## Per-agent execution roles

Loom's own answer to "which role does this agent run as" is one role stack per
agent from `shared/iac/role.yaml`. Its credential-provider grant is scoped to
that agent's own `loom-<agent>-*` providers, so one agent can't read another's
OAuth or API-key credentials (Loom v1.8.1, H1-3956464), and stopping a role stops
one agent. The chant version is the `loom-agent-role` composite and Op:

```bash
LOOM_AGENT_ROLE_AGENT=support_bot LOOM_AGENT_ROLE_GROUP=support \
LOOM_API_BASE_URL=https://loom.example.com LOOM_API_TOKEN=... \
  chant run loom-agent-role
```

It deploys `<project>-<env>-<instance>-agent-role-support-bot` (role name
`<project>-<env>-<instance>-agent-role-support-bot`, inside the backend task
role's `<project>-*` `iam:PassRole` grant), then registers it under Security >
Roles tagged `loom:group=support`, so members of that group can pick it when they
deploy `support_bot`. Optional: `LOOM_AGENT_ROLE_MEMORY_ARN` (adds the memory
policy), `LOOM_AGENT_ROLE_CODE_INTERPRETER=true`, `LOOM_AGENT_ROLE_BEDROCK_MODEL_ARNS`
(comma-separated; default this account's inference profiles and every foundation
model). Re-running is safe. The stack isn't a component, so `loom-teardown`
leaves it; delete it with `aws cloudformation delete-stack`.

## What a BYO backend task role must grant

With `LOOM_BACKEND_TASK_ROLE_ARN` set, chant creates no task role, so the role you
hand over has to carry what Loom's backend calls at runtime. The provisioned role
in `src/composites/loom-backend.ts` (`buildRoles`) is the reference; it ports Loom
v1.9.0's `backend/iac/ecs.yaml` `TaskRole`. Trust `ecs-tasks.amazonaws.com` and
grant, with `<acct>` your account and `<project>` your `LOOM_PROJECT` (default `loom`):

| Purpose | Actions | Resource |
| --- | --- | --- |
| Model invoke | `bedrock:InvokeModel`, `InvokeModelWithResponseStream`, `CountTokens` | `arn:aws:bedrock:*:*:inference-profile/*`, `arn:aws:bedrock:*::foundation-model/*` |
| Model catalog | `bedrock:ListFoundationModels`, `ListInferenceProfiles` | `*` |
| Mantle-only models (invoke test) | `bedrock-mantle:CreateInference` | `*` |
| AgentCore data + control plane | `bedrock-agentcore:*` | `arn:aws:bedrock-agentcore:*:<acct>:*` |
| Runtime versions/endpoints | `bedrock-agentcore:ListAgentRuntimeVersions`, `ListAgentRuntimeEndpoints` | `*` (no resource type in IAM) |
| Agent runtime lifecycle | `bedrock-agentcore-control:{Create,Get,Update,Delete}AgentRuntime[Endpoint]`, `ListAgentRuntimeVersions`, `ListAgentRuntimeEndpoints` | `arn:aws:bedrock-agentcore:*:<acct>:runtime/*` |
| Evaluations | `bedrock-agentcore:ListEvaluators`, `ListOnlineEvaluationConfigs`, `ListBatchEvaluations`, `GetBatchEvaluation` | `*` (no resource type in IAM) |
| | `bedrock-agentcore:Evaluate` on AWS's built-in evaluators | `arn:aws:bedrock-agentcore:*:aws:evaluator/*` (custom evaluators are covered by the account row above) |
| | `logs:StartQuery` | `log-group:/aws/bedrock-agentcore/*`, `log-group:aws/spans` |
| | `logs:GetQueryResults` | `*` |
| Agent Registry | `agent-registry:GetRegistry`, `{Create,Get,Update,Delete}RegistryRecord`, `ListRegistryRecords`, `SubmitRegistryRecordForApproval`, `UpdateRegistryRecordStatus`, `SearchDiscoverableRegistryRecords` | `arn:aws:agent-registry:*:<acct>:registry/*` |
| VPC-mode agents | `iam:CreateServiceLinkedRole` with `iam:AWSServiceName = network.bedrock-agentcore.amazonaws.com` | `arn:aws:iam::<acct>:role/aws-service-role/network.bedrock-agentcore.amazonaws.com/AWSServiceRoleForBedrockAgentCoreNetwork` |
| Agent roles (deploy, import) | `iam:PassRole`, `GetRole`, `ListRolePolicies`, `GetRolePolicy`, `ListRoleTags`, `ListAttachedRolePolicies` | `arn:aws:iam::<acct>:role/<project>-*` |
| Agent log groups | `logs:CreateLogGroup`, `DeleteLogGroup`, `CreateLogStream`, `PutLogEvents`, `FilterLogEvents`, `GetLogEvents`, `DescribeLogStreams` | `log-group:/aws/bedrock-agentcore/*`, `log-group:/aws/vendedlogs/bedrock-agentcore/*` |
| Vended-log delivery | `logs:PutDeliveryDestination`, `DeleteDeliveryDestination`, `PutDeliverySource` | `delivery-destination:loom-*`, `delivery-source:loom-*` |
| | `logs:CreateDelivery`, `DeleteDelivery` | `delivery:*` |
| | `logs:DescribeDeliveries`, `DescribeLogGroups`, `DeleteDeliverySource` | `*` |
| App secrets | `secretsmanager:GetSecretValue`, `CreateSecret`, `DeleteSecret`, `PutSecretValue` | `secret:loom/*`, `secret:bedrock-agentcore-identity!*` |
| DB secret | `secretsmanager:GetSecretValue` + `kms:Decrypt`, `kms:GenerateDataKey` | loom-db's `oRdsSecretArn` and `oSecretsKmsKeyArn` |
| Artifacts | `s3:GetObject`, `PutObject` / `s3:ListBucket` | the artifact bucket's objects / the bucket |
| Cognito | `cognito-idp:ListUserPools` on `*`; `AdminListGroupsForUser`, `ListUsers`, `ListUsersInGroup`, `ListGroups`, `AdminGetUser`, `DescribeUserPool` | `userpool/*` in the deploy region |

The `loom/` and `loom-` prefixes are hardcoded in Loom's application code, so they
don't follow `LOOM_PROJECT`. Any agent execution role you want Loom to deploy with
(including a BYO `LOOM_AGENT_ROLE_ARN`) has to be named `<project>-*`, or the role
grant above has to cover its name.

`test/claims/backend/task-role.sh` checks the provisioned role against this list
with `aws iam simulate-custom-policy` (the Evaluations rows are not in it yet). To check a BYO role, run
`aws iam simulate-principal-policy --policy-source-arn <your role arn>` with the
same actions and resources listed in that script.
