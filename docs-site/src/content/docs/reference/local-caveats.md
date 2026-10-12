---
title: Local caveats
description: How the local (Floci 2.2.0) run diverges from real AWS. Read this before you trust anything the local tier shows you.
---

The local stack ([Run Loom locally](/loomster/getting-started/)) runs the light
[tier](/loomster/concepts/tiers-and-instances/) on [Floci](/loomster/concepts/glossary/#floci)
`2.2.0`, for development, and to show the stacks deploy and the web app runs. It
says little about real AWS. Each section below says what differs, why, and what
holds on AWS instead.

## IAM isn't enforced unless you opt in

By default the backend, [chant](/loomster/concepts/glossary/#chant), local-up and seed all run on Floci's `test`
key, which Floci never checks. A local run succeeding proves nothing about
least privilege.

`LOOM_LOCAL_IAM_ENFORCEMENT=true just local-up` turns on Floci's enforcement
(`FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED`) and runs the backend as
loom-backend's **task role**, so an action the role doesn't grant at all is
denied as on AWS. It isn't the default, because it is noisy and partial:

- ARN-scoped grants are denied for most services. Floci 2.2.0 builds the
  request's resource ARN only for S3, Lambda, SQS, SNS, DynamoDB, Kinesis,
  Secrets Manager, SSM and KMS. Every other service, Cognito, CloudWatch Logs
  and IAM included, is checked against `Resource: "*"`, which an allow scoped
  to ARNs never matches. The task role's least-privilege grants for those
  services (`DescribeUserPool` on this account's pools, `FilterLogEvents` and
  `StartQuery` on agent log groups, `ListRoleTags` on project roles) are
  therefore denied locally and allowed on AWS. Seed's authorizer step fails on
  the first. See the [local guide](/loomster/guides/run-locally-in-depth/#check-the-backends-iam-role-locally)
  for reading the denials.
- chant, local-up and seed keep the `test` key, so deploying the stacks
  proves nothing about a deploy role's permissions.
- The task role's trust policy is widened on Floci. It trusts only
  `ecs-tasks.amazonaws.com`; local-up adds this account to it, on Floci only,
  so the harness can assume the role and hand the session to the backend
  container. The template is unchanged. The session lasts 12 hours.
- Condition keys Floci doesn't populate (MFA, some global keys) make a
  conditioned statement stricter or looser than AWS. See Floci's IAM docs.
- Agents run nothing, so the agent execution roles are never exercised
  (see below).

**Real AWS** enforces IAM everywhere. A stack that works locally can still be
denied there.

## Secrets are plain environment variables

The light tier delivers the database URL as a plain `Environment` variable
built from loom-db's resolved endpoint, because Floci's ECS has not injected
Secrets Manager `Secrets` into containers. **Real AWS** uses Secrets Manager.
Don't copy local secret handling into a real deployment. `production` /
`production-ha` keep the secret.

Floci 2.2.0 does resolve `Fn::Sub` attribute references inside a
`SecretString` (`${Db.Endpoint.Address}` included): the `database-url` secret
loom-db creates on Floci holds a resolved URL.

## Login is real Cognito, on Floci, through a Loom patch

Locally you log in as `loom-admin` against Floci's Cognito, and Loom validates
the tokens and derives scopes from `cognito:groups`. Two things differ from AWS:

- Loom runs with loomster's patch
  (`scripts/loom-patches/0001-cognito-endpoint-override.patch`), configured
  with `LOOM_COGNITO_ENDPOINT_URL` and `VITE_COGNITO_ENDPOINT_URL`. Upstream
  Loom only talks to `cognito-idp.<region>.amazonaws.com`. Every real tier
  leaves both settings unset. See the
  [local guide](/loomster/guides/run-locally-in-depth/#the-loom-patch).
- The user client, the two admin groups and the admin user are created by
  local-up on Floci; the light tier doesn't provision them. MFA is off (as on
  the light tier), the password is a printed throwaway, and Floci's Cognito is
  an emulator: advanced security, hosted-UI branding and token revocation
  details aren't AWS's. **Real AWS** uses the production tiers' user client,
  MFA and your own users. A local login proves the token path, not your
  production access model.

## The app tier runs in docker compose, not on Floci's ECS

chant deploys loom-backend and loom-frontend to Floci, and Floci starts their
ECS tasks, but the app you browse is a compose stack next to them: the
backend needs `LOOM_COGNITO_ENDPOINT_URL`, the frontend a build argument, and
the proxy a route to Floci's Cognito, none of which the real task definitions
carry. **Real AWS** runs the ECS services. Floci can vend task-role
credentials to its own ECS tasks
(`FLOCI_SERVICES_ECS_TASK_ROLE_CREDENTIALS_ENABLED`), which is the closer
match; local-up assumes the same role for the compose backend instead.

## The "ALB" is a reverse proxy

Locally, a reverse proxy path-routes `/api/*` + `/health` to the backend,
`/floci-cognito/` (the login calls) to Floci, and everything else to the
frontend. There is **no** TLS termination, WAF, or health-based failover.
**Real AWS** uses the actual ALB with all of that.

## Security groups aren't enforced

Floci 2.2.0 can filter packets by security group
(`FLOCI_NETWORK_SECURITY_GROUP_ENFORCEMENT_ENABLED`), but only for its own
Docker-backed ECS tasks and EC2 instances, and a task under it gets no
task-role credentials. The compose app tier is outside it, so local-up leaves
it off. **Real AWS** enforces the ALB, ECS, RDS and agent security groups.

## KMS is real crypto; rotation isn't exercised

Floci 2.2.0 encrypts with real AES-256-GCM per key, so KMS calls behave like
AWS's. Secrets Manager rotation exists in Floci, but the light tier configures
none, so nothing local exercises it.

## No telemetry pipeline

Floci has CloudWatch Logs and Metrics APIs, but nothing ships to them locally:
the compose app tier logs to Docker, and agents don't run. There is no X-Ray or
OTel pipeline. Cost, usage and trace views stay empty or show only what the
seed records. **Real AWS** produces that telemetry.

## Agent invoke is a stub; Evaluations aren't emulated

Floci emulates the AgentCore control plane, so agents deploy locally and
definitions are manageable (Postgres). The data plane is a stand-in:
`InvokeAgentRuntime` returns a canned response (`{"output":"yes"}`), not real
agent reasoning. See the
[local guide](/loomster/guides/run-locally-in-depth/#know-what-is-real).

AgentCore **Evaluations** isn't in Floci 2.2.0: the evaluators list and the
online-evaluation configs answer `UnknownOperationException`, so the
Evaluations tab's evaluator and run views return `502` locally (`npm run
validate` reports both). Test cases, which Loom keeps in Postgres, work.

## Single account

Everything runs in Floci's default account `000000000000`. Floci 2.2.0 can
emulate several accounts and Organizations SCPs; local-up doesn't use them.

## Floci's scope

Floci shows that the stacks synthesize and deploy, that the web app runs, and,
with enforcement on, that the backend's role covers Loom's calls. It doesn't
stand in for a run on AWS. What has run on AWS is on
[Validation](/loomster/reference/validation/).
