/**
 * `light`-tier upgrade (chant#905). No approval gate, no rollback — chant#905's
 * dial: "light is additive/local with no gate". Runs on the local Op executor,
 * no Temporal server required:
 *
 *   chant run loom-upgrade-light
 *
 * See `./lib/upgrade-op.ts` for the shared phase shape (Snapshot -> Migrate ->
 * Apply) and why RDS data-safety still applies unconditionally even though the
 * gate does not.
 */

import { buildLoomUpgradeOp } from "./lib/upgrade-op";
import { namingParamsFor } from "./lib/naming-env";

export default buildLoomUpgradeOp({ naming: namingParamsFor("light"), gated: false });
