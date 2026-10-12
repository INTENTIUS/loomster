---
title: Evaluate for your org
description: "For a platform team deciding whether to run Loom: what loomster deploys and proves, how it fits an organization's accounts and identity, what it costs, and what it leaves to you."
---

## Works

- Three [tiers](/loomster/concepts/tiers-and-instances/) from one source: light
  for evaluation, production and production-ha for real use.
- Many Looms side by side, one [instance](/loomster/concepts/glossary/#instance)
  per account or boundary, optionally sharing one Cognito pool.
- Your VPC, KMS key, certificate, zone, repositories, IAM roles, database and
  Cognito pool through parameters, without forking.
- Backup, restore drills, gated restore, upgrade, rotation, drift detection and
  teardown as [Ops](/loomster/concepts/glossary/#op).
- Generated CI for GitHub, GitLab and Forgejo.

## Differs

- Loom's isolation between teams is logical (groups and tags in one database). A
  hard boundary is a separate instance.
- loomster deploys one account per instance. Several accounts means several
  instances.
- A deployed tier starts with no users. Sign in to the web app once you
  [add the first admin](/loomster/guides/add-the-first-admin/).
- Agent runtime, model and Evaluations costs are usage-based and come on top of
  the infrastructure.

## First step

[Deploy the light tier to AWS](/loomster/tutorial/light-on-aws/) on a scratch
account, then read [Validation](/loomster/reference/validation/).

## Proof

[Validation](/loomster/reference/validation/): what has run on each tier and
target, the recorded claims, and what nothing has shown.

## Then read

Tasks:
[Go to production](/loomster/tutorial/production/),
[Run a second deployment](/loomster/guides/run-a-second-deployment/),
[Share a Cognito pool](/loomster/guides/share-a-cognito-pool/),
[Estimate cost](/loomster/guides/estimate-cost/).

Explanation:
[Tiers and instances](/loomster/concepts/tiers-and-instances/),
[Provision, reference or omit](/loomster/concepts/adoption-seams/),
[Choosing chant](/loomster/concepts/why-chant/),
[Stateful resources](/loomster/concepts/what-holds-state/).

Reference:
[Tiers and targets](/loomster/reference/tiers/),
[Cost](/loomster/reference/cost/),
[Security](/loomster/reference/security/),
[Adoption seams](/loomster/reference/adoption-seams/).
