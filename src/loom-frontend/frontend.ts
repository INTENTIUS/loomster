/**
 * The deployable `loom-frontend` stack (chant#889) — CloudWatch Logs KMS
 * key + log group, the task execution role, and the Fargate task definition
 * + service. One `LoomFrontend(...)` call; every cross-stack input is
 * `Ref(...)`-wrapped from `./params.ts`'s CFN `Parameter`s, resolved at
 * deploy time by `../components/loom-frontend.component.ts`'s
 * `stackOutput(...)` wiring — this file has zero resource constructors of
 * its own, so none of chant's EVL rules apply to it.
 */

import { Ref, Split } from "@intentius/chant-lexicon-aws";
import { LoomFrontend } from "../composites/loom-frontend";
import { SUBNET_LIST_DELIMITER } from "../composites/shared-foundation";
import * as params from "./params";

export const frontend = LoomFrontend({
  naming: params.namingParams,

  ecsClusterArn: Ref(params.pEcsClusterArn) as unknown as string,
  ecsSecurityGroupId: Ref(params.pEcsSecurityGroupId) as unknown as string,
  targetGroupArn: Ref(params.pTargetGroupArn) as unknown as string,
  imageUri: Ref(params.pImageUri) as unknown as string,

  publicSubnetIds: Split(SUBNET_LIST_DELIMITER, Ref(params.pPublicSubnetIds)) as unknown as string[],

  cpuArchitecture: params.cpuArchitecture,
  cpu: params.cpu,
  memory: params.memory,
  desiredCount: params.desiredCount,
  logRetentionDays: params.logRetentionDays,

  iamRole: params.iamRole,
});
