import { describe, test, expect } from "vitest";
import { stackRefs } from "./stack-refs";
import { loomNaming, type LoomNamingParams } from "../../src/lib/naming";

const base: LoomNamingParams = {
  project: "loom",
  env: "prod",
  instance: "a",
  tier: "production",
  region: "us-east-1",
  accountId: "111111111111",
  owner: "platform",
};

describe("stackRefs — deterministic identifiers, no stackOutput needed", () => {
  test("derives every identifier from the same naming key the owning composite uses", () => {
    const refs = stackRefs(base);

    expect(refs.dbInstanceIdentifier).toBe("loom-prod-a-loom-db-instance");
    expect(refs.credentialsSecretName).toBe("loom-prod-a-loom-db-credentials");
    expect(refs.connectionSecretName).toBe("loom-prod-a-loom-db-database-url");
    expect(refs.ecsClusterName).toBe("loom-prod-a-shared-foundation-cluster");
    expect(refs.backendServiceName).toBe("loom-prod-a-loom-backend-backend-svc");
    expect(refs.frontendServiceName).toBe("loom-prod-a-loom-frontend-frontend-svc");
    expect(refs.backendTaskFamily).toBe("loom-prod-a-loom-backend-backend-task");
    expect(refs.cognitoUserPoolName).toBe("loom-prod-a-loom-cognito-pool");
    expect(refs.cognitoM2mClientName).toBe("loom-prod-a-loom-cognito-m2m-client");
    // ALB names have a 32-char ELBv2 limit (truncated+hashed by the naming helper) — assert via the same helper rather than a hand-truncated literal.
    expect(refs.albName).toBe(loomNaming(base, "shared-foundation").name("alb", { service: "alb" }));
    expect(refs.rdsProxyName).toBe("loom-prod-a-loom-db-proxy");
  });

  test("two instances never collide on any identifier (chant#897/#898)", () => {
    const a = stackRefs({ ...base, instance: "a" });
    const b = stackRefs({ ...base, instance: "b" });

    for (const key of Object.keys(a) as Array<keyof typeof a>) {
      expect(a[key]).not.toBe(b[key]);
    }
  });

  test("physical names are stable across tiers (chant#897: tier changes behavior, not the naming key)", () => {
    const light = stackRefs({ ...base, tier: "light" });
    const ha = stackRefs({ ...base, tier: "production-ha" });
    expect(light.dbInstanceIdentifier).toBe(ha.dbInstanceIdentifier);
    expect(light.backendServiceName).toBe(ha.backendServiceName);
  });
});
