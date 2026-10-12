/**
 * `production`-tier rotation (chant#905): Cognito M2M app-client (blue/green),
 * RDS master credentials (manual — `production` has no rotation Lambda, see
 * `./lib/rotation.ts`), and the ALB's ACM certificate. Gated throughout — see
 * `./lib/rotate-op.ts` for the full phase shape and why. The approval gate is
 * a fact on the chant/lifecycle ledger:
 *
 *   chant run loom-rotate-production                 # stops at the gate, exit 3
 *   chant approve loom-rotate-production approve-loom-rotate-production
 *   chant run loom-rotate-production                 # continues past the approved gate
 */

import { buildLoomRotateOp } from "./lib/rotate-op";
import { namingParamsFor } from "./lib/naming-env";

export default buildLoomRotateOp({ naming: namingParamsFor("production") });
