---
title: Security
description: The IAM roles loomster creates and what each can reach, the network paths into and inside a deployment, who can see what in Loom, and what each CI workflow and Op touches.
claims: [backend/task-role, backend/deploy-agent]
---

## IAM roles

| Role | Stack | Trusted by | Can reach |
|---|---|---|---|
| Backend task role | `loom-backend` | `ecs-tasks.amazonaws.com` | Everything Loom's backend calls, listed [below](#backend-task-role) |
| Backend execution role | `loom-backend` | `ecs-tasks.amazonaws.com` | ECR pull, log writes, the database secret and its KMS key |
| Frontend execution role | `loom-frontend` | `ecs-tasks.amazonaws.com` | ECR pull and log writes; the frontend has no task role, as in Loom's template |
| Shared agent execution role | `shared-foundation` | `bedrock-agentcore.amazonaws.com`, from this account only | Loom v1.9.0 `role.yaml`'s statements for any agent, plus pull and read on this stack's ECR repositories, artifact bucket and ECR key |
| Per-agent execution role | `…-agent-role-<agent>`, from `loom-agent-role` | `bedrock-agentcore.amazonaws.com`, from this account only | `role.yaml`'s statements, with credential providers scoped to `loom-<agent>-*` |
| Assistant roles | `loom-agents` | AgentCore | The chant-managed assistant's runtime, gateway and Code Interpreter |

Loom never creates or changes IAM itself (since v1.9.0). An agent deploys only
with a role that already exists, is registered under Security > IAM roles, and
is tagged into the caller's group. Every role the backend may pass to AgentCore
has to be named `<project>-*`, the backend's `iam:PassRole` grant.

The per-agent role is how Loom intends roles to be used: one agent can't read
another's OAuth or API-key credentials, and disabling one role stops one agent.
[Create an execution role per agent](/loomster/guides/create-an-execution-role-per-agent/).

### Backend task role

The provisioned role (`buildRoles` in `src/composites/loom-backend.ts`) ports
Loom v1.9.0's `backend/iac/ecs.yaml` `TaskRole`. A role you bring with
`LOOM_BACKEND_TASK_ROLE_ARN` needs the same grants. `<acct>` is your account,
`<project>` your `LOOM_PROJECT`.

| Purpose | Actions | Resource |
| --- | --- | --- |
| Model invoke | `bedrock:InvokeModel`, `InvokeModelWithResponseStream`, `CountTokens` | `arn:aws:bedrock:*:*:inference-profile/*`, `arn:aws:bedrock:*::foundation-model/*` |
| Model catalog | `bedrock:ListFoundationModels`, `ListInferenceProfiles` | `*` |
| Mantle-only models (invoke test) | `bedrock-mantle:CreateInference` | `*` |
| AgentCore data and control plane | `bedrock-agentcore:*` | `arn:aws:bedrock-agentcore:*:<acct>:*` |
| Runtime versions and endpoints | `bedrock-agentcore:ListAgentRuntimeVersions`, `ListAgentRuntimeEndpoints` | `*` (no resource type in IAM) |
| Agent runtime lifecycle | `bedrock-agentcore-control:{Create,Get,Update,Delete}AgentRuntime[Endpoint]`, `ListAgentRuntimeVersions`, `ListAgentRuntimeEndpoints` | `arn:aws:bedrock-agentcore:*:<acct>:runtime/*` |
| Evaluations | `bedrock-agentcore:ListEvaluators`, `ListOnlineEvaluationConfigs`, `ListBatchEvaluations`, `GetBatchEvaluation` | `*` (no resource type in IAM) |
| | `bedrock-agentcore:Evaluate` on AWS's built-in evaluators | `arn:aws:bedrock-agentcore:*:aws:evaluator/*` |
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
| Database secret | `secretsmanager:GetSecretValue`, `kms:Decrypt`, `kms:GenerateDataKey` | loom-db's `oRdsSecretArn` and `oSecretsKmsKeyArn` |
| Artifacts | `s3:GetObject`, `PutObject`; `s3:ListBucket` | the artifact bucket's objects; the bucket |
| Cognito | `cognito-idp:ListUserPools` on `*`; `AdminListGroupsForUser`, `ListUsers`, `ListUsersInGroup`, `ListGroups`, `AdminGetUser`, `DescribeUserPool` | `userpool/*` in the deploy region |

