---
title: Coming from Loom's SAM deploy
description: Each make target and etc/environment.sh setting in Loom's own SAM deploy, what does the same job in loomster, what behaves differently, and how to bring an existing Loom's users and database across.
prompt: |
  Read https://intentius.io/loomster/guides/coming-from-upstream-loom/ and, from the person's Loom checkout (shared/etc/common.sh and the environment.sh files), write the LOOM_* exports that match their settings using the page's settings table.
  List each setting with no loomster equivalent and what the page says to do instead. Don't deploy.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

The same Loom v1.9.0 you deploy with `make` and SAM, deployed from typed source
with one command per [tier](/loomster/concepts/tiers-and-instances/), with your
settings carried over as build parameters.

## The first command

Where Loom's `DEPLOYMENT.md` has you copy four `environment.sh` files, fill in
`shared/etc/common.sh`, and run `make` per stack across three directories with
`make outputs` between them, loomster is:

```
git clone https://github.com/INTENTIUS/loomster && cd loomster && npm install
export LOOM_TIER=production LOOM_VPC_ID=... LOOM_PUBLIC_SUBNET_IDS=... LOOM_PRIVATE_SUBNET_IDS=...
export LOOM_DOMAIN_NAME=loom.example.com LOOM_DB_PASSWORD=...
npm run vendor
npx chant run --components all --env prod
```

The stacks deploy in dependency order and pass outputs to each other; there is
no `outputs.sh`. [Deploy to production on AWS](/loomster/guides/deploy-to-production/)
is the full runbook.

## Targets

