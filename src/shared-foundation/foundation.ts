/**
 * The deployable `shared-foundation` stack (chant#886) — the ALB, ECS
 * cluster, ECR repos, KMS, S3 artifact bucket, DNS, and agent IAM role every
 * Loom service/agent depends on. One `SharedFoundation(...)` call; every
 * seam left unset defaults to `provision` (see ../composites/shared-foundation.ts).
 */

import { SharedFoundation } from "../composites/shared-foundation";
import { namingParams, domainName, albIngressCidr, loggingBucketName, privateLinkMode, route53, acm, kms, ecr, agentRole } from "./params";
import { network } from "./network";

export const foundation = SharedFoundation({
  naming: namingParams,
  network,
  domainName,
  albIngressCidr,
  loggingBucketName,
  // DNS seams (#117): reference an existing zone/cert (LOOM_HOSTED_ZONE_ID /
  // LOOM_CERTIFICATE_ARN) or omit; unset leaves the composite's tier default.
  route53,
  acm,
  // KMS / ECR / agent-role seams (#120): reference existing (LOOM_KMS_KEY_ARN,
  // LOOM_{FRONTEND,BACKEND}_REPOSITORY_URI/_ARN, LOOM_AGENT_ROLE_ARN) or omit;
  // unset leaves the composite's provision default.
  kms,
  ecr,
  agentRole,
  // Only pass the seam when explicitly set (LOOM_PRIVATELINK); unset leaves the
  // composite's tier-based default (#29).
  privateLink: privateLinkMode ? { mode: privateLinkMode } : undefined,
});
