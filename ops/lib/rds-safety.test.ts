import { describe, test, expect } from "vitest";
import { snapshotBeforeScript, restorePreviousScript } from "./rds-safety";

const dbInstanceIdentifier = "loom-prod-a-loom-db-instance";

describe("snapshotBeforeScript (chant#905 — snapshot-before ahead of any mutating apply)", () => {
  test("creates a manual snapshot scoped to this DB instance and waits for it", () => {
    const script = snapshotBeforeScript({ dbInstanceIdentifier });
    expect(script).toContain(`aws rds create-db-snapshot --db-instance-identifier "${dbInstanceIdentifier}"`);
    expect(script).toContain("aws rds wait db-snapshot-available");
    expect(script).toContain("set -euo pipefail");
  });

  test("the snapshot id is computed at run time via shell command substitution, not a literal timestamp baked in at build time (no two runs of the built Op ever collide)", () => {
    const scriptA = snapshotBeforeScript({ dbInstanceIdentifier });
    const scriptB = snapshotBeforeScript({ dbInstanceIdentifier });
    expect(scriptA).toBe(scriptB); // same script text every build...
    expect(scriptA).toContain("$(date -u +%Y%m%dt%H%M%Sz)"); // ...because the timestamp is a shell expression, evaluated at run time
  });
});

describe("restorePreviousScript (chant#905 — the documented restore path)", () => {
  test("restores from the most recent manual snapshot of the same instance", () => {
    const script = restorePreviousScript({ dbInstanceIdentifier });
    expect(script).toContain(`aws rds describe-db-snapshots --db-instance-identifier "${dbInstanceIdentifier}" --snapshot-type manual`);
    expect(script).toContain("aws rds restore-db-instance-from-db-snapshot");
    expect(script).toContain("aws rds wait db-instance-available");
  });

  test("restores to a NEW instance id, never the live one (RDS has no in-place restore)", () => {
    const script = restorePreviousScript({ dbInstanceIdentifier });
    expect(script).toContain(`RESTORED_ID="${dbInstanceIdentifier}-restored-`);
    const restoreLine = script.split("\n").find((l) => l.includes("restore-db-instance-from-db-snapshot"));
    expect(restoreLine).toContain("$RESTORED_ID");
    expect(restoreLine).not.toContain(`"${dbInstanceIdentifier}"`);
  });

  test("fails loudly rather than silently no-op'ing when no snapshot exists", () => {
    const script = restorePreviousScript({ dbInstanceIdentifier });
    expect(script).toContain("exit 1");
  });
});
