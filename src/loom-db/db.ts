/**
 * The deployable `loom-db` stack (chant#887) — RDS Postgres, subnet group,
 * KMS, the two Secrets Manager secrets, and (production/production-ha) the
 * RDS Proxy + secret rotation. One `LoomDb(...)` call; `data.mode` defaults
 * to "provision" (see ../composites/loom-db.ts). The `data` seam is assembled
 * in `./data.ts` from `./params.ts` — this file has zero resource
 * constructors of its own, so none of chant's EVL rules apply to it.
 */

import { LoomDb } from "../composites/loom-db";
import { rotationTransformFor } from "./data-seam";
import { data } from "./data";
import * as params from "./params";

export const db = LoomDb({ naming: params.namingParams, data });

// Declared exactly when the composite builds the production-ha rotation
// schedule — see `rotationTransformFor` in ./data-seam.ts.
export const rotationTransform = rotationTransformFor(params.namingParams.tier, params.dataMode);
