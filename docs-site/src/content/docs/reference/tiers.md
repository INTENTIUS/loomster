---
title: Tiers & targets
description: The three deployment tiers (light, production, production-ha), the two deploy targets (Floci and real AWS) plus the local app-run harness, what differs between them, and what has been validated where.
---

loomster ships one source tree with three tiers. `naming.tier` selects the tier;
no tier has its own files. Every difference below is a parameter resolved off the
tier, so `light` and `production-ha` synthesize from the same composites.

A tier is orthogonal to where it deploys. Any tier can target Floci (a local
emulator) or real AWS; the target is chosen by whether `AWS_ENDPOINT_URL` is set,
nothing else in the code changes.

## Tiers

| | `light` | `production` | `production-ha` |
|---|---|---|---|
| Intended use | Browse, evaluate, laptop and single-account dev | Adoptable single-AZ deployment | Adoptable high-availability deployment |
| VPC | Self-provisioned (public subnets, no NAT) | Bring your own | Bring your own |
| PrivateLink + private subnets | Omitted | Provisioned | Provisioned |
| ECS `AssignPublicIp` | `ENABLED` (the only route to ECR without a NAT) | `DISABLED` | `DISABLED` |
| Backend scaling | 1 task, no autoscaling | 1-task floor + autoscaling | 2-task floor + autoscaling |
| RDS | Single-AZ | Single-AZ + RDS Proxy | Multi-AZ + RDS Proxy + secret rotation |
| RDS deletion protection | Off | On | On |
| RDS backup retention | 7 days | 7 days | 7 days |
| Agents | Assistant only | Assistant + no-code harness | Assistant + no-code harness |
| Agent network mode | `PUBLIC` | `VPC` | `VPC` |
| AgentCore Memory retention | 30 days | 90 days | 90 days |

Constant across every tier: the six components, cross-stack wiring, cost tags,
the naming scheme, and always-on secret encryption (no opt-out). Adoption seams
(`provision | reference-existing | omit`) are also tier-independent — a `light`
deploy can reference an existing VPC, a `production` deploy can provision one. See
[Adoption](/loomster/adoption/overview/).

Each tier also comes with seeded application defaults so a fresh deploy is usable
out of the box: `light` defaults to a `demo` seed profile, the production tiers to
`foundation` (config only). See [Seeded defaults](/loomster/reference/seeding/).

## Targets

| Target | Selected by | What runs | Verify |
|---|---|---|---|
| Floci | `AWS_ENDPOINT_URL` set (e.g. `http://localhost:4566`) | Managed pieces (RDS, Cognito, S3, ECR) plus, on the AgentCore-enabled image, the agents wave | Health-gate skipped — the ALB to ECS data path is not emulated |
| Real AWS | `AWS_ENDPOINT_URL` unset | Everything, on live infrastructure | Full, including the ECS health-gate |

A third path, `just local-up`, is a laptop harness rather than a tier or target:
it runs the app tier (frontend, backend, a reverse proxy standing in for the ALB)
from a chant-generated `docker-compose.yml`, wired to Floci for the managed
pieces. The result is a browsable, authenticated Loom with no AWS account. See
[Run Loom on your laptop](/loomster/guides/local/).

## What has been validated

| Tier | Floci | Real AWS |
|---|---|---|
| `light` | Full stack, 7/7 stacks `CREATE_COMPLETE`, including the code-config agents wave against the AgentCore-enabled image | Deployed end to end — the real ALB served the Loom SPA, backed by real RDS and Cognito, backend passed the ECS health-gate. The agents wave has not been applied to a live account. |
| `production` | Full stack, 7/7 `CREATE_COMPLETE` against a BYO VPC — RDS Proxy, PrivateLink (NLB + VPC endpoint service), ACM + Route53, backend autoscaling, and both agent runtimes (assistant code-config + harness) | Not applied |
| `production-ha` | Full stack, 7/7 `CREATE_COMPLETE` — as production, plus Multi-AZ RDS, secret rotation, and a 2-task backend floor | Not applied |

Both production tiers deploy end to end on Floci against a bring-your-own VPC
(the tier guard requires `LOOM_VPC_ID` + subnets and a `LOOM_DOMAIN_NAME`; a
provisioned VPC is light-only). Every tier-distinguishing resource creates. Two
things Floci can't reflect: it runs RDS as a single container, so `MultiAZ` is
requested in the template but reported `false` by the API; and the app data path
(ALB → ECS) isn't emulated, so the runtime health-gate is real-AWS-only.

Neither production tier has been applied to a **live account** yet — that's the
remaining step for a real HA proof. Real agent execution (invoke) also still
needs AgentCore on a live account, since the emulator's invoke path is a canned
stub. See [Local caveats](/loomster/reference/local-caveats/).