The `loom/` and `loom-` prefixes are fixed in Loom's code and don't follow
`LOOM_PROJECT`. The `backend/task-role` claim runs these pairs through the IAM
policy simulator, and `backend/deploy-agent` deploys an agent through Loom as
this role ([Validation](/loomster/reference/validation/)). To check a role you
bring, run `aws iam simulate-principal-policy --policy-source-arn <role arn>`
with the actions and resources in `test/claims/backend/task-role.sh`.

## Database users

Loom and the schema migrations connect as the RDS master user, whose
credentials are in loom-db's credentials secret. SQL Yodeler's plans, status
and drift reports connect as `loom_reader`, a separate user whose password
CloudFormation generates into loom-db's reader secret (`oRdsReaderSecretArn`).
It can read Loom's tables and yodel's history and nothing else: it owns no
object, every session it opens is read-only, and yodel refuses a deployment
whose reader and writer are the same user. `just db reader` creates it
([Migrate Loom's database](/loomster/guides/migrate-the-database/)).

## Network paths

| From | To | Allowed by | Default |
|---|---|---|---|
| Clients | ALB, port 80 (light) or 443 (production [tiers](/loomster/concepts/tiers-and-instances/)) | ALB security group | `0.0.0.0/0`; narrow it with `LOOM_ALB_INGRESS_CIDR` |
| ALB | Frontend and backend tasks | ECS task security group | ALB security group only |
| Backend tasks | Postgres, port 5432 | Database security group | `10.0.0.0/8` as in Loom's template; `LOOM_DB_SOURCE_SG=true` limits it to the ECS task security group |
| Schema migrations (`just db`) | Postgres on the RDS instance, port 5432 | The tunnel host's ingress rule on the database security group | Only while the optional tunnel host is deployed; the session goes through Systems Manager, never a public endpoint |
| Private networks | Loom, through PrivateLink | NLB and VPC endpoint service | Production tiers. Connections are accepted without a manual step; add principals to the endpoint service's permissions to let other accounts connect |
| Backend tasks | AWS APIs and Bedrock (`bedrock-runtime`, `bedrock-mantle.<region>.api.aws`) | Egress | Public subnets on light; your NAT or endpoints on the production tiers |
| Agents | Models and tools | AgentCore network mode | `PUBLIC` on light, `VPC` in your private subnets on the production tiers |

Light places tasks in public subnets with public IPs, because it builds no NAT.
The production tiers place them in private subnets without public IPs.

## Visibility in Loom

A user's scopes come from their `cognito:groups`: a type group (`t-admin` or
`t-user`) and resource groups (`g-admins-<x>`, `g-users-<x>`). A resource is
visible to the groups its `loom:group` tag names. Since Loom v1.9.0 a resource
with no `loom:group` tag is visible to `g-admins-super` only. Approval policies
carry no group and are visible to anyone with `security:read`.

The production tiers enforce MFA (software token) on the pool and turn on
deletion protection for the pool and the database.

## CI and Op reach

| Workflow or Op | Credentials | Changes |
|---|---|---|
| `ci.yml` | none | Nothing outside the runner |
| `deploy.yml` (and the GitLab and Forgejo deploy jobs) | the `production` environment's AWS credentials | Every component stack; inert until `DEPLOY=true` |
| `watch.yml` | `production` environment, read | Writes a run record to `chant/lifecycle` |
| `reconcile.yml` | `production` environment, read; `GITHUB_TOKEN` with `contents: write` and `pull-requests: write` | Opens a pull request; never changes the cloud |
| `backup.yml`, `restore-drill.yml` | `production` environment | Adds snapshots; the drill creates and deletes its own instance |
| `cost-report.yml`, `audit.yml` | none for AWS | Nothing |
| `loom-upgrade-*`, `loom-rotate-*`, `loom-restore`, `loom-teardown` | yours, run by a person | Stop at a gate before the change ([Gated Ops](/loomster/concepts/gated-ops/)) |
| `loom-seed`, `loom-agent-role` | yours, plus a Loom API token | Loom's database through its API; `loom-agent-role` also creates one IAM role stack |
