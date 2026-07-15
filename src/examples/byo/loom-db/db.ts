/**
 * The `loom-db` half of the BYO-everything example (chant#898). One
 * `LoomDb(...)` call with `data.mode: "reference-existing"` — no different
 * from the repo's real `src/loom-db/db.ts`, just pointed at an external
 * endpoint instead of provisioning RDS. Zero edits to
 * `../../../composites/loom-db.ts`.
 *
 * Exported as `byoDb`, not `db` (chant#928): a whole-project `chant build`/
 * `chant lifecycle snapshot|diff` discovers every `.ts` file in one pass and
 * keys composite-expanded entities off the export identifier, so this
 * illustrative twin must not share a binding name with the real
 * `src/loom-db/db.ts`'s `db` export.
 */

import { LoomDb } from "../../../composites/loom-db";
import * as params from "./params";

export const byoDb = LoomDb({ naming: params.namingParams, data: params.data });
