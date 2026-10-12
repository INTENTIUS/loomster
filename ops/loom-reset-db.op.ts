/**
 * Reset-DB Op (loomster#39) — Loom's `make reset-db`: drop and recreate the
 * database's `public` schema, wiping every agent, policy and setting. Gated,
 * snapshot first, and never driven over MCP (an agent cannot run it or
 * approve its gate):
 *
 *   chant run loom-reset-db                  # snapshot, then exit 3 at the gate
 *   chant approve loom-reset-db approve-loom-reset-db
 *   chant run loom-reset-db                  # drops the schema, rolls the backend
 *
 * Upstream's `reset_db.py` asks for "yes" on stdin and prints the full
 * database URL; the drop here runs as a one-off backend task without either
 * (`./lib/operator.ts`), the gate being the confirmation. Rolling the backend
 * then recreates the tables (`init_db()` on startup). It does not touch what
 * Loom created in AWS (runtimes, credential providers): delete those first
 * (`loom-credentials-delete`, deleting agents in the UI) or they are orphaned.
 * Run `loom-seed` afterwards to repopulate the defaults.
 */

import { Op, phase, gate, shell } from "@intentius/chant/op";
import { namingParamsFromEnv } from "./lib/naming-env";
import { operatorRefs, resetDbScript, restartBackendScript } from "./lib/operator";
import { snapshotBeforeScript } from "./lib/rds-safety";

const naming = namingParamsFromEnv();
const refs = operatorRefs(naming);

export default Op({
  name: "loom-reset-db",
  overview: `Wipe the Loom database (env=${naming.env}, instance=${naming.instance}): snapshot, approve, drop and recreate the public schema, roll the backend so it recreates the tables. Gated, destructive, never over MCP.`,
  labels: { Env: naming.env },
  neverOverMcp: true,
  phases: [
    phase("Snapshot", [shell(snapshotBeforeScript({ dbInstanceIdentifier: refs.dbInstanceIdentifier }), { profile: "longInfra" })]),
    phase("Approve", [
      gate("approve-loom-reset-db", {
        timeout: "24h",
        description: `Approve wiping the Loom database (env=${naming.env}/instance=${naming.instance}): DROP SCHEMA public CASCADE, then a backend roll recreates empty tables. A snapshot was taken first.`,
      }),
    ]),
    phase("Reset", [shell(resetDbScript(refs.backend), { profile: "longInfra" })]),
    phase("Restart", [shell(restartBackendScript(refs.backend), { profile: "longInfra" })]),
  ],
});
