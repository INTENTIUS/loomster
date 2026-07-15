/**
 * The deployable `shared-foundation` stack (chant#886) — the ALB, ECS
 * cluster, ECR repos, KMS, S3 artifact bucket, DNS, and agent IAM role every
 * Loom service/agent depends on. One `SharedFoundation(...)` call; every
 * seam left unset defaults to `provision` (see ../composites/shared-foundation.ts).
 */

import { SharedFoundation } from "../composites/shared-foundation";
import { namingParams, domainName, albIngressCidr, loggingBucketName, privateLinkMode } from "./params";
import { network } from "./network";

export const foundation = SharedFoundation({
  naming: namingParams,
  network,
  domainName,
  albIngressCidr,
  loggingBucketName,
  // Only pass the seam when explicitly set (LOOM_PRIVATELINK); unset leaves the
  // composite's tier-based default (#29).
  privateLink: privateLinkMode ? { mode: privateLinkMode } : undefined,
});
