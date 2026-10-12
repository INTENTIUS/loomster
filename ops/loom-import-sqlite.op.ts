/**
 * Import-SQLite Op (loomster#39) — Loom's `make migrate` (`migrate-db` +
 * `fix-sequences`): copy a SQLite Loom, e.g. one run locally with `make run`,
 * into this deployment's Postgres. Gated, because each copied table's rows
 * replace what the deployment holds, and never driven over MCP:
 *
 *   LOOM_IMPORT_SQLITE=./loom.db chant run loom-import-sqlite    # snapshot, then exit 3 at the gate
 *   chant approve loom-import-sqlite approve-loom-import-sqlite
 *   LOOM_IMPORT_SQLITE=./loom.db chant run loom-import-sqlite    # imports, then fixes the sequences
 *
 * `LOOM_IMPORT_SKIP_EXISTING=1` keeps tables that already have rows (the
 * script's `--skip-existing`). The import runs as a one-off task of the live
 * backend, so the database is reached from inside the VPC with the backend's
 * own credentials (`./lib/operator.ts`). Tier-agnostic, like `./loom-restore.op.ts`.
 */

import { Op, phase, gate, shell } from "@intentius/chant/op";
import { namingParamsFromEnv } from "./lib/naming-env";
import { operatorRefs, importSqliteScript } from "./lib/operator";
import { snapshotBeforeScript } from "./lib/rds-safety";

const naming = namingParamsFromEnv();
const refs = operatorRefs(naming);

export default Op({
  name: "loom-import-sqlite",
  overview: `Import a SQLite Loom (LOOM_IMPORT_SQLITE) into this deployment's Postgres (env=${naming.env}, instance=${naming.instance}): snapshot, approve, copy every table with migrate_sqlite_to_postgres.py, then fix_sequences.py. Gated: copied tables replace existing rows unless LOOM_IMPORT_SKIP_EXISTING=1.`,
  labels: { Env: naming.env },
  neverOverMcp: true,
  phases: [
    phase("Snapshot", [shell(snapshotBeforeScript({ dbInstanceIdentifier: refs.dbInstanceIdentifier }), { profile: "longInfra" })]),
    phase("Approve", [
      gate("approve-loom-import-sqlite", {
        timeout: "24h",
        description: `Approve importing LOOM_IMPORT_SQLITE into the Loom database (env=${naming.env}/instance=${naming.instance}): each table it holds replaces that table's rows. A snapshot was taken first.`,
      }),
    ]),
    phase("Import", [shell(importSqliteScript({ target: refs.backend, sharedFoundationStackName: refs.sharedFoundationStackName }), { profile: "longInfra" })]),
  ],
});
