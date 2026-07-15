# Adoption matrix

Tracks `INTENTIUS/chant#898`. A team runs Loom-on-chant by keeping what it
wants and leaving out or replacing the rest, all through parameters, with no
forking of any composite's source. Every referenceable piece of Loom's
infrastructure exposes a `provision | reference-existing | omit` choice
(where `omit` makes sense at all — some pieces are load-bearing and only
choose between `provision`/`reference-existing`). The seams themselves ship
with each composite (`#886`–`#889`); this page is the coherent map across all
of them, plus a runnable example (`src/examples/byo/`) and a verification
test (`src/examples/byo/adoption.test.ts`) proving they compose.

## Reference-existing network + IAM is the primary case

Most platform teams do not let application stacks provision their own VPC
or IAM roles — a platform/security team owns those centrally. `#898`'s
settled decision treats `reference-existing` as first-class for both, not a
fallback:

- **Network** (`shared-foundation`'s `network` seam) — VPC id, public/private
  subnet ids by AZ. `reference-existing` wires the ALB, ECS tasks, and
  security groups straight into the given ids; chant creates no VPC, subnet,
  route table, or internet gateway. `provision` builds 2 public subnets and
  nothing else — it exists for a from-scratch light/local synth, and the
  composite refuses it outright on `production`/`production-ha` (there is no
  provisioned path to PrivateLink's required private subnets).
- **IAM** — partially covered today. `shared-foundation`'s `agentRole` seam
  (the AgentCore execution role scoped to that stack's own artifact
  bucket/ECR-KMS/logs) is `provision | reference-existing | omit`, same as
  every other `shared-foundation` seam. `loom-backend`'s execution/task roles
  and `loom-frontend`'s execution role are **not yet seamed** — see "Known
  gaps" below.

## Shared Cognito pool / external IdP across multiple Looms

An org runs many Loom instances across hard boundaries — separate AWS
accounts, prod vs. non-prod, separate compliance scopes. Loom's own groups
and `loom:group` tags isolate *teams* within one deployment; they don't
isolate one deployment from another. `#898`'s other settled decision: a
shared org-level Cognito pool (or an external OIDC IdP fronted the same way)
referenced by every Loom instance, with groups and the scope catalog defined
once at the org level, is the multi-instance pattern — not a fallback for
teams that skipped provisioning. `identity: reference-existing` on
`loom-cognito` is exactly that: zero Cognito resources, every id/URL threaded
straight from params. `src/examples/byo/loom-cognito/` and
`src/examples/byo/loom-cognito-second-instance/` instantiate the composite
twice, under two different `naming.instance` values, against the identical
pool config — `adoption.test.ts` asserts both produce zero members and
resolve to the same pool id. Provisioning one pool per Loom instance
(`identity: provision`, the default) remains the right call for a single
greenfield boundary.

## The matrix

| Composite | Seam | Options | Default | What replacing it requires |
|---|---|---|---|---|
| `shared-foundation` (`#886`) | `network` | `provision` \| `reference-existing` | `provision` (light-tier scaffolding only; `production`/`production-ha` require `reference-existing`) | `vpcId`, `publicSubnetIds` (>=2, across 2 AZs), `privateSubnetIds` (required once PrivateLink is in play) |
| `shared-foundation` | `kms` | `provision` \| `reference-existing` \| `omit` | `provision` | `kmsKeyArn` — used to encrypt the two ECR repos when `ecr` is also present |
| `shared-foundation` | `ecr` | `provision` \| `reference-existing` \| `omit` | `provision` | `frontendRepositoryUri`/`Arn`, `backendRepositoryUri`/`Arn` |
| `shared-foundation` | `route53` | `provision` \| `reference-existing` \| `omit` | `provision` (production/production-ha only; unused on light) | `hostedZoneId` (the alias record still gets created against it, unless also `omit`) |
| `shared-foundation` | `acm` | `provision` \| `reference-existing` \| `omit` | `provision` (production/production-ha only) | `certificateArn`, already DNS-validated against the referenced zone |
| `shared-foundation` | `agentRole` | `provision` \| `reference-existing` \| `omit` | `provision` | `agentRoleArn` — the least-privilege AgentCore execution role a security team already built |
| `shared-foundation` | `loggingBucketName` | reference-existing \| unset | unset (no access logging) | An existing S3 bucket for ALB/NLB + artifact-bucket access logs — Loom never creates this bucket itself |
| `shared-foundation` | `privateLink` | `provision` \| `omit` | `provision` on production/production-ha, `omit` on light (both overridable) | `privateLink.mode` — `omit` drops the NLB + VPCEndpointService on production; `provision` (with private subnets supplied) adds it on any tier |
| `loom-db` (`#887`) | `data` | `provision` \| `reference-existing` \| `omit` | `provision` | `endpoint`, `credentialsSecretArn`, optionally `connectionSecretArn`/`port`/`dbName` — an externally-managed Postgres endpoint (RDS, Aurora, or otherwise) |
| `loom-db` | `dbIngress` (provision mode only) | `cidr` \| `security-group` | `cidr` (Loom's own `10.0.0.0/8`) | `sourceSecurityGroupId` — typically `shared-foundation`'s own ECS task SG |
| `loom-cognito` (`#888`) | `identity` | `provision` \| `reference-existing` \| `omit` | `provision` | `userPoolId`, `domain`, `resourceServerIdentifier`, `m2mClientId`; optionally `userPoolArn`/`userClientId`/`issuer`/`discoveryUrl`/`tokenUrl` (derived when omitted) |
| `loom-cognito` | `groups`/demo seed | opt-in only | empty (`resourceGroups: []`), demo seed `undefined` | A team's own org structure — Loom's upstream 12 groups / 22 demo users are never defaulted in |
| `loom-backend` / `loom-frontend` (`#889`) | execution/task IAM roles | **always provisioned — no seam yet** | n/a | See "Known gaps" |
| `loom-backend` / `loom-frontend` | Cross-stack inputs (cluster ARN, target-group ARN, DB secret ARN, Cognito pool id, image URI) | plain composite props | n/a (all required or explicitly optional per prop) | Any value from any source — a `stackOutput(...)`-resolved CFN Parameter (the real concrete stacks' own convention) or a literal already known at author time (`src/examples/byo/`'s convention) |
| CI (`#891`/`#892`) | Generated pipeline vs. BYO-CI | `chant build --components --generate gitlab` \| hand off the Build Archive | generated | Point existing CI at the Build Archive (`packages/core/src/components/verbs/build-archive.ts` in the chant repo) instead of running the generated pipeline — see `examples/adopt-alb-services/` in the chant repo |
| Agents (`#893`) | AgentCore wave | not yet built | n/a | Composite doesn't exist yet — nothing to omit or reference today beyond `shared-foundation`'s own `agentRole` seam above |
| Cost hooks (`#896`) | Build-time cost estimate | not yet built | n/a | Composite doesn't exist yet |

## The bring-your-own-everything example

`src/examples/byo/` deploys `shared-foundation`, `loom-db`, `loom-cognito`
(twice, as two Loom instances), `loom-backend`, and `loom-frontend` with
every referenceable seam set to `reference-existing`, against a single
consistent set of illustrative platform-team-owned resources (one VPC, one
KMS key, one ACM cert + Route53 zone, one pair of ECR repos, one agent
role, one external Postgres endpoint, one shared Cognito pool). No file
under `src/composites/` changed to build it. `src/examples/byo/README.md`
has the directory layout and the exact `chant build` commands;
`src/examples/byo/adoption.test.ts` is the verification test — it proves
the shipped modules compose, that the two Cognito instances resolve to one
pool, and that every stack with resources of its own serializes to valid
CloudFormation with no dangling `Ref`/`Fn::GetAtt` targets.

## Known gaps

Documented here rather than papered over, so a team adopting this today
knows exactly where the edges are.

- **`loom-backend`/`loom-frontend` execution/task IAM roles.** Both
  composites always provision their own roles (`buildRoles()` in
  `src/composites/loom-backend.ts`; the equivalent in
  `src/composites/loom-frontend.ts`) — there is no `reference-existing` seam
  for them, unlike every upstream piece they depend on (network, KMS, ECR,
  data, identity, and `shared-foundation`'s own `agentRole`). A team that
  needs pre-existing task/execution roles cannot get them through params
  today; this would need a seam added to those two composites, matching the
  shape `shared-foundation`'s `agentRole` already establishes.
- **No bastion composite.** Nothing in this codebase models a bastion host,
  and Loom's own upstream template doesn't define one either — there is
  nothing to reference or omit, and this page does not invent one to check
  a box.
- **A fully-`reference-existing` `loom-db`/`loom-cognito` stack has zero
  resources of its own**, by design — nothing is provisioned. `chant build
  --lexicon aws` on a directory with no lexicon-tagged declarable at all
  (not even a `Parameter`) fails its own empty-output guard; this reproduces
  identically against the repo's real, unmodified `src/loom-cognito` stack
  under `LOOM_COGNITO_MODE=reference-existing` (which has no cross-stack
  `Parameter` the way `loom-db`/`loom-backend`/`loom-frontend` each have at
  least one), so it's a general, pre-existing chant-core behavior, not
  something `#898`'s seams introduced. Such a stack's outputs are meant to
  be consumed by a downstream `stackOutput(...)`, not built standalone —
  `src/examples/byo/adoption.test.ts` verifies these stacks directly instead
  of relying on the CLI's own build path.
- **`shared-foundation`'s artifact bucket has no TLS-deny policy yet**
  (`WAW042`) — `chant build` on both the real `src/shared-foundation` stack
  and `src/examples/byo/shared-foundation` currently exits non-zero on this
  pre-existing gap. It's unrelated to the adoption seams this page
  documents and is being closed separately (`#890`).
