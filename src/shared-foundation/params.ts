/**
 * Concrete parameter source for the deployable `shared-foundation` stack
 * (chant#886). Everything here comes from the environment — nothing
 * hardcoded (LOOM001) — so the same source works for a local/Floci light-tier
 * synth and a real production deploy; only the environment differs.
 */

import type { LoomNamingParams, Tier } from "../lib/naming";

const VALID_TIERS: readonly Tier[] = ["light", "production", "production-ha"];

function tierFromEnv(): Tier {
  const raw = process.env.LOOM_TIER ?? "light";
  const invalidTierError = new Error(`shared-foundation: LOOM_TIER must be one of ${VALID_TIERS.join(", ")}, got "${raw}"`);
  if (!(VALID_TIERS as readonly string[]).includes(raw)) {
    throw invalidTierError;
  }
  return raw as Tier;
}

export const namingParams: LoomNamingParams = {
  project: process.env.LOOM_PROJECT ?? "loom",
  env: process.env.LOOM_ENV ?? "dev",
  instance: process.env.LOOM_INSTANCE ?? "a",
  tier: tierFromEnv(),
  region: process.env.AWS_REGION ?? "us-east-1",
  accountId: process.env.AWS_ACCOUNT_ID,
  owner: process.env.LOOM_OWNER ?? "platform",
};

/** Custom domain (e.g. "loom.example.com") — required on production/production-ha unless ACM+Route53 are both omitted. Unused on light. */
export const domainName = process.env.LOOM_DOMAIN_NAME;

/** CIDR allowed to reach the ALB. Falls back to the composite's own default (0.0.0.0/0) when unset. */
export const albIngressCidr = process.env.LOOM_ALB_INGRESS_CIDR;

/** Pre-existing S3 bucket for ALB/NLB/artifact-bucket access logs. Always reference-existing (Loom never creates it). */
export const loggingBucketName = process.env.LOOM_LOGGING_BUCKET_NAME;

/**
 * PrivateLink seam (#29), independent of tier. `LOOM_PRIVATELINK=omit` drops
 * the NLB + VPCEndpointService on production; `provision` adds it on any tier
 * (needs private subnets). Unset → the composite's tier-based default
 * (provision on production/production-ha, omit on light).
 */
export const privateLinkMode: "provision" | "omit" | undefined =
  process.env.LOOM_PRIVATELINK === "omit"
    ? "omit"
    : process.env.LOOM_PRIVATELINK === "provision"
      ? "provision"
      : undefined;
