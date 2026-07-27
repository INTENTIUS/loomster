/**
 * Concrete parameter source for the deployable `loom-backend` stack
 * (chant#889). Everything here is a declared build-time parameter
 * (chant#1064) — see `../../chant.config.ts`'s `buildParams`. The ten
 * cross-stack values (cluster/SG/target-group/ECR-KMS/private-subnets from
 * shared-foundation, the connection-secret ARN + its KMS key from loom-db,
 * the user pool id from loom-cognito) plus the published image are genuine
 * CloudFormation `Parameter`s — real Ref()-able declarables, resolved at
 * deploy time via `../components/loom-backend.component.ts`'s `cfn-deploy`
 * step's `stackOutput(...)` wiring. Everything else (sizing, app-level
 * knobs) is a plain build-time parameter, baked directly into the template
 * at `chant build` time.
 */

import { Parameter } from "@intentius/chant-lexicon-aws";
import { params } from "@intentius/chant/params";
import type { LoomNamingParams, Tier } from "../lib/naming";
import type { LogRetentionDays, LoomBackendIamRolesSeam } from "../composites/loom-backend";

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
// resolved at deploy time via ../components/loom-backend.component.ts's
// stackOutput(...) wiring. Named after Loom's own real ecs.yaml parameters
// for 1:1 fidelity with upstream (matches the outputs.ts convention already
// established for shared-foundation/loom-db/loom-cognito). ──────────────
export const pEcsClusterArn = new Parameter("String", { description: "ECS cluster ARN (shared-foundation oEcsClusterArn)" });
export const pEcsClusterName = new Parameter("String", { description: "ECS cluster name (shared-foundation oEcsClusterName)" });
export const pEcsSecurityGroupId = new Parameter("AWS::EC2::SecurityGroup::Id", { description: "ECS task security group id (shared-foundation oEcsSecurityGroupId)" });
export const pTargetGroupArn = new Parameter("String", { description: "Backend ALB target group ARN (shared-foundation oBackendTargetGroupArn)" });
export const pArtifactBucket = new Parameter("String", { description: "S3 bucket name for agent deployments (shared-foundation oArtifactBucket)" });
export const pEcrKmsKeyArn = new Parameter("String", { description: "KMS key ARN encrypting ECR repositories (shared-foundation oEcrKmsKeyArn)" });
export const pPrivateSubnetIds = new Parameter("String", { description: "Comma-separated private subnet ids for the backend ECS service (shared-foundation oPrivateSubnetIds)" });
export const pDatabaseSecretArn = new Parameter("String", { description: "Secrets Manager ARN containing the DB URL (loom-db oRdsSecretArn)" });
export const pSecretsKmsKeyArn = new Parameter("String", { description: "KMS key ARN encrypting Secrets Manager secrets (loom-db oSecretsKmsKeyArn)" });
export const pCognitoUserPoolId = new Parameter("String", { description: "Cognito User Pool id (loom-cognito oCognitoUserPoolId)", defaultValue: "" });
export const pImageUri = new Parameter("String", { description: "Published backend image (build-once, promote-by-digest — @Publish.uri)" });

// ── Light-tier plain DB URL (#46) ─────────────────────────────────────────
// On the light (Floci) tier the backend cannot read its DB URL from Secrets
// Manager: Floci's ECS does not inject `Secrets` into containers, and does not
// resolve `Fn::Sub ${LogicalId.Attribute}` GetAtt inside a `SecretString`.
// So light tier builds `LOOM_DATABASE_URL` as a plain `Environment` var (see
// ./backend.ts) from loom-db's *already-resolved* endpoint/port outputs —
// which chant's cfn-deploy resolves to real literals and an `Fn::Sub` over
// these *parameters* resolves fine, unlike a GetAtt. Production/production-ha
// keep the Secrets-Manager secret unchanged. The endpoint + port are
// deploy-time (cross-stack); the username/password/dbName are build-time and
// baked.
export const pRdsEndpoint = new Parameter("String", { description: "RDS endpoint address (loom-db oRdsEndpoint) — light-tier plain DB URL", defaultValue: "" });
export const pRdsPort = new Parameter("String", { description: "RDS endpoint port (loom-db oRdsPort) — light-tier plain DB URL", defaultValue: "5432" });
export const isLightTier = namingParams.tier === "light";
export const dbUsername = (params.dbUsername as string | undefined) ?? "loom";
export const dbPassword = (params.dbPassword as string | undefined) ?? "";
export const dbName = (params.dbName as string | undefined) ?? "loom";

// ── Sizing (chant#890 tier defaults live in the composite; overrides here) ──
// Fargate CPU architecture, shared with loom-frontend. Default (unset) → the
// composite's X86_64, matching CI-built images. Set ARM64 for Apple-Silicon-
// built images or Graviton — must match how the image is built.
export const cpuArchitecture: "X86_64" | "ARM64" | undefined =
  params.cpuArchitecture === "ARM64" ? "ARM64"
    : params.cpuArchitecture === "X86_64" ? "X86_64"
      : undefined;
export const cpu = params.backendCpu as string | undefined;
export const memory = params.backendMemory as string | undefined;
export const desiredCount = params.backendDesiredCount as number | undefined;
export const maxCount = params.backendMaxCount as number | undefined;
export const logRetentionDays = params.backendLogRetentionDays as LogRetentionDays | undefined;

// ── Other Loom app-level knobs — build-time; Loom's own template defaults
// all of these to "" (disabled/unset). ────────────────────────────────────
export const cognitoRegion = params.cognitoRegion as string | undefined;
export const allowedOrigins = params.allowedOrigins as string | undefined;
export const registryId = params.registryId as string | undefined;
export const litellmProxyBaseUrl = params.litellmProxyBaseUrl as string | undefined;
export const litellmDiscoveryBaseUrl = params.litellmDiscoveryBaseUrl as string | undefined;
export const litellmProxyApiKeySecretArn = params.litellmProxyApiKeySecretArn as string | undefined;
export const litellmProxyApiKeySecretKmsKeyArn = params.litellmProxyApiKeySecretKmsKeyArn as string | undefined;

/**
 * Bring-your-own execution + task IAM roles (loomster#66). Set both
 * `backendExecutionRoleArn` and `backendTaskRoleArn` to reference roles a
 * platform/security team owns; otherwise the composite provisions them.
 */
export const iamRoles: LoomBackendIamRolesSeam | undefined =
  params.backendExecutionRoleArn && params.backendTaskRoleArn
    ? {
        mode: "reference-existing",
        executionRoleArn: params.backendExecutionRoleArn as string,
        taskRoleArn: params.backendTaskRoleArn as string,
      }
    : undefined;
