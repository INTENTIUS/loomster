import { describe, test, expect } from "vitest";
import { resolveKms, resolveEcr, resolveAgentRole } from "./params";

// KMS / ECR / agent-role seam resolution for the deployable (#120). The
// composite already supports these three seams (provision | reference-existing |
// omit); these cover the params-layer decision that wires them from LOOM_* env
// vars, which — like the DNS seams before #117 — wasn't threaded through at all
// (always provision). Same shape as dns-seams.test.ts.

describe("resolveKms", () => {
  test("LOOM_KMS_KEY_ARN references an existing key", () => {
    const arn = "arn:aws:kms:us-east-1:000000000000:key/abcd-1234";
    expect(resolveKms(arn, undefined)).toEqual({ mode: "reference-existing", kmsKeyArn: arn });
  });

  test("a key arn wins over any LOOM_KMS mode", () => {
    expect(resolveKms("arn:x", "omit")).toEqual({ mode: "reference-existing", kmsKeyArn: "arn:x" });
  });

  test("LOOM_KMS=omit drops the key; provision forces one; unset -> default", () => {
    expect(resolveKms(undefined, "omit")).toEqual({ mode: "omit" });
    expect(resolveKms(undefined, "provision")).toEqual({ mode: "provision" });
    expect(resolveKms(undefined, undefined)).toBeUndefined();
    expect(resolveKms(undefined, "garbage")).toBeUndefined();
  });
});

describe("resolveEcr", () => {
  const f = { uri: "111122223333.dkr.ecr.us-east-1.amazonaws.com/loom-frontend", arn: "arn:aws:ecr:us-east-1:111122223333:repository/loom-frontend" };
  const b = { uri: "111122223333.dkr.ecr.us-east-1.amazonaws.com/loom-backend", arn: "arn:aws:ecr:us-east-1:111122223333:repository/loom-backend" };

  test("all four ids reference the existing repos", () => {
    expect(resolveEcr(f.uri, f.arn, b.uri, b.arn, undefined)).toEqual({
      mode: "reference-existing",
      frontendRepositoryUri: f.uri,
      frontendRepositoryArn: f.arn,
      backendRepositoryUri: b.uri,
      backendRepositoryArn: b.arn,
    });
  });

  test("a partial set is ignored rather than half-wired (falls through to the mode)", () => {
    // frontend uri+arn but no backend -> not reference-existing; honours LOOM_ECR
    expect(resolveEcr(f.uri, f.arn, undefined, undefined, "provision")).toEqual({ mode: "provision" });
    expect(resolveEcr(f.uri, f.arn, undefined, undefined, undefined)).toBeUndefined();
    // missing one arn -> still ignored
    expect(resolveEcr(f.uri, undefined, b.uri, b.arn, "omit")).toEqual({ mode: "omit" });
  });

  test("LOOM_ECR=omit drops the repos; provision forces them; unset -> default", () => {
    expect(resolveEcr(undefined, undefined, undefined, undefined, "omit")).toEqual({ mode: "omit" });
    expect(resolveEcr(undefined, undefined, undefined, undefined, "provision")).toEqual({ mode: "provision" });
    expect(resolveEcr(undefined, undefined, undefined, undefined, undefined)).toBeUndefined();
  });
});

describe("resolveAgentRole", () => {
  test("LOOM_AGENT_ROLE_ARN references a security-team-owned role", () => {
    const arn = "arn:aws:iam::111122223333:role/loom-agent";
    expect(resolveAgentRole(arn, undefined)).toEqual({ mode: "reference-existing", agentRoleArn: arn });
  });

  test("a role arn wins over any LOOM_AGENT_ROLE mode", () => {
    expect(resolveAgentRole("arn:x", "omit")).toEqual({ mode: "reference-existing", agentRoleArn: "arn:x" });
  });

  test("LOOM_AGENT_ROLE=omit drops it; provision forces one; unset -> default", () => {
    expect(resolveAgentRole(undefined, "omit")).toEqual({ mode: "omit" });
    expect(resolveAgentRole(undefined, "provision")).toEqual({ mode: "provision" });
    expect(resolveAgentRole(undefined, undefined)).toBeUndefined();
  });
});
