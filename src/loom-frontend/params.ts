/**
 * Concrete parameter source for the deployable `loom-frontend` stack
 * (chant#889). Everything author-time-known comes from the environment
 * (LOOM001 — nothing hardcoded in this file or the composite), same
 * convention `shared-foundation`/`loom-db`/`loom-cognito`/`loom-backend`'s
 * `params.ts` use.
 *
 * The frontend depends on shared-foundation only (#886) — four cross-stack
 * values (cluster/SG/target-group/public-subnets) plus the published image,
 * each a genuine CloudFormation `Parameter` keyed by export name so its
 * logical id in the synthesized template matches the key
 * `../components/loom-frontend.component.ts`'s `cfn-deploy` step uses to
 * resolve it via `stackOutput(...)` at deploy time (same convention
 * `loom-backend/params.ts` established). `pPublicSubnetIds` replaces the old
 * `LOOM_PUBLIC_SUBNET_IDS` env var (chant#928/loomster#35) — the ECS
 * service's subnets now come from shared-foundation's `oPublicSubnetIds`,
 * comma-joined (CloudFormation Outputs can't be lists) and split back apart
 * in `./frontend.ts`.
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

// ── Cross-stack Parameters (chant#889) — real CFN Parameter declarables,
// resolved at deploy time via ../components/loom-frontend.component.ts's
// stackOutput(...) wiring. Named after Loom's own real ecs.yaml parameters. ──
export const pEcsClusterArn = new Parameter("String", { description: "ECS cluster ARN (shared-foundation oEcsClusterArn)" });
export const pEcsSecurityGroupId = new Parameter("AWS::EC2::SecurityGroup::Id", { description: "ECS task security group id (shared-foundation oEcsSecurityGroupId)" });
export const pTargetGroupArn = new Parameter("String", { description: "Frontend ALB target group ARN (shared-foundation oFrontendTargetGroupArn)" });
export const pPublicSubnetIds = new Parameter("String", { description: "Comma-separated public subnet ids for the frontend ECS service (shared-foundation oPublicSubnetIds)" });
export const pImageUri = new Parameter("String", { description: "Published frontend image (build-once, promote-by-digest — @Publish.uri)" });

// ── Sizing (chant#890 tier defaults live in the composite; overrides here) ──
// Fargate CPU architecture (LOOM_CPU_ARCHITECTURE), shared with loom-backend.
// Default (unset) → the composite's X86_64. Set ARM64 for Apple-Silicon-built
// images or Graviton — must match how the image is built.
export const cpuArchitecture: "X86_64" | "ARM64" | undefined =
  process.env.LOOM_CPU_ARCHITECTURE === "ARM64" ? "ARM64"
    : process.env.LOOM_CPU_ARCHITECTURE === "X86_64" ? "X86_64"
      : undefined;
export const cpu = process.env.LOOM_FRONTEND_CPU;
export const memory = process.env.LOOM_FRONTEND_MEMORY;
export const desiredCount = process.env.LOOM_FRONTEND_DESIRED_COUNT ? Number(process.env.LOOM_FRONTEND_DESIRED_COUNT) : undefined;
export const logRetentionDays = process.env.LOOM_FRONTEND_LOG_RETENTION_DAYS
  ? (Number(process.env.LOOM_FRONTEND_LOG_RETENTION_DAYS) as LogRetentionDays)
  : undefined;
