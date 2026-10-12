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

## IAM

IAM is first-class reference-existing across the board:

- **`shared-foundation`'s `agentRole`** — the AgentCore execution role, scoped to
  that stack's own artifact bucket, ECR KMS, and logs. `provision | reference-existing | omit`.
  Set `LOOM_AGENT_ROLE_ARN` to hand over the least-privilege role a security team
  already built (`LOOM_AGENT_ROLE=omit` drops it). `src/examples/byo/` wires it at
  the composite level; the deployable reads the env var (#120).
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
| AgentCore data + control plane | `bedrock-agentcore:*` | `arn:aws:bedrock-agentcore:*:<acct>:*` |
| Runtime versions/endpoints | `bedrock-agentcore:ListAgentRuntimeVersions`, `ListAgentRuntimeEndpoints` | `*` (no resource type in IAM) |
| Agent runtime lifecycle | `bedrock-agentcore-control:{Create,Get,Update,Delete}AgentRuntime[Endpoint]`, `ListAgentRuntimeVersions`, `ListAgentRuntimeEndpoints` | `arn:aws:bedrock-agentcore:*:<acct>:runtime/*` |
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
with `aws iam simulate-custom-policy`. To check a BYO role, run
`aws iam simulate-principal-policy --policy-source-arn <your role arn>` with the
same actions and resources listed in that script.
