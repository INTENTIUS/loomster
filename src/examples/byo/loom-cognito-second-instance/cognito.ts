/**
 * The second Loom instance's identity reference (chant#898) — same
 * `LoomCognito(...)` call shape as `../loom-cognito/cognito.ts`, fed the
 * identical `identity` seam under a different `naming.instance`. Building
 * this alongside `../loom-cognito/cognito.ts` and asserting both produce
 * zero Cognito members is what proves "one pool, two instances, no second
 * pool" (see `./params.ts` and the verification test, `../adoption.test.ts`).
 *
 * Exported as `byoCognitoSecondInstance`, not `cognito` (chant#928): a
 * whole-project `chant build`/`chant lifecycle snapshot|diff` discovers
 * every `.ts` file in one pass and keys composite-expanded entities off the
 * export identifier, so this binding must not collide with either the real
 * `src/loom-cognito/cognito.ts`'s `cognito` export or
 * `../loom-cognito/cognito.ts`'s `byoCognito`.
 */

import { LoomCognito } from "../../../composites/loom-cognito";
import * as params from "./params";

export const byoCognitoSecondInstance = LoomCognito({ naming: params.namingParams, identity: params.identity });
