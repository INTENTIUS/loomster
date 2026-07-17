---
title: Naming & Tagging
description: How every Loom composite derives its physical resource names and cost-allocation tags from one shared parameter source. Segment order, per-service length/char limits, uniqueness strategy, and lint enforcement.
---

Every Loom composite derives its physical resource names and cost-allocation
tags from one shared parameter source, `src/lib/naming.ts`'s
`loomNaming(params, component)`. Nothing is hardcoded: no names, ARNs, regions,
account ids, or sizes in any composite.

## Naming key

```
{project}-{env}-{instance}-{component}-{resource}
```

- **`project`** is the deployment family, e.g. `loom`.
- **`env`** is `dev` / `staging` / `prod`, etc.
- **`instance`** is the tenant/boundary segment. Mandatory. This is what lets N
  Loom instances coexist in one AWS account or spread across many without
  collision (the multi-boundary topology). The **CFN stack names** are namespaced by
  the same `{project}-{env}-{instance}` prefix — a component `loom-db` deploys to a
  stack `loom-prod-a-loom-db` — so two deployments never collide on stack names
  either, only on the `instance` boundary. Two tiers were run side by side in one
  account this way (`production` as instance `a`, `production-ha` as instance `b`).
- **`component`** is the composite's own name, e.g. `loom-db`, `shared-foundation`.
- **`resource`** is the specific resource within the component, e.g. `instance`,
  `uploads`, `domain`.

Segments are joined with `-`, lowercased, and sanitized: anything outside
`[a-z0-9-]` becomes a hyphen, repeated hyphens collapse to one, and
leading/trailing hyphens are trimmed. `loomNaming({ project: "Loom", ... })` and
`loomNaming({ project: "loom", ... })` produce the same name.

## Per-service length/char limits and uniqueness strategy

Physical names have to satisfy AWS's own constraints per resource type. Pass the
relevant `service` to `name()` and the helper applies the right one:

| `service` | AWS constraint | Strategy |
|---|---|---|
| `alb` | ALB name: max 32 chars | Truncate + append a 6-char hash of the full pre-truncation name |
| `targetGroup` | Target group name: max 32 chars | Same as `alb` |
| `s3Bucket` | Bucket names are globally unique across every account, 3–63 chars | Append a hash of `accountId:region` before truncating to 63 |
| `rdsInstance` | DB instance identifier: ≤63 chars, must start with a letter | Prefix `x` if sanitization would start with a digit; truncate + hash tail |
| `rdsProxy` | DB Proxy name: ≤63 chars, must start with a letter | Same as `rdsInstance` |
| `cognitoDomain` | User pool domain prefix: unique per Region, ≤63 chars, can't start with `aws`/`amazon`/`cognito` | Append the region-derived hash; prefix `x-` if the sanitized name would start with a reserved word; truncate + hash tail |
| `ecrRepo` | Repository name: ≤256 chars | Truncate + hash tail (rarely triggers) |
| `default` | No AWS-specific constraint known | No suffix, no truncation |

The truncation hash is computed over the **full untruncated name**. Two
different long names that share a common prefix still land on distinct truncated
values, so truncation never silently collapses two distinct resources onto the
same physical name.

The uniqueness suffix on `s3Bucket` / `cognitoDomain` is a short hash of
`accountId:region`, falling back to `region` alone when the account id is unknown
at author time (as with a reference-existing seam). It's deterministic. The same
account/region pair always produces the same suffix, and two different accounts
or regions always produce different ones.

## Tags

`tags(extra?)` returns the exact cost-allocation set attached to every taggable
resource, from the same param source as `name()`. One source, two consumers:

```ts
{ component, tier, env, owner, instance }
```

`extra` is merged on top (an extra key can override a base one, e.g. a composite
that wants to set its own `owner`).

## Logical IDs and output keys

`logicalId(component, resource)` produces a stable PascalCase id (e.g.
`logicalId("loom-db", "instance")` yields `"LoomDbInstance"`), deliberately **not**
derived from env/instance/tier. A CloudFormation logical id only needs to be
unique within one template, not across deployments. Use it for both the
resource's logical id and the corresponding `stackOutput(...)` key, so cross-stack
wiring resolves by convention.

## Lint enforcement

`.chant/rules/no-hardcoded-name.ts` (rule `LOOM001`) scans every `*.component.ts`
file and everything under `src/composites/` and `src/components/` for a string
literal on a known AWS physical-name CloudFormation property (`BucketName`,
`DBInstanceIdentifier`, `LoadBalancerName`, `Domain`, and the rest) and flags it.
The value should come from `loomNaming(...).name(...)` instead. Run `just lint`
(`chant lint .`) to check.

## Example

```ts
import { loomNaming, logicalId } from "../lib/naming";

const naming = loomNaming(
  {
    project: "loom",
    env: "prod",
    instance: "a",
    tier: "production",
    region: "us-east-1",
    accountId: process.env.AWS_ACCOUNT_ID,
    owner: "platform-team",
  },
  "loom-db",
);

// "loom-prod-a-loom-db-instance", <=63 chars, starts with a letter
const instanceId = naming.name("instance", { service: "rdsInstance" });

// { component: "loom-db", tier: "production", env: "prod", owner: "platform-team", instance: "a" }
const tags = naming.tags();

// "LoomDbInstance", stable across envs/instances
const outputKey = logicalId("loom-db", "instance");
```
