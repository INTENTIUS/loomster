---
title: Tiers and targets
description: What differs between the light, production and production-ha tiers, how a target (Floci or real AWS) is chosen, and the recovery targets of each tier.
---

One source tree, three [tiers](/loomster/concepts/tiers-and-instances/).
`LOOM_TIER` selects one; every difference below is a value resolved from it, so
`light` and `production-ha` build from the same composites. What has run where
is on [Validation](/loomster/reference/validation/).

## Tiers

| | `light` | `production` | `production-ha` |
|---|---|---|---|
| Intended use | Browse, evaluate, single-account dev | Adoptable single-AZ deployment | Adoptable high-availability deployment |
| VPC | Built by the stack (public subnets, no NAT) | Yours | Yours |
| PrivateLink and private subnets | Omitted | Provisioned | Provisioned |
| ECS `AssignPublicIp` | `ENABLED`, the only route to ECR without a NAT | `DISABLED` | `DISABLED` |
| Serving | HTTP on the ALB's DNS name | HTTPS on your domain | HTTPS on your domain |
| Backend scaling | 1 task, no autoscaling | 1-task floor and autoscaling | 2-task floor and autoscaling |
| RDS | Single-AZ | Single-AZ and RDS Proxy | Multi-AZ, RDS Proxy and secret rotation |
| RDS deletion protection | Off | On | On |
| RDS backup retention | 7 days | 7 days | 7 days |
| Cognito | MFA off, no end-user client | MFA on (software token), end-user client, deletion protection | As production |
| Agents | The assistant (code configuration) | The assistant | The assistant |
| Agent network mode | `PUBLIC` | `VPC` | `VPC` |
| AgentCore Memory retention | 30 days | 90 days | 90 days |
| Default seed profile | `demo` | `foundation` | `foundation` |
| Rotation [Op](/loomster/concepts/glossary/#op) | none | `loom-rotate-production` | `loom-rotate-production-ha` |

The same on every tier: the six components, cross-stack wiring, the cost tags,
the naming scheme, and secret encryption with no opt-out. Seams are
independent of the tier ([Adoption seams](/loomster/reference/adoption-seams/)).

## Targets

| Target | Chosen by | What runs | Verify phase |
|---|---|---|---|
| [Floci](/loomster/concepts/glossary/#floci) | `AWS_ENDPOINT_URL` set, such as `http://localhost:4566` | The stacks, including the agents wave on Floci 2.2.0 | Skipped: Floci doesn't serve the ALB to ECS path |
| Real AWS | `AWS_ENDPOINT_URL` unset | Everything | Steady state and the health check |

`just local-up` is a third path: it deploys the light tier on Floci and runs the
app from a generated compose file with a proxy in place of the ALB
([Run Loom locally](/loomster/getting-started/)).

## Recovery targets

All three tiers keep 7 days of automated backups with point-in-time recovery,
so for data loss the recovery point is about 5 minutes anywhere in that window.
They differ in how an infrastructure failure is handled.

| Tier | AZ or instance failure | Data loss (corruption, bad delete) | Region loss |
|---|---|---|---|
| `light` | `loom-restore` and cutover | point-in-time or snapshot `loom-restore` | survivable only with a `loom-backup` DR copy |
| `production` | `loom-restore` and cutover | point-in-time or snapshot `loom-restore` | survivable only with a DR copy |
| `production-ha` | Multi-AZ failover, about 1 to 2 minutes, no data loss | point-in-time or snapshot `loom-restore` | survivable only with a DR copy |

Recovery time outside a Multi-AZ failover is how long the gated `loom-restore`
takes to restore, wait for approval and cut over. Data older than the 7-day
window survives only in a manual snapshot, which `loom-backup` takes.
[Back up and restore](/loomster/guides/back-up-and-restore/) has the steps.
