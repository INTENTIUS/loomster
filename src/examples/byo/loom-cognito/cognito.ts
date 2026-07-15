/**
 * The `loom-cognito` half of the BYO-everything example (chant#898). One
 * `LoomCognito(...)` call with `identity.mode: "reference-existing"` — no
 * different from the repo's real `src/loom-cognito/cognito.ts`, just pointed
 * at the org's shared pool instead of provisioning one. Zero edits to
 * `../../../composites/loom-cognito.ts`.
 *
 * Exported as `byoCognito`, not `cognito` (chant#928): a whole-project
 * `chant build`/`chant lifecycle snapshot|diff` discovers every `.ts` file
 * in one pass and keys composite-expanded entities off the export
 * identifier, so this illustrative twin must not share a binding name with
 * the real `src/loom-cognito/cognito.ts`'s `cognito` export (or with
 * `../loom-cognito-second-instance/cognito.ts`'s `byoCognitoSecondInstance`).
 */

import { LoomCognito } from "../../../composites/loom-cognito";
import * as params from "./params";

export const byoCognito = LoomCognito({ naming: params.namingParams, identity: params.identity });
