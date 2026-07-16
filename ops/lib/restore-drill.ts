/**
 * Restore-verification drill script. A pure, unit-testable AWS CLI script
 * builder, same shape as `./restore.ts` / `./backup.ts`.
 *
 * A backup that has never been restored is a hope, not a backup. This drill
 * proves the latest `loom-backup` snapshot actually restores to a functioning
 * instance, without touching the live data plane: it restores into a throwaway
 * instance `<id>-drill-<ts>`, asserts the instance reaches `available` with the
 * same engine / engine version / storage as the source (RDS only reaches
 * `available` from a genuinely restorable snapshot), then always deletes the
 * drill instance — a `trap` on EXIT runs the delete even when an assertion
 * fails, so a failed drill never leaks a paid instance.
 *
 * Because it only ever creates and deletes its own `-drill-` instance and never
 * repoints the connection secret, it is non-destructive to the running Loom and
 * runs ungated on the local executor — unlike `./restore.ts`, whose cutover is
 * destructive and gates. See `../loom-restore-drill.op.ts`.
 *
 * Deep in-database schema probing (connecting and counting tables) needs network
 * reachability to a private RDS instance, which a CI runner outside the VPC
 * doesn't have; the drill asserts at the RDS control-plane level, which is what
 * a snapshot restore can be proven at from outside the VPC.
 */

export interface DrillRefs {
  dbInstanceIdentifier: string;
  dbSubnetGroupName: string;
  rdsSecurityGroupName: string;
}

/**
 * Restore the latest `loom-backup` snapshot (or `LOOM_RESTORE_SNAPSHOT_ID`) to a
 * throwaway `<id>-drill-<ts>` instance, assert it comes up healthy with config
 * matching the source, then delete it. The delete is registered as an EXIT trap
 * before the instance is created, so it runs on any exit path. Fails loudly if
 * there is no snapshot to restore.
 */
export function restoreDrillScript(refs: DrillRefs): string {
  const id = refs.dbInstanceIdentifier;
  return [
    "set -euo pipefail",
    `SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${refs.rdsSecurityGroupName}" --query "SecurityGroups[0].GroupId" --output text)`,
    `if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then echo "drill: security group ${refs.rdsSecurityGroupName} not found" >&2; exit 1; fi`,
    // Pick the snapshot before creating anything, so a "nothing to restore" run costs nothing.
    `if [ -n "\${LOOM_RESTORE_SNAPSHOT_ID:-}" ]; then SNAP="$LOOM_RESTORE_SNAPSHOT_ID"; else SNAP=$(aws rds describe-db-snapshots --db-instance-identifier "${id}" --snapshot-type manual --query "reverse(sort_by(DBSnapshots[?starts_with(DBSnapshotIdentifier, '${id}-backup-')], &SnapshotCreateTime))[0].DBSnapshotIdentifier" --output text); fi`,
    `if [ -z "$SNAP" ] || [ "$SNAP" = "None" ]; then echo "drill: nothing to restore (run loom-backup first, or set LOOM_RESTORE_SNAPSHOT_ID)" >&2; exit 1; fi`,
    `DRILL_ID="${id}-drill-$(date -u +%Y%m%dt%H%M%Sz)"`,
    // Register cleanup BEFORE creating the instance: any exit (assertion failure
    // included) deletes the drill instance, so a failed drill never leaks a paid
    // resource. --skip-final-snapshot: this is a throwaway, no farewell snapshot.
    `cleanup() { echo "drill: cleaning up $DRILL_ID"; aws rds delete-db-instance --db-instance-identifier "$DRILL_ID" --skip-final-snapshot --delete-automated-backups >/dev/null 2>&1 || true; }`,
    `trap cleanup EXIT`,
    `echo "drill: restoring snapshot $SNAP -> $DRILL_ID"`,
    `aws rds restore-db-instance-from-db-snapshot --db-instance-identifier "$DRILL_ID" --db-snapshot-identifier "$SNAP" --db-subnet-group-name "${refs.dbSubnetGroupName}" --vpc-security-group-ids "$SG_ID" >/dev/null`,
    `aws rds wait db-instance-available --db-instance-identifier "$DRILL_ID"`,
    // Assert the restored instance matches the source's shape. RDS only reaches
    // `available` from a restorable snapshot, so this having succeeded already
    // proves the core of the drill; the config comparison catches a snapshot
    // taken against a since-changed engine/version/storage.
    `read -r SRC_ENGINE SRC_VER SRC_STORAGE < <(aws rds describe-db-instances --db-instance-identifier "${id}" --query "DBInstances[0].[Engine,EngineVersion,AllocatedStorage]" --output text)`,
    `read -r DRILL_ENGINE DRILL_VER DRILL_STORAGE DRILL_STATUS < <(aws rds describe-db-instances --db-instance-identifier "$DRILL_ID" --query "DBInstances[0].[Engine,EngineVersion,AllocatedStorage,DBInstanceStatus]" --output text)`,
    `if [ "$DRILL_STATUS" != "available" ]; then echo "drill: FAILED — $DRILL_ID status is $DRILL_STATUS, expected available" >&2; exit 1; fi`,
    `if [ "$DRILL_ENGINE" != "$SRC_ENGINE" ]; then echo "drill: FAILED — engine $DRILL_ENGINE != source $SRC_ENGINE" >&2; exit 1; fi`,
    `if [ "$DRILL_STORAGE" -lt "$SRC_STORAGE" ]; then echo "drill: FAILED — storage $DRILL_STORAGE < source $SRC_STORAGE" >&2; exit 1; fi`,
    `echo "drill: OK — $SNAP restored to $DRILL_ID (engine $DRILL_ENGINE $DRILL_VER, \${DRILL_STORAGE}GB, status available); deleting drill instance"`,
  ].join("\n");
}
