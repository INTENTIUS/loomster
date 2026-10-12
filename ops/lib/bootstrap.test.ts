import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapScript, LOOM_SERVICE_LINKED_ROLES } from "./bootstrap";

// Runs the script against a stub `aws` that knows which service paths already
// have a role, and logs every call.
function runAgainstStub(existing: string[]): { out: string; calls: string } {
  const dir = mkdtempSync(join(tmpdir(), "bootstrap-stub-"));
  const log = join(dir, "calls.log");
  writeFileSync(
    join(dir, "aws"),
    `#!/usr/bin/env bash
echo "$*" >> "${log}"
if [ "$1 $2" = "iam list-roles" ]; then
  case "$4" in
${existing.map((s) => `    "/aws-service-role/${s}/") echo "Role-for-${s}" ;;`).join("\n")}
    *) echo None ;;
  esac
fi
`,
    { mode: 0o755 },
  );
  try {
    const out = execFileSync("bash", ["-c", bootstrapScript()], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      encoding: "utf-8",
    });
    let calls = "";
    try { calls = readFileSync(log, "utf-8"); } catch { /* no calls */ }
    return { out, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("loom-bootstrap (loomster#38)", () => {
  test("covers Loom's agentcore.init and ecs.init", () => {
    expect(LOOM_SERVICE_LINKED_ROLES.map((r) => [r.loomTarget, r.service])).toEqual([
      ["ecs.init", "ecs.amazonaws.com"],
      ["agentcore.init", "runtime-identity.bedrock-agentcore.amazonaws.com"],
    ]);
  });

  test("is valid bash", () => {
    execFileSync("bash", ["-n"], { input: bootstrapScript() });
  });

  test("a fresh account: creates both roles", () => {
    const { calls } = runAgainstStub([]);
    expect(calls).toMatch(/^iam create-service-linked-role --aws-service-name ecs\.amazonaws\.com$/m);
    expect(calls).toMatch(/^iam create-service-linked-role --aws-service-name runtime-identity\.bedrock-agentcore\.amazonaws\.com$/m);
  });

  test("an account that has them: creates nothing", () => {
    const { out, calls } = runAgainstStub(["ecs.amazonaws.com", "runtime-identity.bedrock-agentcore.amazonaws.com"]);
    expect(calls).not.toMatch(/create-service-linked-role/);
    expect(out).toContain("already exists");
  });

  test("creates only the missing one", () => {
    const { calls } = runAgainstStub(["ecs.amazonaws.com"]);
    expect(calls).not.toMatch(/create-service-linked-role --aws-service-name ecs\.amazonaws\.com/);
    expect(calls).toMatch(/create-service-linked-role --aws-service-name runtime-identity\.bedrock-agentcore\.amazonaws\.com/);
  });

  test("a failed create fails the step (unlike Loom's `|| true`)", () => {
    expect(bootstrapScript()).not.toContain("|| true");
    expect(bootstrapScript()).toContain("set -euo pipefail");
  });
});
