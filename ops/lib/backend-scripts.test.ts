import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackendScriptsScript } from "./backend-scripts";

// Runs the generated bash against a fake `aws` on PATH: the entry parsing and
// the per-entry run-task override are the parts worth checking, and they only
// exist as shell.
const FAKE_AWS = `#!/usr/bin/env bash
echo "$*" >> "$CALLS"
case "$*" in
  *"ecs describe-services"*taskDefinition*) echo "arn:aws:ecs:us-east-1:111:task-definition/fam:7" ;;
  *"ecs describe-services"*networkConfiguration*) echo '{"awsvpcConfiguration":{"subnets":["subnet-1"],"securityGroups":["sg-1"],"assignPublicIp":"DISABLED"}}' ;;
  *"describe-task-definition"*awslogs-group*) echo "/ecs/backend-logs" ;;
  *"describe-task-definition"*awslogs-stream-prefix*) echo "backend" ;;
  *"ecs run-task"*) n=$(grep -c "ecs run-task" "$CALLS"); echo "arn:aws:ecs:us-east-1:111:task/cluster/task$n" ;;
  *"ecs describe-tasks"*exitCode*) echo "$FAKE_EXIT" ;;
  *"ecs describe-tasks"*stoppedReason*) echo "Essential container in task exited" ;;
  *"logs get-log-events"*) echo '["script output line"]' ;;
esac
`;

function run(specs: string, exitCode = "0") {
  const dir = mkdtempSync(join(tmpdir(), "backend-scripts-"));
  writeFileSync(join(dir, "aws"), FAKE_AWS);
  chmodSync(join(dir, "aws"), 0o755);
  const calls = join(dir, "calls");
  const script = runBackendScriptsScript({ cluster: "cluster", serviceName: "svc", container: "backend" });
  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALLS: calls, FAKE_EXIT: exitCode, LOOM_UPGRADE_SCRIPTS: specs },
  });
  const lines = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [];
  const runTasks = lines.filter((l) => l.startsWith("ecs run-task"));
  return { ...result, lines, runTasks };
}

describe("runBackendScriptsScript", () => {
  test("one run-task per entry, on the service's own task def + network, with the script as python -m scripts.<name> [args]", () => {
    const r = run("migrate_oauth2_secrets.py --apply, drop_permission_requests");
    expect(r.status, r.stderr).toBe(0);
    expect(r.runTasks).toHaveLength(2);
    expect(r.runTasks[0]).toContain("--task-definition arn:aws:ecs:us-east-1:111:task-definition/fam:7");
    expect(r.runTasks[0]).toContain('"subnets":["subnet-1"]');
    expect(r.runTasks[0]).toContain('{"containerOverrides":[{"name":"backend","command":["python","-m","scripts.migrate_oauth2_secrets","--apply"]}]}');
    expect(r.runTasks[1]).toContain('"command":["python","-m","scripts.drop_permission_requests"]');
    expect(r.lines.some((l) => l.includes("--log-stream-name backend/backend/task1"))).toBe(true);
    expect(r.stdout).toContain("script output line");
  });

  test("a non-zero exit fails the step after printing the logs, and stops before the next entry", () => {
    const r = run("migrate_oauth2_secrets.py --apply,drop_permission_requests.py", "1");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("script output line");
    expect(r.stderr).toContain("migrate_oauth2_secrets exited 1");
    expect(r.runTasks).toHaveLength(1);
  });

  test("unset/empty is a no-op that touches nothing", () => {
    const r = run("");
    expect(r.status).toBe(0);
    expect(r.lines).toHaveLength(0);
  });
});
