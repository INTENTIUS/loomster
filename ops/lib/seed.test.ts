import { describe, test, expect } from "vitest";
import { seedDefaultsScript } from "./seed";

const refs = {
  agentRoleName: "loom-prod-a-shared-foundation-agent-role",
  cognitoUserPoolName: "loom-prod-a-loom-cognito-pool",
  defaultProfile: "foundation" as const,
};

describe("seedDefaultsScript", () => {
  test("bakes in the tier default profile but lets LOOM_SEED_PROFILE override it", () => {
    const script = seedDefaultsScript(refs);
    expect(script).toContain('PROFILE="${LOOM_SEED_PROFILE:-foundation}"');
    expect(script).toContain("set -euo pipefail");
  });

  test("profile=none seeds nothing", () => {
    const script = seedDefaultsScript(refs);
    expect(script).toContain('if [ "$PROFILE" = "none" ]; then echo "loom-seed: profile=none, nothing to seed"; exit 0; fi');
  });

  test("foundation: imports the agent execution role by ARN, idempotently", () => {
    const script = seedDefaultsScript(refs);
    expect(script).toContain(`ROLE_ARN="arn:aws:iam::\${ACCOUNT}:role/${refs.agentRoleName}"`);
    // existence-guarded (no duplicate import)
    expect(script).toContain("jq -e --arg a \"$ROLE_ARN\" 'any(.[]; .role_arn == $a)'");
    expect(script).toContain('"mode\\":\\"import');
    expect(script).toContain("POST \"$BASE/api/security/roles\"");
  });

  test("foundation: resolves the Cognito pool id by name and creates an authorizer, idempotently", () => {
    const script = seedDefaultsScript(refs);
    expect(script).toContain(`UserPools[?Name=='${refs.cognitoUserPoolName}'].Id`);
    expect(script).toContain("jq -e --arg n \"$AUTH_NAME\" 'any(.[]; .name == $n)'");
    expect(script).toContain("POST \"$BASE/api/security/authorizers\"");
    // skips gracefully when the pool is absent
    expect(script).toContain("skipping authorizer");
  });

  test("foundation stops before demo content; demo populates every Catalog section", () => {
    const script = seedDefaultsScript(refs);
    expect(script).toContain('if [ "$PROFILE" != "demo" ]; then echo "loom-seed: foundation seed complete"; exit 0; fi');
    // every Catalog section: MCP, memory, agent, A2A
    expect(script).toContain("POST \"$BASE/api/mcp/servers\"");
    expect(script).toContain("Loomster Echo MCP");
    expect(script).toContain("POST \"$BASE/api/memories\"");
    expect(script).toContain("POST \"$BASE/api/agents\"");
    expect(script).toContain('\\"source\\":\\"deploy\\"');
    expect(script).toContain("POST \"$BASE/api/a2a/agents\"");
  });

  test("A2A is registered only when a reachable endpoint (LOOM_DEMO_A2A_URL) is provided", () => {
    const script = seedDefaultsScript(refs);
    expect(script).toContain('if [ -n "${LOOM_DEMO_A2A_URL:-}" ]; then');
    expect(script).toContain("needs a reachable A2A endpoint");
  });

  test("the demo agent uses a valid (hyphen-free) name and a discovered model", () => {
    const script = seedDefaultsScript(refs);
    expect(script).toContain('AGENT_NAME="loomster_demo_agent"');
    expect(script).toContain("api/agents/models");
  });

  test("demo invokes the agent to populate the runtime dashboards, idempotent + READY-gated + demo-only", () => {
    const script = seedDefaultsScript(refs);
    // only when no invocation exists yet
    expect(script).toContain("'.total_invocations == 0'");
    // waits for the demo agent to be READY, then invokes it
    expect(script).toContain('ASTATUS" = "READY"');
    expect(script).toContain("POST \"$BASE/api/agents/$AID/invoke\"");
    // the whole block sits inside the demo branch (after the foundation early-exit)
    const demoExit = script.indexOf('loom-seed: foundation seed complete"; exit 0');
    expect(script.indexOf("api/agents/$AID/invoke")).toBeGreaterThan(demoExit);
  });

  test("demo also seeds the Security screen's approval-policy + permission-request tabs, but never an identity provider", () => {
    const script = seedDefaultsScript(refs);
    expect(script).toContain("POST \"$BASE/api/settings/approval-policies\"");
    expect(script).toContain("POST \"$BASE/api/security/permission-requests\"");
    // identity providers must NOT be seeded — it would disable Loom's dev-auth bypass
    expect(script).not.toContain("api/settings/identity-providers");
  });

  test("everything it creates is branded loomster", () => {
    const script = seedDefaultsScript(refs);
    // branded tags applied to the role + MCP
    expect(script).toContain('\\"loom:application\\":\\"loomster\\"');
    expect(script).toContain('\\"loom:owner\\":\\"loomster\\"');
    // a loomster tag profile, seeded idempotently
    expect(script).toContain("POST \"$BASE/api/settings/tag-profiles\"");
    expect(script).toContain('any(.[]; .name == "loomster")');
    expect(script).toContain('\\"name\\":\\"loomster\\"');
    // branded resource names
    expect(script).toContain("Loomster Cognito Pool");
    // the access-control group stays overridable
    expect(script).toContain('GROUP="${LOOM_SEED_GROUP:-loomster}"');
  });

  test("the demo default (light tier) emits the same script with a demo default profile", () => {
    const script = seedDefaultsScript({ ...refs, defaultProfile: "demo" });
    expect(script).toContain('PROFILE="${LOOM_SEED_PROFILE:-demo}"');
  });

  test("uses LOOM_API_BASE_URL, defaulting to the local-up proxy", () => {
    const script = seedDefaultsScript(refs);
    expect(script).toContain('BASE="${LOOM_API_BASE_URL:-http://localhost:8080}"');
  });
});
