/**
 * The `loom-frontend` half of the BYO-everything example (chant#898). One
 * `LoomFrontend(...)` call, fed the plain literal stand-ins from
 * `./params.ts`. Zero edits to `../../../composites/loom-frontend.ts`.
 */

import { LoomFrontend } from "../../../composites/loom-frontend";
import * as params from "./params";

export const frontend = LoomFrontend({
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
