---
title: Network & IAM
description: The two load-bearing reference-existing seams — bring your own VPC/subnets and your own IAM roles. reference-existing is first-class here, not a fallback.
---

Most platform teams don't let an application stack provision its own VPC or IAM
roles — a platform/security team owns those centrally. So for both, `reference-existing`
is the first-class path, not a fallback. See the [seam matrix](/loomster/adoption/#the-seam-matrix)
for the exact option/default/replacement of each.

## Network

`shared-foundation`'s `network` seam takes a VPC id and public/private subnet ids
by AZ. `reference-existing` wires the ALB, ECS tasks, and security groups straight
into the given ids; chant creates no VPC, subnet, route table, or internet gateway.

```
export LOOM_VPC_ID=<vpc id>
export LOOM_PUBLIC_SUBNET_IDS=<subnet>,<subnet>     # >=2, across 2 AZs
export LOOM_PRIVATE_SUBNET_IDS=<subnet>,<subnet>    # required once PrivateLink is in play
```

`provision` builds two public subnets and nothing else — it exists for a
from-scratch light/local synth, and the composite **refuses it on `production` /
`production-ha`**: there's no provisioned path to the private subnets PrivateLink
requires. So the production tiers always reference an existing network. The
deployable fails fast with a tier-specific message when those vars are missing,
rather than surfacing a generic error deep in synthesis.

Every downstream network consumer (`loom-db`, `loom-backend`, `loom-frontend`,
`loom-agents`) reads the VPC/subnet ids back out of `shared-foundation`'s own
outputs, so you set them once.

## IAM

IAM is first-class reference-existing across the board:

- **`shared-foundation`'s `agentRole`** — the AgentCore execution role, scoped to
  that stack's own artifact bucket, ECR KMS, and logs. `provision | reference-existing | omit`
  at the composite level; hand over `agentRoleArn` to use the least-privilege role a
  security team already built. `src/examples/byo/` wires it, though the standard
  deployable doesn't yet expose it as a `LOOM_*` env var (the same wiring the DNS
  seams just got — a small follow-up).
- **`loom-backend`'s execution + task roles** — `provision | reference-existing`
  via `LOOM_BACKEND_EXECUTION_ROLE_ARN` / `LOOM_BACKEND_TASK_ROLE_ARN`. A referenced
  execution role needs ECR-pull + logs-write; the task role needs whatever the app
  itself calls.
- **`loom-frontend`'s execution role** — `provision | reference-existing` via
  `LOOM_FRONTEND_EXECUTION_ROLE_ARN`. It needs ECR-pull + logs-write; there's no task
  role, matching Loom's own template.

None of this forks a composite. `src/examples/byo/` wires every one of these to
`reference-existing` against one set of platform-owned resources, with no edits
under `src/composites/`.
