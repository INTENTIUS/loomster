import { describe, test, expect } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  operatorRefs,
  fixSequencesScript,
  importSqliteScript,
  resetDbScript,
  restartBackendScript,
  ownedCredentialProvidersScript,
  listCredentialProvidersScript,
  memoryQueryScript,
  setPasswordsScript,
  RESET_DB_PY,
  OWNED_CREDENTIAL_PROVIDERS_PY,
} from "./operator";

// The scripts only exist as bash, so they run against a fake `aws` on PATH
// that logs each call and answers the lookups they make.
const FAKE_AWS = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  *"ecs describe-services"*taskDefinition*) [ -n "\${NO_SERVICE:-}" ] && echo None || echo "arn:aws:ecs:us-east-1:111:task-definition/fam:7" ;;
  *"ecs describe-services"*networkConfiguration*) [ -n "\${NO_SERVICE:-}" ] && echo null || echo '{"awsvpcConfiguration":{"subnets":["subnet-1"],"securityGroups":["sg-1"]}}' ;;
  *"describe-task-definition"*awslogs-group*) echo "/ecs/backend" ;;
  *"describe-task-definition"*awslogs-stream-prefix*) echo "backend" ;;
  *"ecs run-task"*) echo "arn:aws:ecs:us-east-1:111:task/cluster/task1" ;;
  *"ecs describe-tasks"*exitCode*) echo 0 ;;
  *"ecs describe-tasks"*stoppedReason*) echo "Essential container in task exited" ;;
  *"logs get-log-events"*) echo '["task output"]' ;;
  *"oArtifactBucket"*) echo "artifact-bucket" ;;
  *"oCognitoUserPoolId"*) echo "us-east-1_pool" ;;
  *"cognito-idp list-users"*) echo '{"Users":[{"Username":"admin"},{"Username":"demo-user-1"}]}' ;;
  *"cognito-idp admin-set-user-password"*) for a in "$@"; do case "$a" in file://*) cat "\${a#file://}" >> "$CALLS.inputs" ;; esac; done ;;
  *"get-memory"*) echo '{"memory":{"strategies":[{"strategyId":"sum-1","namespaces":["/strategies/{memoryStrategyId}/actors/{actorId}/sessions/{sessionId}"]}]}}' ;;
  *"list-memory-records"*) echo '{"memoryRecordSummaries":[{"memoryRecordId":"r1"}]}' ;;
  *"list-memories"*) echo '{"memories":[{"id":"m1"}]}' ;;
  *"list-oauth2-credential-providers"*) echo '{"credentialProviders":[{"name":"loom-bot-1-mcp-x","credentialProviderVendor":"CustomOauth2"}]}' ;;
  *"list-api-key-credential-providers"*) echo '{"credentialProviders":[]}' ;;
