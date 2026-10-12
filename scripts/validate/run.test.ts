import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RUN_TS = resolve(__dirname, "run.ts");

// `chant lint .` imports every .ts file, run.ts included (loomster#73). Importing
// it must not mint a token (the token step creates a Cognito user and sets its
// password) or start validating. The import runs from a directory that looks
// like a local-up checkout, with a token script that only leaves a marker.
describe("scripts/validate/run.ts on import", () => {
  test("mints no token and validates nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "validate-import-"));
    try {
      mkdirSync(join(dir, "dist/local"), { recursive: true });
      writeFileSync(join(dir, "dist/local/.env"), "LOOM_COGNITO_USER_POOL_ID=us-east-1_FAKE\n");
      mkdirSync(join(dir, "scripts/local"), { recursive: true });
      const marker = join(dir, "token-minted");
      writeFileSync(join(dir, "scripts/local/local-token.sh"), `touch "${marker}"; echo token\n`);
      // The runner's defaults: the local-up proxy and no token of its own.
      const env = { ...process.env };
      delete env.LOOM_API_TOKEN;
      delete env.LOOM_API_BASE_URL;

      const out = execFileSync(
        "npx",
        ["tsx", "-e", `import(${JSON.stringify(RUN_TS)}).then(() => console.log("imported"))`],
        { cwd: dir, encoding: "utf8", env },
      );

      expect(out).toContain("imported");
      expect(out).not.toContain("Validating Loom screens");
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
