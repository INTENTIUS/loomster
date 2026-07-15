/**
 * The `loom-cognito` half of the BYO-everything example (chant#898). One
 * `LoomCognito(...)` call with `identity.mode: "reference-existing"` — no
 * different from the repo's real `src/loom-cognito/cognito.ts`, just pointed
 * at the org's shared pool instead of provisioning one. Zero edits to
 * `../../../composites/loom-cognito.ts`.
 */

import { LoomCognito } from "../../../composites/loom-cognito";
import * as params from "./params";

export const cognito = LoomCognito({ naming: params.namingParams, identity: params.identity });
