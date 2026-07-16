---
title: Adoption
description: How a team adopts Loom-on-chant — keep, replace, or omit each piece of infrastructure through parameters, never forking a composite. The seam matrix, the deep-dives per area, and the runnable bring-your-own-everything example.
---

A team runs Loom-on-chant by keeping what it wants and replacing or leaving out
the rest, all through parameters, with **no forking of any composite's source**.
Every referenceable piece of Loom's infrastructure exposes a
`provision | reference-existing | omit` choice, where `omit` makes sense at all;
some pieces are load-bearing and only choose between `provision` and
`reference-existing`. The seams ship with each composite. A runnable example
(`src/examples/byo/`) and a verification test (`src/examples/byo/adoption.test.ts`)
prove they compose at every tier.

The deep-dives cover the areas most teams wire first:

- **[Network & IAM](/loomster/adoption/network-and-iam/)** — the two load-bearing
  reference-existing seams; a platform/security team already owns these.
- **[DNS & certificates](/loomster/adoption/dns/)** — reference an existing Route53
  zone and ACM cert, provision new ones, or drop the custom domain.
- **[Identity & topology](/loomster/adoption/identity/)** — a shared Cognito pool or
  external IdP across many Loom instances, single- vs multi-boundary.

## The seam matrix

Every seam, its options, its default, and what replacing it requires.

| Composite | Seam | Options | Default | What replacing it requires |
|---|---|---|---|---|
| `shared-foundation` | `network` | `provision` \| `reference-existing` | `provision` (light-tier scaffolding only; `production` / `production-ha` require `reference-existing`) | `vpcId`, `publicSubnetIds` (≥2, across 2 AZs), `privateSubnetIds` (required once PrivateLink is in play) |
| `shared-foundation` | `kms` | `provision` \| `reference-existing` \| `omit` | `provision` | `kmsKeyArn` — used to encrypt the two ECR repos when `ecr` is also present |
| `shared-foundation` | `ecr` | `provision` \| `reference-existing` \| `omit` | `provision` | `frontendRepositoryUri`/`Arn`, `backendRepositoryUri`/`Arn` |
| `shared-foundation` | `route53` | `provision` \| `reference-existing` \| `omit` | `provision` (production / production-ha only; unused on light) | `LOOM_HOSTED_ZONE_ID` → the existing zone's id (loomster adds the alias record, creates no zone); `LOOM_ROUTE53=omit` drops DNS |
| `shared-foundation` | `acm` | `provision` \| `reference-existing` \| `omit` | `provision` (production / production-ha only) | `LOOM_CERTIFICATE_ARN` → an already-DNS-validated cert; `LOOM_ACM=omit` drops HTTPS |
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

## Beyond infrastructure: seeding the app

The seams above get the *infrastructure* right; a deployed Loom also has to be
*usable*. That's a separate layer — Loom's own database seeds almost nothing, so a
fresh deploy's Security screen has no role or authorizer and no agent can be
created. `loom-seed` closes that by registering what loomster provisioned into
Loom's app database through Loom's own API. See [Seeded defaults](/loomster/reference/seeding/)
and [Screens](/loomster/reference/screens/) for the full detail.

One clarification worth making here: the **Cognito demo seed** in the matrix above
(`loom-cognito`'s `groups` / demo seed row) is Loom's upstream 12 groups and 22
demo *users*, which loomster never defaults in — you bring your own org structure.
That's distinct from `loom-seed`, which populates the *application* database
(roles, authorizers, catalog), not the *identity* pool.

## The bring-your-own-everything example

`src/examples/byo/` deploys `shared-foundation`, `loom-db`, `loom-cognito` (twice,
as two Loom instances), `loom-backend`, and `loom-frontend` with every
referenceable seam set to `reference-existing`, against one consistent set of
illustrative platform-team-owned resources (one VPC, one KMS key, one ACM cert +
Route53 zone, one pair of ECR repos, one agent role, one external Postgres
endpoint, one shared Cognito pool). No file under `src/composites/` changed to
build it. `src/examples/byo/README.md` has the layout and the exact `chant build`
commands; `src/examples/byo/adoption.test.ts` proves the shipped modules compose,
that the two Cognito instances resolve to one pool, that every stack with resources
of its own serializes to valid CloudFormation with no dangling `Ref`/`Fn::GetAtt`
targets, and — since the DNS seams only build on the full tiers — that the whole
reference-existing seam set holds at **light, production, and production-ha**.

## Known gaps

Written down rather than papered over:

- **No bastion composite.** Nothing here models a bastion host, and Loom's own
  upstream template doesn't define one either. There's nothing to reference or omit.
- **A fully-`reference-existing` `loom-db` / `loom-cognito` stack has zero resources
  of its own**, by design. `chant build --lexicon aws` on a directory with no
  lexicon-tagged declarable at all (not even a `Parameter`) fails its own
  empty-output guard, a general chant behavior, not something these seams introduce.
  Such a stack's outputs are meant to be consumed by a downstream `stackOutput(...)`,
  not built standalone, so `adoption.test.ts` verifies these stacks directly rather
  than through the CLI's own build path.
