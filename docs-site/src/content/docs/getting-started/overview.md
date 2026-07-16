---
title: What loomster is
description: A deployment of awslabs/loom you drive from the repo — six components, three tiers, seeded and validated. Built to be run by your agent.
---

loomster deploys [awslabs/loom](https://github.com/awslabs/loom) — an AWS Labs
sample for building and running Bedrock agents — as real, tiered infrastructure you
can stand up yourself. Six components, three tiers (`light` / `production` /
`production-ha`), generated CI, and a seed step that leaves the app usable on first
login, not only serving. It is pinned to Loom `v1.6.0`; upstream is a moving `as-is`
sample, so expect breaking changes between versions.

It is built with [chant](https://intentius.io/chant), which types and lints the
infrastructure and generates the pipeline — but you don't need to know chant to run
loomster. You need the verbs in the [Tutorial](/loomster/getting-started/tutorial/),
and an agent can run them for you.

## Drive it with your agent

This repo is meant to be operated by an agent from the first command. Two things
make that work:

- A **loomster skill** (`skills/loomster/SKILL.md`) — the capability map: every
  lifecycle verb (deploy, seed, validate, back up, reconcile, tear down), the golden
  paths, and the guardrails that keep a deploy from locking itself out.
- **chant's MCP server** — `chant serve mcp` (stdio) exposes `build`, `lint`,
  `list`, `describe`, `diff`, and the Op tools. Point your agent at it to inspect and
  build the graph directly.

Ask your agent to "stand up Loom locally" or "deploy the light tier and validate
it," and the skill tells it which commands to run and what not to touch.

## Where it runs today

- The full stack builds Loom's real images and runs on [Floci](https://floci.io), a
  local emulator, at `localhost:8080` — no AWS account.
- The **light tier is deployed end to end to a real AWS account**: a real ALB,
  backed by real RDS and Cognito.
- `production` / `production-ha` synthesize and pass the fidelity audit against
  Loom's `v1.6.0` templates, and deploy end to end on Floci, but haven't been applied
  to a live account yet.

The [Screens reference](/loomster/reference/screens/) maps the running app back to
the deployment decisions behind it — what each screen shows, what's seeded, and what
is left empty on purpose.

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
rollback compensation phase. Cross-stack inputs (cluster ARN, security group, target
group, the DB secret, the Cognito pool, and more) resolve via `stackOutput(...)`. A
seventh stack in the graph, `downstream-stub`, is verification-only: it consumes
`shared-foundation`'s outputs to prove they resolve, and is not part of Loom.

## Org topology

Loom is one control plane with logical, group-based multi-tenancy, not hard
isolation between teams. Two topologies:

- **Single-boundary** keeps one Loom and many Cognito groups. RBAC plus ABAC give
  each team a scoped view without a second deployment. Right when every team fits
  inside one compliance and account boundary.
- **Multi-boundary** runs many Looms, one per account, prod-vs-nonprod, or compliance
  domain, each a different instance. A shared org-level Cognito pool (or external OIDC
  IdP) is referenced by every instance, with groups and scopes defined once.

**Rule of thumb: groups inside a boundary, a new Loom per boundary.** The Tutorial's
[Org topology](/loomster/getting-started/tutorial/#org-topology) section has the
runnable proof that the two axes are orthogonal.

## Known gaps

- **`production` / `production-ha` aren't yet applied to a live account.** They deploy
  end to end on Floci — `just production-floci-e2e` stands the full stack up against a
  bring-your-own VPC and checks every tier-distinguishing resource — but the
  real-account apply is still the light tier's alone.
- **Agents deploy locally; only real agent execution needs AWS.** The AgentCore Floci
  image emulates the control plane, so the agents wave reaches `CREATE_COMPLETE`
  locally and definitions are manageable everywhere. Invoking an agent returns a
  canned stub, not real reasoning — that needs AgentCore on a live account. See
  [Run Loom on your laptop](/loomster/guides/local/) and
  [Local caveats](/loomster/reference/local-caveats/).
- No bastion composite, and Loom's own upstream template doesn't define one either.

The full seam-by-seam detail is in [Adoption](/loomster/adoption/overview/).
