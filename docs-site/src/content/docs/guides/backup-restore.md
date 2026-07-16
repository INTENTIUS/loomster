---
title: Backup & restore
description: What holds state in a Loom deployment, what protects it today (RDS automated backups, snapshot deletion policy, the upgrade Op's pre-migration snapshot), the manual restore runbook, and the gaps to a first-class backup/restore story.
---

A Loom deployment is mostly stateless infrastructure that redeploys from the same
CloudFormation templates. A few things hold real state, and those are what backup
and restore are about.

## What holds state

- **RDS Postgres** is the application data: agents, memories, credentials, costs,
  settings. This is the thing that actually needs protecting.
- **The Cognito user pool** holds user records. Its configuration (groups,
  clients, resource server, scopes) lives in code and comes back with a re-synth.
  The user records themselves do not.
- **Secrets Manager** holds the DB credential secret.
- **The S3 artifact bucket** has versioning enabled, but its contents are
  rebuildable from source, so it's low-priority for backup.
- **The CloudFormation templates** live in git. Not a backup concern.

## What's protected today

- **Automated backups.** The DB runs with `BackupRetentionPeriod: 7`, giving 7
  days of automated backups and a point-in-time-recovery window.
- **Snapshot on delete or replace.** The DB instance carries
  `DeletionPolicy: Snapshot` and `UpdateReplacePolicy: Snapshot`, so a teardown or
  a replacing change leaves a final snapshot rather than dropping the data.
- **Multi-AZ on `production-ha`.** This is availability, not backup, but it
  removes single-AZ failure as a data-loss path.
- **Pre-migration snapshot.** The upgrade Op takes a manual snapshot before
  running migrations (`ops/lib/rds-safety.ts`), and on rollback restores the
  latest manual snapshot to a **new** instance. It deliberately stops before
  cutover.

## Restoring today

Restore is a manual runbook. RDS has no in-place undo. Every restore path creates
a **new** instance, and you cut the application over to it.

**From a snapshot** (a pre-migration safety snapshot, or the final snapshot a
teardown left):

```
# find the snapshot
aws rds describe-db-snapshots --db-instance-identifier <db-id> \
  --snapshot-type manual \
  --query "reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[0].DBSnapshotIdentifier" --output text

# restore it to a new instance
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier <db-id>-restored --db-snapshot-identifier <snapshot-id>
```

**To a point in time** (within the 7-day automated-backup window):

```
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier <db-id> \
  --target-db-instance-identifier <db-id>-restored \
  --restore-time 2026-07-16T03:00:00Z
```

Either way, the restored instance is not live until you cut over. Repoint
loom-db's connection secret and endpoint at the restored instance, redeploy the
backend so it picks up the new endpoint, confirm the app is healthy, then
decommission the old instance as a separate, confirmed step.

## Recovery targets per tier

All three tiers share the same 7-day automated backups and point-in-time-recovery
window, so the recovery point for data loss is roughly 5 minutes (RDS PITR
granularity) anywhere inside that window. What differs is how an infrastructure
failure is handled, and both restore paths are manual today until the restore Op
(#80) and the DR copy (#79) land.

| Tier | AZ / instance failure | Data loss (corruption, bad delete) | Regional loss |
|---|---|---|---|
| `light` | single-AZ — manual restore + cutover | PITR or snapshot restore, manual cutover | not survivable (no DR copy) |
| `production` | single-AZ — manual restore + cutover | PITR or snapshot restore, manual cutover | not survivable (no DR copy) |
| `production-ha` | Multi-AZ automatic failover (RTO ~1–2 min, RPO ≈0) | PITR or snapshot restore, manual cutover | not survivable (no DR copy) |

- **RPO** is ≈5 minutes within the 7-day window for data-loss events, and ≈0 for a
  `production-ha` Multi-AZ failover. Data older than the window survives only if a
  manual snapshot exists.
- **RTO** is ~1–2 minutes for a `production-ha` infrastructure failover, and
  otherwise the time to run the manual restore-and-cutover runbook above. A
  first-class `loom-restore` Op (#80) would shorten and de-risk that.
- **A regional or account loss is not survivable today.** The cross-region /
  cross-account snapshot copy (#79) is what changes that.

## Gaps

These are tracked in `INTENTIUS/loomster#72`. Today's backup and restore exist
only inside the upgrade Op; there is no dedicated backup/restore Op and no
disaster-recovery copy.

- **No first-class backup Op.** Snapshots happen only as a side effect of an
  upgrade. A `loom-backup` Op (on-demand plus a per-tier schedule) would take and
  retain snapshots independently.
- **No cross-region / cross-account copy.** A regional or account-level loss is
  not survivable without `copy-db-snapshot` to a second location.
- **Restore isn't automated past "new instance."** The cutover (repoint, redeploy,
  decommission) is manual. A gated `loom-restore` Op would drive it.
- **No Cognito user backup.** A pool loss loses users. An exported `list-users`
  dump would cover the records the pool config can't.
- **No documented RPO / RTO per tier.** The recovery-point and recovery-time
  expectations differ across `light`, `production`, and `production-ha`, and a
  cross-region copy would change them again.

## Related

The upgrade, rotate, and teardown Ops are the existing gated, data-aware lifecycle
operations. See [Lifecycle](/loomster/getting-started/tutorial/#lifecycle) in the
tutorial. Backup and restore Ops would join them, gated the same way, since a
restore is destructive to the live instance at cutover.
