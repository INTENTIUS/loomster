/**
 * RDS data-safety scripts (chant#905) — the Op-layer counterpart to the aws
 * lexicon's `snapshot-before` / `rollback-previous`
 * capabilities (`lexicons/aws/src/components/{safety,apply}.ts` in the chant
 * repo). Those are Component-level capabilities, dispatched by the driver that
 * runs a *Component's* `deploy` composition — a hand-authored `*.op.ts` Op has
 * no such dispatch (an `ActivityStep`'s `fn` only resolves against the named
 * activities a lexicon's `op/activities` module exports, and neither the aws
 * lexicon nor the temporal lexicon exports one for these verbs today).
 * `shell()` is the documented escape hatch for exactly this gap (see
 * docs/guide/ops.mdx's "Try it locally" — swap `shell()` for a typed builder
 * once/if one exists); these functions build the AWS CLI scripts each
 * `shell()` step runs, kept here as pure, unit-testable string builders
 * (mirroring `lexicons/temporal/src/op/activities/apply.ts`'s `applyCommand`).
 *
 * **Why a bash script string, not one command per step.** An `ActivityStep`'s
 * `args` are static JSON baked in at `chant build` time (no `@Phase.field`
 * wiring the way a Component step gets — see `./stack-refs.ts`'s docstring),
 * so a value only known at *run* time (a fresh snapshot id, a restored
 * instance id) cannot be threaded from one step's output into a
 * later step's input. Each function below instead returns one self-contained
 * script that computes and consumes its own run-time values with ordinary
 * shell — `set -euo pipefail` so any failing AWS CLI call fails the whole
 * step (and therefore the phase, and therefore the workflow).
 */

/** Config identifying the RDS instance a snapshot/restore acts on. */
export interface DbRefs {
  dbInstanceIdentifier: string;
}

/**
 * `snapshot-before`, the script form. Creates a uniquely-named **manual**
 * snapshot (not a timestamp baked in at build time — computed at run time, so
 * repeat runs of the same built Op never collide on the snapshot id) and waits
 * for it to reach `available` before returning, so the phase after this one
 * (the backend roll, which migrates the schema) never starts against a DB with no safety net underneath
 * it yet.
 */
export function snapshotBeforeScript(refs: DbRefs): string {
  const id = refs.dbInstanceIdentifier;
  return [
    "set -euo pipefail",
    `SNAPSHOT_ID="${id}-upgrade-$(date -u +%Y%m%dt%H%M%Sz)"`,
    `aws rds create-db-snapshot --db-instance-identifier "${id}" --db-snapshot-identifier "$SNAPSHOT_ID" --tags Key=chant:purpose,Value=pre-upgrade-safety`,
    `aws rds wait db-snapshot-available --db-instance-identifier "${id}" --db-snapshot-identifier "$SNAPSHOT_ID"`,
    `echo "{\\"snapshotId\\":\\"$SNAPSHOT_ID\\"}"`,
  ].join("\n");
}

/**
 * The restore path `snapshot-before`'s output documents (chant#905 acceptance:
 * "the restore path (rollback-previous) is documented"). RDS has no in-place
 * "undo" — `restore-db-instance-from-db-snapshot` always creates a **new**
 * instance, never overwrites the live one — so this looks up the most recent
 * manual snapshot of `dbInstanceIdentifier` (the one `snapshotBeforeScript`
 * just took) and restores it to `<id>-restored-<timestamp>`.
 *
 * Deliberately stops there. Promoting the restored instance to production
 * (repointing `oConnectEndpoint`/the connection secret at it, then decommissioning
 * the original) is a second, separate, human-confirmed action — automatically
 * swapping a live database's endpoint out from under a running backend mid-saga-
 * unwind is not a step this Op takes unattended. This mirrors chant#905's own
 * scope line: a full policy-driven backup/restore regime is out of scope here
 * ("could later justify a Dagster/Airflow host... not now").
 */
export function restorePreviousScript(refs: DbRefs): string {
  const id = refs.dbInstanceIdentifier;
  return [
    "set -euo pipefail",
    `LATEST_SNAPSHOT=$(aws rds describe-db-snapshots --db-instance-identifier "${id}" --snapshot-type manual --query "reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[0].DBSnapshotIdentifier" --output text)`,
    `if [ -z "$LATEST_SNAPSHOT" ] || [ "$LATEST_SNAPSHOT" = "None" ]; then echo "restore-previous: no manual snapshot found for ${id}" >&2; exit 1; fi`,
    `RESTORED_ID="${id}-restored-$(date -u +%Y%m%dt%H%M%Sz)"`,
    `aws rds restore-db-instance-from-db-snapshot --db-instance-identifier "$RESTORED_ID" --db-snapshot-identifier "$LATEST_SNAPSHOT"`,
    `aws rds wait db-instance-available --db-instance-identifier "$RESTORED_ID"`,
    `echo "restore-previous: restored $LATEST_SNAPSHOT -> $RESTORED_ID (NOT yet live — cut the connection secret/endpoint over to it, then decommission ${id}, as a separate confirmed step)"`,
  ].join("\n");
}
