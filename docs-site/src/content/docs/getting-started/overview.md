---
title: What loomster is
description: The map before the tutorial — six components, what deploys where today, tiers and org topology, and the known edges.
---

loomster is a **deployment of [awslabs/loom](https://github.com/awslabs/loom)** —
typed, tiered infrastructure-as-code on [chant](https://intentius.io/chant) that
stands up Loom's infrastructure *and* leaves the app usable, not just running.
Six components, three tiers (`light` / `production` / `production-ha`), generated
CI, a naming scheme that lets many Loom instances coexist in one or many AWS
accounts without collision, and a seed step that populates the app so its screens
work on first login. Pinned to Loom `v1.6.0`, a moving `as-is` AWS Labs sample,
so expect breaking changes upstream between versions.

The [Screens reference](/loomster/reference/screens/) maps the running app to the
deployment decisions behind it — what every screen shows, what's seeded, and
what's deliberately left empty.

Loom's own deploy today is a manual, multi-step SAM process behind a
`DEPLOYMENT.md`. chant types it, lints it, dedupes the cross-stack glue, orders
it, tiers it, and generates the pipeline. For the honest breakdown of where that's
a real win over the SAM baseline and where it's parity, see the tutorial's
[Positioning](/loomster/getting-started/tutorial/#positioning).

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
  deploy end to end on Floci — a repeatable `just production-floci-e2e` stands the
  full stack up against a bring-your-own VPC and checks every tier-distinguishing
  resource — but the real-account apply is still the light tier's alone.
- **Agents deploy locally; only real agent execution needs AWS.** The
  AgentCore-enabled Floci image emulates the control plane, so the agents wave
  reaches `CREATE_COMPLETE` locally and definitions are manageable everywhere.
  Invoking an agent returns a canned stub, not real reasoning — that needs
  AgentCore on a live account. See [Run Loom on your laptop](/loomster/guides/local/)
  and [Local caveats](/loomster/reference/local-caveats/).
- No bastion composite, and Loom's own upstream template doesn't define one either.

The full seam-by-seam detail is in [Adoption](/loomster/guides/adoption/).
