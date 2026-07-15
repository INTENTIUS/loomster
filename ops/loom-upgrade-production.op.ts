/**
 * `production`-tier upgrade (chant#905). Gated + rollback — chant#905's dial:
 * "prod/prod-ha carry gate + rollback". The gate is a durable wait-for-signal,
 * so this Op needs Temporal:
 *
 *   chant run loom-upgrade-production --temporal        # pauses at "Approve"
 *   chant run signal loom-upgrade-production approve-loom-upgrade-production
 *
 * See `./lib/upgrade-op.ts` for the shared phase shape (Snapshot -> Migrate ->
 * Approve -> Apply, `onFailure: [Rollback]`).
 */

import { buildLoomUpgradeOp } from "./lib/upgrade-op";
import { namingParamsFor } from "./lib/naming-env";

export default buildLoomUpgradeOp({ naming: namingParamsFor("production"), gated: true });
