/**
 * Concrete parameter source for the deployable `shared-foundation` stack
 * (chant#886). Everything here comes from the environment — nothing
 * hardcoded (LOOM001) — so the same source works for a local/Floci light-tier
 * synth and a real production deploy; only the environment differs.
 */

import type { LoomNamingParams, Tier } from "../lib/naming";
import type { Route53Seam, AcmSeam } from "../composites/shared-foundation";

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

/**
 * Route53 seam (#117). The common adoption case is referencing an existing zone
 * — most teams already own the parent domain — so `LOOM_HOSTED_ZONE_ID` points at
 * one (loomster adds the ALB alias record, creates no zone). `LOOM_ROUTE53=omit`
 * drops DNS entirely; `provision` forces a new zone. Unset → the composite's
 * tier default (provision on production/production-ha, unused on light).
 */
export function resolveRoute53(hostedZoneId: string | undefined, mode: string | undefined): Route53Seam | undefined {
  if (hostedZoneId) return { mode: "reference-existing", hostedZoneId };
  if (mode === "omit") return { mode: "omit" };
  if (mode === "provision") return { mode: "provision" };
  return undefined;
}
export const route53 = resolveRoute53(process.env.LOOM_HOSTED_ZONE_ID, process.env.LOOM_ROUTE53);

/**
 * ACM seam (#117). `LOOM_CERTIFICATE_ARN` references an existing, already
 * DNS-validated certificate (no cert provisioned, no validation wait);
 * `LOOM_ACM=omit` drops HTTPS; `provision` forces a new cert. Unset → the
 * composite's tier default.
 */
export function resolveAcm(certificateArn: string | undefined, mode: string | undefined): AcmSeam | undefined {
  if (certificateArn) return { mode: "reference-existing", certificateArn };
  if (mode === "omit") return { mode: "omit" };
  if (mode === "provision") return { mode: "provision" };
  return undefined;
}
export const acm = resolveAcm(process.env.LOOM_CERTIFICATE_ARN, process.env.LOOM_ACM);

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
