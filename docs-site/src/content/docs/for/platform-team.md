---
title: Platform team
description: "For the team that will run Loom for others: adopting your own network, identity and roles, running several deployments, wiring CI, and keeping the code in step with Loom releases."
---

## Works

- Every piece you already own is a [seam](/loomster/concepts/glossary/#seam):
  network, KMS, ECR, DNS, certificate, agent role, backend and frontend roles,
  database, Cognito pool.
- One instance per boundary with a shared Cognito pool, from the same source.
- Generated pipelines that follow the component graph, a gated deploy, and
  scheduled [Ops](/loomster/concepts/glossary/#op) behind repository variables.
- Loom bumps as a pin change plus an upgrade Op that snapshots first.

## Differs

- Light builds its own VPC; the production [tiers](/loomster/concepts/tiers-and-instances/)
  always need yours.
- Per-agent role stacks and the DNS zone from `loom-dns-setup` live outside the
  component graph, so teardown leaves them.
- CloudFormation keeps the state; there is no backend to run.

## First step

[Bring your own network and IAM](/loomster/guides/bring-your-own-network-and-iam/).

## Proof

`src/examples/byo/adoption.test.ts` builds every seam as `reference-existing` on
all three tiers ([Bring your own everything](/loomster/guides/bring-your-own-everything/));
[Validation](/loomster/reference/validation/) lists what has run live.

## Then read

Tasks:
[Share a Cognito pool](/loomster/guides/share-a-cognito-pool/),
[Bring your own KMS, ECR and database](/loomster/guides/bring-your-own-kms-ecr-and-database/),
[Run a second deployment](/loomster/guides/run-a-second-deployment/),
[Add CI to your forge](/loomster/guides/add-ci-to-your-forge/),
[Upgrade Loom](/loomster/guides/upgrade-loom/).

Explanation:
[Provision, reference or omit](/loomster/concepts/adoption-seams/),
[Tiers and instances](/loomster/concepts/tiers-and-instances/).

Reference:
[Adoption seams](/loomster/reference/adoption-seams/),
[Build parameters](/loomster/reference/parameters/),
[Components](/loomster/reference/components/),
[Naming and tagging](/loomster/reference/naming/).
