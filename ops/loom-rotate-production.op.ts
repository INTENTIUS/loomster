/**
 * `production`-tier rotation (chant#905): Cognito M2M app-client (blue/green),
 * RDS master credentials (manual — `production` has no rotation Lambda, see
 * `./lib/rotation.ts`), and the ALB's ACM certificate. Gated throughout — see
 * `./lib/rotate-op.ts` for the full phase shape and why. Needs Temporal for the
 * approval gate:
 *
 *   chant run loom-rotate-production --temporal
 *   chant run signal loom-rotate-production approve-loom-rotate-production
 */

import { buildLoomRotateOp } from "./lib/rotate-op";
import { namingParamsFor } from "./lib/naming-env";

export default buildLoomRotateOp({ naming: namingParamsFor("production") });