| To do this | Loom | loomster |
|---|---|---|
| Configure a deployment | `shared/etc/common.sh` plus `etc/environment.sh` in `shared/`, `backend/`, `frontend/` | `LOOM_*` build parameters ([settings below](#settings)) |
| Once per account | `make agentcore.init`, `make ecs.init` | `just bootstrap` |
| Pass outputs between stacks | `make outputs`, then `include etc/outputs.sh` | automatic: `stackOutput(...)` between components |
| Hosted zone and NS delegation | `make dns`, `make dns.outputs` | `npm run dns-setup` (creates the zone, prints the NS records, waits for the delegation) |
| S3, ECR, ACM, ALB | `make infra` | `shared-foundation` |
| ECS cluster | `make ecs` (shared) | `shared-foundation` |
| PrivateLink | `make privatelink` | `shared-foundation` on the production tiers (`LOOM_PRIVATELINK`) |
| Cognito pool, groups, scopes, clients | `make cognito` | `loom-cognito` |
| An agent execution role | `make role` with `P_AGENT_NAME` | `just agent-role <agent> <group>`, which also registers it in Loom ([guide](/loomster/guides/create-an-execution-role-per-agent/)); the shared role is in `shared-foundation` |
| Code Interpreter role | `make ci-role` | `LOOM_AGENT_ROLE_CODE_INTERPRETER=true` on `loom-agent-role` |
| RDS and RDS Proxy | `make rds` in `backend/` | `loom-db` |
| Bastion and tunnel to the database | `make ec2`, `make tunnel` | `just tunnel-host`, then `just tunnel` ([guide](/loomster/guides/open-a-tunnel-to-the-database/)) |
| Build, push and deploy the services | `make deploy` (podman build and push by git sha, `sam deploy` per service) | `chant run --components loom-backend` and `loom-frontend`: build, publish by digest, deploy, wait for steady state and `/health`, roll back on failure |
| Everything, in order | about ten targets across three directories | `npx chant run --components all` |
| A token for the API | `make cognito.get-tokens` | `just cognito-token`, a throwaway admin with the MFA challenge handled on the production tiers |
| Client ids | `make cognito.get-client-id` | `just cognito-client-id` |
| First-sign-in passwords | `make cognito.set-passwords` | `LOOM_COGNITO_PASSWORD=... just set-passwords [users]` |
| Copy a SQLite Loom into Postgres | `make migrate` | `just import-sqlite <loom.db>`, gated |
| Fix sequences | `make fix-sequences` | `just fix-sequences` |
| Wipe the database | `make reset-db` | `just reset-db`: snapshot first, gated |
| Run locally | Phase 1: SQLite, `make run` and `make dev`, Cognito in AWS | `just local-up`: Postgres and Cognito on [Floci](/loomster/concepts/glossary/#floci), no AWS account |
| Fill a fresh Loom (role, authorizer) | `ONBOARDING.md` steps by hand | `npm run seed` ([Seed and validate a deploy](/loomster/guides/seed-and-validate/)) |
| Remove everything | `make *.delete` in reverse, per directory | `chant run loom-teardown`, gated ([Tear down a deployment](/loomster/guides/tear-down/)) |
| List AgentCore credential providers | `make agentcore.credentials.list` | `just credentials` |
| Delete them | `make agentcore.credentials.delete-all` (every provider in the account) | `just credentials-delete`: only the ones this Loom recorded, gated |
| Inspect AgentCore memory | `make agentcore.memory.list`, `get`, `records`, `records-by-namespace`, `extraction-jobs` | `just memory [query] [id] [who]` |

[Loom make targets](/loomster/reference/make-targets/) has every operator target
and how each verb differs from it.

## Settings

| Loom setting | Where | loomster |
|---|---|---|
| `AWS_PROFILE`, `AWS_REGION` | `common.sh` | your AWS CLI configuration, `AWS_REGION` |
| `ACCOUNTID` | `common.sh` | `AWS_ACCOUNT_ID` |
| `BUCKET` (SAM artifacts) | `common.sh` | none: [chant](/loomster/concepts/glossary/#chant) applies templates without a SAM bucket |
| `VPC_ID`, `PUBLIC_SUBNET_IDS`, `PRIVATE_SUBNET_IDS` | `common.sh` | `LOOM_VPC_ID`, `LOOM_PUBLIC_SUBNET_IDS`, `LOOM_PRIVATE_SUBNET_IDS` |
| `PUBLIC_FQDN` | `common.sh` | `LOOM_DOMAIN_NAME` |
| `RDS_ALLOWED_CIDR` | `common.sh` | `LOOM_DB_ALLOWED_CIDR` |
| `COGNITO_POOL_NAME`, `COGNITO_DOMAIN` | `common.sh` | derived from `{project}-{env}-{instance}` ([Naming and tagging](/loomster/reference/naming/)) |
| `LOOM_ARTIFACT_BUCKET` | `common.sh` | created and named by `shared-foundation` |
| `LOOM_LOGGING_BUCKET` | `common.sh` (required) | `LOOM_LOGGING_BUCKET_NAME` (optional) |
| `RDS_PASSWORD` | `common.sh` | `LOOM_DB_PASSWORD` |
| `SUPER_ADMIN_PASSWORD`, `DEMO_USER_*_PASSWORD` | `common.sh` | none: loomster creates no users |
| `P_TAG_OWNER` | each `environment.sh` | `LOOM_OWNER` |
| `P_RDS_INSTANCE_CLASS`, `P_RDS_ALLOCATED_STORAGE` | `backend/` | `LOOM_DB_INSTANCE_CLASS`, `LOOM_DB_ALLOCATED_STORAGE` |
| `P_RDS_MULTI_AZ`, `P_RDS_ENABLE_PROXY` | `backend/` | the tier: Proxy on `production`, Proxy and Multi-AZ on `production-ha` |
| `P_ECS_BACKEND_CPU`, `_MEMORY`, `_DESIRED_COUNT`, `_MAX_COUNT` | `backend/` | `LOOM_BACKEND_CPU`, `_MEMORY`, `_DESIRED_COUNT`, `_MAX_COUNT` |
| `P_ECS_FRONTEND_CPU`, `_MEMORY`, `_DESIRED_COUNT` | `frontend/` | `LOOM_FRONTEND_CPU`, `_MEMORY`, `_DESIRED_COUNT` |
| `LOOM_ALLOWED_ORIGINS`, `LOOM_REGISTRY_ID` | `backend/` | the same names |
| `P_LITELLM_*` | `backend/` | `LOOM_LITELLM_*` |
| `P_INFRA_ALB_INGRESS_CIDR` | `shared/` | `LOOM_ALB_INGRESS_CIDR` |
| `P_AGENT_NAME`, `P_MEMORY_ARN`, `P_BEDROCK_MODEL_ARNS`, `P_ENABLE_CODE_INTERPRETER` | `shared/` (role) | `LOOM_AGENT_ROLE_AGENT`, `_MEMORY_ARN`, `_BEDROCK_MODEL_ARNS`, `_CODE_INTERPRETER` |

Every parameter is in [Build parameters](/loomster/reference/parameters/).

## Behavior differences

- Defaults are smaller. Loom's example runs three backend tasks, Multi-AZ RDS and
  an RDS Proxy. loomster sizes by tier: one backend task on light and production,
  two on production-ha; Multi-AZ only on production-ha.
- On the production tiers both services run in private subnets with no public
  IP; Loom's example puts the frontend in public subnets.
- Images deploy by digest, not by git sha tag, and a failed service deploy rolls
  back to the previous task definition.
- Loom's frontend build passes the Cognito end-user client id
  (`podman.build.frontend`); loomster's AWS build passes none, so the served app's
  sign-in form isn't wired on a deployed tier, and you use Loom through its API
  with a token. The local stack does sign in through the form.
- The tunnel host is optional and off until you run `just tunnel-host`. The
  database [Ops](/loomster/concepts/glossary/#op) (`import-sqlite`, `fix-sequences`, `reset-db`) don't need it:
  they run as one-off tasks of the backend inside the VPC.
- Upgrades are an Op that snapshots first, and on the production tiers waits for
  approval ([Upgrade Loom](/loomster/guides/upgrade-loom/)).

## Bringing an existing Loom across

- Users: point loomster at your existing pool with
  `LOOM_COGNITO_MODE=reference-existing` and its ids, and every user and group
  stays ([Share a Cognito pool](/loomster/guides/share-a-cognito-pool/)).
- Data: point `loom-db` at your existing database with
  `LOOM_DB_MODE=reference-existing`, `LOOM_DB_ENDPOINT` and the secret Loom's
  `rds.yaml` created ([Bring your own KMS, ECR and database](/loomster/guides/bring-your-own-kms-ecr-and-database/)).
  The backend migrates the schema on startup, as it does under SAM. A Phase 1
  Loom's `loom.db` comes across with `just import-sqlite loom.db`.
- Agent roles: they keep working; register any Loom created on demand before
  v1.9.0 under Security > IAM roles.

## Left out on purpose

| Not here | In Loom | loomster's rule | Do this instead |
|---|---|---|---|
| The 12 demo groups and 22 demo users | `cognito.yaml`, `make cognito.set-passwords` | it doesn't invent an org structure or users | `LOOM_COGNITO_RESOURCE_GROUPS_JSON` and `LOOM_COGNITO_DEMO_SEED_USERS_JSON`, or reference your pool |
| SQLite | Phase 1 local development | every run, local included, uses Postgres | `just local-up`; bring a SQLite Loom's data across with `just import-sqlite` |
| A laptop backend on cloud RDS | Phase 2 hybrid | the backend runs where its database is | `just local-up`, or a deployed tier |
| `make refresh-models` on a running deploy | `backend/makefile` | the model list arrives with a Loom release | bump the pinned Loom ([Upgrade Loom](/loomster/guides/upgrade-loom/)) |
| `make ci-role` | `shared/makefile`, with a template Loom doesn't ship | | the generated pipelines' own credentials ([CI providers](/loomster/reference/ci/)) |
| Deleting every credential provider in the account | `make agentcore.credentials.delete-all` | another instance's providers aren't this one's to delete | `just credentials-delete` |

## Next

- [Deploy the light tier to AWS](/loomster/tutorial/light-on-aws/) to try it on a
  scratch account first.
- [Build parameters](/loomster/reference/parameters/).
