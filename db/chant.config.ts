import type { ChantConfig } from "@intentius/chant/config";
import "@intentius/chant-lexicon-sql";
import { credentials } from "@intentius/sql-yodeler";
import { deployment, loomSchema } from "./deployment";

/**
 * SQL Yodeler's project for Loom's Postgres schema (loomster#78). `src/`
 * declares the schema of the vendored Loom version, `migrations/` holds one
 * migration per Loom version from the v1.9.0 baseline on, and `ops/` the
 * migrate Op and drift watch. Run it through `scripts/db/yodel.sh` (`just db
 * <command>`), which resolves the deployment's database, brings up the SSM
 * tunnel or the local forward, and reads the credentials from loom-db's
 * secrets; nothing here holds a host or a password.
 *
 * Profiles:
 * - the deployment (`loom-dev-a`, ./deployment.ts): reader and writer read
 *   their user and password from LOOM_DB_READER_* / LOOM_DB_WRITER_*, which
 *   yodel.sh fills from loom-db's reader secret and master credentials. The
 *   reader is `loom_reader` (scripts/db/reader.ts); the writer is the RDS
 *   master user Loom itself connects as. YODEL_CREDENTIALS=writer:<env> picks
 *   the writer, and only `apply`, `baseline` and `reader` set it.
 * - scratch: the throwaway Postgres scripts/db/schema.sh runs Loom's own
 *   init_db against, to read the schema a Loom version creates.
 * - replay: the throwaway Postgres `yodel lint --replay replay --reset` (CI,
 *   `just db-replay`) replays every migration into. It drops `public` there.
 */
export default {
  lexicons: ["sql"],
  sourceDir: "src",
  sql: {
    dialect: "postgres",
    profiles: {
      [deployment]: {
        url: process.env.LOOM_YODEL_URL ?? "postgres://deployment.invalid:5432/loom",
        ...credentials(deployment, "postgres", {
          reader: { user: { env: "LOOM_DB_READER_USER" }, password: { env: "LOOM_DB_READER_PASSWORD" } },
          writer: { user: { env: "LOOM_DB_WRITER_USER" }, password: { env: "LOOM_DB_WRITER_PASSWORD" } },
        }),
        schemas: [loomSchema],
      },
      scratch: {
        url: process.env.SCRATCH_POSTGRES_URL ?? "postgres://scratch.invalid:5432/loom",
        user: { env: "SCRATCH_POSTGRES_USER" },
        password: { env: "SCRATCH_POSTGRES_PASSWORD" },
        schemas: [loomSchema],
      },
      replay: {
        url: process.env.REPLAY_POSTGRES_URL ?? "postgres://replay.invalid:5432/loom",
        user: { env: "REPLAY_POSTGRES_USER" },
        password: { env: "REPLAY_POSTGRES_PASSWORD" },
        schemas: [loomSchema],
      },
    },
  },
} satisfies ChantConfig;