esac
`;

function run(script: string, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "operator-"));
  writeFileSync(join(dir, "aws"), FAKE_AWS);
  chmodSync(join(dir, "aws"), 0o755);
  const calls = join(dir, "calls");
  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALLS: calls, TMPDIR: dir, ...env },
  });
  const lines = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [];
  const inputs = existsSync(`${calls}.inputs`) ? readFileSync(`${calls}.inputs`, "utf8") : "";
  return { ...result, dir, lines, inputs, runTask: lines.find((l) => l.startsWith("ecs run-task")) ?? "" };
}

const refs = operatorRefs({ project: "loom", env: "dev", instance: "a", tier: "light", region: "us-east-1", owner: "platform" } as never);

/** The container argv a run-task call asked for. */
function command(runTaskLine: string): string[] {
  const m = runTaskLine.match(/--overrides (\{.*\}) --started-by/);
  return JSON.parse(m![1]).containerOverrides[0].command;
}

describe("operatorRefs", () => {
  test("stack names are namespaced by project+env+instance, the backend target is the live service", () => {
    expect(refs.sharedFoundationStackName).toBe("loom-dev-a-shared-foundation");
    expect(refs.cognitoStackName).toBe("loom-dev-a-loom-cognito");
    expect(refs.backend.container).toBe("backend");
    expect(refs.backend.serviceName).toContain("backend-svc");
  });
});

describe("embedded Python", () => {
  test.each([["RESET_DB_PY", RESET_DB_PY], ["OWNED_CREDENTIAL_PROVIDERS_PY", OWNED_CREDENTIAL_PROVIDERS_PY]])("%s parses", (_, src) => {
    execFileSync("python3", ["-c", "import ast, sys; ast.parse(sys.stdin.read())"], { input: src });
  });

  test("reset-db neither prompts nor prints the database URL", () => {
    expect(RESET_DB_PY).not.toMatch(/input\(/);
    expect(RESET_DB_PY).not.toMatch(/print\([^)]*url/);
  });
});

describe("backend one-off tasks", () => {
  test("fix-sequences runs fix_sequences.py on the service's own task definition and network", () => {
    const r = run(fixSequencesScript(refs.backend));
    expect(r.status, r.stderr).toBe(0);
    expect(r.runTask).toContain("--task-definition arn:aws:ecs:us-east-1:111:task-definition/fam:7");
    expect(r.runTask).toContain('"subnets":["subnet-1"]');
    expect(command(r.runTask)).toEqual(["python", "-m", "scripts.fix_sequences"]);
    expect(r.stdout).toContain("task output");
  });

  test("reset-db runs the drop as python -c, and the restart rolls the service and waits", () => {
    const r = run(resetDbScript(refs.backend));
    expect(r.status, r.stderr).toBe(0);
    expect(command(r.runTask)).toEqual(["python", "-c", RESET_DB_PY]);
    const restart = run(restartBackendScript(refs.backend));
    expect(restart.lines.some((l) => l.startsWith("ecs update-service") && l.includes("--force-new-deployment"))).toBe(true);
    expect(restart.lines.some((l) => l.startsWith("ecs wait services-stable"))).toBe(true);
  });

  test("owned credential providers: list or delete, and teardown's re-run skips a backend that is gone", () => {
    const list = run(ownedCredentialProvidersScript(refs.backend, "list"));
    expect(list.status, list.stderr).toBe(0);
    expect(command(list.runTask)).toEqual(["python", "-c", OWNED_CREDENTIAL_PROVIDERS_PY, "list"]);
    const del = run(ownedCredentialProvidersScript(refs.backend, "delete"));
    expect(command(del.runTask).at(-1)).toBe("delete");

    const gone = run(ownedCredentialProvidersScript(refs.backend, "delete", { missingServiceOk: true }), { NO_SERVICE: "1" });
    expect(gone.status).toBe(0);
    expect(gone.stdout).toContain("nothing to do");
    expect(gone.runTask).toBe("");
    const goneStrict = run(ownedCredentialProvidersScript(refs.backend, "delete"), { NO_SERVICE: "1" });
    expect(goneStrict.status).not.toBe(0);
  });
});

describe("importSqliteScript", () => {
  const script = importSqliteScript({ target: refs.backend, sharedFoundationStackName: refs.sharedFoundationStackName });

  test("uploads the file, imports it in a one-off task with the URL expanded inside the container, then deletes the object", () => {
    const dir = mkdtempSync(join(tmpdir(), "sqlite-"));
    writeFileSync(join(dir, "loom.db"), "sqlite");
    const r = run(script, { LOOM_IMPORT_SQLITE: join(dir, "loom.db") });
    expect(r.status, r.stderr).toBe(0);
    const cp = r.lines.find((l) => l.startsWith("s3 cp"))!;
    expect(cp).toMatch(/s3:\/\/artifact-bucket\/loom-import\/\d{8}T\d{6}Z\/loom\.db$/);
    const argv = command(r.runTask);
    expect(argv.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(argv[2]).toContain('--dest "$LOOM_DATABASE_URL"');
    expect(argv[2]).toContain("python -m scripts.migrate_sqlite_to_postgres --source sqlite:////tmp/loom.db");
    expect(argv[2]).toMatch(/&& python -m scripts\.fix_sequences$/);
    expect(argv.slice(3)).toEqual(["artifact-bucket", cp.split("s3://artifact-bucket/")[1], ""]);
    expect(r.lines.some((l) => l.startsWith("s3 rm s3://artifact-bucket/loom-import/"))).toBe(true);
  });

  test("LOOM_IMPORT_SKIP_EXISTING=1 passes --skip-existing", () => {
    const dir = mkdtempSync(join(tmpdir(), "sqlite-"));
    writeFileSync(join(dir, "loom.db"), "sqlite");
    const r = run(script, { LOOM_IMPORT_SQLITE: join(dir, "loom.db"), LOOM_IMPORT_SKIP_EXISTING: "1" });
    expect(command(r.runTask).at(-1)).toBe("--skip-existing");
  });

  test("no file: fails before touching AWS", () => {
    const r = run(script, { LOOM_IMPORT_SQLITE: "/nonexistent/loom.db" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("set LOOM_IMPORT_SQLITE");
    expect(r.lines).toHaveLength(0);
  });
});

describe("listCredentialProvidersScript", () => {
  test("lists OAuth2 and API-key providers in the region", () => {
    const r = run(listCredentialProvidersScript());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("loom-bot-1-mcp-x");
  });
});

describe("memoryQueryScript", () => {
  const script = memoryQueryScript();

  test("list is the default", () => {
    const r = run(script);
    expect(r.status, r.stderr).toBe(0);
    expect(r.lines).toEqual(["bedrock-agentcore-control list-memories --output json"]);
  });

  test("records expands each strategy's namespaces for the actor, cut at the first unfilled placeholder", () => {
    const r = run(script, { LOOM_MEMORY_QUERY: "records", LOOM_MEMORY_ID: "mem-1", LOOM_MEMORY_ACTOR_ID: "alice" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.lines).toContain("bedrock-agentcore list-memory-records --memory-id mem-1 --namespace /strategies/sum-1/actors/alice/sessions/ --output json");
    expect(JSON.parse(r.stdout)).toMatchObject({ actor_id: "alice", memory_id: "mem-1", total_records: 1 });
  });

  test("a query missing its input names it, and an unknown query is refused", () => {
    const r = run(script, { LOOM_MEMORY_QUERY: "get" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("needs LOOM_MEMORY_ID");
    expect(run(script, { LOOM_MEMORY_QUERY: "nope" }).status).not.toBe(0);
  });
});

describe("setPasswordsScript", () => {
  const script = setPasswordsScript(refs.cognitoStackName);

  test("defaults to every FORCE_CHANGE_PASSWORD user; the password goes through a file, never argv", () => {
    const r = run(script, { LOOM_COGNITO_PASSWORD: "S3cret-pass!" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.lines.some((l) => l.includes("FORCE_CHANGE_PASSWORD"))).toBe(true);
    const sets = r.lines.filter((l) => l.startsWith("cognito-idp admin-set-user-password"));
    expect(sets).toHaveLength(2);
    expect(r.lines.join("\n")).not.toContain("S3cret-pass!");
    const inputs = r.inputs.trim().split("\n").map((l) => JSON.parse(l));
    expect(inputs).toEqual([
      { UserPoolId: "us-east-1_pool", Username: "admin", Password: "S3cret-pass!", Permanent: true },
      { UserPoolId: "us-east-1_pool", Username: "demo-user-1", Password: "S3cret-pass!", Permanent: true },
    ]);
  });

  test("LOOM_COGNITO_USERS names the users; no password is refused", () => {
    const r = run(script, { LOOM_COGNITO_PASSWORD: "x", LOOM_COGNITO_USERS: "alice, bob" });
    expect(r.inputs).toContain('"Username":"alice"');
    expect(r.inputs).toContain('"Username":"bob"');
    expect(r.lines.some((l) => l.includes("list-users"))).toBe(false);
    expect(run(script).status).not.toBe(0);
  });
});
