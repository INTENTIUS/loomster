import { describe, test, expect } from "vitest";
import { restoreScript, cutoverScript } from "./restore";

const refs = {
  dbInstanceIdentifier: "loom-prod-a-loom-db-instance",
  dbSubnetGroupName: "loom-prod-a-loom-db-subnet-group",
  rdsSecurityGroupName: "loom-prod-a-loom-db-sg",
  connectionSecretName: "loom-prod-a-loom-db-database-url",
  ecsClusterName: "loom-prod-a-shared-foundation-cluster",
  backendServiceName: "loom-prod-a-loom-backend-backend-svc",
};

describe("restoreScript", () => {
  test("resolves the RDS security group id by name and fails if absent", () => {
    const s = restoreScript(refs);
    expect(s).toContain(`Name=group-name,Values=${refs.rdsSecurityGroupName}`);
    expect(s).toContain("exit 1");
  });

  test("restores to a NEW instance in the same subnet group + security group", () => {
    const s = restoreScript(refs);
    expect(s).toContain(`RESTORED_ID="${refs.dbInstanceIdentifier}-restored-`);
    expect(s).toContain(`--db-subnet-group-name "${refs.dbSubnetGroupName}"`);
    expect(s).toContain('--vpc-security-group-ids "$SG_ID"');
  });

  test("supports point-in-time, explicit snapshot, and latest-backup modes", () => {
    const s = restoreScript(refs);
    expect(s).toContain("restore-db-instance-to-point-in-time");
    expect(s).toContain('if [ -n "${LOOM_RESTORE_TIME:-}" ]');
    expect(s).toContain('if [ -n "${LOOM_RESTORE_SNAPSHOT_ID:-}" ]');
    expect(s).toContain(`starts_with(DBSnapshotIdentifier, '${refs.dbInstanceIdentifier}-backup-')`);
    expect(s).toContain("restore-db-instance-from-db-snapshot");
  });

  test("waits for the restored instance to be available", () => {
    expect(restoreScript(refs)).toContain("aws rds wait db-instance-available");
  });
});

describe("cutoverScript", () => {
  test("finds the most recent restored instance and its endpoint", () => {
    const s = cutoverScript(refs);
    expect(s).toContain(`starts_with(DBInstanceIdentifier, '${refs.dbInstanceIdentifier}-restored-')`);
    expect(s).toContain("Endpoint.Address");
  });

  test("repoints only the host in the connection URL secret, preserving the credential", () => {
    const s = cutoverScript(refs);
    expect(s).toContain(`--secret-id "${refs.connectionSecretName}"`);
    expect(s).toContain('.url |= sub("@[^:/@]+:5432"');
    expect(s).toContain("put-secret-value");
  });

  test("forces a backend redeploy and waits for the service to stabilise", () => {
    const s = cutoverScript(refs);
    expect(s).toContain(`update-service --cluster "${refs.ecsClusterName}" --service "${refs.backendServiceName}" --force-new-deployment`);
    expect(s).toContain("aws ecs wait services-stable");
  });

  test("does not delete the old instance (decommission is a separate confirmed step)", () => {
    const s = cutoverScript(refs);
    expect(s).not.toContain("delete-db-instance");
  });
});
