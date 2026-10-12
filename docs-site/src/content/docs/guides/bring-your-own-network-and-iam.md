---
title: Bring your own network and IAM
description: Deploy Loom into a VPC and subnets your platform team owns, hand over existing IAM roles for the backend, frontend and agents, and run behind a TLS-inspecting proxy.
prompt: |
  Read https://intentius.io/loomster/guides/bring-your-own-network-and-iam/ and check the VPC, subnets and roles the person names with read-only AWS CLI calls: two AZs, private-subnet egress, and the trust and grants each role needs.
  Report the variables to export and anything missing. Don't deploy unless the person asked for that in this session.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

A Loom whose ALB, tasks and database sit in your network and whose roles are the
ones your security team built, with no loomster-created VPC, subnet, route table
or IAM role for the pieces you handed over.

## Prerequisites

- A VPC with at least two public subnets across two AZs, and two private subnets
  for the production [tiers](/loomster/concepts/tiers-and-instances/) or
  PrivateLink. Private subnets need egress for image pulls: a NAT gateway, or
  ECR, S3 and CloudWatch Logs endpoints.
- For each role you bring, its ARN, with the trust and grants listed in
  [Security](/loomster/reference/security/#iam-roles).

## Steps

### 1. The network

```
export LOOM_VPC_ID=<vpc id>
export LOOM_PUBLIC_SUBNET_IDS=<subnet>,<subnet>     # two or more, across two AZs
export LOOM_PRIVATE_SUBNET_IDS=<subnet>,<subnet>    # needed with PrivateLink
```

`shared-foundation` wires the ALB, ECS tasks and security groups into those ids
and creates no networking. Every other component reads the ids back from
`shared-foundation`'s outputs, so you set them once. On a production tier with
these unset, the build stops and names what's missing; the network a
loomster-built VPC provides is light-only, because it has no private subnets.

### 2. The roles

Each is a [seam](/loomster/concepts/glossary/#seam), independent of the others.

| Role | Variable | Needs |
|---|---|---|
| Shared agent execution role | `LOOM_AGENT_ROLE_ARN` (`LOOM_AGENT_ROLE=omit` drops it) | Trust `bedrock-agentcore.amazonaws.com`; Loom's `role.yaml` statements; a name starting `<project>-` |
| Backend execution and task roles | `LOOM_BACKEND_EXECUTION_ROLE_ARN` and `LOOM_BACKEND_TASK_ROLE_ARN`, both | Execution: ECR pull, log writes, the database secret. Task: [the backend task role grants](/loomster/reference/security/#backend-task-role) |
| Frontend execution role | `LOOM_FRONTEND_EXECUTION_ROLE_ARN` | ECR pull and log writes; there is no frontend task role |

Loom's backend passes agent roles to AgentCore only when they're named
`<project>-*` (`<project>` is `LOOM_PROJECT`, default `loom`), so any agent role
you bring needs that prefix, or a task role whose `iam:PassRole` grant covers its
name. The `loom/` secret and `loom-` delivery prefixes are fixed in Loom's code.

To check a backend task role you bring, run
`aws iam simulate-principal-policy --policy-source-arn <role arn>` with the
actions and resources in `test/claims/backend/task-role.sh`.

### 3. Behind a TLS-inspecting proxy

If egress goes through a proxy that re-signs TLS with a corporate CA, set
`LOOM_USE_SYSTEM_TRUST_STORE=true` before deploying `loom-backend`. The backend
then verifies TLS against the OS trust store instead of certifi's bundle (Loom
v1.6.1 and later), so the CA has to be in the image's OS store. It's off by
default, as in Loom's template.

### 4. Model endpoints

Loom v1.8.0 and later call two Bedrock endpoints: `bedrock-runtime` and
`https://bedrock-mantle.<region>.api.aws`, which some models only serve. On a
private network the backend needs egress to both (a NAT, or an interface
endpoint for each). Strands agents reach models through `bedrock-runtime` only.

## Next

- [Create an execution role per agent](/loomster/guides/create-an-execution-role-per-agent/)
  for roles scoped to one agent.
- [Bring your own KMS, ECR and database](/loomster/guides/bring-your-own-kms-ecr-and-database/).
- [Adoption seams](/loomster/reference/adoption-seams/) for every seam.
