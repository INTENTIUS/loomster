---
title: Adoption seams
description: Every seam in loomster's composites, its modes, its default, and what replacing it needs, in one table.
---

Each row is a [seam](/loomster/concepts/glossary/#seam): a piece of
infrastructure you can let loomster create, point at one you already have, or
leave out. Why it works this way is in
[Provision, reference or omit](/loomster/concepts/adoption-seams/); the
variables are in [Build parameters](/loomster/reference/parameters/).

| Composite | Seam | Modes | Default | Replacing it needs |
|---|---|---|---|---|
| `shared-foundation` | network | `provision`, `reference-existing` | `provision` on light; the production [tiers](/loomster/concepts/tiers-and-instances/) require `reference-existing` | `LOOM_VPC_ID`, `LOOM_PUBLIC_SUBNET_IDS` (two or more, across two AZs), `LOOM_PRIVATE_SUBNET_IDS` (needed with PrivateLink) |
| `shared-foundation` | kms | `provision`, `reference-existing`, `omit` | `provision` | `LOOM_KMS_KEY_ARN`, a key that encrypts the two ECR repositories; `LOOM_KMS=omit` drops it |
| `shared-foundation` | ecr | `provision`, `reference-existing`, `omit` | `provision` | All four of `LOOM_FRONTEND_REPOSITORY_URI`, `_ARN`, `LOOM_BACKEND_REPOSITORY_URI`, `_ARN` (a partial set is ignored); `LOOM_ECR=omit` drops the repositories |
| `shared-foundation` | route53 | `provision`, `reference-existing`, `omit` | `provision` on the production tiers; unused on light | `LOOM_HOSTED_ZONE_ID`; loomster adds the alias record and creates no zone. `LOOM_ROUTE53=omit` drops DNS |
| `shared-foundation` | acm | `provision`, `reference-existing`, `omit` | `provision` on the production tiers | `LOOM_CERTIFICATE_ARN`, already DNS-validated; `LOOM_ACM=omit` drops HTTPS |
| `shared-foundation` | agentRole | `provision`, `reference-existing`, `omit` | `provision` | `LOOM_AGENT_ROLE_ARN`, an AgentCore execution role your security team built; `LOOM_AGENT_ROLE=omit` drops it |
| `shared-foundation` | loggingBucketName | reference-existing, or unset | unset (no access logs) | `LOOM_LOGGING_BUCKET_NAME`, an existing bucket for ALB, NLB and artifact bucket access logs |
| `shared-foundation` | privateLink | `provision`, `omit` | `provision` on the production tiers, `omit` on light | `LOOM_PRIVATELINK`; `provision` with private subnets adds it on any tier |
| `loom-db` | data | `provision`, `reference-existing`, `omit` | `provision` | `LOOM_DB_MODE=reference-existing` with `LOOM_DB_ENDPOINT`, `LOOM_DB_CREDENTIALS_SECRET_ARN`, and optionally `LOOM_DB_CONNECTION_SECRET_ARN`, `LOOM_DB_PORT`, `LOOM_DB_NAME`: any Postgres endpoint |
| `loom-db` | dbIngress (provision only) | `cidr`, `security-group` | `cidr`, `10.0.0.0/8` as in Loom's template | `LOOM_DB_ALLOWED_CIDR`, or `LOOM_DB_SOURCE_SG=true` for the ECS task security group |
| `loom-cognito` | identity | `provision`, `reference-existing`, `omit` | `provision` | `LOOM_COGNITO_MODE=reference-existing` with `LOOM_COGNITO_USER_POOL_ID`, `LOOM_COGNITO_DOMAIN`, `LOOM_COGNITO_RESOURCE_SERVER_ID`, `LOOM_COGNITO_M2M_CLIENT_ID`; ARN, end-user client, issuer and URLs are derived when unset |
| `loom-cognito` | groups and demo users | opt-in only | none | `LOOM_COGNITO_RESOURCE_GROUPS_JSON`, `LOOM_COGNITO_DEMO_SEED_USERS_JSON`. Loom's upstream 12 groups and 22 demo users are never added by default |
| `loom-backend` | execution and task IAM roles | `provision`, `reference-existing` | `provision` | Both `LOOM_BACKEND_EXECUTION_ROLE_ARN` and `LOOM_BACKEND_TASK_ROLE_ARN`; the task role needs what Loom calls ([Security](/loomster/reference/security/#backend-task-role)) |
| `loom-frontend` | execution IAM role | `provision`, `reference-existing` | `provision` | `LOOM_FRONTEND_EXECUTION_ROLE_ARN`, with ECR pull and log write; there is no task role, as in Loom's template |
| `loom-backend`, `loom-frontend` | cross-stack inputs (cluster, target groups, database secret, pool, image) | composite props | from `stackOutput(...)` | Any value from any source: the components use `stackOutput(...)`, `src/examples/byo/` uses literals |
| `loom-agents` | agent execution role | through shared-foundation's agentRole | provisioned | `agentRoleArn`, from the agentRole row |
| CI | the generated pipeline | generated, or your own CI | generated | Point your CI at the synthesized templates instead ([Deploy without chant](/loomster/guides/deploy-without-chant/)) |

## Seeding is a separate layer

The seams decide the infrastructure. What Loom's own database holds after a
deploy (the registered role, the authorizer, demo content) comes from
`loom-seed`, through Loom's API ([Screens](/loomster/reference/screens/)). The
groups and demo users row above is about the Cognito pool, which `loom-seed`
never touches.

## The example

`src/examples/byo/` deploys `shared-foundation`, `loom-db`, `loom-cognito` twice
(as two instances), `loom-backend` and `loom-frontend` with every seam set to
`reference-existing`, against one set of platform-owned resources, and no file
under `src/composites/` changed. [Bring your own everything](/loomster/guides/bring-your-own-everything/)
walks it.
