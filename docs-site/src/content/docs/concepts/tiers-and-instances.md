---
title: Tiers and instances
description: The two independent settings behind every loomster deployment, tier for the size of one Loom and instance for which Loom it is, and the single-boundary and multi-boundary topologies they give.
---

Every physical name and cost tag comes from one call,
`loomNaming(params, component)`, keyed
`{project}-{env}-{instance}-{component}-{resource}` ([Naming and tagging](/loomster/reference/naming/)).
Two of those inputs are the settings you choose for a deployment, and they don't
depend on each other.

## Tier

`LOOM_TIER` is `light`, `production` or `production-ha`. It sizes one Loom:

- `light` builds its own VPC with public subnets, serves HTTP on the ALB's own
  DNS name, and runs single-AZ RDS. It needs nothing from you but an account.
- `production` needs your VPC with private subnets, and adds HTTPS on a custom
  domain, PrivateLink, an RDS Proxy, backend autoscaling, Cognito MFA and
  deletion protection.
- `production-ha` adds Multi-AZ RDS, Secrets Manager rotation of the database
  credential and a two-task backend floor.

Every tier runs the same source. No tier has its own files; each difference is a
value resolved from the tier. The full table is in [Tiers and targets](/loomster/reference/tiers/).

## Instance

`LOOM_INSTANCE` names which Loom this is. It's in every physical name and every
CloudFormation stack name (`loom-prod-a-loom-db`), so two instances in one
account and region never collide, and `loom-teardown` only ever deletes its own
instance's stacks. `LOOM_ENV` works the same way one level up.

## Topology

Loom has group-based multi-tenancy inside one deployment: Cognito groups give a
user scopes, and the `loom:group` tag decides which resources they see. That
isolation is logical. One Loom is one control plane and one database.

So there are two topologies:

- Single-boundary: one Loom, many groups. Every team fits inside one account
  and compliance boundary and sees a scoped view.
- Multi-boundary: many Looms, one instance per account, per prod and non-prod,
  or per compliance domain. A shared Cognito pool or external IdP can serve
  all of them, with groups and scopes defined once
  ([Share a Cognito pool](/loomster/guides/share-a-cognito-pool/)).

The rule of thumb is groups inside a boundary, and a new instance per boundary.
If two teams must never see each other's agents, give them separate instances.
If they should see a scoped view of one platform, give them groups in one Loom.

## Target

Where a tier deploys is a third, separate choice: [Floci](/loomster/concepts/glossary/#floci)
when `AWS_ENDPOINT_URL` is set, real AWS when it isn't. Any tier can go to either.
