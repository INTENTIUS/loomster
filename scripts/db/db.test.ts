import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readerStatements, READ_SCHEMAS } from "./reader";

const root = join(import.meta.dirname, "..", "..");

describe("the read-only user (#78)", () => {
  const sql = readerStatements("loom", "loom_reader", "pa'ss", "loom");

  test("logs in read-only, owns nothing, and reads public and yodel's history", () => {
    expect(sql).toContain(`ALTER ROLE "loom_reader" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'pa''ss'`);
    expect(sql).toContain(`ALTER ROLE "loom_reader" SET default_transaction_read_only = on`);
    expect(READ_SCHEMAS).toEqual(["public", "yodeler"]);
    for (const schema of READ_SCHEMAS) {
      expect(sql).toContain(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO "loom_reader"`);
      expect(sql).toContain(`ALTER DEFAULT PRIVILEGES FOR ROLE "loom" IN SCHEMA "${schema}" GRANT SELECT ON TABLES TO "loom_reader"`);
    }
  });

  test("grants nothing that writes", () => {
    for (const s of sql) expect(s).not.toMatch(/GRANT (ALL|INSERT|UPDATE|DELETE|TRUNCATE|CREATE)/);
  });

  test("creates the history schema before granting on it, and is safe to run again", () => {
    const create = sql.findIndex((s) => s.startsWith(`CREATE SCHEMA IF NOT EXISTS "yodeler"`));
    const grant = sql.findIndex((s) => s.includes(`SCHEMA "yodeler" TO`));
    expect(create).toBeGreaterThanOrEqual(0);
    expect(create).toBeLessThan(grant);
    expect(sql[0]).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles/);
  });
});

describe("db/ (#78)", () => {
  test("the first migration is the baseline, and every migration has its SQL and its recorded schema", () => {
    const dirs = readdirSync(join(root, "db", "migrations")).filter((d) => !d.startsWith(".")).sort();
    expect(dirs[0]).toMatch(/^\d{8}T\d{4}-baseline$/);
    for (const d of dirs) {
      const files = readdirSync(join(root, "db", "migrations", d));
      expect(files).toEqual(expect.arrayContaining(["migration.sql", "migration.json"]));
    }
  });

  test("the declarations cover every table Loom's models define", () => {
    const schema = readFileSync(join(root, "db", "src", "schema.ts"), "utf8");
    // Loom v1.9.0 has 28 tables; each is one table`CREATE TABLE public.<name>` export.
    expect(schema.match(/CREATE TABLE public\.\w+ \(/g)?.length).toBe(28);
  });

  test("the wrapper and the schema scripts are valid bash", () => {
    for (const f of ["yodel.sh", "schema.sh", "replay.sh", "loom-init-db.sh"]) {
      execFileSync("bash", ["-n", join(root, "scripts", "db", f)]);
    }
  });
});
