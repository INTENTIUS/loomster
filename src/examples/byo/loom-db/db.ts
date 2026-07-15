/**
 * The `loom-db` half of the BYO-everything example (chant#898). One
 * `LoomDb(...)` call with `data.mode: "reference-existing"` — no different
 * from the repo's real `src/loom-db/db.ts`, just pointed at an external
 * endpoint instead of provisioning RDS. Zero edits to
 * `../../../composites/loom-db.ts`.
 */

import { LoomDb } from "../../../composites/loom-db";
import * as params from "./params";

export const db = LoomDb({ naming: params.namingParams, data: params.data });
