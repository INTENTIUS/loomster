/**
 * The `loom-backend` half of the BYO-everything example (chant#898). One
 * `LoomBackend(...)` call, fed the plain literal stand-ins from
 * `./params.ts`. Zero edits to `../../../composites/loom-backend.ts` — the
 * execution/task IAM roles are still composite-provisioned (see that file's
 * header comment for the known gap this example does not paper over).
 *
 * Exported as `byoBackend`, not `backend` (chant#928): chant's whole-project
 * discovery walk keys each composite's expanded entities off the *export
 * identifier* (`packages/core/src/discovery/collect.ts`), not the file path
 * or `naming` params — so this illustrative twin colliding with the real
 * `src/loom-backend/backend.ts`'s `backend` export is exactly what broke
 * `chant build`/`chant lifecycle snapshot|diff` against the whole tree
 * ("Duplicate entity name ... from composite expansion of \"backend\"").
 */

import { LoomBackend } from "../../../composites/loom-backend";
import * as params from "./params";

export const byoBackend = LoomBackend({
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
