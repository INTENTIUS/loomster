/**
 * `production-ha`-tier rotation (chant#905): Cognito M2M app-client
 * (blue/green), RDS master credentials (native — triggers the
 * `RotationSchedule` hosted Lambda `../src/composites/loom-db.ts` already
 * wires up for this tier, on demand instead of waiting for its 30-day
 * schedule), and the ALB's ACM certificate. Gated throughout — see
 * `./lib/rotate-op.ts`. Needs Temporal for the approval gate:
 *
 *   chant run loom-rotate-production-ha --temporal
 *   chant run signal loom-rotate-production-ha approve-loom-rotate-production-ha
 */

import { buildLoomRotateOp } from "./lib/rotate-op";
import { namingParamsFor } from "./lib/naming-env";

export default buildLoomRotateOp({ naming: namingParamsFor("production-ha") });
