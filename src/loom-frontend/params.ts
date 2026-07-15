/**
 * Concrete parameter source for the deployable `loom-frontend` stack
 * (chant#889). Everything author-time-known comes from the environment
 * (LOOM001 — nothing hardcoded in this file or the composite), same
 * convention `shared-foundation`/`loom-db`/`loom-cognito`/`loom-backend`'s
 * `params.ts` use.
 *
 * The frontend depends on shared-foundation only (#886) — three cross-stack
 * values (cluster/SG/target-group) plus the published image, each a genuine
 * CloudFormation `Parameter` keyed by export name so its logical id in the
 * synthesized template matches the key `../components/loom-frontend.
 * component.ts`'s `cfn-deploy` step uses to resolve it via `stackOutput(...)`
 * at deploy time (same convention `loom-backend/params.ts` established).
 */

import { Parameter } from "@intentius/chant-lexicon-aws";
import type { LoomNamingParams, Tier } from "../lib/naming";
import type { LogRetentionDays } from "../composites/loom-backend";

const VALID_TIERS: readonly Tier[] = ["light", "production", "production-ha"];

function tierFromEnv(): Tier {
  const raw = process.env.LOOM_TIER ?? "light";
  const invalidTierError = new Error(`loom-frontend: LOOM_TIER must be one of ${VALID_TIERS.join(", ")}, got "${raw}"`);
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

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

/**
 * Public subnet ids — the same `LOOM_PUBLIC_SUBNET_IDS` baseline
 * `shared-foundation/network.ts` reads, not a shared-foundation output
 * (subnet ids are BYO network, never re-exposed as a stack output).
 */
export const publicSubnetIds = splitCsv(process.env.LOOM_PUBLIC_SUBNET_IDS);

// ── Cross-stack Parameters (chant#889) — real CFN Parameter declarables,
// resolved at deploy time via ../components/loom-frontend.component.ts's
// stackOutput(...) wiring. Named after Loom's own real ecs.yaml parameters. ──
export const pEcsClusterArn = new Parameter("String", { description: "ECS cluster ARN (shared-foundation oEcsClusterArn)" });
export const pEcsSecurityGroupId = new Parameter("AWS::EC2::SecurityGroup::Id", { description: "ECS task security group id (shared-foundation oEcsSecurityGroupId)" });
export const pTargetGroupArn = new Parameter("String", { description: "Frontend ALB target group ARN (shared-foundation oFrontendTargetGroupArn)" });
export const pImageUri = new Parameter("String", { description: "Published frontend image (build-once, promote-by-digest — @Publish.uri)" });

// ── Sizing (chant#890 tier defaults live in the composite; overrides here) ──
export const cpu = process.env.LOOM_FRONTEND_CPU;
export const memory = process.env.LOOM_FRONTEND_MEMORY;
export const desiredCount = process.env.LOOM_FRONTEND_DESIRED_COUNT ? Number(process.env.LOOM_FRONTEND_DESIRED_COUNT) : undefined;
export const logRetentionDays = process.env.LOOM_FRONTEND_LOG_RETENTION_DAYS
  ? (Number(process.env.LOOM_FRONTEND_LOG_RETENTION_DAYS) as LogRetentionDays)
  : undefined;
