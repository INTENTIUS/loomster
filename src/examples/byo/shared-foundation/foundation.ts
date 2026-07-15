/**
 * The `shared-foundation` half of the "bring-your-own-everything" adoption
 * example (chant#898). One `SharedFoundation(...)` call, wired entirely from
 * `./params.ts` — no different from the repo's real
 * `src/shared-foundation/foundation.ts`, just fed reference-existing seams
 * instead of provision defaults. Zero edits to
 * `../../../composites/shared-foundation.ts`.
 *
 * Exported as `byoFoundation`, not `foundation` (chant#928): chant's
 * whole-project discovery walk keys each composite's expanded entities off
 * the *export identifier*, not the file path or `naming` params, so this
 * illustrative twin must not share a binding name with the real
 * `src/shared-foundation/foundation.ts`'s `foundation` export — that
 * collision is exactly what broke `chant build`/`chant lifecycle
 * snapshot|diff` against the whole tree.
 */

import { SharedFoundation } from "../../../composites/shared-foundation";
import * as params from "./params";

export const byoFoundation = SharedFoundation({
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
