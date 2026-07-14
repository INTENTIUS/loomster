/**
 * Concrete parameter source for the deployable `loom-db` stack (chant#887).
 * Everything here comes from the environment (LOOM001 — nothing hardcoded in
 * this file or the composite), same convention `shared-foundation/params.ts`
 * uses — except `ecsSecurityGroupId`, which is a genuine CloudFormation
 * `Parameter` because it crosses stacks: `../components/loom-db.component.ts`
 * wires it from shared-foundation's `oEcsSecurityGroupId` output at deploy
 * time via `stackOutput("shared-foundation", "oEcsSecurityGroupId")`. Every
 * other input (project/env/instance/tier, VPC id, subnet ids, DB password,
 * ...) is already known outside any stack's outputs, so it's read straight
 * from the environment.
 */

import { Parameter } from "@intentius/chant-lexicon-aws";
import type { LoomNamingParams, Tier } from "../lib/naming";

const VALID_TIERS: readonly Tier[] = ["light", "production", "production-ha"];

function tierFromEnv(): Tier {
  const raw = process.env.LOOM_TIER ?? "light";
  const invalidTierError = new Error(`loom-db: LOOM_TIER must be one of ${VALID_TIERS.join(", ")}, got "${raw}"`);
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

/** BYO-DB (chant#898): `"provision"` (default) | `"reference-existing"` | `"omit"`. */
export type DataMode = "provision" | "reference-existing" | "omit";

const VALID_DATA_MODES: readonly DataMode[] = ["provision", "reference-existing", "omit"];

function dataModeFromEnv(): DataMode {
  const raw = process.env.LOOM_DB_MODE ?? "provision";
  const invalidModeError = new Error(`loom-db: LOOM_DB_MODE must be one of ${VALID_DATA_MODES.join(", ")}, got "${raw}"`);
  if (!(VALID_DATA_MODES as readonly string[]).includes(raw)) {
    throw invalidModeError;
  }
  return raw as DataMode;
}

export const dataMode = dataModeFromEnv();

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

/**
 * BYO network (chant#886/#887 scope: "network/KMS provisioning owned by
 * shared-foundation, referenced here") — loom-db never provisions a VPC.
 * These are the same private-subnet baseline `shared-foundation/network.ts`
 * reads (`LOOM_VPC_ID`/`LOOM_PRIVATE_SUBNET_IDS`), since the RDS instance
 * belongs in private subnets alongside the ECS tasks, not the ALB's public
 * ones. Only meaningful for `data.mode: "provision"`.
 */
export const vpcId = process.env.LOOM_VPC_ID;
export const dbSubnetIds = splitCsv(process.env.LOOM_PRIVATE_SUBNET_IDS);

/** CIDR allowed to reach RDS directly — Loom's own `pAllowedCidr` posture. Ignored once `LOOM_DB_SOURCE_SG_ID` is set (chant#898: reference shared-foundation's ECS security group instead of a CIDR block). */
export const allowedCidr = process.env.LOOM_DB_ALLOWED_CIDR;
/** When set, takes priority over `allowedCidr` — see `ecsSecurityGroupId` below. */
export const useSourceSecurityGroup = process.env.LOOM_DB_SOURCE_SG === "true";

export const dbName = process.env.LOOM_DB_NAME;
export const dbUsername = process.env.LOOM_DB_USERNAME;
/** Master password — required for `data.mode: "provision"`. No default: never hardcode. Marking the CFN parameter NoEcho is chant#894 (RDS hardening) — out of scope here. */
export const dbPassword = process.env.LOOM_DB_PASSWORD;
export const dbInstanceClass = process.env.LOOM_DB_INSTANCE_CLASS;
export const dbAllocatedStorage = process.env.LOOM_DB_ALLOCATED_STORAGE ? Number(process.env.LOOM_DB_ALLOCATED_STORAGE) : undefined;

/** `data.mode: "reference-existing"` inputs — an external DB this stack does not own. */
export const referenceEndpoint = process.env.LOOM_DB_ENDPOINT;
export const referencePort = process.env.LOOM_DB_PORT ? Number(process.env.LOOM_DB_PORT) : undefined;
export const referenceCredentialsSecretArn = process.env.LOOM_DB_CREDENTIALS_SECRET_ARN;
export const referenceConnectionSecretArn = process.env.LOOM_DB_CONNECTION_SECRET_ARN;

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
export const ecsSecurityGroupId = new Parameter("String", {
  description: "shared-foundation ECS security group id (ingress source for the RDS security group)",
});
