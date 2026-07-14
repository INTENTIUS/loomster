import { describe, test, expect } from "vitest";
import { loomNaming, logicalId, type LoomNamingParams } from "./naming";

const base: LoomNamingParams = {
  project: "loom",
  env: "dev",
  instance: "a",
  tier: "production",
  region: "us-east-1",
  accountId: "111111111111",
  owner: "platform-team",
};

describe("loomNaming: naming key + segment order", () => {
  test("default service produces the documented {project}-{env}-{instance}-{component}-{resource} key", () => {
    const naming = loomNaming(base, "loom-db");
    expect(naming.name("instance")).toBe("loom-dev-a-loom-db-instance");
  });

  test("sanitizes uppercase and invalid characters in every segment", () => {
    const naming = loomNaming({ ...base, project: "Loom", env: "Dev", instance: "A" }, "Loom_DB!!");
    expect(naming.name("My Instance")).toBe("loom-dev-a-loom-db-my-instance");
  });

  test("collapses and trims stray hyphens from sanitization", () => {
    const naming = loomNaming(base, "loom-db");
    expect(naming.name("--weird__resource--")).toBe("loom-dev-a-loom-db-weird-resource");
  });
});

describe("loomNaming: collision — two envs, same account/region (chant#897 acceptance)", () => {
  test("dev and prod never collide across every service kind", () => {
    const services = ["default", "alb", "targetGroup", "s3Bucket", "rdsInstance", "rdsProxy", "cognitoDomain", "ecrRepo"] as const;
    for (const service of services) {
      const dev = loomNaming({ ...base, env: "dev" }, "loom-backend").name("service", { service });
      const prod = loomNaming({ ...base, env: "prod" }, "loom-backend").name("service", { service });
      expect(dev).not.toBe(prod);
    }
  });
});

describe("loomNaming: collision — two instances, same account/env (chant#897 acceptance)", () => {
  test("instance-a and instance-b never collide across every service kind", () => {
    const services = ["default", "alb", "targetGroup", "s3Bucket", "rdsInstance", "rdsProxy", "cognitoDomain", "ecrRepo"] as const;
    for (const service of services) {
      const a = loomNaming({ ...base, instance: "instance-a" }, "loom-backend").name("service", { service });
      const b = loomNaming({ ...base, instance: "instance-b" }, "loom-backend").name("service", { service });
      expect(a).not.toBe(b);
    }
  });
});

describe("loomNaming: S3 global uniqueness (suffix account/region)", () => {
  test("identical project/env/instance/component/resource but different accounts never collide", () => {
    const acctA = loomNaming({ ...base, accountId: "111111111111" }, "shared-foundation").name("uploads", {
      service: "s3Bucket",
    });
    const acctB = loomNaming({ ...base, accountId: "222222222222" }, "shared-foundation").name("uploads", {
      service: "s3Bucket",
    });
    expect(acctA).not.toBe(acctB);
  });

  test("identical everything but different regions never collide", () => {
    const east = loomNaming({ ...base, region: "us-east-1" }, "shared-foundation").name("uploads", {
      service: "s3Bucket",
    });
    const west = loomNaming({ ...base, region: "us-west-2" }, "shared-foundation").name("uploads", {
      service: "s3Bucket",
    });
    expect(east).not.toBe(west);
  });

  test("missing accountId still derives a stable, distinct suffix from region alone", () => {
    const withAccount = loomNaming({ ...base, accountId: "111111111111" }, "shared-foundation").name("uploads", {
      service: "s3Bucket",
    });
    const withoutAccount = loomNaming({ ...base, accountId: undefined }, "shared-foundation").name("uploads", {
      service: "s3Bucket",
    });
    expect(withAccount).not.toBe(withoutAccount);
    // Deterministic: same inputs always produce the same name.
    expect(loomNaming({ ...base, accountId: undefined }, "shared-foundation").name("uploads", { service: "s3Bucket" })).toBe(
      withoutAccount,
    );
  });

  test("bucket name respects the 3-63 char S3 limit", () => {
    const naming = loomNaming(
      { ...base, project: "loom-production-platform", instance: "boundary-alpha" },
      "shared-foundation-networking",
    );
    const name = naming.name("uploads-and-artifacts-archive", { service: "s3Bucket" });
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
  });
});

describe("loomNaming: Cognito domain uniqueness + reserved prefixes", () => {
  test("unique per region even with identical other segments", () => {
    const east = loomNaming({ ...base, region: "us-east-1" }, "loom-cognito").name("domain", {
      service: "cognitoDomain",
    });
    const west = loomNaming({ ...base, region: "eu-west-1" }, "loom-cognito").name("domain", {
      service: "cognitoDomain",
    });
    expect(east).not.toBe(west);
  });

  test("never starts with a reserved prefix (aws/amazon/cognito)", () => {
    const naming = loomNaming({ ...base, project: "aws" }, "cognito");
    const name = naming.name("domain", { service: "cognitoDomain" });
    expect(name.startsWith("aws")).toBe(false);
    expect(name).toMatch(/^x-aws-/);
  });

  test("domain prefix respects the 63 char Cognito limit", () => {
    const naming = loomNaming(
      { ...base, project: "loom-production-platform", instance: "boundary-alpha-primary" },
      "loom-cognito-user-pool-domain",
    );
    const name = naming.name("hosted-ui-domain-prefix", { service: "cognitoDomain" });
    expect(name.length).toBeLessThanOrEqual(63);
  });
});

