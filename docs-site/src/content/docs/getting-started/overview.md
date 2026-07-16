---
title: What loomster is
description: The map before the tutorial. Six components, what deploys where today, real wins vs. parity with Loom's own SAM deploy, and the known edges.
---

loomster is typed, tiered infrastructure-as-code for
[awslabs/loom](https://github.com/awslabs/loom) on
[chant](https://intentius.io/chant). Six components, three tiers
(`light` / `production` / `production-ha`), generated CI, and a naming scheme
that lets many Loom instances coexist in one or many AWS accounts without
collision. Pinned to Loom `v1.6.0`, a moving `as-is` AWS Labs sample, so expect
breaking changes upstream between versions.

Loom's own deploy today is a manual, multi-step SAM process behind a
`DEPLOYMENT.md`. chant types it, lints it, dedupes the cross-stack glue, orders
it, tiers it, and generates the pipeline.

**Where it runs today:**

- The full stack builds Loom's real images and runs on [Floci](https://floci.io),
  a local emulator. Browsable at `localhost:8080`, no AWS account.
- The **light tier is deployed end to end to a real AWS account**. Loom is served
  on a real ALB, backed by real RDS and Cognito.
- `production` / `production-ha` synthesize and pass the fidelity audit against
  Loom's `v1.6.0` templates, but haven't been applied to a live account yet.

The [Tutorial](/loomster/getting-started/tutorial/) is the hands-on walkthrough,
from a browsable local Loom to the light tier on real AWS to production.

## Components

Six stacks, deployed in dependency order:

| Component | Depends on | What it is |
|---|---|---|
| `shared-foundation` | — | ALB, ECS cluster, ECR, KMS, S3 artifact bucket, DNS, agent IAM role |
| `loom-cognito` | — | Cognito user pool, hosted-UI domain, resource server, clients |
| `loom-db` | `shared-foundation` | RDS Postgres, Secrets Manager; production adds RDS Proxy + rotation |
| `loom-frontend` | `shared-foundation` | The frontend ECS Fargate service |
| `loom-backend` | `shared-foundation`, `loom-db`, `loom-cognito` | The backend ECS Fargate service |
| `loom-agents` | `shared-foundation`, `loom-cognito`, `loom-backend` | The Bedrock AgentCore agents — a low-code Strands agent (every tier) + a no-code harness agent (production-ha) |

`loom-frontend` and `loom-backend` each run build, publish, apply, verify, with a
rollback compensation phase. Cross-stack inputs (cluster ARN, security
group, target group, the DB secret, the Cognito pool, and more) resolve via
`stackOutput(...)`. A seventh stack in the graph, `downstream-stub`, is a
verification-only stack. It consumes `shared-foundation`'s outputs to prove they
resolve, and is not part of Loom.

## Same discipline, one layer down

Loom's own [launch post](https://aws.amazon.com/blogs/opensource/building-secure-ai-agents-at-scale-introducing-loom-for-aws/)
states its model plainly: no code is generated at runtime and deployed into any
environment. Only configuration changes, and the control plane manages that
configuration. That is chant's pitch too, one layer beneath:

- Loom scans the agent code once, ahead of any deployment. chant type-checks and
  lints a stack at author time, before anything synthesizes.
- Loom never generates agent code at runtime. chant never generates
  infrastructure code at deploy time. `chant build` emits a CloudFormation
  template once, and every environment applies that same template.
- Loom redeploys by changing config, not by hand-editing a running agent. chant
  redeploys by changing tier, instance, or an adoption seam's mode, not by
  forking a composite per environment.

## Real wins vs. parity

Loom's baseline is that manual SAM process. Clone three repos, `sam build` /
`sam deploy` per stack, in order, by hand. Some of the difference is a real
improvement; some of what sounds like a chant win is CloudFormation-vs-Terraform,
or no difference at all.

**Real wins:**

- Author-time type-check and lint of cross-resource references. A wrong output
  name or unresolved `Ref` is a build failure, not a `ROLLBACK_COMPLETE`.
- Cross-stack wiring without hand-written glue. `loom-backend` resolves nine
  inputs across three upstream stacks via `stackOutput(...)`.
- One dependency-ordered orchestrator, not a `DEPLOYMENT.md` a human executes.
- Build-once, promote-by-digest.
- Tiering as config, not three forked copies.
- Generated CI from the same graph the CLI reads.
- A local emulator for the light tier. The CloudFormation doesn't change between
  Floci and real AWS, only the endpoint does.

**Parity, not wins:**

- **"No state file."** CloudFormation manages state as a service, which is true of
  vanilla SAM too. A real advantage over a Terraform-style state file, not
  something chant adds on top of SAM.
- **Walk-away** behaves identically. chant emits standard CloudFormation and stops,
  and SAM does the same. The difference is the authoring and orchestration path,
  not the output format.

The Tutorial's [Positioning](/loomster/getting-started/tutorial/#positioning)
section has the full argument.

## Org topology

Loom is one control plane with logical, group-based multi-tenancy, not hard
isolation between teams. Two topologies:

- **Single-boundary** keeps one Loom and many Cognito groups. RBAC plus ABAC give
  each team a scoped view without a second deployment. Right when every team fits
  inside one compliance and account boundary.
- **Multi-boundary** runs many Looms, one per account, prod-vs-nonprod, or
  compliance domain, each a different instance. A shared org-level Cognito pool (or
  external OIDC IdP) is referenced by every instance, with groups and scopes
  defined once.

**Rule of thumb: groups inside a boundary, a new Loom per boundary.** The
Tutorial's [Org topology](/loomster/getting-started/tutorial/#org-topology)
section has the runnable proof that the two axes are orthogonal.

## Known gaps

Written down rather than papered over:

- **`production` / `production-ha` aren't yet applied to a live account.** They
  synthesize and pass the fidelity audit; the light tier is the one that's been
  deployed to real AWS end to end.
- **Agents deploy locally; only real agent execution needs AWS.** The
  AgentCore-enabled Floci image emulates the control plane, so the agents wave
  reaches `CREATE_COMPLETE` locally and definitions are manageable everywhere.
  Invoking an agent returns a canned stub, not real reasoning — that needs
  AgentCore on a live account. See [Run Loom on your laptop](/loomster/guides/local/)
  and [Local caveats](/loomster/reference/local-caveats/).
- No bastion composite, and Loom's own upstream template doesn't define one either.

The full seam-by-seam detail is in [Adoption](/loomster/guides/adoption/).
