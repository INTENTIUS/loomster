/**
 * Concrete parameter source for the deployable `shared-foundation` stack
 * (chant#886). Everything here is a declared build-time parameter (chant#1064)
 * — nothing hardcoded (LOOM001) — so the same source works for a local/Floci
 * light-tier synth and a real production deploy; only the supplied
 * parameters differ. See `../../chant.config.ts`'s `buildParams` for the
 * declarations (name, type, default, allowed values) this file reads.
 */

import { params } from "@intentius/chant/params";
import type { LoomNamingParams, Tier } from "../lib/naming";
import { resolveRoute53, resolveAcm, resolveKms, resolveEcr, resolveAgentRole } from "./seams";

// `?? <default>` mirrors chant.config.ts's own declared `default` for each of
// these — redundant under a real `chant build` (params.<name> already carries
// it), but a real safety net for anything that imports this module OUTSIDE
// chant's build pipeline (a unit test, a script) where nothing ever called
// `setBuildParams(...)`, so `params` is still its initial empty object.
export const namingParams: LoomNamingParams = {
  project: (params.project as string | undefined) ?? "loom",
  env: (params.env as string | undefined) ?? "dev",
  instance: (params.instance as string | undefined) ?? "a",
  tier: (params.tier as Tier | undefined) ?? "light",
  region: (params.region as string | undefined) ?? "us-east-1",
  accountId: params.accountId as string | undefined,
  owner: (params.owner as string | undefined) ?? "platform",
};

/** Custom domain (e.g. "loom.example.com") — required on production/production-ha unless ACM+Route53 are both omitted. Unused on light. */
export const domainName = params.domainName as string | undefined;

export const route53 = resolveRoute53(params.hostedZoneId as string | undefined, params.route53Mode as string | undefined);
export const acm = resolveAcm(params.certificateArn as string | undefined, params.acmMode as string | undefined);
export const kms = resolveKms(params.kmsKeyArn as string | undefined, params.kmsMode as string | undefined);
export const ecr = resolveEcr(
  params.frontendRepositoryUri as string | undefined,
  params.frontendRepositoryArn as string | undefined,
  params.backendRepositoryUri as string | undefined,
  params.backendRepositoryArn as string | undefined,
  params.ecrMode as string | undefined,
);
export const agentRole = resolveAgentRole(params.agentRoleArn as string | undefined, params.agentRoleMode as string | undefined);

/** CIDR allowed to reach the ALB. Falls back to the composite's own default (0.0.0.0/0) when unset. */
export const albIngressCidr = params.albIngressCidr as string | undefined;

/** Pre-existing S3 bucket for ALB/NLB/artifact-bucket access logs. Always reference-existing (Loom never creates it). */
export const loggingBucketName = params.loggingBucketName as string | undefined;

/**
 * PrivateLink seam (#29), independent of tier. `"omit"` drops the NLB +
 * VPCEndpointService on production; `"provision"` adds it on any tier (needs
 * private subnets). Unset → the composite's tier-based default (provision on
 * production/production-ha, omit on light).
 */
export const privateLinkMode = params.privateLinkMode as "provision" | "omit" | undefined;
