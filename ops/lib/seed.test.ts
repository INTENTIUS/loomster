import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { seedDefaultsScript } from "./seed";

const script = seedDefaultsScript({
  agentRoleName: "loom-dev-a-agent-role",
  cognitoUserPoolName: "loom-dev-a-pool",
  cognitoStackName: "loom-dev-a-loom-cognito",
  defaultProfile: "demo",
});

describe("seedDefaultsScript failure handling (#42)", () => {
  test("is valid bash", () => {
    execFileSync("bash", ["-n"], { input: script });
  });

  test("no step swallows a failed request as 'skipped'", () => {
    expect(script).not.toMatch(/\|\| echo "loom-seed: [^"]*skipped/);
    expect(script).not.toMatch(/>\/dev\/null 2>&1 \|\| true/);
  });

  test("every demo step can report failed", () => {
    for (const step of [
      "demo-mcp-server",
      "demo-memory",
      "demo-agent",
      "demo-a2a-agent",
      "demo-approval-policy",
      "demo-agent-ready",
      "demo-invocations",
    ]) {
      expect(script).toContain(`verdict ${step} failed`);
    }
  });

  test("ends through finish, which exits non-zero when any step failed", () => {
    expect(script).toContain(`finish() { if [ -n "$FAILED" ]; then`);
    expect(script).toContain("exit 1; fi;");
    expect(script.trimEnd().endsWith(`finish "demo seed complete"`)).toBe(true);
  });
});
