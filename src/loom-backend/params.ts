/**
 * Concrete parameter source for the deployable `loom-backend` stack
 * (chant#889). Everything author-time-known comes from the environment
 * (LOOM001 — nothing hardcoded in this file or the composite), same
 * convention `shared-foundation`/`loom-db`/`loom-cognito`'s `params.ts` use.
 *
 * The ten cross-stack values (cluster/SG/target-group/ECR-KMS/private-
 * subnets from shared-foundation, the connection-secret ARN + its KMS key
 * from loom-db, the user pool id from loom-cognito) plus the published image
 * are genuine CloudFormation `Parameter`s — real Ref()-able declarables
 * collected independently of the `LoomBackend` composite (same convention
 * `loom-db/params.ts`'s `ecsSecurityGroupId` established), keyed by export
 * name so their logical id in the synthesized template exactly matches the
 * key `../components/loom-backend.component.ts`'s `cfn-deploy` step's
 * `inputs` map uses to resolve them via `stackOutput(...)` at deploy time.
 * `pPrivateSubnetIds` replaces the old `LOOM_PRIVATE_SUBNET_IDS` env var
 * (chant#928/loomster#35) — comma-joined (CloudFormation Outputs can't be
 * lists), split back apart in `./backend.ts`. Everything else (sizing,
 * app-level knobs) is a plain env-driven composite prop — author-time-known,
 * baked directly into the template at `chant build` time, not deferred to a
 * deploy-time parameter override (same convention `loom-db/params.ts` uses
 * for `dbPassword`/`dbInstanceClass`).
 */

import { Parameter } from "@intentius/chant-lexicon-aws";
import type { LoomNamingParams, Tier } from "../lib/naming";
import type { LogRetentionDays } from "../composites/loom-backend";

const VALID_TIERS: readonly Tier[] = ["light", "production", "production-ha"];

function tierFromEnv(): Tier {
  const raw = process.env.LOOM_TIER ?? "light";
  const invalidTierError = new Error(`loom-backend: LOOM_TIER must be one of ${VALID_TIERS.join(", ")}, got "${raw}"`);
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
// which chant's cfn-deploy resolves to real literals (proven on Floci:
// oRdsEndpoint=172.17.0.2, oRdsPort=7001) and an `Fn::Sub` over these
// *parameters* resolves fine, unlike a GetAtt. Production/production-ha keep
// the Secrets-Manager secret unchanged. The endpoint + port are deploy-time
// (cross-stack); the username/password/dbName are author-time-known and baked.
export const pRdsEndpoint = new Parameter("String", { description: "RDS endpoint address (loom-db oRdsEndpoint) — light-tier plain DB URL", defaultValue: "" });
export const pRdsPort = new Parameter("String", { description: "RDS endpoint port (loom-db oRdsPort) — light-tier plain DB URL", defaultValue: "5432" });
export const isLightTier = namingParams.tier === "light";
export const dbUsername = process.env.LOOM_DB_USERNAME ?? "loom";
export const dbPassword = process.env.LOOM_DB_PASSWORD ?? "";
export const dbName = process.env.LOOM_DB_NAME ?? "loom";

// ── Sizing (chant#890 tier defaults live in the composite; overrides here) ──
// Fargate CPU architecture (LOOM_CPU_ARCHITECTURE), shared with loom-frontend.
// Default (unset) → the composite's X86_64, matching CI-built images. Set ARM64
// for Apple-Silicon-built images or Graviton — must match how the image is built.
export const cpuArchitecture: "X86_64" | "ARM64" | undefined =
  process.env.LOOM_CPU_ARCHITECTURE === "ARM64" ? "ARM64"
    : process.env.LOOM_CPU_ARCHITECTURE === "X86_64" ? "X86_64"
      : undefined;
export const cpu = process.env.LOOM_BACKEND_CPU;
export const memory = process.env.LOOM_BACKEND_MEMORY;
export const desiredCount = process.env.LOOM_BACKEND_DESIRED_COUNT ? Number(process.env.LOOM_BACKEND_DESIRED_COUNT) : undefined;
export const maxCount = process.env.LOOM_BACKEND_MAX_COUNT ? Number(process.env.LOOM_BACKEND_MAX_COUNT) : undefined;
export const logRetentionDays = process.env.LOOM_BACKEND_LOG_RETENTION_DAYS
  ? (Number(process.env.LOOM_BACKEND_LOG_RETENTION_DAYS) as LogRetentionDays)
  : undefined;

// ── Other Loom app-level knobs — author-time, env-driven; Loom's own
// template defaults all of these to "" (disabled/unset). ──────────────────
export const cognitoRegion = process.env.LOOM_COGNITO_REGION;
export const allowedOrigins = process.env.LOOM_ALLOWED_ORIGINS;
export const registryId = process.env.LOOM_REGISTRY_ID;
export const litellmProxyBaseUrl = process.env.LOOM_LITELLM_PROXY_BASE_URL;
export const litellmDiscoveryBaseUrl = process.env.LOOM_LITELLM_DISCOVERY_BASE_URL;
export const litellmProxyApiKeySecretArn = process.env.LOOM_LITELLM_PROXY_API_KEY_SECRET_ARN;
export const litellmProxyApiKeySecretKmsKeyArn = process.env.LOOM_LITELLM_PROXY_API_KEY_SECRET_KMS_KEY_ARN;
