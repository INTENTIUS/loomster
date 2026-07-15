/**
 * Network seam for the deployable `shared-foundation` stack (chant#886,
 * chant#898). Reference-existing is first-class — a platform team hands
 * over `LOOM_VPC_ID` / `LOOM_PUBLIC_SUBNET_IDS` (comma-separated) and
 * optionally `LOOM_PRIVATE_SUBNET_IDS` (needed for PrivateLink on
 * production/production-ha).
 *
 * Tier-aware (chant#890): `SharedFoundation` itself refuses
 * `network.mode: "provision"` outside the `light` tier (it only ever builds
 * 2 public subnets — no NAT, no private subnets, so it can't back
 * PrivateLink). `light` may still provision from scratch when no VPC is
 * handed over, for a from-scratch local/Floci synth; `production`/
 * `production-ha` always require `reference-existing`, and `resolveNetwork`
 * below fails fast with a clear, tier-specific error the moment the env vars
 * are missing, instead of letting that generic composite-level error surface
 * deep in synthesis.
 */

import type { NetworkSeam } from "../composites/shared-foundation";
import type { Tier } from "../lib/naming";
import { namingParams } from "./params";

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

/**
 * Pure tier + env -> `NetworkSeam` decision (exported for direct unit testing
 * of the tier/topology matrix, no env mocking required).
 *
 * - Any tier: `vpcId` + `publicSubnetIds` both given -> `reference-existing`
 *   (BYO network is always the first-class path, `light` included).
 * - `light` with nothing given -> `provision` (from-scratch local/Floci synth).
 * - `production`/`production-ha` with nothing given -> throws; those tiers
 *   have no `provision` fallback (chant#890).
 */
export function resolveNetwork(
  tier: Tier,
  vpcId: string | undefined,
  publicSubnetIds: string[] | undefined,
  privateSubnetIds: string[] | undefined,
): NetworkSeam {
  if (vpcId && publicSubnetIds) {
    return { mode: "reference-existing", vpcId, publicSubnetIds, privateSubnetIds };
  }

  const referenceExistingRequiredError = new Error(
    `shared-foundation: tier "${tier}" requires network.mode "reference-existing" — set LOOM_VPC_ID and LOOM_PUBLIC_SUBNET_IDS (and LOOM_PRIVATE_SUBNET_IDS for PrivateLink). A from-scratch provisioned VPC is light-tier only.`,
  );
  if (tier !== "light") {
    throw referenceExistingRequiredError;
  }

  return { mode: "provision" };
}

const vpcId = process.env.LOOM_VPC_ID;
const publicSubnetIds = splitCsv(process.env.LOOM_PUBLIC_SUBNET_IDS);
const privateSubnetIds = splitCsv(process.env.LOOM_PRIVATE_SUBNET_IDS);

export const network: NetworkSeam = resolveNetwork(namingParams.tier, vpcId, publicSubnetIds, privateSubnetIds);
