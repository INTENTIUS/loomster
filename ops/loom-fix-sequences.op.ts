/**
 * Fix-sequences Op (loomster#39) — Loom's `make fix-sequences`
 * (`backend/scripts/fix_sequences.py`): reset each Postgres id sequence to its
 * table's max id, so inserts stop colliding after rows were copied in with
 * explicit ids. `loom-import-sqlite` already runs it; this is for rows loaded
 * any other way. A restore (`loom-restore`) does not need it: an RDS snapshot
 * or point-in-time restore carries the sequences with the data.
 *
 *   chant run loom-fix-sequences
 *
 * Idempotent and ungated; runs as a one-off task of the live backend.
 */

import { Op, phase, shell } from "@intentius/chant/op";
import { preflightPhase, stackPrefixOf } from "./lib/preflight";
import { namingParamsFromEnv } from "./lib/naming-env";
import { operatorRefs, fixSequencesScript } from "./lib/operator";

const naming = namingParamsFromEnv();
const refs = operatorRefs(naming);

export default Op({
  name: "loom-fix-sequences",
  overview: `Reset the Loom database's id sequences to each table's max id (env=${naming.env}, instance=${naming.instance}) with fix_sequences.py, as a one-off backend task. Idempotent, ungated.`,
  labels: { Env: naming.env },
  phases: [
    preflightPhase({ env: naming.env, stacks: ["loom-db", "loom-backend"].map((c) => `${stackPrefixOf(naming)}-${c}`) }),
    phase("FixSequences", [shell(fixSequencesScript(refs.backend), { profile: "longInfra" })]),
  ],
});
