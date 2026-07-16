import { describe, test, expect } from "vitest";
import { restoreDrillScript } from "./restore-drill";

const refs = {
  dbInstanceIdentifier: "loom-prod-a-loom-db-instance",
  dbSubnetGroupName: "loom-prod-a-loom-db-subnet-group",
  rdsSecurityGroupName: "loom-prod-a-loom-db-sg",
};

describe("restoreDrillScript", () => {
  test("resolves the RDS security group id by name and fails if absent", () => {
    const s = restoreDrillScript(refs);
    expect(s).toContain(`Name=group-name,Values=${refs.rdsSecurityGroupName}`);
    expect(s).toContain("exit 1");
  });

  test("picks the latest loom-backup snapshot, or an explicit one, and fails if none", () => {
    const s = restoreDrillScript(refs);
    expect(s).toContain('if [ -n "${LOOM_RESTORE_SNAPSHOT_ID:-}" ]');
    expect(s).toContain(`starts_with(DBSnapshotIdentifier, '${refs.dbInstanceIdentifier}-backup-')`);
    expect(s).toContain("nothing to restore");
  });

  test("restores to a throwaway -drill- instance in the same subnet group + security group", () => {
    const s = restoreDrillScript(refs);
    expect(s).toContain(`DRILL_ID="${refs.dbInstanceIdentifier}-drill-`);
    expect(s).toContain("restore-db-instance-from-db-snapshot");
    expect(s).toContain(`--db-subnet-group-name "${refs.dbSubnetGroupName}"`);
    expect(s).toContain('--vpc-security-group-ids "$SG_ID"');
    expect(s).toContain("aws rds wait db-instance-available");
  });

  test("registers the cleanup trap BEFORE creating the instance, so a failed drill never leaks it", () => {
    const s = restoreDrillScript(refs);
    const trapIdx = s.indexOf("trap cleanup EXIT");
    const createIdx = s.indexOf("restore-db-instance-from-db-snapshot");
    expect(trapIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(trapIdx).toBeLessThan(createIdx);
  });

  test("cleanup deletes the drill instance with no final snapshot, tolerating a missing instance", () => {
    const s = restoreDrillScript(refs);
    expect(s).toContain("delete-db-instance");
    expect(s).toContain("--skip-final-snapshot");
    expect(s).toContain('|| true'); // never fail the run on cleanup
  });

  test("asserts the restored instance is available and matches the source's engine + storage", () => {
    const s = restoreDrillScript(refs);
    expect(s).toContain('!= "available"');
    expect(s).toContain('"$DRILL_ENGINE" != "$SRC_ENGINE"');
    expect(s).toContain('"$DRILL_STORAGE" -lt "$SRC_STORAGE"');
  });

  test("never repoints the connection secret or touches the live backend (non-destructive)", () => {
    const s = restoreDrillScript(refs);
    expect(s).not.toContain("put-secret-value");
    expect(s).not.toContain("update-service");
  });
});
