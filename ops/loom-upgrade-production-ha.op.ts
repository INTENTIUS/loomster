/**
 * `production-ha`-tier upgrade (chant#905). Gated + rollback — same posture as
 * `./loom-upgrade-production.op.ts`, targeting the Multi-AZ/RDS-Proxy tier
 * (`../src/composites/loom-db.ts`):
 *
 *   chant run loom-upgrade-production-ha                 # stops at the gate, exit 3
 *   chant approve loom-upgrade-production-ha approve-loom-upgrade-production-ha
 *   chant run loom-upgrade-production-ha                 # continues past the approved gate
 *
 * See `./lib/upgrade-op.ts` for the shared phase shape.
 */

import { buildLoomUpgradeOp } from "./lib/upgrade-op";
import { namingParamsFor } from "./lib/naming-env";

export default buildLoomUpgradeOp({ naming: namingParamsFor("production-ha"), gated: true });
