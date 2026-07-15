/**
 * The second Loom instance's identity reference (chant#898) — same
 * `LoomCognito(...)` call shape as `../loom-cognito/cognito.ts`, fed the
 * identical `identity` seam under a different `naming.instance`. Building
 * this alongside `../loom-cognito/cognito.ts` and asserting both produce
 * zero Cognito members is what proves "one pool, two instances, no second
 * pool" (see `./params.ts` and the verification test, `../adoption.test.ts`).
 */

import { LoomCognito } from "../../../composites/loom-cognito";
import * as params from "./params";

export const cognito = LoomCognito({ naming: params.namingParams, identity: params.identity });
