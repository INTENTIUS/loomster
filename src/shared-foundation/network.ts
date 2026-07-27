/**
 * Network seam value for the deployable `shared-foundation` stack (chant#886,
 * chant#898) — one exported constant, nothing else.
 *
 * The decision (`resolveNetwork`, tier rules and all) and the input reads
 * (`networkSeam`) both live in `./seams.ts`, alongside the other
 * adoption-seam resolvers. That split is what makes this file fold
 * (loomster#160): an exported function declaration anywhere in a file makes
 * the whole file un-foldable, and an ambient `process.env` read is a value
 * chant can only get by executing the file. What is left here is a single
 * top-level `export const` whose initializer is a call to an imported
 * function — the shape chant resolves through the file's own imports and
 * invokes for real, with zero module execution of this file.
 *
 * `foundation.ts` and `outputs.ts` both import `network`, so this one file
 * gated the entire stack before the split: its reason ("exported function
 * declaration \"resolveNetwork\" is not foldable") appeared verbatim as
 * theirs.
 */

import type { NetworkSeam } from "../composites/shared-foundation";
import { networkSeam } from "./seams";
import { namingParams } from "./params";

export const network: NetworkSeam = networkSeam(namingParams.tier);
