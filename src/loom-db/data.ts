/**
 * The assembled `data` seam for `./db.ts` (loomster#160) — one exported
 * constant, nothing else, for the same reason `../lib/component-stack-names.ts`
 * exists: a call is resolvable at a file's own top-level `export const` and
 * nowhere inside a props object literal, so the call gets its own file and
 * the consumer reads a cross-file constant.
 *
 * See `./data-seam.ts` for what `buildData` does and why it lives apart.
 */

import { buildData } from "./data-seam";
import * as params from "./params";

export const data = buildData(params);
