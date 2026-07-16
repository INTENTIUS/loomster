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
- **On-demand and scheduled backup.** `chant run loom-backup` takes a labelled
  manual snapshot on demand, and copies it cross-region for disaster recovery
  when `LOOM_DR_REGION` is set (with `LOOM_DR_KMS_KEY_ID` for an encrypted DB).
  `.github/workflows/backup.yml` runs it daily, inert until opted in.
- **Cognito user export.** `chant run loom-cognito-export` exports the pool's
  users, groups, and memberships (the records a re-synth can't restore) to
  stdout, and to S3 when `LOOM_BACKUP_BUCKET` is set.

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

Either way, the restored instance is not live until you cut over.

The `loom-restore` Op automates this end to end, gated. It restores to a new
instance (network-placed in the same subnet group), pauses for approval, then
repoints loom-db's connection secret at the restored endpoint and redeploys the
backend:

```
LOOM_RESTORE_SNAPSHOT_ID=<id> chant run loom-restore --temporal   # or LOOM_RESTORE_TIME=<ts> for PITR
chant run signal loom-restore approve-loom-restore
```

With neither variable set it restores the latest `loom-backup` snapshot. The old
instance is left running on purpose. Decommissioning it (`aws rds
delete-db-instance --final-db-snapshot-identifier ...`) stays a separate,
human-confirmed step, since it destroys the pre-restore data.

## Verifying restores (the drill)

A backup you've never restored is a hope. `loom-restore-drill` proves the latest
`loom-backup` snapshot actually restores, without touching the live database:

```
chant run loom-restore-drill                          # latest loom-backup snapshot
LOOM_RESTORE_SNAPSHOT_ID=<id> chant run loom-restore-drill   # a specific snapshot
```

It restores the snapshot to a throwaway `<db-id>-drill-<ts>` instance, asserts it
reaches `available` with the same engine, version, and storage as the source
(RDS only reaches `available` from a genuinely restorable snapshot), then always
deletes the drill instance — a shell `trap` runs the delete on every exit path, so
a failed drill never leaves a paid instance behind. Because it only ever creates
and deletes its own `-drill-` instance and never repoints the connection secret,
it is non-destructive and runs ungated on the local executor, unlike `loom-restore`.

`.github/workflows/restore-drill.yml` runs it monthly, inert until you set the
`SCHEDULED_RESTORE_DRILL` repo variable. The control-plane assertion is what a
restore can be proven at from outside the VPC; a deeper in-database schema probe
needs network reachability to the private instance.

## Recovery targets per tier

All three tiers share the same 7-day automated backups and point-in-time-recovery
window, so the recovery point for data loss is roughly 5 minutes (RDS PITR
granularity) anywhere inside that window. What differs is how an infrastructure
failure is handled.

| Tier | AZ / instance failure | Data loss (corruption, bad delete) | Regional loss |
|---|---|---|---|
| `light` | single-AZ — `loom-restore` + cutover | PITR or snapshot `loom-restore` | not survivable unless DR copy is on |
| `production` | single-AZ — `loom-restore` + cutover | PITR or snapshot `loom-restore` | not survivable unless DR copy is on |
| `production-ha` | Multi-AZ automatic failover (RTO ~1–2 min, RPO ≈0) | PITR or snapshot `loom-restore` | not survivable unless DR copy is on |

- **RPO** is ≈5 minutes within the 7-day window for data-loss events, and ≈0 for a
  `production-ha` Multi-AZ failover. Data older than the window survives only if a
  manual snapshot exists.
- **RTO** is ~1–2 minutes for a `production-ha` infrastructure failover, and
  otherwise the time for the gated `loom-restore` Op (restore + approve + cutover)
  to run.
- **A regional or account loss** is survivable only where the `loom-backup` Op's
  DR copy is configured (`LOOM_DR_REGION`). Without it, the snapshots live in one
  region.

## Gaps

Tracked in `INTENTIUS/loomster#72`.

- **Old-instance decommission stays manual.** After `loom-restore` cuts over, the
  restored instance carries a `-restored-` identifier and the original is left
  running. Deleting the original (and, if you want the canonical identifier back,
  renaming the restored instance and repointing once more) is a deliberate
  human-confirmed step, not an automatic delete of a live database.

## Related

`loom-backup`, `loom-restore`, `loom-restore-drill`, upgrade, rotate, and teardown
are the data-aware lifecycle Ops. See the [Operations overview](/loomster/operations/overview/)
for the whole set, or [Lifecycle](/loomster/getting-started/tutorial/#lifecycle) in
the tutorial.
