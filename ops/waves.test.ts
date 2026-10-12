import { describe, test, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertOpWavesSpec, memoryGateLedgerPort, parseOpWavesSpec, runOpWave, type OpWaveExec } from "@intentius/chant/op";

/**
 * Tier-by-tier rollouts with chant's Op waves (#28): `ops/waves/upgrade.json`
 * rolls light, then production, then production-ha, and `rotate.json` the two
 * production tiers, each run calling `scripts/ops/wave.sh`.
 */

const ROOT = join(__dirname, "..");
const WAVE_SH = join(ROOT, "scripts/ops/wave.sh");
const specText = (name: string) => readFileSync(join(ROOT, "ops/waves", `${name}.json`), "utf-8");

function opNames(): string[] {
  return readdirSync(__dirname)
    .filter((f) => f.endsWith(".op.ts"))
    .map((f) => /name: [`"]([^`"]+)/.exec(readFileSync(join(__dirname, f), "utf-8"))?.[1])
    .filter((n): n is string => !!n)
    // The tier-fixed Ops name themselves in their builder: loom-upgrade-<tier>, loom-rotate-<tier>.
    .concat(["loom-upgrade-light", "loom-upgrade-production", "loom-upgrade-production-ha", "loom-rotate-production", "loom-rotate-production-ha"]);
}

describe("Op waves specs (#28)", () => {
  for (const name of ["upgrade", "rotate"]) {
    test(`${name}.json is a valid spec, never resolved over MCP, and every run names a real Op`, () => {
      const spec = parseOpWavesSpec(specText(name), name);
      expect(() => assertOpWavesSpec(spec)).not.toThrow();
      expect(spec.neverOverMcp).toBe(true);
      const ops = opNames();
      for (const run of spec.waves.flatMap((w) => w.runs)) expect(ops).toContain(run.op);
    });
  }

  test("upgrade rolls light, then production, then production-ha", () => {
    expect(parseOpWavesSpec(specText("upgrade"), "upgrade").waves.map((w) => [w.name, w.runs.map((r) => r.op)])).toEqual([
      ["light", ["loom-upgrade-light"]],
      ["production", ["loom-upgrade-production"]],
      ["production-ha", ["loom-upgrade-production-ha"]],
    ]);
  });

  test("the wave gates never wait: each production run stops at its own Op's gate instead, one approval per run", () => {
    for (const name of ["upgrade", "rotate"]) {
      for (const w of parseOpWavesSpec(specText(name), name).waves) expect(w.gate).toBe("never");
    }
  });
});

// A scratch git repository holding wave.sh, so `plan` has a tree to digest.
function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "waves-"));
  mkdirSync(join(dir, "scripts/ops"), { recursive: true });
  copyFileSync(WAVE_SH, join(dir, "scripts/ops/wave.sh"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "scratch");
  return dir;
}

describe("scripts/ops/wave.sh (#28)", () => {
  test("is valid bash", () => {
    execFileSync("bash", ["-n", WAVE_SH]);
  });

  test("plan writes a digest per op and target; production tiers are destructive", () => {
    const dir = scratchRepo();
    try {
      const plan = (op: string, target: string) => {
        execFileSync("bash", ["scripts/ops/wave.sh", "plan", op, target, "p.json"], { cwd: dir, stdio: "ignore" });
        return JSON.parse(readFileSync(join(dir, "p.json"), "utf-8")) as { planDigest: string; destructive: boolean };
      };
      const light = plan("loom-upgrade-light", "dev.a");
      const prod = plan("loom-upgrade-production", "staging.a");
      expect(light.planDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(light.destructive).toBe(false);
      expect(prod.destructive).toBe(true);
      expect(plan("loom-upgrade-light", "dev.b").planDigest).not.toBe(light.planDigest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("apply runs the Op for the target's env and instance; a malformed target or Op is refused", () => {
    const dir = scratchRepo();
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "npx"), `#!/usr/bin/env bash\necho "npx $* LOOM_ENV=$LOOM_ENV LOOM_INSTANCE=$LOOM_INSTANCE"\n`, { mode: 0o755 });
    const apply = (op: string, target: string) =>
      spawnSync("bash", ["scripts/ops/wave.sh", "apply", op, target], { cwd: dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf-8" });
    try {
      const ok = apply("loom-upgrade-production", "prod.b");
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain("npx chant run loom-upgrade-production --env prod LOOM_ENV=prod LOOM_INSTANCE=b");
      expect(apply("loom-upgrade-production", "prod").status).toBe(2);
      expect(apply("rm -rf", "prod.a").status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chant's wave runner over upgrade.json (#28)", () => {
  test("each wave plans with wave.sh and applies its tier's Op, in order, with no wave gate", async () => {
    const dir = scratchRepo();
    const text = specText("upgrade");
    writeFileSync(join(dir, "upgrade.json"), text);
    const spec = parseOpWavesSpec(text, "upgrade.json");
    const applied: string[][] = [];
    // Plans run for real (wave.sh plan); applies are recorded, not run.
    const exec: OpWaveExec = (argv, cwd, env) => {
      if (argv[2] === "apply") {
        applied.push(argv.slice(3));
        return 0;
      }
      return spawnSync(argv[0]!, argv.slice(1), { cwd, env: { ...process.env, ...env }, stdio: "ignore" }).status ?? 1;
    };
    try {
      for (const wave of [1, 2, 3]) {
        const r = await runOpWave({
          spec,
          specFile: "upgrade.json",
          wave,
          cwd: dir,
          gates: memoryGateLedgerPort(),
          exec,
          show: () => ({ sha: "base", text }),
          log: () => {},
        });
        expect({ wave, exitCode: r.exitCode }).toEqual({ wave, exitCode: 0 });
      }
      expect(applied).toEqual([
        ["loom-upgrade-light", "dev.a"],
        ["loom-upgrade-production", "staging.a"],
        ["loom-upgrade-production-ha", "prod.a"],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
