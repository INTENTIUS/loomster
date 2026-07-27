/**
 * Concrete parameter source for the deployable `loom-db` stack (chant#887).
 * Everything here is a declared build-time parameter (chant#1064) — nothing
 * hardcoded in this file or the composite — except `pVpcId`/
 * `pPrivateSubnetIds`/`pEcsSecurityGroupId`, which are genuine CloudFormation
 * `Parameter`s because they cross stacks: `../components/loom-db.component.ts`
 * wires them from shared-foundation's `oVpcId`/`oPrivateSubnetIds`/
 * `oEcsSecurityGroupId` outputs at deploy time (chant#928/loomster#35 — the
 * RDS instance's own network comes from shared-foundation, not a build-time
 * parameter). Every other input (project/env/instance/tier, DB password, ...)
 * is a declared build-time parameter — see `../../chant.config.ts`'s
 * `buildParams`.
 */

import { Parameter } from "@intentius/chant-lexicon-aws";
import { params } from "@intentius/chant/params";
import type { LoomNamingParams, Tier } from "../lib/naming";

// `?? <default>` mirrors chant.config.ts's own declared `default` — a real
// safety net for anything that imports this module outside chant's build
// pipeline (a unit test), where `setBuildParams(...)` never ran.
export const namingParams: LoomNamingParams = {
  project: (params.project as string | undefined) ?? "loom",
  env: (params.env as string | undefined) ?? "dev",
  instance: (params.instance as string | undefined) ?? "a",
  tier: (params.tier as Tier | undefined) ?? "light",
  region: (params.region as string | undefined) ?? "us-east-1",
  accountId: params.accountId as string | undefined,
  owner: (params.owner as string | undefined) ?? "platform",
};

/** BYO-DB (chant#898): `"provision"` (default) | `"reference-existing"` | `"omit"`. */
export type DataMode = "provision" | "reference-existing" | "omit";

export const dataMode: DataMode = (params.dbMode as DataMode | undefined) ?? "provision";

/**
 * BYO network (chant#886/#887 scope: "network/KMS provisioning owned by
 * shared-foundation, referenced here") — loom-db never provisions a VPC.
 * Real CloudFormation `Parameter`s, resolved at deploy time via
 * `../components/loom-db.component.ts`'s `stackOutput("shared-foundation",
 * "oVpcId"/"oPrivateSubnetIds")` wiring, since the RDS instance belongs in
 * private subnets alongside the ECS tasks, not the ALB's public ones.
 * `pPrivateSubnetIds` is a comma-joined string (CloudFormation Outputs can't
 * be lists) — split back apart in `./db.ts`. Only meaningful for
 * `data.mode: "provision"`.
 */
export const pVpcId = new Parameter("AWS::EC2::VPC::Id", { description: "shared-foundation VPC id (shared-foundation oVpcId)" });
export const pPrivateSubnetIds = new Parameter("String", { description: "Comma-separated private subnet ids for the RDS subnet group (shared-foundation oPrivateSubnetIds)" });

/** CIDR allowed to reach RDS directly — Loom's own `pAllowedCidr` posture. Ignored once `useSourceSecurityGroup` is set (chant#898: reference shared-foundation's ECS security group instead of a CIDR block). */
export const allowedCidr = params.dbAllowedCidr as string | undefined;
/** When set, takes priority over `allowedCidr` — see `pEcsSecurityGroupId` below. */
export const useSourceSecurityGroup: boolean = (params.dbSourceSg as boolean | undefined) ?? false;

export const dbName = params.dbName as string | undefined;
export const dbUsername = params.dbUsername as string | undefined;
/** Master password — required for `data.mode: "provision"`. No default: never hardcode. Marking the CFN parameter NoEcho is chant#894 (RDS hardening) — out of scope here. */
export const dbPassword = params.dbPassword as string | undefined;
export const dbInstanceClass = params.dbInstanceClass as string | undefined;
export const dbAllocatedStorage = params.dbAllocatedStorage as number | undefined;

/** `data.mode: "reference-existing"` inputs — an external DB this stack does not own. */
export const referenceEndpoint = params.dbReferenceEndpoint as string | undefined;
export const referencePort = params.dbReferencePort as number | undefined;
export const referenceCredentialsSecretArn = params.dbReferenceCredentialsSecretArn as string | undefined;
export const referenceConnectionSecretArn = params.dbReferenceConnectionSecretArn as string | undefined;

/**
 * shared-foundation's ECS task security group id, threaded in at deploy time
 * via `stackOutput("shared-foundation", "oEcsSecurityGroupId")`
 * (../components/loom-db.component.ts) — lets the RDS security group allow
 * ingress from the actual ECS tasks instead of a CIDR block
 * (`useSourceSecurityGroup` above opts in). Parameters are inherently
 * cross-file (declared here, consumed via `Ref()` in `./db.ts`) — chant's
 * COR004 exempts them from its unused-declarable check for exactly this
 * reason.
 */
export const pEcsSecurityGroupId = new Parameter("String", {
  description: "shared-foundation ECS security group id (ingress source for the RDS security group)",
});
