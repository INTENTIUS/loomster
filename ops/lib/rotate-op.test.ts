import { describe, test, expect, beforeEach, afterEach } from "vitest";
import type { OpConfig } from "@intentius/chant/op";
import { buildLoomRotateOp } from "./rotate-op";
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

function configOf(op: ReturnType<typeof buildLoomRotateOp>): OpConfig {
  return (op as unknown as { props: OpConfig }).props;
}

const originalDomain = process.env.LOOM_DOMAIN_NAME;

beforeEach(() => {
  delete process.env.LOOM_DOMAIN_NAME;
});

afterEach(() => {
  if (originalDomain === undefined) delete process.env.LOOM_DOMAIN_NAME;
  else process.env.LOOM_DOMAIN_NAME = originalDomain;
});

describe("buildLoomRotateOp — always gated (chant#905: 'Gate where a rotation is disruptive')", () => {
  test("both tiers carry an Approve gate before the disruptive completion phase", () => {
    for (const tier of ["production", "production-ha"] as const) {
      const op = buildLoomRotateOp({ naming: { ...naming, tier } });
      const names = configOf(op).phases.map((p) => p.name);
      expect(names).toContain("Approve");
      expect(names.indexOf("Approve")).toBeLessThan(names.indexOf("CompleteRotation"));
    }
  });

  test("no ACM phase when LOOM_DOMAIN_NAME is unset (light-equivalent: no custom domain)", () => {
    const op = buildLoomRotateOp({ naming });
    const names = configOf(op).phases.map((p) => p.name);
    expect(names).not.toContain("RequestCertificate");
  });

  test("an ACM request+swap phase pair appears when a custom domain is configured", () => {
    process.env.LOOM_DOMAIN_NAME = "loom.example.com";
    const op = buildLoomRotateOp({ naming });
    const names = configOf(op).phases.map((p) => p.name);
    expect(names).toContain("RequestCertificate");
    expect(names.indexOf("RequestCertificate")).toBeLessThan(names.indexOf("Approve"));
  });
});

describe("buildLoomRotateOp — RDS mechanism follows the tier dial (chant#890)", () => {
  test("production-ha's RotateRdsCredential step uses the native rotate-secret trigger", () => {
    const op = buildLoomRotateOp({ naming: { ...naming, tier: "production-ha" } });
    const rotate = configOf(op).phases.find((p) => p.name === "RotateRdsCredential")!;
    const step = rotate.steps[0] as { fn?: string; args?: { cmd?: string } };
    expect(step.args?.cmd).toContain("aws secretsmanager rotate-secret");
  });

  test("production's RotateRdsCredential step manually rotates the master password", () => {
    const op = buildLoomRotateOp({ naming: { ...naming, tier: "production" } });
    const rotate = configOf(op).phases.find((p) => p.name === "RotateRdsCredential")!;
    const step = rotate.steps[0] as { fn?: string; args?: { cmd?: string } };
    expect(step.args?.cmd).toContain("aws rds modify-db-instance");
  });
});
