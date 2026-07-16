/**
 * RDS restore + cutover scripts. Pure, unit-testable AWS CLI script builders,
 * same shape as `./rds-safety.ts` / `./backup.ts`.
 *
 * RDS has no in-place restore — every restore path creates a NEW instance, and
 * the app is cut over to it. `restoreScript` restores (from a snapshot or to a
 * point in time) into the same subnet group and security group so the restored
 * instance is network-reachable; `cutoverScript` repoints loom-db's connection
 * secret at the restored endpoint and forces a backend redeploy.
 *
 * Cutover is destructive to the live data plane, so `../loom-restore.op.ts`
 * gates before it (Temporal approval), like teardown/rotate. Decommissioning
 * the old instance is left as a documented, human-confirmed follow-up rather
 * than an automatic delete — see the Op and guides/backup-restore.
 */

export interface RestoreRefs {
  dbInstanceIdentifier: string;
  dbSubnetGroupName: string;
  rdsSecurityGroupName: string;
  connectionSecretName: string;
  ecsClusterName: string;
  backendServiceName: string;
}

/**
 * Restore to a new instance `<id>-restored-<ts>`, network-placed in the same
 * subnet group + security group as the original. Mode is a run-time env var:
 * `LOOM_RESTORE_TIME` -> point-in-time (within the 7-day window);
 * `LOOM_RESTORE_SNAPSHOT_ID` -> that snapshot; otherwise the latest `loom-backup`
 * snapshot. Fails loudly if there's nothing to restore.
 */
export function restoreScript(refs: RestoreRefs): string {
  const id = refs.dbInstanceIdentifier;
  return [
    "set -euo pipefail",
    `SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${refs.rdsSecurityGroupName}" --query "SecurityGroups[0].GroupId" --output text)`,
    `if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then echo "restore: security group ${refs.rdsSecurityGroupName} not found" >&2; exit 1; fi`,
    `RESTORED_ID="${id}-restored-$(date -u +%Y%m%dt%H%M%Sz)"`,
    `if [ -n "\${LOOM_RESTORE_TIME:-}" ]; then`,
    `  echo "restore: point-in-time to $LOOM_RESTORE_TIME -> $RESTORED_ID"`,
    `  aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier "${id}" --target-db-instance-identifier "$RESTORED_ID" --restore-time "$LOOM_RESTORE_TIME" --db-subnet-group-name "${refs.dbSubnetGroupName}" --vpc-security-group-ids "$SG_ID"`,
    `else`,
    `  if [ -n "\${LOOM_RESTORE_SNAPSHOT_ID:-}" ]; then SNAP="$LOOM_RESTORE_SNAPSHOT_ID"; else SNAP=$(aws rds describe-db-snapshots --db-instance-identifier "${id}" --snapshot-type manual --query "reverse(sort_by(DBSnapshots[?starts_with(DBSnapshotIdentifier, '${id}-backup-')], &SnapshotCreateTime))[0].DBSnapshotIdentifier" --output text); fi`,
    `  if [ -z "$SNAP" ] || [ "$SNAP" = "None" ]; then echo "restore: nothing to restore (set LOOM_RESTORE_SNAPSHOT_ID or LOOM_RESTORE_TIME, or run loom-backup first)" >&2; exit 1; fi`,
    `  echo "restore: from snapshot $SNAP -> $RESTORED_ID"`,
    `  aws rds restore-db-instance-from-db-snapshot --db-instance-identifier "$RESTORED_ID" --db-snapshot-identifier "$SNAP" --db-subnet-group-name "${refs.dbSubnetGroupName}" --vpc-security-group-ids "$SG_ID"`,
    `fi`,
    `aws rds wait db-instance-available --db-instance-identifier "$RESTORED_ID"`,
    `echo "restore: $RESTORED_ID available (not yet live — cutover is the gated next phase)"`,
  ].join("\n");
}

/**
 * Cut the app over to the most recent restored instance: repoint loom-db's
 * connection secret at its endpoint (the secret is
 * `{"url":"postgresql+psycopg2://user:pass@host:5432/db"}`, so only the host
 * changes — the master credential is preserved by the restore) and force a new
 * backend deployment so it picks the secret up, waiting for the service to
 * stabilise. Deliberately leaves the old instance running; decommissioning it
 * is a separate, human-confirmed step (guides/backup-restore).
 */
export function cutoverScript(refs: RestoreRefs): string {
  const id = refs.dbInstanceIdentifier;
  return [
    "set -euo pipefail",
    `RESTORED_ID=$(aws rds describe-db-instances --query "reverse(sort_by(DBInstances[?starts_with(DBInstanceIdentifier, '${id}-restored-')], &InstanceCreateTime))[0].DBInstanceIdentifier" --output text)`,
    `if [ -z "$RESTORED_ID" ] || [ "$RESTORED_ID" = "None" ]; then echo "cutover: no restored instance found (run the Restore phase first)" >&2; exit 1; fi`,
    `NEW_HOST=$(aws rds describe-db-instances --db-instance-identifier "$RESTORED_ID" --query "DBInstances[0].Endpoint.Address" --output text)`,
    `OLD=$(aws secretsmanager get-secret-value --secret-id "${refs.connectionSecretName}" --query SecretString --output text)`,
    `NEW=$(echo "$OLD" | jq --arg h "$NEW_HOST" '.url |= sub("@[^:/@]+:5432"; "@" + $h + ":5432")')`,
    `aws secretsmanager put-secret-value --secret-id "${refs.connectionSecretName}" --secret-string "$NEW"`,
    `aws ecs update-service --cluster "${refs.ecsClusterName}" --service "${refs.backendServiceName}" --force-new-deployment`,
    `aws ecs wait services-stable --cluster "${refs.ecsClusterName}" --services "${refs.backendServiceName}"`,
    `echo "cutover: secret repointed to $RESTORED_ID ($NEW_HOST); backend redeployed. Old instance ${id} left running — decommission it as a confirmed follow-up."`,
  ].join("\n");
}
