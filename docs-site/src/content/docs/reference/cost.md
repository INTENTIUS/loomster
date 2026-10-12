---
title: Cost
description: What costs money in each tier of a loomster deployment, what keeps costing after a teardown, which seed and claim steps are billable, and how to estimate it.
---

loomster carries no pricing data. For numbers, run Infracost against the
synthesized templates ([Estimate cost](/loomster/guides/estimate-cost/)). This
page lists what drives the bill.

## Per tier

| Resource | `light` | `production` | `production-ha` |
|---|---|---|---|
| ALB | one | one | one |
| Fargate tasks | backend 1, frontend | backend 1 and autoscaling, frontend | backend 2 and autoscaling, frontend |
| RDS | single-AZ | single-AZ and RDS Proxy | Multi-AZ and RDS Proxy, rotation function |
| PrivateLink | none | NLB and endpoint service | NLB and endpoint service |
| NAT or VPC endpoints | none (public subnets) | yours | yours |
| Route53 hosted zone | none | one, unless you reference yours | one, unless you reference yours |
| KMS keys | ECR and secrets keys | as light | as light |
| AgentCore | the assistant runtime and its memory | as light | as light |

production-ha costs materially more than production: Multi-AZ RDS, two backend
tasks and the rotation function on top of everything production has. A hosted
zone is about $0.50 a month.

## Usage-based

Outside any estimate of the templates, and growing with use:

- agent invocations: AgentCore Runtime time and model tokens;
- AgentCore Memory events and records;
- Evaluations, which invoke an agent and a model to score it;
- CloudWatch logs and the `aws/spans` log group Transaction Search writes;
- S3 artifacts and ECR images, including old versions.

## Seeding and claims

- The `demo` seed profile, the default on light, deploys an agent, creates a
  memory, invokes the agent and runs an evaluation. On a live account all of that
  is billable. `foundation`, the production tiers' default, creates nothing
  billable ([Screens](/loomster/reference/screens/#seed-profiles)).
- AWS [claims](/loomster/concepts/glossary/#claim) refuse to run unless an AWS
  Budgets budget alerts at $10 or less (`LOOM_CLAIMS_ALERT_USD`) and this
  month's spend is under $25 (`LOOM_CLAIMS_SPEND_CAP_USD`), and they delete what
  they create afterwards ([Claims](/loomster/reference/claims/#real-aws)).

## After a teardown

`loom-teardown` leaves the RDS final snapshot, the versioned artifact bucket and
the ECR repositories, which keep costing storage until you delete them.
Per-agent role stacks cost nothing; a hosted zone from `loom-dns-setup` keeps its
monthly charge ([Tear down a deployment](/loomster/guides/tear-down/)).

## Keeping a tutorial cheap

Use the light [tier](/loomster/concepts/tiers-and-instances/), seed with
`foundation`, and tear down when you're done. The local stack on Floci costs
nothing ([Run Loom locally](/loomster/getting-started/)).