describe("loomNaming: ALB / target group 32 char limit", () => {
  test("truncates with a disambiguating hash tail when it would overflow 32 chars", () => {
    const naming = loomNaming(
      { ...base, project: "loom-production-platform", instance: "boundary-alpha" },
      "shared-foundation-networking",
    );
    const name = naming.name("public-application-load-balancer", { service: "alb" });
    expect(name.length).toBeLessThanOrEqual(32);
    expect(name).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
  });

  test("two different long overflowing names still land on distinct truncated values", () => {
    const naming = loomNaming(
      { ...base, project: "loom-production-platform", instance: "boundary-alpha" },
      "shared-foundation-networking",
    );
    const alb = naming.name("public-application-load-balancer-one", { service: "alb" });
    const tg = naming.name("public-application-load-balancer-two", { service: "targetGroup" });
    expect(alb.length).toBeLessThanOrEqual(32);
    expect(tg.length).toBeLessThanOrEqual(32);
    expect(alb).not.toBe(tg);
  });

  test("short names are left untouched (no gratuitous hashing)", () => {
    const naming = loomNaming(base, "alb");
    expect(naming.name("public", { service: "alb" })).toBe("loom-dev-a-alb-public");
  });
});

describe("loomNaming: RDS instance + DB proxy identifier rules", () => {
  test("respects the 63 char limit and starts with a letter", () => {
    const naming = loomNaming(
      { ...base, project: "loom-production-platform", instance: "boundary-alpha-primary" },
      "loom-db-relational-datastore",
    );
    const instance = naming.name("primary-writer-instance-identifier", { service: "rdsInstance" });
    const proxy = naming.name("primary-writer-instance-identifier", { service: "rdsProxy" });
    for (const name of [instance, proxy]) {
      expect(name.length).toBeLessThanOrEqual(63);
      expect(name).toMatch(/^[a-z]/);
      expect(name).toMatch(/^[a-z0-9-]+$/);
    }
  });

  test("prefixes with a letter if sanitization would otherwise start with a digit", () => {
    const naming = loomNaming({ ...base, project: "9lives" }, "loom-db");
    const name = naming.name("instance", { service: "rdsInstance" });
    expect(name).toMatch(/^[a-z]/);
  });
});

describe("loomNaming: ECR repository naming", () => {
  test("respects the 256 char ceiling and charset", () => {
    const naming = loomNaming(base, "loom-backend");
    const name = naming.name("backend-app-image-repository", { service: "ecrRepo" });
    expect(name.length).toBeLessThanOrEqual(256);
    expect(name).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
  });
});

describe("loomNaming: tags()", () => {
  test("returns exactly the cost-allocation tag set chant#896 attaches", () => {
    const naming = loomNaming(base, "loom-backend");
    expect(naming.tags()).toEqual({
      component: "loom-backend",
      tier: "production",
      env: "dev",
      owner: "platform-team",
      instance: "a",
    });
  });

  test("merges in extra tags without dropping the base set", () => {
    const naming = loomNaming(base, "loom-backend");
    expect(naming.tags({ costCenter: "1234" })).toEqual({
      component: "loom-backend",
      tier: "production",
      env: "dev",
      owner: "platform-team",
      instance: "a",
      costCenter: "1234",
    });
  });

  test("extra tags can override a base key", () => {
    const naming = loomNaming(base, "loom-backend");
    expect(naming.tags({ owner: "security-team" }).owner).toBe("security-team");
  });

  test("reflects the tier passed in (light / production / production-ha)", () => {
    expect(loomNaming({ ...base, tier: "light" }, "loom-backend").tags().tier).toBe("light");
    expect(loomNaming({ ...base, tier: "production-ha" }, "loom-backend").tags().tier).toBe("production-ha");
  });
});

describe("logicalId()", () => {
  test("produces a stable PascalCase id", () => {
    expect(logicalId("loom-db", "instance")).toBe("LoomDbInstance");
  });

  test("is deployment-agnostic — same id regardless of env/instance/tier", () => {
    // logicalId is deliberately not derived from loomNaming()'s params: CFN
    // logical ids only need to be unique within one template, not across envs.
    expect(logicalId("loom-db", "instance")).toBe(logicalId("loom-db", "instance"));
  });

  test("different resources produce different ids", () => {
    expect(logicalId("loom-db", "instance")).not.toBe(logicalId("loom-db", "proxy"));
  });

  test("sanitizes before casing", () => {
    expect(logicalId("loom_db!!", "my resource")).toBe("LoomDbMyResource");
  });
});
