import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { seedDefaultsScript, SEED_MODEL_JQ, SEED_MODEL_PREFERENCE } from "./seed";

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

describe("demo agent model choice (#8)", () => {
  const pick = (models: unknown[], geo = "us"): string =>
    execFileSync("jq", ["-r", "--arg", "geo", geo, "--arg", "pref", SEED_MODEL_PREFERENCE.join(" "), SEED_MODEL_JQ], {
      input: JSON.stringify(models),
    }).toString().trim();

  test("takes the first preferred model as the region's profile, whatever the catalog order", () => {
    const models = [
      { model_id: "us.anthropic.claude-opus-5-5" },
      { model_id: "us.amazon.nova-micro-v1:0" },
      { model_id: "us.amazon.nova-lite-v1:0" },
    ];
    expect(pick(models)).toBe("us.amazon.nova-lite-v1:0");
  });

  test("skips a model Bedrock reports unavailable", () => {
    const models = [
      { model_id: "us.amazon.nova-lite-v1:0", available: false },
      { model_id: "us.amazon.nova-micro-v1:0", available: null },
    ];
    expect(pick(models)).toBe("us.amazon.nova-micro-v1:0");
  });

  test("outside the US, never picks a us. profile", () => {
    const models = [
      { model_id: "us.amazon.nova-lite-v1:0" },
      { model_id: "us.anthropic.claude-sonnet-5" },
      { model_id: "deepseek.r1-v1:0" },
    ];
    expect(pick(models, "eu")).toBe("deepseek.r1-v1:0");
    expect(pick([{ model_id: "eu.amazon.nova-lite-v1:0" }, ...models], "eu")).toBe("eu.amazon.nova-lite-v1:0");
  });

  test("prints nothing when no listed model fits", () => {
    expect(pick([{ model_id: "us.amazon.nova-lite-v1:0" }], "eu")).toBe("");
    expect(pick([])).toBe("");
  });

  test("LOOM_SEED_MODEL_ID overrides the choice", () => {
    expect(script).toContain('MODEL="${LOOM_SEED_MODEL_ID:-');
  });
});
