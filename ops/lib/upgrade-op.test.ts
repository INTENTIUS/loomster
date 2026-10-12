import { describe, test, expect } from "vitest";
import type { OpConfig } from "@intentius/chant/op";
import { buildLoomUpgradeOp } from "./upgrade-op";
import type { LoomNamingParams } from "../../src/lib/naming";

const naming: LoomNamingParams = {
  project: "loom",
  env: "prod",
  instance: "a",
  tier: "production",
  region: "us-east-1",
  accountId: "111111111111",
  owner: "platform",
};

function configOf(op: ReturnType<typeof buildLoomUpgradeOp>): OpConfig {
  return (op as unknown as { props: OpConfig }).props;
}

describe("buildLoomUpgradeOp — the dial (chant#905: prod/prod-ha gate+rollback, light additive/local)", () => {
  test("gated=false (light): no Approve phase, no onFailure — additive, no approval needed", () => {
    const op = buildLoomUpgradeOp({ naming: { ...naming, tier: "light" }, gated: false });
    const config = configOf(op);

    expect(config.phases.some((p) => p.name === "Approve")).toBe(false);
    expect(config.onFailure).toBeUndefined();
  });

  test("gated=true (production/production-ha): an Approve gate before Apply, and an onFailure Rollback", () => {
    const op = buildLoomUpgradeOp({ naming, gated: true });
    const config = configOf(op);

    const names = config.phases.map((p) => p.name);
    expect(names).toContain("Approve");
    expect(names.indexOf("Approve")).toBeLessThan(names.indexOf("Apply"));
    expect(config.onFailure?.map((p) => p.name)).toEqual(["Rollback"]);
  });

  test("phase order: the schema migrates (SQL Yodeler) before the backend rolls, the gate sits before both, one-time scripts run last (gated only)", () => {
    expect(configOf(buildLoomUpgradeOp({ naming: { ...naming, tier: "light" }, gated: false })).phases.map((p) => p.name)).toEqual([
      "Snapshot",
      "Schema",
      "Backend",
      "Apply",
    ]);
    expect(configOf(buildLoomUpgradeOp({ naming, gated: true })).phases.map((p) => p.name)).toEqual([
      "Snapshot",
      "Approve",
      "Schema",
      "Backend",
      "Apply",
      "Scripts",
    ]);
  });

  test("Schema applies the pending migrations through scripts/db/yodel.sh, on every tier (#78)", () => {
    for (const gated of [false, true]) {
      const schema = configOf(buildLoomUpgradeOp({ naming, gated })).phases.find((p) => p.name === "Schema")!;
      expect(schema.steps).toHaveLength(1);
      expect(JSON.stringify(schema.steps[0])).toContain("bash scripts/db/yodel.sh apply");
    }
  });

  test("Op name and labels are tier/env-scoped", () => {
    const op = buildLoomUpgradeOp({ naming, gated: true });
    const config = configOf(op);
    expect(config.name).toBe("loom-upgrade-production");
    expect(config.labels).toEqual({ Tier: "production", Env: "prod" });
  });

  test("the gate name is derived from the Op's own name", () => {
    const op = buildLoomUpgradeOp({ naming, gated: true });
    const config = configOf(op);
    const approve = config.phases.find((p) => p.name === "Approve")!;
    expect(approve.steps[0]).toMatchObject({ kind: "gate", gate: "approve-loom-upgrade-production" });
  });
});
