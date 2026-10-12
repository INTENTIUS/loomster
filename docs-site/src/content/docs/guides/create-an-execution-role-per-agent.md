---
title: Create an execution role per agent
description: Deploy one agent's AgentCore execution role the way Loom's role.yaml does, scoped to that agent's credential providers, and register it in Loom tagged into the group that deploys the agent.
prompt: |
  Read https://intentius.io/loomster/guides/create-an-execution-role-per-agent/ and, for the agent name and group the person gives, run `just agent-role <agent> <group>` against their Loom with an API token.
  Report the role ARN and confirm it appears under Security > IAM roles. Run it only if the person asked for it in this session, since it deploys an IAM stack.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

Loom v1.9.0 never creates IAM. Every agent deploys with a role that already
exists, is registered under Security > IAM roles, and is tagged into the
caller's group. Loom's own answer is one role stack per agent from
`shared/iac/role.yaml`: its credential-provider grant covers only that agent's
`loom-<agent>-*` providers, so one agent can't read another's OAuth or API-key
credentials, and disabling a role stops one agent. The `loom-agent-role`
[Op](/loomster/concepts/glossary/#op) is the [chant](/loomster/concepts/glossary/#chant) version.

## Result

A stack `<project>-<env>-<instance>-agent-role-<agent>` holding the role, and the
role registered in Loom with `loom:group` set, so that group's members can pick
it when they deploy the agent.

## Prerequisites

- A deployed Loom and the deployment's `LOOM_*` variables and AWS credentials
  (IAM write access).
- `LOOM_API_BASE_URL` and a `LOOM_API_TOKEN`, as for the seed
  ([Seed and validate a deploy](/loomster/guides/seed-and-validate/#prerequisites)).

## Steps

1. Run it for the agent and group:

   ```
   export LOOM_API_BASE_URL=https://loom.example.com LOOM_API_TOKEN=...
   just agent-role support_bot support
   ```

   which is
   `LOOM_AGENT_ROLE_AGENT=support_bot LOOM_AGENT_ROLE_GROUP=support chant run loom-agent-role`.

   The Deploy phase builds `src/loom-agent-role` for that agent and deploys it
   (underscores in the agent name become hyphens in the stack name). The role
   is named `<project>-<env>-<instance>-agent-role-support-bot`, inside the
   backend task role's `<project>-*` `iam:PassRole` grant. The Import phase
   registers it with `POST /api/security/roles`, tagged
   `loom:group=support`.

2. Add what this agent needs:

   - `LOOM_AGENT_ROLE_MEMORY_ARN` adds the memory policy for that memory.
   - `LOOM_AGENT_ROLE_CODE_INTERPRETER=true` adds the Code Interpreter policy.
   - `LOOM_AGENT_ROLE_BEDROCK_MODEL_ARNS` (comma-separated) limits the models;
     unset means this account's inference profiles and every foundation model.

   Loom's integrations (S3, Lambda, DynamoDB and the rest) record configuration
   only; the matching IAM statement has to be in the role. Re-running with new
   values updates the stack. Re-running unchanged does nothing.

3. Deploy the agent from Loom's Agents screen and pick the role.

The stack isn't a component, so `loom-teardown` leaves it. Delete it with
`aws cloudformation delete-stack --stack-name <stack>` once the agent is gone.

The shared agent role in `shared-foundation` carries the same statements for any
agent; the seed and the demo agent use it.

## Next

[Security](/loomster/reference/security/#iam-roles) for every role loomster
creates.
