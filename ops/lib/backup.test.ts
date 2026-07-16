import { describe, test, expect } from "vitest";
import { backupSnapshotScript, drCopySnapshotScript } from "./backup";

const dbInstanceIdentifier = "loom-prod-a-loom-db-instance";

describe("backupSnapshotScript (on-demand / scheduled RDS backup)", () => {
  test("creates a manual snapshot of the live instance, tagged as a backup, and waits for it", () => {
    const script = backupSnapshotScript({ dbInstanceIdentifier });
    expect(script).toContain(`aws rds create-db-snapshot --db-instance-identifier "${dbInstanceIdentifier}"`);
    expect(script).toContain("Key=chant:purpose,Value=backup");
    expect(script).toContain("aws rds wait db-snapshot-available");
    expect(script).toContain("set -euo pipefail");
  });

  test("the snapshot id is a backup-labelled id computed at run time (no two runs collide)", () => {
    const script = backupSnapshotScript({ dbInstanceIdentifier });
    expect(script).toContain(`SNAPSHOT_ID="${dbInstanceIdentifier}-backup-`);
    expect(script).toContain("$(date -u +%Y%m%dt%H%M%Sz)");
    expect(backupSnapshotScript({ dbInstanceIdentifier })).toBe(script); // deterministic build-time text
  });

  test("honors an explicit purpose label", () => {
    const script = backupSnapshotScript({ dbInstanceIdentifier }, { purpose: "scheduled-backup" });
    expect(script).toContain("Key=chant:purpose,Value=scheduled-backup");
  });
});

describe("drCopySnapshotScript (cross-region DR copy)", () => {
  test("is a clean no-op when no DR region is configured", () => {
    const script = drCopySnapshotScript({ dbInstanceIdentifier });
    expect(script).toContain('if [ -z "${LOOM_DR_REGION:-}" ]');
    expect(script).toContain("exit 0");
  });

  test("copies the most recent backup-labelled snapshot to the DR region by ARN", () => {
    const script = drCopySnapshotScript({ dbInstanceIdentifier });
    expect(script).toContain(`starts_with(DBSnapshotIdentifier, '${dbInstanceIdentifier}-backup-')`);
    expect(script).toContain("DBSnapshotArn");
    expect(script).toContain("aws rds copy-db-snapshot --source-db-snapshot-identifier");
    expect(script).toContain('--region "$LOOM_DR_REGION"');
    expect(script).toContain("--copy-tags");
  });

  test("passes a target-region KMS key when one is set (required for an encrypted source)", () => {
    const script = drCopySnapshotScript({ dbInstanceIdentifier });
    expect(script).toContain('if [ -n "${LOOM_DR_KMS_KEY_ID:-}" ]');
    expect(script).toContain("--kms-key-id");
  });

  test("fails loudly rather than silently when a DR region is set but no backup snapshot exists", () => {
    const script = drCopySnapshotScript({ dbInstanceIdentifier });
    expect(script).toContain("exit 1");
  });
});
