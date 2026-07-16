---
title: Adoption
description: The full seam-by-seam adoption matrix — provision, reference-existing, or omit for every referenceable piece of Loom's infrastructure, plus the runnable bring-your-own-everything example and known gaps.
---

A team runs Loom-on-chant by keeping what it wants and replacing or leaving out
the rest, all through parameters, with no forking of any composite's source.
Every referenceable piece of Loom's infrastructure exposes a
`provision | reference-existing | omit` choice, where `omit` makes sense at all;
some pieces are load-bearing and only choose between `provision` and
`reference-existing`. The seams ship with each composite. A runnable example
(`src/examples/byo/`) and a verification test
(`src/examples/byo/adoption.test.ts`) prove they compose.

## Reference-existing network + IAM is the primary case

Most platform teams don't let application stacks provision their own VPC or IAM
roles. A platform/security team owns those centrally. `reference-existing` is
first-class for both, not a fallback:

- **Network** (`shared-foundation`'s `network` seam). VPC id, public/private
  subnet ids by AZ. `reference-existing` wires the ALB, ECS tasks, and security
  groups straight into the given ids; chant creates no VPC, subnet, route table,
  or internet gateway. `provision` builds 2 public subnets and nothing else. It
  exists for a from-scratch light/local synth, and the composite refuses it on
  `production` / `production-ha` (there's no provisioned path to PrivateLink's
  required private subnets).
- **IAM**, first-class across the board. `shared-foundation`'s `agentRole` seam
  (the AgentCore execution role scoped to that stack's own artifact bucket, ECR
  KMS, and logs) is `provision | reference-existing | omit`. `loom-backend`'s
  execution + task roles and `loom-frontend`'s execution role are
  `provision | reference-existing` too (`LOOM_BACKEND_EXECUTION_ROLE_ARN` /
  `LOOM_BACKEND_TASK_ROLE_ARN`, `LOOM_FRONTEND_EXECUTION_ROLE_ARN`).

## Shared Cognito pool / external IdP across multiple Looms

An org runs many Loom instances across hard boundaries, separate accounts, prod
vs. non-prod, separate compliance scopes. Loom's own groups and `loom:group` tags
isolate *teams* within one deployment; they don't isolate one deployment from
another. A shared org-level Cognito pool (or an external OIDC IdP fronted the same
way), referenced by every instance with groups and the scope catalog defined once
at the org level, is the multi-instance pattern, not a fallback for teams that
skipped provisioning. `identity: reference-existing` on `loom-cognito` is exactly
that: zero Cognito resources, every id and URL threaded from params.
`src/examples/byo/loom-cognito/` and `src/examples/byo/loom-cognito-second-instance/`
instantiate the composite twice, under two `naming.instance` values, against the
identical pool config. `adoption.test.ts` asserts both produce zero members and
resolve to the same pool id. Provisioning one pool per instance
(`identity: provision`, the default) remains right for a single greenfield
boundary.

## Seeding the app, not just the infrastructure

The seams above get the *infrastructure* right. A deployed Loom also has to be
*usable*, and that's a separate layer: Loom's own database seeds almost nothing,
so a fresh deploy's Security screen has no role or authorizer and no agent can be
created. `loom-seed` closes that by registering what loomster provisioned into
Loom's app database, through Loom's own API — an imported agent role, a Cognito
authorizer, a `loomster` tag profile. On a real deploy the default profile is
`foundation` (that floor, and nothing billable); `light`/local defaults to `demo`
(also a sample agent, memory, MCP, and A2A). Run it against the deployed app:

```
LOOM_API_BASE_URL=https://<your-loom> npm run seed
```

Two things are deliberately never seeded, both because seeding them would break
or mislead: an **identity provider** (it flips Loom out of its dev-auth bypass
and locks a local deploy) and any **demo content on production tiers** (billable
resources). See [Screens](/loomster/reference/screens/) for the per-screen detail
and [Seeded defaults](/loomster/reference/seeding/) for the profiles.

This is a different thing from the **Cognito demo seed** in the matrix below
(`loom-cognito`'s `groups` / demo seed row): that's Loom's upstream 12 groups and
22 demo *users*, which loomster never defaults in — you bring your own org
structure. `loom-seed` populates the *application* database (roles, authorizers,
catalog); the Cognito seed would populate the *identity* pool.

## The matrix

| Composite | Seam | Options | Default | What replacing it requires |
|---|---|---|---|---|
| `shared-foundation` | `network` | `provision` \| `reference-existing` | `provision` (light-tier scaffolding only; `production` / `production-ha` require `reference-existing`) | `vpcId`, `publicSubnetIds` (≥2, across 2 AZs), `privateSubnetIds` (required once PrivateLink is in play) |
| `shared-foundation` | `kms` | `provision` \| `reference-existing` \| `omit` | `provision` | `kmsKeyArn` — used to encrypt the two ECR repos when `ecr` is also present |
| `shared-foundation` | `ecr` | `provision` \| `reference-existing` \| `omit` | `provision` | `frontendRepositoryUri`/`Arn`, `backendRepositoryUri`/`Arn` |
| `shared-foundation` | `route53` | `provision` \| `reference-existing` \| `omit` | `provision` (production / production-ha only; unused on light) | `hostedZoneId` (the alias record still gets created against it, unless also `omit`) |
| `shared-foundation` | `acm` | `provision` \| `reference-existing` \| `omit` | `provision` (production / production-ha only) | `certificateArn`, already DNS-validated against the referenced zone |
| `shared-foundation` | `agentRole` | `provision` \| `reference-existing` \| `omit` | `provision` | `agentRoleArn` — the least-privilege AgentCore execution role a security team already built |
| `shared-foundation` | `loggingBucketName` | reference-existing \| unset | unset (no access logging) | An existing S3 bucket for ALB/NLB + artifact-bucket access logs — Loom never creates this bucket itself |
| `shared-foundation` | `privateLink` | `provision` \| `omit` | `provision` on production / production-ha, `omit` on light (both overridable) | `privateLink.mode` — `omit` drops the NLB + VPC endpoint service on production; `provision` (with private subnets supplied) adds it on any tier |
| `loom-db` | `data` | `provision` \| `reference-existing` \| `omit` | `provision` | `endpoint`, `credentialsSecretArn`, optionally `connectionSecretArn`/`port`/`dbName` — an externally-managed Postgres endpoint (RDS, Aurora, or otherwise) |
| `loom-db` | `dbIngress` (provision mode only) | `cidr` \| `security-group` | `cidr` (Loom's own `10.0.0.0/8`) | `sourceSecurityGroupId` — typically `shared-foundation`'s own ECS task SG |
| `loom-cognito` | `identity` | `provision` \| `reference-existing` \| `omit` | `provision` | `userPoolId`, `domain`, `resourceServerIdentifier`, `m2mClientId`; optionally `userPoolArn`/`userClientId`/`issuer`/`discoveryUrl`/`tokenUrl` (derived when omitted) |
| `loom-cognito` | `groups` / demo seed | opt-in only | empty (`resourceGroups: []`), demo seed `undefined` | A team's own org structure — Loom's upstream 12 groups / 22 demo users are never defaulted in |
| `loom-backend` | execution + task IAM roles | `provision` \| `reference-existing` | `provision` | both `executionRoleArn` + `taskRoleArn` (`LOOM_BACKEND_EXECUTION_ROLE_ARN` / `LOOM_BACKEND_TASK_ROLE_ARN`) — a referenced execution role needs ECR-pull + logs-write; the task role needs whatever the app calls |
| `loom-frontend` | execution IAM role | `provision` \| `reference-existing` | `provision` | `executionRoleArn` (`LOOM_FRONTEND_EXECUTION_ROLE_ARN`) — needs ECR-pull + logs-write; no task role (matches Loom's template) |
| `loom-backend` / `loom-frontend` | Cross-stack inputs (cluster ARN, target-group ARN, DB secret ARN, Cognito pool id, image URI) | plain composite props | n/a (all required or explicitly optional per prop) | Any value from any source — a `stackOutput(...)`-resolved CFN Parameter (the concrete stacks' convention) or a literal known at author time (`src/examples/byo/`'s convention) |
| `loom-agents` | agent execution role | via `shared-foundation`'s `agentRole` seam | provisioned | `agentRoleArn` (see the `agentRole` row above) — the composite creates no other referenceable resource of its own |
| CI | Generated pipeline vs. BYO-CI | `chant build --components --generate gitlab` \| hand off the Build Archive | generated | Point existing CI at the Build Archive instead of running the generated pipeline — see `examples/adopt-alb-services/` in the chant repo |

## The bring-your-own-everything example

`src/examples/byo/` deploys `shared-foundation`, `loom-db`, `loom-cognito`
(twice, as two Loom instances), `loom-backend`, and `loom-frontend` with every
referenceable seam set to `reference-existing`, against one consistent set of
illustrative platform-team-owned resources (one VPC, one KMS key, one ACM cert +
Route53 zone, one pair of ECR repos, one agent role, one external Postgres
endpoint, one shared Cognito pool). No file under `src/composites/` changed to
build it. `src/examples/byo/README.md` has the layout and the exact `chant build`
commands; `src/examples/byo/adoption.test.ts` proves the shipped modules compose,
that the two Cognito instances resolve to one pool, and that every stack with
resources of its own serializes to valid CloudFormation with no dangling `Ref` or
`Fn::GetAtt` targets.

## Known gaps

Written down rather than papered over:

- **No bastion composite.** Nothing here models a bastion host, and Loom's own
  upstream template doesn't define one either. There's nothing to reference or
  omit.
- **A fully-`reference-existing` `loom-db` / `loom-cognito` stack has zero
  resources of its own**, by design. `chant build --lexicon aws` on a directory
  with no lexicon-tagged declarable at all (not even a `Parameter`) fails its own
  empty-output guard, a general chant behavior, not something these seams
  introduce. Such a stack's outputs are meant to be consumed by a downstream
  `stackOutput(...)`, not built standalone, so `adoption.test.ts` verifies these
  stacks directly rather than through the CLI's own build path.
