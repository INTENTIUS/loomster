import { describe, test, expect } from "vitest";
import { resolveNetwork } from "./network";

const vpcId = "vpc-0123456789abcdef0";
const publicSubnetIds = ["subnet-pub1", "subnet-pub2"];
const privateSubnetIds = ["subnet-priv1", "subnet-priv2"];

// chant#890 tier/topology matrix: `resolveNetwork` is the tier-aware gate
// that decides `network.mode` for the deployable shared-foundation stack.
// `SharedFoundation` itself refuses `network.mode: "provision"` outside
// `light` (see ../composites/shared-foundation.ts) — these tests cover the
// params-layer decision that used to silently fall back to "provision" and
// let that deep, generic composite error surface instead of a clear one here.
describe("resolveNetwork — light tier", () => {
  test("no VPC given: falls back to provision (from-scratch local/Floci synth)", () => {
    expect(resolveNetwork("light", undefined, undefined, undefined)).toEqual({ mode: "provision" });
  });

  test("VPC + public subnets given: opts into reference-existing, same as any other tier", () => {
    expect(resolveNetwork("light", vpcId, publicSubnetIds, undefined)).toEqual({
      mode: "reference-existing",
      vpcId,
      publicSubnetIds,
      privateSubnetIds: undefined,
    });
  });

  test("VPC given but no public subnets: still falls back to provision", () => {
    expect(resolveNetwork("light", vpcId, undefined, privateSubnetIds)).toEqual({ mode: "provision" });
  });
});

describe("resolveNetwork — production / production-ha tiers", () => {
  for (const tier of ["production", "production-ha"] as const) {
    test(`${tier}: VPC + public + private subnets given -> reference-existing, ids threaded through`, () => {
      expect(resolveNetwork(tier, vpcId, publicSubnetIds, privateSubnetIds)).toEqual({
        mode: "reference-existing",
        vpcId,
        publicSubnetIds,
        privateSubnetIds,
      });
    });

    test(`${tier}: no VPC given -> throws a clear, tier-specific error (no provision fallback)`, () => {
      expect(() => resolveNetwork(tier, undefined, undefined, undefined)).toThrow(
        new RegExp(`tier "${tier}" requires network.mode "reference-existing"`),
      );
    });

    test(`${tier}: VPC given but no public subnets -> throws (never silently falls back to provision)`, () => {
      expect(() => resolveNetwork(tier, vpcId, undefined, privateSubnetIds)).toThrow(
        /requires network\.mode "reference-existing"/,
      );
    });
  }
});
