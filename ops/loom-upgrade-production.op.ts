/**
 * `production`-tier upgrade (chant#905). Gated + rollback — chant#905's dial:
 * "prod/prod-ha carry gate + rollback". The gate is a fact on the
 * chant/lifecycle ledger:
 *
 *   chant run loom-upgrade-production                 # stops at the gate, exit 3
 *   chant approve loom-upgrade-production approve-loom-upgrade-production
 *   chant run loom-upgrade-production                 # continues past the approved gate
 *
 * See `./lib/upgrade-op.ts` for the shared phase shape (Snapshot -> Approve -> Migrate ->
 * Apply -> Scripts, `onFailure: [Rollback]`). Set LOOM_UPGRADE_SCRIPTS to run
 * one-time Loom scripts after the roll (docs: operations/upgrade).
 */

import { buildLoomUpgradeOp } from "./lib/upgrade-op";
import { namingParamsFor } from "./lib/naming-env";

export default buildLoomUpgradeOp({ naming: namingParamsFor("production"), gated: true });
