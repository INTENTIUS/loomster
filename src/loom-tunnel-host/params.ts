/**
 * Parameter source for the optional `loom-tunnel-host` stack (loomster#37).
 * Declared build-time parameters only (chant#1064, see `../../chant.config.ts`).
 * `chant run loom-tunnel-host` (`../../ops/loom-tunnel-host.op.ts`) resolves
 * the VPC, the private subnets and the database's security group from
 * shared-foundation's and loom-db's outputs and sets LOOM_TUNNEL_* before it
 * builds, unless they are already set.
 *
 * This stack is not a component: `chant run --components` never deploys it,
 * so the tunnel host is off unless an operator asks for it. With no VPC set
 * it declares nothing, so whole-project builds (`chant lifecycle diff`) see
 * no host here.
 */

import { params } from "@intentius/chant/params";
import type { LoomNamingParams, Tier } from "../lib/naming";

export const namingParams: LoomNamingParams = {
  project: (params.project as string | undefined) ?? "loom",
  env: (params.env as string | undefined) ?? "dev",
  instance: (params.instance as string | undefined) ?? "a",
  tier: (params.tier as Tier | undefined) ?? "light",
  region: (params.region as string | undefined) ?? "us-east-1",
  accountId: params.accountId as string | undefined,
  owner: (params.owner as string | undefined) ?? "platform",
};

/** VPC id (shared-foundation `oVpcId`). Unset: the stack declares nothing. */
export const vpcId = params.tunnelVpcId as string | undefined;
/** Comma-separated private subnet ids (shared-foundation `oPrivateSubnetIds`). */
export const subnetIds = ((params.tunnelSubnetIds as string | undefined) ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
/** The database's security group (loom-db `oRdsSecurityGroupId`); unset adds no ingress rule. */
export const dbSecurityGroupId = params.tunnelDbSecurityGroupId as string | undefined;
export const dbPort = (params.tunnelDbPort as number | undefined) ?? 5432;
export const instanceType = params.tunnelInstanceType as string | undefined;
export const ssmEndpoints = (params.tunnelSsmEndpoints as boolean | undefined) ?? false;
