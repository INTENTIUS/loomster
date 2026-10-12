import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { deployAgentRoleScript, importAgentRoleScript } from "./agent-role";

const refs = { stackPrefix: "loom-dev-a" };

describe("loom-agent-role scripts (loomster#2)", () => {
  test("both are valid bash", () => {
    execFileSync("bash", ["-n"], { input: deployAgentRoleScript(refs) });
    execFileSync("bash", ["-n"], { input: importAgentRoleScript(refs) });
  });

  test("refuse to run without an agent and a group", () => {
    for (const script of [deployAgentRoleScript(refs), importAgentRoleScript(refs)]) {
      expect(script).toContain("LOOM_AGENT_ROLE_AGENT:?");
      expect(script).toContain("LOOM_AGENT_ROLE_GROUP:?");
    }
  });

  test("the stack name matches the role name's agent suffix (underscores as hyphens)", () => {
    const out = execFileSync("bash", ["-c", `${deployAgentRoleScript(refs).split("\n").slice(0, 5).join("\n")}\necho "$STACK"`], {
      env: { ...process.env, LOOM_AGENT_ROLE_AGENT: "support_bot", LOOM_AGENT_ROLE_GROUP: "support" },
      encoding: "utf-8",
    });
    expect(out.trim()).toBe("loom-dev-a-agent-role-support-bot");
  });

  test("deploy builds the per-agent stack and allows a named IAM role", () => {
    const script = deployAgentRoleScript(refs);
    expect(script).toContain("chant build src/loom-agent-role --lexicon aws");
    expect(script).toContain("--capabilities CAPABILITY_NAMED_IAM");
  });

  test("import registers the role as an agent role tagged into the group, once", () => {
    const script = importAgentRoleScript(refs);
    expect(script).toContain(`-X POST "$BASE/api/security/roles"`);
    expect(script).toContain(`role_type: "agent"`);
    expect(script).toContain(`"loom:group": $g`);
    expect(script).toContain("is already registered in Loom");
  });
});
