---
title: On call
description: "For whoever is paged for a Loom deployment: the Ops and runbooks for backup and restore, rotation, upgrade, drift, lockouts and teardown, and what each one changes."
---

## Works

- Backups on demand or daily, with a cross-region copy, and a monthly drill that
  restores a backup to a throwaway instance and deletes it.
- A gated restore from a snapshot or a point in time, with a cutover you approve.
- Rotation of the Cognito machine-to-machine client, the database credential and
  the certificate on the production [tiers](/loomster/concepts/tiers-and-instances/).
- Drift detection every 15 minutes and a pull request for what drifted.
- A token from `scripts/validate/get-user-token.sh` when you need Loom's API.

## Differs

- Every RDS restore makes a new instance; the old one keeps running until a
  person deletes it.
- Light has no rotation Op and no Multi-AZ; a database failure there is a
  restore.
- The database has no public endpoint. Deploy the optional tunnel host to reach
  it from a laptop ([Open a tunnel to the database](/loomster/guides/open-a-tunnel-to-the-database/));
  the database Ops run inside the VPC without it.

## First step

[Ops](/loomster/reference/ops/), for which Op does what and which ones stop at a
gate.

## Proof

The recovery point and time for each tier are in
[Tiers and targets](/loomster/reference/tiers/#recovery-targets); what has run is
in [Validation](/loomster/reference/validation/).

## Then read

Tasks:
[Back up and restore](/loomster/guides/back-up-and-restore/),
[Rotate credentials](/loomster/guides/rotate-credentials/),
[Upgrade Loom](/loomster/guides/upgrade-loom/),
[Watch and reconcile drift](/loomster/guides/watch-and-reconcile-drift/),
[Recover from an IdP lockout](/loomster/guides/recover-from-an-idp-lockout/),
[Open a tunnel to the database](/loomster/guides/open-a-tunnel-to-the-database/),
[Tear down a deployment](/loomster/guides/tear-down/).

Explanation:
[Gated Ops](/loomster/concepts/gated-ops/),
[Stateful resources](/loomster/concepts/what-holds-state/).

Reference:
[Ops](/loomster/reference/ops/),
[Loom make targets](/loomster/reference/make-targets/),
[Tiers and targets](/loomster/reference/tiers/),
[Components](/loomster/reference/components/).
