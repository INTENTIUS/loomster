/**
 * The `loom-frontend` half of the BYO-everything example (chant#898). One
 * `LoomFrontend(...)` call, fed the plain literal stand-ins from
 * `./params.ts`. Zero edits to `../../../composites/loom-frontend.ts`.
 *
 * Exported as `byoFrontend`, not `frontend` (chant#928): chant's
 * whole-project discovery walk keys each composite's expanded entities off
 * the export identifier, so this illustrative twin must not share a
 * binding name with the real `src/loom-frontend/frontend.ts`'s `frontend`
 * export.
 */

import { LoomFrontend } from "../../../composites/loom-frontend";
import * as params from "./params";

export const byoFrontend = LoomFrontend({
  naming: params.namingParams,

  ecsClusterArn: params.ecsClusterArn,
  ecsSecurityGroupId: params.ecsSecurityGroupId,
  targetGroupArn: params.targetGroupArn,
  imageUri: params.imageUri,

  publicSubnetIds: params.publicSubnetIds,

  cpu: params.cpu,
  memory: params.memory,
  desiredCount: params.desiredCount,
  logRetentionDays: params.logRetentionDays,
});
