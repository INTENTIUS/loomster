/**
 * Concrete parameter source for the deployable `loom-frontend` stack
 * (chant#889). Everything here is a declared build-time parameter
 * (chant#1064) — see `../../chant.config.ts`'s `buildParams`.
 *
 * The frontend depends on shared-foundation only (#886) — four cross-stack
 * values (cluster/SG/target-group/public-subnets) plus the published image,
 * each a genuine CloudFormation `Parameter` keyed by export name so its
 * logical id in the synthesized template matches the key
 * `../components/loom-frontend.component.ts`'s `cfn-deploy` step uses to
 * resolve it via `stackOutput(...)` at deploy time (same convention
 * `loom-backend/params.ts` established).
 */

import { Parameter } from "@intentius/chant-lexicon-aws";
import { params } from "@intentius/chant/params";
import type { LoomNamingParams, Tier } from "../lib/naming";
import type { LogRetentionDays } from "../composites/loom-backend";
import type { LoomFrontendIamRoleSeam } from "../composites/loom-frontend";

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

// ── Cross-stack Parameters (chant#889) — real CFN Parameter declarables,
// resolved at deploy time via ../components/loom-frontend.component.ts's
// stackOutput(...) wiring. Named after Loom's own real ecs.yaml parameters. ──
export const pEcsClusterArn = new Parameter("String", { description: "ECS cluster ARN (shared-foundation oEcsClusterArn)" });
export const pEcsSecurityGroupId = new Parameter("AWS::EC2::SecurityGroup::Id", { description: "ECS task security group id (shared-foundation oEcsSecurityGroupId)" });
export const pTargetGroupArn = new Parameter("String", { description: "Frontend ALB target group ARN (shared-foundation oFrontendTargetGroupArn)" });
export const pPublicSubnetIds = new Parameter("String", { description: "Comma-separated public subnet ids for the frontend ECS service (shared-foundation oPublicSubnetIds)" });
export const pImageUri = new Parameter("String", { description: "Published frontend image (build-once, promote-by-digest — @Publish.uri)" });

// ── Sizing (chant#890 tier defaults live in the composite; overrides here) ──
// Fargate CPU architecture, shared with loom-backend. Default (unset) → the
// composite's X86_64. Set ARM64 for Apple-Silicon-built images or Graviton —
// must match how the image is built.
export const cpuArchitecture: "X86_64" | "ARM64" | undefined =
  params.cpuArchitecture === "ARM64" ? "ARM64"
    : params.cpuArchitecture === "X86_64" ? "X86_64"
      : undefined;
/**
 * Bring-your-own execution IAM role (loomster#66). Set
 * `frontendExecutionRoleArn` to reference a role a platform/security team
 * owns; otherwise the composite provisions it.
 */
export const iamRole: LoomFrontendIamRoleSeam | undefined =
  params.frontendExecutionRoleArn
    ? { mode: "reference-existing", executionRoleArn: params.frontendExecutionRoleArn as string }
    : undefined;

export const cpu = params.frontendCpu as string | undefined;
export const memory = params.frontendMemory as string | undefined;
export const desiredCount = params.frontendDesiredCount as number | undefined;
export const logRetentionDays = params.frontendLogRetentionDays as LogRetentionDays | undefined;
