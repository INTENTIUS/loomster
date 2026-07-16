---
title: Identity & topology
description: A shared Cognito pool or external OIDC IdP referenced across many Loom instances, and the single-boundary vs multi-boundary topology that decides when you run one Loom or many.
---

## Shared Cognito pool / external IdP across multiple Looms

An org runs many Loom instances across hard boundaries — separate accounts, prod
vs. non-prod, separate compliance scopes. Loom's own groups and `loom:group` tags
isolate *teams* within one deployment; they don't isolate one deployment from
another.

A shared org-level Cognito pool (or an external OIDC IdP fronted the same way),
referenced by every instance with groups and the scope catalog defined once at the
org level, is the multi-instance pattern — not a fallback for teams that skipped
provisioning. `identity: reference-existing` on `loom-cognito` is exactly that: zero
Cognito resources, every id and URL threaded from params.
`src/examples/byo/loom-cognito/` and `src/examples/byo/loom-cognito-second-instance/`
instantiate the composite twice, under two `naming.instance` values, against the
identical pool config; `adoption.test.ts` asserts both produce zero members and
resolve to the same pool id. Provisioning one pool per instance (`identity: provision`,
the default) remains right for a single greenfield boundary.

## Single-boundary vs multi-boundary

Loom is one control plane with logical, group-based multi-tenancy, not hard
isolation between teams. That gives two topologies:

- **Single-boundary** — one Loom, many Cognito groups. RBAC plus the
  `loom:group` / `loom:application` / `loom:owner` tags `loom-cognito` attaches give
  each team a scoped view without a second deployment. Right when every team fits
  inside one compliance and account boundary.
- **Multi-boundary** — many Looms, one per account, prod-vs-nonprod, or compliance
  domain, each a different `LOOM_INSTANCE`. A shared org-level pool (or external IdP)
  is referenced by every instance via `identity: reference-existing`, with groups and
  scopes defined once at the org level.

**Rule of thumb: groups inside a boundary, a new Loom per boundary.** If two teams
should never see each other's Loom resources, that's a separate instance. If they
should, but scoped, that's a group and an ABAC tag inside one Loom.

`LOOM_INSTANCE` is the segment that keeps many Looms collision-free in one account —
two instance values are two independent Looms whose every physical name and tag
differs. See [Naming & tagging](/loomster/reference/naming/) for the full scheme.
