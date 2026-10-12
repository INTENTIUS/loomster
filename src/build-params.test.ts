/**
 * Build-time parameters reach `chant build src/<stack>` from the env vars
 * CI, scripts and docs set (loomster#43). Runs the real `chant` bin the same
 * way `npm run synth:<stack>` does and checks the synthesized template.
 */

import { describe, test, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import config from "../chant.config";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CHANT_BIN = join(REPO_ROOT, "node_modules", ".bin", "chant");
const outDir = mkdtempSync(join(tmpdir(), "loom-build-params-"));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

/** The caller's env minus any LOOM_* already set, so only `vars` drive the build. */
function cleanEnv(vars: Record<string, string>): NodeJS.ProcessEnv {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("LOOM_")));
  return { ...base, ...vars };
}

let n = 0;
function synth(stack: string, vars: Record<string, string>, extraArgs: string[] = []): { ok: boolean; stderr: string; raw: string; resourceTypes: string[] } {
  const outFile = join(outDir, `${stack}-${n++}.json`);
  const r = spawnSync(CHANT_BIN, ["build", `src/${stack}`, "--lexicon", "aws", "-o", outFile, ...extraArgs], {
    cwd: REPO_ROOT,
    env: cleanEnv(vars),
    encoding: "utf-8",
  });
  if (r.status !== 0) return { ok: false, stderr: r.stderr, raw: "", resourceTypes: [] };
  const raw = readFileSync(outFile, "utf-8");
  const template = JSON.parse(raw) as { Resources: Record<string, { Type: string }> };
  return { ok: true, stderr: r.stderr, raw, resourceTypes: Object.values(template.Resources).map((res) => res.Type) };
}

const BYO_NETWORK = {
  LOOM_VPC_ID: "vpc-0123456789abcdef0",
  LOOM_PUBLIC_SUBNET_IDS: "subnet-0aaaaaaaaa1111111,subnet-0bbbbbbbbb2222222",
  LOOM_PRIVATE_SUBNET_IDS: "subnet-0ccccccccc3333333,subnet-0ddddddddd4444444",
};

describe("LOOM_* env vars reach chant build", { timeout: 180_000 }, () => {
  test("loom-db: LOOM_DB_PASSWORD, and --param on a subdirectory build", () => {
    const fromEnv = synth("loom-db", { LOOM_DB_PASSWORD: "sentinelPwEnv123" });
    expect(fromEnv.ok, fromEnv.stderr).toBe(true);
    expect(fromEnv.raw).toContain("sentinelPwEnv123");

    const fromFlag = synth("loom-db", {}, ["--param", "dbPassword=sentinelPwFlag123"]);
    expect(fromFlag.ok, fromFlag.stderr).toBe(true);
    expect(fromFlag.raw).toContain("sentinelPwFlag123");
  });

  test("shared-foundation: LOOM_TIER, LOOM_HOSTED_ZONE_ID, LOOM_DOMAIN_NAME, LOOM_KMS seam mode", () => {
    const vars = { ...BYO_NETWORK, LOOM_TIER: "production", LOOM_HOSTED_ZONE_ID: "ZSENTINEL0123", LOOM_DOMAIN_NAME: "sentinel.example.com" };
    const withKms = synth("shared-foundation", vars);
    expect(withKms.ok, withKms.stderr).toBe(true);
    expect(withKms.raw).toContain("ZSENTINEL0123");
    expect(withKms.raw).toContain("sentinel.example.com");
    expect(withKms.resourceTypes).toContain("AWS::Route53::RecordSet");
    expect(withKms.resourceTypes).toContain("AWS::KMS::Key");

    const kmsOmitted = synth("shared-foundation", { ...vars, LOOM_KMS: "omit" });
    expect(kmsOmitted.ok, kmsOmitted.stderr).toBe(true);
    expect(kmsOmitted.resourceTypes).not.toContain("AWS::KMS::Key");
  });

  test("loom-backend: LOOM_CPU_ARCHITECTURE", () => {
    const r = synth("loom-backend", { LOOM_CPU_ARCHITECTURE: "ARM64" });
    expect(r.ok, r.stderr).toBe(true);
    expect(r.raw).toMatch(/"CpuArchitecture":\s*"ARM64"/);
  });

  test("loom-cognito: LOOM_COGNITO_MODE and LOOM_COGNITO_CALLBACK_URLS", () => {
    const badMode = synth("loom-cognito", { LOOM_COGNITO_MODE: "not-a-mode" });
    expect(badMode.ok).toBe(false);
    expect(badMode.stderr).toContain('build parameter "cognitoMode" must be one of');

    const r = synth("loom-cognito", { LOOM_COGNITO_MODE: "provision", LOOM_COGNITO_CALLBACK_URLS: "https://sentinel.example.com/cb" });
    expect(r.ok, r.stderr).toBe(true);
    expect(r.raw).toContain("https://sentinel.example.com/cb");
  });
});

/** Params deliberately settable only via --param/--params-file. Keep short; say why for each. */
const NO_ENV_MAPPING: readonly string[] = [];

test("every buildParam maps an env var", () => {
  const unmapped = Object.entries(config.buildParams ?? {})
    .filter(([name, def]) => !def.env && !NO_ENV_MAPPING.includes(name))
    .map(([name]) => name);
  expect(unmapped).toEqual([]);
});
