/**
 * The deployable `loom-cognito` stack (chant#888) — the Cognito UserPool,
 * hosted-UI domain, resource server, M2M client, and (production/
 * production-ha) user client + groups + Managed Login branding. One
 * `LoomCognito(...)` call; `identity.mode` defaults to "provision" (see
 * ../composites/loom-cognito.ts). The `identity` seam is assembled in
 * `./identity.ts` from `./params.ts` — this file has zero resource
 * constructors of its own, so none of chant's EVL rules apply to it.
 */

import { LoomCognito } from "../composites/loom-cognito";
import { identity } from "./identity";
import * as params from "./params";

export const cognito = LoomCognito({ naming: params.namingParams, identity });
