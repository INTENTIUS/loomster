---
title: Architecture
description: The six components loomster deploys Loom as, the order they deploy in, how values pass between them, and what runs around them.
---

loomster deploys [awslabs/loom](https://github.com/awslabs/loom) v1.9.0 as six
CloudFormation stacks written in [chant](/loomster/concepts/glossary/#chant).
Loom's backend and frontend images are built from the pinned upstream source;
loomster writes the infrastructure around them, the [Ops](/loomster/concepts/glossary/#op)
that run it, and the CI that deploys it.

## Components

| Component | Depends on | What it is |
|---|---|---|
| `shared-foundation` | | ALB, ECS cluster, ECR repositories, KMS key, S3 artifact bucket, DNS and certificate, security groups, PrivateLink, the shared agent execution role |
| `loom-cognito` | | Cognito user pool, hosted-UI domain, resource server and scopes, clients |
| `loom-db` | `shared-foundation` | RDS Postgres and its secrets; RDS Proxy on the production [tiers](/loomster/concepts/tiers-and-instances/), Multi-AZ and rotation on production-ha |
| `loom-frontend` | `shared-foundation` | The frontend ECS Fargate service |
| `loom-backend` | `shared-foundation`, `loom-db`, `loom-cognito` | The backend ECS Fargate service and its task role |
| `loom-agents` | `shared-foundation`, `loom-cognito`, `loom-backend` | The Strands assistant on AgentCore Runtime (code configuration, Runtime V2) |

A seventh stack, `downstream-stub`, checks that `shared-foundation`'s outputs
resolve for a consumer. It isn't part of Loom. [Components](/loomster/reference/components/)
has each one's phases and outputs.

## Deploy order

```
$ npx chant graph --components
Deploy order (waves apply top-to-bottom; a wave's components are parallel-safe):
  1. loom-cognito, shared-foundation
  2. downstream-stub, loom-db, loom-frontend
  3. loom-backend
  4. loom-agents
```

`chant run --components all` deploys in that order. Each component synthesizes
its own template, deploys it, and passes its outputs on: the cluster ARN, the
database secret, the Cognito pool and the rest reach the next stack through
`stackOutput(...)`, with no parameter files. The generated CI pipelines follow
the same graph.

`loom-backend` and `loom-frontend` also build their image from `vendor/loom`
(fetched by `npm run vendor`), publish it by digest, deploy, then on real AWS
wait for the service to settle and pass `/health`. A failed deploy rolls the
service back to its previous task definition.

## Runtime layout

```
Internet ──▶ ALB (shared-foundation) ──┬─▶ frontend tasks (loom-frontend)
                                       └─▶ backend tasks (loom-backend) ──▶ RDS (loom-db)
                                                         │                   └ via RDS Proxy on production tiers
                                                         ├─▶ Cognito (loom-cognito): token validation
                                                         └─▶ AgentCore: agents Loom deploys, invokes, evaluates
Private networks ──▶ PrivateLink NLB + endpoint service (production tiers)
```

The backend task role is what lets Loom create AgentCore runtimes, read
secrets, query logs and use the Agent Registry. Its full grant list is in
[Security](/loomster/reference/security/).

## Around the stacks

- Seeding: a fresh Loom database holds almost nothing, so `loom-seed` registers
  what loomster provisioned (the agent role, a Cognito authorizer, and on the
  demo profile sample content) through Loom's own API.
  [Screens](/loomster/reference/screens/) shows what each screen gets.
- Validation: `just validate` reads every screen's endpoint and fails if a
  screen the profile seeds is empty.
- Ops: backup, restore, upgrade, rotation, drift and teardown run with
  `chant run`, and the destructive ones stop at an approval gate
  ([Gated Ops](/loomster/concepts/gated-ops/)).
- CI: GitHub, GitLab and Forgejo pipelines generated from the component graph
  ([CI providers](/loomster/reference/ci/)).
- Local: `just local-up` runs the same templates on [Floci](/loomster/concepts/glossary/#floci)
  and the app from a generated compose file ([Run Loom locally](/loomster/getting-started/)).
- Claims: one script per documented capability, each able to fail on purpose
  ([Validation](/loomster/reference/validation/)).
