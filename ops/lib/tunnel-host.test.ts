import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { deployTunnelHostScript } from "./tunnel-host";

const script = deployTunnelHostScript({ stackPrefix: "loom-prod-a" });

describe("deployTunnelHostScript (loomster#37)", () => {
  test("is valid bash", () => {
    execFileSync("bash", ["-n"], { input: script });
  });

  test("reads its inputs from this deployment's stacks, each one overridable", () => {
    expect(script).toContain('LOOM_TUNNEL_VPC_ID="${LOOM_TUNNEL_VPC_ID:-$(out loom-prod-a-shared-foundation oVpcId)}"');
    // shared-foundation joins subnet ids with ":" (SUBNET_LIST_DELIMITER); the build param is comma-separated.
    expect(script).toContain("$(out loom-prod-a-shared-foundation oPrivateSubnetIds | tr ':' ',')");
    expect(script).toContain("$(out loom-prod-a-loom-db oRdsSecurityGroupId)");
    expect(script).toContain("$(out loom-prod-a-loom-db oRdsPort)");
  });

  test("builds the stack source and deploys it as <prefix>-tunnel-host", () => {
    expect(script).toContain("npx chant build src/loom-tunnel-host --lexicon aws");
    expect(script).toMatch(/aws cloudformation deploy --stack-name "loom-prod-a-tunnel-host" .*--capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset/);
  });

  test("fails without a VPC instead of building an empty stack", () => {
    expect(script).toMatch(/\[ -n "\$LOOM_TUNNEL_VPC_ID" \] \|\| \{ .*exit 1; \}/);
  });
});
