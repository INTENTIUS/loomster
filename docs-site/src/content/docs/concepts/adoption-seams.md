---
title: Provision, reference or omit
description: Why every replaceable piece of loomster's infrastructure takes provision, reference-existing or omit through parameters, so a team adopts Loom without forking a composite.
---

Most organizations don't let an application stack create its own VPC, KMS keys,
certificates or IAM roles. A platform or security team owns those and hands out
ids. loomster is built for that case, so each piece of infrastructure a team
might already own is a seam with up to three modes:

- `provision`: the [composite](/loomster/concepts/glossary/#composite) creates it.
  The default for most seams.
- `reference-existing`: you pass ids or ARNs, and the composite wires them in
  and creates nothing for that piece.
- `omit`: the piece is left out, where Loom still works without it (a KMS key,
  ECR repositories, a custom domain).

Some pieces are load-bearing and only choose between `provision` and
`reference-existing`: the network, the database and the backend's IAM roles.

## Parameters, not forks

Every seam is a build parameter (`LOOM_VPC_ID`, `LOOM_COGNITO_MODE`,
`LOOM_AGENT_ROLE_ARN` and so on, all in [Build parameters](/loomster/reference/parameters/)).
Changing a mode never means editing a file under `src/composites/`. That keeps
an adopting team on the same source as everyone else, so a Loom bump or a
loomster fix reaches them without a merge.

`src/examples/byo/` sets every seam to `reference-existing` at once against one
set of platform-owned resources, and `src/examples/byo/adoption.test.ts` checks
that it builds valid CloudFormation on all three
[tiers](/loomster/concepts/tiers-and-instances/).

## Seams and tiers are independent

A `light` deploy can reference an existing VPC, and a `production` deploy can
provision a KMS key. The one exception is the network: `production` and
`production-ha` always reference yours, because PrivateLink needs private
subnets a loomster-built VPC doesn't have.

## Next

- [Adoption seams](/loomster/reference/adoption-seams/) lists every seam, its
  modes, its default and what replacing it needs.
- The how-to guides under Adopt your infrastructure walk the common ones:
  [network and IAM](/loomster/guides/bring-your-own-network-and-iam/),
  [a shared Cognito pool](/loomster/guides/share-a-cognito-pool/),
  [KMS, ECR and the database](/loomster/guides/bring-your-own-kms-ecr-and-database/).
