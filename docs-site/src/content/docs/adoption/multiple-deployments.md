---
title: Multiple deployments
description: Run N Loom instances in one AWS account (or across many) without collision — the instance segment namespaces every physical resource and every CloudFormation stack.
---

A team often needs more than one Loom: prod vs non-prod, one per compliance domain,
one per tenant. loomster runs any number of them in a single AWS account (or spread
across accounts) without collision. The isolation boundary is the **`instance`**
segment.

## How isolation works

Two things get namespaced by the `{project}-{env}-{instance}` prefix (see
[Naming & Tagging](/loomster/reference/naming/)):

- **Physical resource names** — the RDS instance, S3 buckets, Cognito domain, ECR
  repos, SGs, and so on: `loom-prod-a-shared-foundation-artifacts-…`.
- **CloudFormation stack names** — a component `loom-db` deploys to the stack
  `loom-prod-a-loom-db`, not a bare `loom-db`.

So two deployments that differ in `env` or `instance` never touch each other's stacks
or resources. Cross-stack wiring stays internal to each deployment: `stackOutput(...)`
resolves against the deploying run's own stacks, so instance `a`'s `loom-backend`
reads instance `a`'s `shared-foundation`, never `b`'s.

The **`instance` (and `env`) is the boundary** — deploying the *same* `instance` twice
into one account is not two deployments, it's a collision (the second run's physical
names already exist). A second deployment always means a different `instance` or `env`.

## Standing up a second instance

Each deployment is the same source with different env vars. To run instance `b`
alongside instance `a`:

```
# instance a
LOOM_ENV=prod LOOM_INSTANCE=a  chant run --components all --env prod

# instance b — a fully separate stack set, in the same account
LOOM_ENV=prod LOOM_INSTANCE=b  chant run --components all --env prod
```

Both were exercised together during live validation: `production` ran as instance `a`
while `production-ha` ran as instance `b` in the same account, each 7/7 and fully
independent.

Tear one down without touching the other — `loom-teardown` is instance-scoped, so
`LOOM_INSTANCE=b chant run loom-teardown --temporal` deletes only the `loom-prod-b-*`
stacks.

## Shared vs. separate identity

Two topologies (see [Identity & topology](/loomster/adoption/identity/)):

- **Fully separate** — each instance provisions its own Cognito pool. Simplest;
  no shared users.
- **Shared org pool** — point every instance at one existing Cognito pool (or an
  external OIDC IdP) with `loom-cognito`'s `reference-existing` seam, so users and
  scopes are defined once and every instance honors them. This is the multi-boundary
  topology: groups inside a boundary, a new instance per boundary.

Nothing about running multiple instances forks a composite — it's `LOOM_INSTANCE`
(and the identity seam) all the way down.
