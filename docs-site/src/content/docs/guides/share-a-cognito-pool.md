---
title: Share a Cognito pool
description: Point one or many Loom instances at a Cognito pool your organization already runs, so users, groups and scopes are defined once and every instance honors them.
prompt: |
  Read https://intentius.io/loomster/guides/share-a-cognito-pool/ and look up the pool the person names with `aws cognito-idp describe-user-pool` and its clients and resource servers.
  Report the LOOM_COGNITO_* values to export, and whether the pool has the groups Loom expects.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

Loom's groups and `loom:group` tags isolate teams inside one deployment. They
don't isolate one deployment from another. An organization that runs many Looms,
one per account or compliance boundary, wants users and groups defined once.
`loom-cognito`'s identity [seam](/loomster/concepts/glossary/#seam) set to
`reference-existing` does that: the stack creates no Cognito resources and passes
your pool's ids through.

## Result

`loom-cognito` creating nothing, and every instance validating tokens from your
pool. Provisioning one pool per instance, the default, stays right for a single
boundary ([Tiers and instances](/loomster/concepts/tiers-and-instances/#topology)).

## Prerequisites

A Cognito pool (or an external OIDC IdP fronted by one) with a hosted-UI domain,
a resource server, a machine-to-machine client, and Loom's type and resource
groups (`t-admin`, `t-user`, `g-admins-<x>`, `g-users-<x>`).

## Steps

1. Export the pool's ids:

   ```
   export LOOM_COGNITO_MODE=reference-existing
   export LOOM_COGNITO_USER_POOL_ID=<pool id>
   export LOOM_COGNITO_DOMAIN=<hosted-UI domain prefix>
   export LOOM_COGNITO_RESOURCE_SERVER_ID=<resource server identifier>
   export LOOM_COGNITO_M2M_CLIENT_ID=<machine-to-machine client id>
   export LOOM_COGNITO_USER_CLIENT_ID=<end-user client id>          # optional
   ```

   The ARN, issuer, discovery URL and token URL are derived when unset;
   `LOOM_COGNITO_USER_POOL_ARN`, `LOOM_COGNITO_ISSUER`,
   `LOOM_COGNITO_DISCOVERY_URL` and `LOOM_COGNITO_TOKEN_URL` override them.

2. Deploy each instance with the same values and its own `LOOM_INSTANCE`. Each
   `loom-cognito` stack resolves to the same pool.
   `src/examples/byo/loom-cognito/` and `loom-cognito-second-instance/` build the
   composite twice under two instances against one pool, and
   `src/examples/byo/adoption.test.ts` checks both create nothing and resolve to
   the same pool id.

3. Seed each instance. `loom-seed` registers a Cognito authorizer for the pool in
   that instance's Loom ([Seed and validate a deploy](/loomster/guides/seed-and-validate/)).

Membership in a `g-admins-<x>` or `g-users-<x>` group decides which resources a
user sees in every instance at once, so name groups for the teams they stand for,
not for one instance.

## Next

[Run a second deployment](/loomster/guides/run-a-second-deployment/).
