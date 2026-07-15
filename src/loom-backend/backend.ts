/**
 * The deployable `loom-backend` stack (chant#889) — CloudWatch Logs KMS key
 * + log group, task execution/task IAM roles, the Fargate task definition +
 * service, and (production/production-ha) autoscaling. One
 * `LoomBackend(...)` call; every cross-stack input is `Ref(...)`-wrapped
 * from `./params.ts`'s CFN `Parameter`s, resolved at deploy time by
 * `../components/loom-backend.component.ts`'s `stackOutput(...)` wiring —
 * this file has zero resource constructors of its own, so none of chant's
 * EVL rules apply to it (same convention `loom-db/db.ts`/
 * `loom-cognito/cognito.ts` use).
 */

import { Ref, Split } from "@intentius/chant-lexicon-aws";
import { LoomBackend } from "../composites/loom-backend";
import { SUBNET_LIST_DELIMITER } from "../composites/shared-foundation";
import * as params from "./params";

export const backend = LoomBackend({
  naming: params.namingParams,

  ecsClusterArn: Ref(params.pEcsClusterArn) as unknown as string,
  ecsClusterName: Ref(params.pEcsClusterName) as unknown as string,
  ecsSecurityGroupId: Ref(params.pEcsSecurityGroupId) as unknown as string,
  targetGroupArn: Ref(params.pTargetGroupArn) as unknown as string,
  artifactBucket: Ref(params.pArtifactBucket) as unknown as string,
  ecrKmsKeyArn: Ref(params.pEcrKmsKeyArn) as unknown as string,
  databaseSecretArn: Ref(params.pDatabaseSecretArn) as unknown as string,
  secretsKmsKeyArn: Ref(params.pSecretsKmsKeyArn) as unknown as string,
  cognitoUserPoolId: Ref(params.pCognitoUserPoolId) as unknown as string,
  imageUri: Ref(params.pImageUri) as unknown as string,

  privateSubnetIds: Split(SUBNET_LIST_DELIMITER, Ref(params.pPrivateSubnetIds)) as unknown as string[],

  cognitoRegion: params.cognitoRegion,
  allowedOrigins: params.allowedOrigins,
  registryId: params.registryId,
  litellmProxyBaseUrl: params.litellmProxyBaseUrl,
  litellmDiscoveryBaseUrl: params.litellmDiscoveryBaseUrl,
  litellmProxyApiKeySecretArn: params.litellmProxyApiKeySecretArn,
  litellmProxyApiKeySecretKmsKeyArn: params.litellmProxyApiKeySecretKmsKeyArn,

  cpu: params.cpu,
  memory: params.memory,
  desiredCount: params.desiredCount,
  maxCount: params.maxCount,
  logRetentionDays: params.logRetentionDays,
});
