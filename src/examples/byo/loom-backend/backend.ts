/**
 * The `loom-backend` half of the BYO-everything example (chant#898). One
 * `LoomBackend(...)` call, fed the plain literal stand-ins from
 * `./params.ts`. Zero edits to `../../../composites/loom-backend.ts` — the
 * execution/task IAM roles are still composite-provisioned (see that file's
 * header comment for the known gap this example does not paper over).
 */

import { LoomBackend } from "../../../composites/loom-backend";
import * as params from "./params";

export const backend = LoomBackend({
  naming: params.namingParams,

  ecsClusterArn: params.ecsClusterArn,
  ecsClusterName: params.ecsClusterName,
  ecsSecurityGroupId: params.ecsSecurityGroupId,
  targetGroupArn: params.targetGroupArn,
  artifactBucket: params.artifactBucket,
  ecrKmsKeyArn: params.ecrKmsKeyArn,
  databaseSecretArn: params.databaseSecretArn,
  secretsKmsKeyArn: params.secretsKmsKeyArn,
  cognitoUserPoolId: params.cognitoUserPoolId,
  imageUri: params.imageUri,

  privateSubnetIds: params.privateSubnetIds,

  cognitoRegion: params.cognitoRegion,
  allowedOrigins: params.allowedOrigins,

  cpu: params.cpu,
  memory: params.memory,
  desiredCount: params.desiredCount,
  maxCount: params.maxCount,
  logRetentionDays: params.logRetentionDays,
});
