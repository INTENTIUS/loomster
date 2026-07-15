/**
 * "Bring-your-own-everything" adoption example (chant#898) — the
 * `loom-backend` half. Every cross-stack value below is a **plain literal**,
 * standing in for what a real deploy pipeline resolves automatically via
 * `stackOutput(...)` — see the repo's real
 * `../../../components/loom-backend.component.ts` for that wiring, which
 * this minimal, single-purpose example does not reproduce. The values line
 * up with the illustrative placeholders in `../shared-foundation/params.ts`,
 * `../loom-db/params.ts`, and `../loom-cognito/params.ts`, as if resolved
 * from those three stacks' outputs.
 *
 * **Known gap (see docs/adoption.md):** `LoomBackend` (chant#889,
 * `../../../composites/loom-backend.ts`) does not yet expose a
 * `reference-existing` seam for its own execution/task IAM roles — it always
 * provisions both, regardless of how upstream network/data/identity are
 * configured. Every OTHER piece here is genuinely bring-your-own (network,
 * KMS, ECR, ACM, Route53, agent role, RDS, Cognito) — only the ECS task's
 * own two roles are still composite-managed. Zero edits to
 * `../../../composites/loom-backend.ts` either way.
 */

import type { LoomNamingParams } from "../../../lib/naming";
import type { LogRetentionDays } from "../../../composites/loom-backend";

export const namingParams: LoomNamingParams = {
  project: "loom",
  env: "prod",
  instance: "shared-a",
  tier: "production",
  region: "us-east-1",
  accountId: "123456789012",
  owner: "platform-team",
};

// ── Stand-ins for ../shared-foundation's stackOutput("shared-foundation", "<key>") values ──
export const ecsClusterArn = "arn:aws:ecs:us-east-1:123456789012:cluster/loom-prod-shared-a-shared-foundation-cluster";
export const ecsClusterName = "loom-prod-shared-a-shared-foundation-cluster";
export const ecsSecurityGroupId = "sg-0eee5555666677778";
export const targetGroupArn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/loom-prod-shared-a-be-tg/0123456789abcdef";
export const artifactBucket = "loom-prod-shared-a-shared-foundation-artifacts-a1b2c3";
export const ecrKmsKeyArn = "arn:aws:kms:us-east-1:123456789012:key/1111aaaa-11aa-11aa-11aa-1111aaaa1111";

// ── Stand-ins for ../loom-db's stackOutput("loom-db", "<key>") values ──
export const databaseSecretArn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:data-team/loom-database-url-GhIjKl";
/**
 * The data team's own secrets-encryption CMK ARN — `LoomDb`'s
 * `reference-existing` `DataSeam` (chant#898, `../../../composites/loom-db.ts`)
 * has no field for this (it models only the endpoint + the two secret ARNs),
 * so an externally-managed DB's secrets KMS key has no `stackOutput("loom-db",
 * ...)` to flow through today — a second facet of the same gap documented
 * above, tracked in docs/adoption.md rather than patched here.
 */
export const secretsKmsKeyArn = "arn:aws:kms:us-east-1:123456789012:key/3333cccc-33cc-33cc-33cc-3333cccc3333";

// ── Stand-in for ../loom-cognito's stackOutput("loom-cognito", "oCognitoUserPoolId") ──
export const cognitoUserPoolId = "us-east-1_ExAmPle1";

/** Published image (build-once, promote-by-digest, `@Publish.uri`) — a placeholder digest reference here since this example does not build a real image. */
export const imageUri = "123456789012.dkr.ecr.us-east-1.amazonaws.com/loom-backend@sha256:0000000000000000000000000000000000000000000000000000000000aa";

/** Private subnet ids — the same ones handed to `../shared-foundation/params.ts`'s `network.privateSubnetIds`. */
export const privateSubnetIds: string[] = ["subnet-0ccc3333444455556", "subnet-0ddd4444555566667"];

export const cognitoRegion = "us-east-1";
export const allowedOrigins = "https://loom.example.com";

export const cpu: string | undefined = undefined;
export const memory: string | undefined = undefined;
export const desiredCount: number | undefined = undefined;
export const maxCount: number | undefined = undefined;
export const logRetentionDays: LogRetentionDays | undefined = undefined;
