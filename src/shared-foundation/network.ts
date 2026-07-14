/**
 * Network seam for the deployable `shared-foundation` stack (chant#886,
 * chant#898). Reference-existing is first-class — a platform team hands
 * over `LOOM_VPC_ID` / `LOOM_PUBLIC_SUBNET_IDS` (comma-separated) and
 * optionally `LOOM_PRIVATE_SUBNET_IDS` (needed for PrivateLink on
 * production/production-ha). Falls back to `network.mode: "provision"`
 * (light tier only) when unset, so a from-scratch local/Floci synth doesn't
 * need a VPC handed to it first.
 */

import type { NetworkSeam } from "../composites/shared-foundation";

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

const vpcId = process.env.LOOM_VPC_ID;
const publicSubnetIds = splitCsv(process.env.LOOM_PUBLIC_SUBNET_IDS);
const privateSubnetIds = splitCsv(process.env.LOOM_PRIVATE_SUBNET_IDS);

export const network: NetworkSeam =
  vpcId && publicSubnetIds
    ? { mode: "reference-existing", vpcId, publicSubnetIds, privateSubnetIds }
    : { mode: "provision" };
