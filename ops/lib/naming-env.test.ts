import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { namingParamsFor, namingParamsFromEnv } from "./naming-env";

const ENV_KEYS = ["LOOM_PROJECT", "LOOM_ENV", "LOOM_INSTANCE", "LOOM_TIER", "AWS_REGION", "AWS_ACCOUNT_ID", "LOOM_OWNER"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("namingParamsFor — tier is a caller-supplied literal, everything else from the environment", () => {
  test("defaults match the other stacks' own params.ts conventions", () => {
    expect(namingParamsFor("production")).toEqual({
      project: "loom",
      env: "dev",
      instance: "a",
      tier: "production",
      region: "us-east-1",
      accountId: undefined,
      owner: "platform",
    });
  });

  test("the tier argument wins regardless of LOOM_TIER — each tier gets its own named Op, not an env switch", () => {
    process.env.LOOM_TIER = "light";
    expect(namingParamsFor("production-ha").tier).toBe("production-ha");
  });

  test("reads every other field from the environment", () => {
    process.env.LOOM_PROJECT = "loom2";
    process.env.LOOM_ENV = "staging";
    process.env.LOOM_INSTANCE = "b";
    process.env.AWS_REGION = "eu-west-1";
    process.env.AWS_ACCOUNT_ID = "222222222222";
    process.env.LOOM_OWNER = "sre";

    expect(namingParamsFor("light")).toEqual({
      project: "loom2",
      env: "staging",
      instance: "b",
      tier: "light",
      region: "eu-west-1",
      accountId: "222222222222",
      owner: "sre",
    });
  });
});

describe("namingParamsFromEnv — teardown reads LOOM_TIER like a stack's own params.ts does", () => {
  test("defaults to light, same as every composite's params.ts", () => {
    expect(namingParamsFromEnv().tier).toBe("light");
  });

  test("honors LOOM_TIER", () => {
    process.env.LOOM_TIER = "production-ha";
    expect(namingParamsFromEnv().tier).toBe("production-ha");
  });

  test("rejects an invalid tier with a clear error", () => {
    process.env.LOOM_TIER = "bogus";
    expect(() => namingParamsFromEnv()).toThrow(/LOOM_TIER must be one of/);
  });
});
