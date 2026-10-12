import { describe, test, expect } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identityPreflightScript, preflightPhase, schemaPreflightScript, stableStacksPreflightScript } from "./preflight";

interface Stub {
  /** Account `sts get-caller-identity` answers, or undefined for no credentials. */
  account?: string;
  /** Stack name -> status; a stack not listed is missing. */
  stacks?: Record<string, string>;
  /** `yodel.sh status --json`'s exit code and applied count. */
  yodel?: { code: number; applied: number };
  /** Whether session-manager-plugin is on PATH. */
  ssmPlugin?: boolean;
}

// Runs a preflight script in a scratch directory against stub `aws`, `npx`,
// `session-manager-plugin` and `scripts/db/yodel.sh`.
function run(script: string, stub: Stub, env: Record<string, string> = {}): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "preflight-stub-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  mkdirSync(join(dir, "scripts/db"), { recursive: true });
  const stacks = stub.stacks ?? {};
  writeFileSync(
    join(bin, "aws"),
    `#!/usr/bin/env bash
case "$1 $2" in
  "sts get-caller-identity")
    ${stub.account ? `case "$*" in *Arn*) echo "arn:aws:iam::${stub.account}:role/ops" ;; *) echo "${stub.account}" ;; esac` : "exit 255"} ;;
  "cloudformation describe-stacks")
    case "$4" in
${Object.entries(stacks).map(([n, st]) => `      "${n}") echo "${st}" ;;`).join("\n")}
      *) exit 254 ;;
    esac ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, "npx"), "#!/usr/bin/env bash\necho whoami-stub\n", { mode: 0o755 });
  if (stub.ssmPlugin) writeFileSync(join(bin, "session-manager-plugin"), "#!/usr/bin/env bash\n", { mode: 0o755 });
  const y = stub.yodel ?? { code: 0, applied: 1 };
  writeFileSync(join(dir, "scripts/db/yodel.sh"), `echo '{"applied":[${Array(y.applied).fill('"m"').join(",")}]}'\nexit ${y.code}\n`);
  try {
    // A PATH without the host's session-manager-plugin, so the stub decides.
    const r = spawnSync("bash", ["-c", script], {
      cwd: dir,
      env: { PATH: `${bin}:/usr/bin:/bin:${process.execPath.replace(/\/node$/, "")}`, HOME: dir, ...env },
      encoding: "utf-8",
    });
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("preflight (loomster#27)", () => {
  test("every script is valid bash", () => {
    for (const s of [identityPreflightScript("dev"), stableStacksPreflightScript(["a", "b"]), schemaPreflightScript("loom-dev-a")]) {
      execFileSync("bash", ["-n"], { input: s });
    }
  });

  test("identity: resolves through sts and prints who acts", () => {
    const r = run(identityPreflightScript("dev"), { account: "111111111111" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("whoami-stub");
    expect(r.out).toContain("acting as arn:aws:iam::111111111111:role/ops in account 111111111111");
  });

  test("identity: no credentials stops the run", () => {
    const r = run(identityPreflightScript("dev"), {});
    expect(r.code).toBe(1);
    expect(r.out).toContain("AWS credentials don't resolve");
  });

  test("identity: credentials for another account than AWS_ACCOUNT_ID stop the run", () => {
    const r = run(identityPreflightScript("dev"), { account: "222222222222" }, { AWS_ACCOUNT_ID: "111111111111" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("resolve to account 222222222222, but AWS_ACCOUNT_ID is 111111111111");
  });

  test("stacks: settled stacks pass, including a rolled-back update", () => {
    const r = run(stableStacksPreflightScript(["a", "b"]), { stacks: { a: "UPDATE_COMPLETE", b: "UPDATE_ROLLBACK_COMPLETE" } });
    expect(r.code).toBe(0);
  });

  test("stacks: one mid-update, failed, never-created or missing stack stops the run and names each", () => {
    const r = run(stableStacksPreflightScript(["a", "b", "c", "d"]), {
      stacks: { a: "UPDATE_IN_PROGRESS", b: "UPDATE_ROLLBACK_FAILED", c: "ROLLBACK_COMPLETE" },
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain("a=UPDATE_IN_PROGRESS b=UPDATE_ROLLBACK_FAILED c=ROLLBACK_COMPLETE d=MISSING");
  });

  test("schema on AWS: needs the Session Manager plugin and the tunnel host", () => {
    const script = schemaPreflightScript("loom-prod-a");
    expect(run(script, { stacks: { "loom-prod-a-tunnel-host": "CREATE_COMPLETE" } }, { LOOM_ENV: "prod" }).out).toContain("install the AWS CLI Session Manager plugin");
    expect(run(script, { ssmPlugin: true }, { LOOM_ENV: "prod" }).out).toContain("deploy the tunnel host first (just tunnel-host)");
    expect(run(script, { ssmPlugin: true, stacks: { "loom-prod-a-tunnel-host": "CREATE_COMPLETE" } }, { LOOM_ENV: "prod" }).code).toBe(0);
  });

  test("schema on Floci needs no tunnel", () => {
    expect(run(schemaPreflightScript("loom-local-a"), {}, { LOOM_ENV: "local" }).code).toBe(0);
  });

  test("schema: pending migrations pass; a mismatch, a failed status or no baseline stop the run", () => {
    const script = schemaPreflightScript("loom-local-a");
    const env = { LOOM_ENV: "local" };
    expect(run(script, { yodel: { code: 3, applied: 2 } }, env).code).toBe(0);
    expect(run(script, { yodel: { code: 4, applied: 2 } }, env).out).toContain("checksum mismatch or an out-of-order migration");
    expect(run(script, { yodel: { code: 1, applied: 0 } }, env).out).toContain("yodel status failed (exit 1)");
    expect(run(script, { yodel: { code: 3, applied: 0 } }, env).out).toContain("record the baseline first (just db baseline)");
    expect(run(script, { yodel: { code: 3, applied: 0 } }, { ...env, LOOM_DB_APPLY_BASELINE: "1" }).code).toBe(0);
  });

  test("preflightPhase: identity always, stacks and schema when asked", () => {
    expect(preflightPhase({ env: "dev" }).steps).toHaveLength(1);
    const full = preflightPhase({ env: "dev", stacks: ["s"], schemaStackPrefix: "loom-dev-a" });
    expect(full.name).toBe("Preflight");
    expect(full.steps).toHaveLength(3);
  });
});
