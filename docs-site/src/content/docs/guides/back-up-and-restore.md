---
title: Back up and restore
description: Take and copy RDS backups, export Cognito users, prove a backup restores with the drill, and restore the database from a snapshot or a point in time with a gated cutover.
prompt: |
  Read https://intentius.io/loomster/guides/back-up-and-restore/ and, for the deployment the person names, run `npm run backup` and `npm run restore-drill` and report the snapshot id and the drill's result.
  For a restore, run `chant run loom-restore` up to its gate, report the restored instance, and tell the person the approval command; do not approve it.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

What a deployment holds and what protects it is in
[Stateful resources](/loomster/concepts/what-holds-state/). The short version: the
RDS database is the data that matters, every restore makes a new instance, and
a restore ends with a cutover.

## Result

A labelled snapshot (and a copy in another region), a Cognito export, proof the
snapshot restores, and, when you need it, the backend running on a restored
database.

## Prerequisites

The deployment's `LOOM_*` variables and AWS credentials.

## Steps

### Back up

```
npm run backup                       # chant run loom-backup
```

`loom-backup` takes a labelled manual snapshot. With `LOOM_DR_REGION` set it also
copies it to that region, with `LOOM_DR_KMS_KEY_ID` for an encrypted database.
It only adds, so it has no gate. `.github/workflows/backup.yml` runs it daily
once turned on ([Turn on scheduled Ops](/loomster/guides/turn-on-scheduled-ops/)).

Besides these snapshots, every [tier](/loomster/concepts/tiers-and-instances/)
keeps 7 days of automated backups for point-in-time recovery, the database
leaves a final snapshot when deleted or replaced, and the upgrade [Op](/loomster/concepts/glossary/#op) snapshots
before it rolls the backend.

### Export Cognito users

```
npm run cognito-export               # chant run loom-cognito-export
```

It writes the pool's users, groups and memberships to stdout, or to S3 when
`LOOM_BACKUP_BUCKET` is set. The pool's configuration comes back from code; its
users don't, so keep this export.

### Prove a backup restores

```
npm run restore-drill                                     # latest loom-backup snapshot
LOOM_RESTORE_SNAPSHOT_ID=<id> npm run restore-drill       # a specific one
```

`loom-restore-drill` restores to a throwaway `<db-id>-drill-<ts>` instance,
checks it reaches `available` with the source's engine, version and storage
(RDS only gets there from a restorable snapshot), then deletes it; a shell
`trap` runs the delete on every exit path. It never repoints anything, so it runs
without a gate. The check is on the control plane; a check inside the database
needs network access to the private instance. `.github/workflows/restore-drill.yml`
runs it monthly once turned on.

### Restore

`loom-restore` restores to a new instance in the same subnet group, stops for
approval, then points loom-db's connection secret at the restored endpoint and
redeploys the backend:

```
export LOOM_RESTORE_SNAPSHOT_ID=<id>     # or LOOM_RESTORE_TIME=2026-07-16T03:00:00Z for point-in-time
chant run loom-restore                   # restores, then stops at Approve (exit 3)
chant approve loom-restore approve-loom-restore
chant run loom-restore                   # cuts over
```

With neither variable set it restores the latest `loom-backup` snapshot. Check
the restored instance before approving: the cutover is the step you can't take
back by re-running.

To find a snapshot:

```
aws rds describe-db-snapshots --db-instance-identifier <db-id> --snapshot-type manual \
  --query "reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[0].DBSnapshotIdentifier" --output text
```

The old instance keeps running after the cutover. Deleting it destroys the
pre-restore data, so it stays a separate step for a person:
`aws rds delete-db-instance --db-instance-identifier <old id> --final-db-snapshot-identifier <name>`.
The restored instance keeps its `-restored-` identifier.

## Next

[Tiers and targets](/loomster/reference/tiers/#recovery-targets) for the recovery
point and time on each tier.
