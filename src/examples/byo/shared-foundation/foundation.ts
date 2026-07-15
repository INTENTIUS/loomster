/**
 * The `shared-foundation` half of the "bring-your-own-everything" adoption
 * example (chant#898). One `SharedFoundation(...)` call, wired entirely from
 * `./params.ts` — no different from the repo's real
 * `src/shared-foundation/foundation.ts`, just fed reference-existing seams
 * instead of provision defaults. Zero edits to
 * `../../../composites/shared-foundation.ts`.
 */

import { SharedFoundation } from "../../../composites/shared-foundation";
import * as params from "./params";

export const foundation = SharedFoundation({
  naming: params.namingParams,
  network: params.network,
  domainName: params.domainName,
  kms: params.kms,
  ecr: params.ecr,
  route53: params.route53,
  acm: params.acm,
  agentRole: params.agentRole,
  loggingBucketName: params.loggingBucketName,
});
