/**
 * The assembled `identity` seam for `./cognito.ts` (loomster#160) — one
 * exported constant, nothing else. See `./identity-seam.ts` for what
 * `buildIdentity` does and why the call needs its own file.
 */

import { buildIdentity } from "./identity-seam";
import * as params from "./params";

export const identity = buildIdentity(params);
