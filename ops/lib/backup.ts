/**
 * RDS backup scripts — the on-demand/scheduled counterpart to
 * `./rds-safety.ts`'s upgrade-time snapshot. Same shape: pure, unit-testable
 * AWS CLI script builders each `shell()` step runs, computing their run-time
 * values (a fresh snapshot id, the DR region) in ordinary shell with
 * `set -euo pipefail`, since an `ActivityStep`'s `args` are static JSON baked
 * in at `chant build` time (see `./rds-safety.ts`'s docstring and
 * `./stack-refs.ts`).
 *
 * A backup is additive and non-destructive, so `../loom-backup.op.ts` runs on
 * the local executor with no gate — unlike the restore path, which is
 * destructive at cutover and gates.
 */

import type { DbRefs } from "./rds-safety";

/**
 * A labelled manual snapshot of the live DB instance, tagged
 * `chant:purpose=backup` so `drCopySnapshotScript` (and any retention tooling)
 * can find backup snapshots without confusing them with the upgrade Op's
 * `pre-upgrade-safety` snapshots. The id carries a run-time timestamp so
 * repeat runs of the same built Op never collide.
 */
export function backupSnapshotScript(refs: DbRefs, opts: { purpose?: string } = {}): string {
  const id = refs.dbInstanceIdentifier;
  const purpose = opts.purpose ?? "backup";
  return [
    "set -euo pipefail",
    `SNAPSHOT_ID="${id}-backup-$(date -u +%Y%m%dt%H%M%Sz)"`,
    `aws rds create-db-snapshot --db-instance-identifier "${id}" --db-snapshot-identifier "$SNAPSHOT_ID" --tags Key=chant:purpose,Value=${purpose}`,
    `aws rds wait db-snapshot-available --db-instance-identifier "${id}" --db-snapshot-identifier "$SNAPSHOT_ID"`,
    `echo "{\\"snapshotId\\":\\"$SNAPSHOT_ID\\"}"`,
  ].join("\n");
}

/**
 * Cross-region (and by extension cross-account, via a KMS key shared to the
 * target) disaster-recovery copy of the most recent backup snapshot. The DR
 * target is a run-time env var, not a build-time arg: `LOOM_DR_REGION` (and
 * `LOOM_DR_KMS_KEY_ID`, required when the source DB is encrypted — a
 * cross-region copy of an encrypted snapshot must name a key in the target
 * region). With no `LOOM_DR_REGION` set the step is a clean no-op, so the
 * `DrCopy` phase is always present but only does work where DR is configured.
 *
 * The copy runs in the target region against the source snapshot's ARN, the
 * form `copy-db-snapshot` requires for a cross-region source.
 */
export function drCopySnapshotScript(refs: DbRefs): string {
  const id = refs.dbInstanceIdentifier;
  return [
    "set -euo pipefail",
    `if [ -z "\${LOOM_DR_REGION:-}" ]; then echo "dr-copy: LOOM_DR_REGION unset — no cross-region copy configured, skipping"; exit 0; fi`,
    `SNAP=$(aws rds describe-db-snapshots --db-instance-identifier "${id}" --snapshot-type manual --query "reverse(sort_by(DBSnapshots[?starts_with(DBSnapshotIdentifier, '${id}-backup-')], &SnapshotCreateTime))[0].DBSnapshotIdentifier" --output text)`,
    `if [ -z "$SNAP" ] || [ "$SNAP" = "None" ]; then echo "dr-copy: no backup snapshot found for ${id} (run the Snapshot phase first)" >&2; exit 1; fi`,
    `SRC_ARN=$(aws rds describe-db-snapshots --db-snapshot-identifier "$SNAP" --query "DBSnapshots[0].DBSnapshotArn" --output text)`,
    `KMS_ARG=""; if [ -n "\${LOOM_DR_KMS_KEY_ID:-}" ]; then KMS_ARG="--kms-key-id $LOOM_DR_KMS_KEY_ID"; fi`,
    `aws rds copy-db-snapshot --source-db-snapshot-identifier "$SRC_ARN" --target-db-snapshot-identifier "$SNAP-dr" --region "$LOOM_DR_REGION" --copy-tags $KMS_ARG`,
    `echo "dr-copy: copied $SNAP -> $SNAP-dr in $LOOM_DR_REGION"`,
  ].join("\n");
}
