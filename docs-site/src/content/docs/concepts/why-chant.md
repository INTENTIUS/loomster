---
title: Choosing chant
description: What loomster gets from writing Loom's infrastructure in chant instead of Loom's own SAM templates and makefiles, and what stays plain CloudFormation either way.
---

Loom's own deploy is a set of SAM templates and makefiles: you fill in
`etc/environment.sh` files, run `make` targets per stack in order, and copy
outputs between them with `make outputs`. loomster deploys the same application
from typed source in [chant](https://intentius.io/chant/).

## Same discipline, one layer down

Loom's [launch post](https://aws.amazon.com/blogs/opensource/building-secure-ai-agents-at-scale-introducing-loom-for-aws/)
states its model: no code is generated at runtime and deployed into an
environment; only configuration changes, and the control plane manages it.
chant applies the same model to the infrastructure:

- Loom scans agent code once, before any deployment. chant type-checks and lints
  a stack when you write it, before anything synthesizes.
- Loom never generates agent code at runtime. chant never generates
  infrastructure at deploy time: `chant build` emits a CloudFormation template
  once, and every environment applies that template.
- Loom redeploys by changing configuration. loomster redeploys by changing a
  [tier](/loomster/concepts/tiers-and-instances/), an instance or a [seam](/loomster/concepts/glossary/#seam)'s mode.

## Additions over SAM

- A wrong stack-output name or an unresolved `Ref` fails the build, before a
  stack ever reaches `ROLLBACK_COMPLETE`.
- Cross-stack values move with `stackOutput(...)`: `loom-backend` reads nine
  inputs from three other stacks with no parameter files.
- One dependency order: `chant graph --components` prints it, and
  `chant run --components all` and the generated CI pipelines both follow it.
- Images build once and deploy by digest.
- Tiers are parameters of one composite per component, not copies of templates.
- CI for GitHub, GitLab and Forgejo is generated from the same graph.
- [Ops](/loomster/reference/ops/) for backup, restore, upgrade, rotation, drift and
  teardown, with approval gates recorded in git.
- A local stack on [Floci](/loomster/concepts/glossary/#floci) with the same CloudFormation as real AWS.

## CloudFormation underneath

The output is standard CloudFormation, as SAM's is. CloudFormation keeps the
state, so there is no state file to host. You can apply the templates and walk
away from chant entirely ([Deploy without chant](/loomster/guides/deploy-without-chant/)).
What differs is how the templates are written, ordered and run.
