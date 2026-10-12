---
title: Run a second deployment
description: Stand up another Loom in the same AWS account, or another one, without collisions by giving it a different instance or env, and tear one down without touching the other.
prompt: |
  Read https://intentius.io/loomster/guides/run-a-second-deployment/ and list the loomster stacks already in the account with `aws cloudformation list-stacks`, grouped by project, env and instance.
  Propose an instance value that doesn't collide. Deploy only if the person asked for it in this session.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

Two independent Looms side by side, each with its own stacks and resources.

## Prerequisites

One deployment already running, and the inputs to deploy another (for a
production tier, its network and domain).

## Steps

1. Choose a new [instance](/loomster/concepts/glossary/#instance) (or env). The
   `{project}-{env}-{instance}` prefix namespaces every physical name (the RDS
   instance, buckets, the Cognito domain, ECR repositories, security groups) and
   every stack name: instance `a`'s `loom-db` stack is `loom-prod-a-loom-db`,
   instance `b`'s is `loom-prod-b-loom-db`. Deploying the same instance twice
   into one account is a collision, not a second deployment.

2. Deploy it with the same source:

   ```
   LOOM_ENV=prod LOOM_INSTANCE=a npx chant run --components all --env prod
   LOOM_ENV=prod LOOM_INSTANCE=b npx chant run --components all --env prod
   ```

   Cross-stack values resolve within each run's own stacks, so instance `b`'s
   `loom-backend` reads `b`'s `shared-foundation`, never `a`'s. production and
   production-ha have run this way in one account, as instances `a` and `b`
   ([Validation](/loomster/reference/validation/)).

3. Decide identity. Each instance can provision its own Cognito pool, or all
   can reference one org pool ([Share a Cognito pool](/loomster/guides/share-a-cognito-pool/)).

4. Tear one down without the other. `loom-teardown` is instance-scoped:

   ```
   LOOM_INSTANCE=b chant run loom-teardown
   chant approve loom-teardown approve-loom-teardown
   LOOM_INSTANCE=b chant run loom-teardown
   ```

   deletes only the `loom-prod-b-*` stacks.

## Next

[Tiers and instances](/loomster/concepts/tiers-and-instances/#topology) on when a
new instance is the right answer and when a Cognito group is.
