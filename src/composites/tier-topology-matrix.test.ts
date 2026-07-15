/**
 * chant#890 — the tier x topology matrix, exercised at the composite level
 * (unit coverage for the two orthogonal, parameter-driven axes the issue
 * describes: `tier` sizes a single Loom; `instance` — the topology/boundary
 * axis — decides how many coexist). `../lib/naming.test.ts` already proves
 * the naming helper itself never collides across instances/tiers; this file
 * proves the composites actually consume those params so real deployable
 * stacks (not just the naming helper in isolation) stay collision-free and
 * tier-appropriate.
 */

import { describe, test, expect } from "vitest";
import { SharedFoundation } from "./shared-foundation";
import { LoomDb } from "./loom-db";
import type { LoomNamingParams, Tier } from "../lib/naming";

const TIERS: readonly Tier[] = ["light", "production", "production-ha"];

function namingFor(tier: Tier, instance: string): LoomNamingParams {
  return {
    project: "loom",
    env: "test",
    instance,
    tier,
    region: "us-east-1",
    accountId: "111111111111",
    owner: "platform",
  };
}

const referenceExistingNetwork = {
  mode: "reference-existing" as const,
  vpcId: "vpc-123",
  publicSubnetIds: ["subnet-pub1", "subnet-pub2"],
  privateSubnetIds: ["subnet-priv1", "subnet-priv2"],
};

describe("tier x instance matrix — SharedFoundation", () => {
  for (const tier of TIERS) {
    test(`${tier}: two instances in the same project/env/account never collide on physical names`, () => {
      const a = SharedFoundation({
        naming: namingFor(tier, "a"),
        network: referenceExistingNetwork,
        domainName: tier === "light" ? undefined : "a.loom.example.com",
      });
      const b = SharedFoundation({
        naming: namingFor(tier, "b"),
        network: referenceExistingNetwork,
        domainName: tier === "light" ? undefined : "b.loom.example.com",
      });

      const bucketNameA = (a.artifactBucket as any).props.BucketName;
      const bucketNameB = (b.artifactBucket as any).props.BucketName;
      expect(bucketNameA).not.toBe(bucketNameB);

      const clusterNameA = (a.ecsCluster as any).props.ClusterName;
      const clusterNameB = (b.ecsCluster as any).props.ClusterName;
      expect(clusterNameA).not.toBe(clusterNameB);
      expect(clusterNameA).toBe("loom-test-a-shared-foundation-cluster");
      expect(clusterNameB).toBe("loom-test-b-shared-foundation-cluster");
    });

    test(`${tier}: instance is not part of the tag's identity confusion — tags().tier reflects the tier, not the instance`, () => {
      const a = SharedFoundation({
        naming: namingFor(tier, "a"),
        network: referenceExistingNetwork,
        domainName: tier === "light" ? undefined : "a.loom.example.com",
      });
      const tagsA: Array<{ Key: string; Value: string }> = (a.artifactBucket as any).props.Tags;
      expect(tagsA).toContainEqual({ Key: "tier", Value: tier });
      expect(tagsA).toContainEqual({ Key: "instance", Value: "a" });
    });
  }

  test("tier changes behavior, not the naming key: same instance, different tier -> same name, different topology (PrivateLink/DNS)", () => {
    const light = SharedFoundation({ naming: namingFor("light", "a"), network: referenceExistingNetwork });
    const prod = SharedFoundation({
      naming: namingFor("production", "a"),
      network: referenceExistingNetwork,
      domainName: "loom.example.com",
    });

    // Naming key has no tier segment (chant#897) — physical names match.
    expect((light.ecsCluster as any).props.ClusterName).toBe((prod.ecsCluster as any).props.ClusterName);

    // Tier alone drives the topology delta: PrivateLink/DNS only on production.
    expect(Object.keys(light.members)).not.toContain("nlb");
    expect(Object.keys(prod.members)).toContain("nlb");
  });
});

describe("tier x instance matrix — LoomDb", () => {
  const network = { vpcId: "vpc-123", subnetIds: ["subnet-priv1", "subnet-priv2"] };

  for (const tier of TIERS) {
    test(`${tier}: two instances never collide on the RDS instance identifier`, () => {
      const a = LoomDb({ naming: namingFor(tier, "a"), data: { mode: "provision", network, dbPassword: "x" } });
      const b = LoomDb({ naming: namingFor(tier, "b"), data: { mode: "provision", network, dbPassword: "x" } });

      const idA = (a.rdsInstance as any).props.DBInstanceIdentifier;
      const idB = (b.rdsInstance as any).props.DBInstanceIdentifier;
      expect(idA).not.toBe(idB);
      expect(idA).toBe("loom-test-a-loom-db-instance");
      expect(idB).toBe("loom-test-b-loom-db-instance");
    });
  }

  test("multi-boundary composes freely: production-ha in instance a, light in instance b, same env/account", () => {
    const ha = LoomDb({ naming: namingFor("production-ha", "a"), data: { mode: "provision", network, dbPassword: "x" } });
    const light = LoomDb({ naming: namingFor("light", "b"), data: { mode: "provision", network, dbPassword: "x" } });

    expect((ha.rdsInstance as any).props.MultiAZ).toBe(true);
    expect((light.rdsInstance as any).props.MultiAZ).toBe(false);
    expect(Object.keys(ha.members)).toContain("rotationSchedule");
    expect(Object.keys(light.members)).not.toContain("rotationSchedule");
    expect((ha.rdsInstance as any).props.DBInstanceIdentifier).not.toBe(
      (light.rdsInstance as any).props.DBInstanceIdentifier,
    );
  });
});
