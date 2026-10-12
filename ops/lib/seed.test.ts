import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      "demo-eval-test-case",
      "demo-eval-run",
      "demo-skill",
      "demo-skill-approved",
      "demo-skill-attached",
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

// Runs the demo seed against a stub Loom: `curl` answers from a table and logs
// each request, `aws` answers the pool lookup. Checks the requests the
// evaluation and skill steps make, which a typo in a path or body would break.
function runAgainstStub(opts: { registry: boolean }): { out: string; requests: string } {
  const dir = mkdtempSync(join(tmpdir(), "seed-stub-"));
  const log = join(dir, "requests.log");
  writeFileSync(
    join(dir, "curl"),
    `#!/usr/bin/env bash
m=GET d= u=
while [ $# -gt 0 ]; do
  case "$1" in -X) m="$2"; shift ;; -d) d="$2"; shift ;; -K|-w|-H|--max-time) shift ;; http*) u="$1" ;; esac
  shift
done
p="\${u#http://loom}"
echo "$m $p $d" >>"${log}"
case "$m $p" in
  "GET /api/agents") echo '[{"id":7,"name":"loomster_demo_agent","status":"READY"}]' ;;
  "GET /api/agents/7/status") echo '{"status":"READY"}' ;;
  "GET /api/dashboard/costs") echo '{"total_invocations":3}' ;;
  "GET /api/agents/models") echo '{"models":[{"model_id":"us.amazon.nova-lite-v1:0"}]}' ;;
  "POST /api/agents/7/evaluations/test-cases") echo '{"id":11,"name":"Loomster demo test case","last_run_at":null}' ;;
  "GET /api/settings/registry") echo '{"enabled":${opts.registry}}' ;;
  "POST /api/registry/records") echo '{"record_id":"rec1","status":"DRAFT"}' ;;
  "GET /api/registry/records/rec1") echo '{"record_id":"rec1","status":"DRAFT"}' ;;
  GET*) echo '[]' ;;
  *) echo '{}' ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(join(dir, "aws"), `#!/usr/bin/env bash\necho us-east-1_Stub\n`, { mode: 0o755 });
  let out = "";
  try {
    out = execFileSync("bash", ["-c", script], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, LOOM_API_BASE_URL: "http://loom", LOOM_SEED_PROFILE: "demo", AWS_ACCOUNT_ID: "111122223333", LOOM_API_TOKEN: "" },
      encoding: "utf8",
    });
  } catch (e) {
    // Steps outside these two may fail against the stub; the output still holds every verdict.
    out = String((e as { stdout?: string }).stdout ?? "");
  }
  const requests = readFileSync(log, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { out, requests };
}

describe("demo evaluation and skill steps (#10, #11)", () => {
  test("saves a Helpfulness test case on the demo agent and starts one run", () => {
    const { out, requests } = runAgainstStub({ registry: true });
    expect(requests).toMatch(/^POST \/api\/agents\/7\/evaluations\/test-cases \{.*"evaluator_ids":\["Builtin.Helpfulness"\]/m);
    expect(requests).toMatch(/^POST \/api\/agents\/7\/evaluations\/test-cases\/11\/run /m);
    expect(out).toContain("step=demo-eval-test-case verdict=ok");
    expect(out).toContain("step=demo-eval-run verdict=ok");
  });

  test("with a registry: creates, submits, approves and attaches the demo skill", () => {
    const { out, requests } = runAgainstStub({ registry: true });
    const create = requests.split("\n").find((l) => l.startsWith("POST /api/registry/records {"));
    expect(create).toBeDefined();
    const body = JSON.parse(create!.slice("POST /api/registry/records ".length));
    expect(body).toMatchObject({ resource_type: "skill", skill_name: "loomster-demo-skill", skill_license: "MIT", skill_version: "1.0.0" });
    expect(body.skill_md).toContain("name: loomster-demo-skill\n");
    expect(requests).toMatch(/^POST \/api\/registry\/records\/rec1\/submit/m);
    expect(requests).toMatch(/^POST \/api\/registry\/records\/rec1\/approve \{"reason":/m);
    expect(requests).toMatch(/^POST \/api\/agents\/7\/integrations \{"integration_type":"skill","integration_config":\{"record_id":"rec1"\}\}/m);
    for (const step of ["demo-skill", "demo-skill-approved", "demo-skill-attached"]) expect(out).toContain(`step=${step} verdict=ok`);
  });

  test("without a registry: the skill step is skipped with the reason, nothing is written", () => {
    const { out, requests } = runAgainstStub({ registry: false });
    expect(out).toMatch(/step=demo-skill verdict=skipped no Agent Registry configured/);
    expect(requests).not.toMatch(/^POST \/api\/registry/m);
  });
});
