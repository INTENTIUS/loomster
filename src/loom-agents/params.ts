/**
 * Concrete parameter source for the deployable `loom-agents` stack
 * (chant#893). Everything author-time-known comes from the environment
 * (LOOM001 — nothing hardcoded in this file or the composite), same
 * convention `../loom-backend/params.ts`/`../loom-db/params.ts` use.
 *
 * The seven cross-stack values (artifact bucket + ECS security group +
 * private subnets from shared-foundation, the OAuth2 token/discovery URLs
 * from loom-cognito) are genuine CloudFormation `Parameter`s — real
 * Ref()-able declarables, resolved at deploy time by
 * `../components/loom-agents.component.ts`'s `cfn-deploy` step, keyed by
 * export name so their logical id in the synthesized template exactly
 * matches the key that wiring uses. `pPrivateSubnetIds` replaces the old
 * `LOOM_PRIVATE_SUBNET_IDS` env var (chant#928/loomster#35) — comma-joined
 * (CloudFormation Outputs can't be lists), split back apart in `./agents.ts`.
 *
 * The assistant's code prefix (`pAssistantCodePrefix`) and the harness image
 * (`pHarnessAgentImageUri`) are also `Parameter`s, but unlike `pImageUri` in
 * `../loom-backend/params.ts` neither is wired through a `"@Publish.uri"`
 * build/publish phase — this stack composes no Build/Publish phase of its own
 * (see `../composites/loom-agents.ts`'s file header: there is no agent-specific
 * ECR repo, and the Strands agent ships as an S3 zip built out-of-band by
 * Loom's own `build_agent_artifact()`, not a container). Both are "already
 * exists, supplied out-of-band" values — a real deploy passes them as
 * CloudFormation parameter overrides.
 */

import { Parameter } from "@intentius/chant-lexicon-aws";
import type { LoomNamingParams, Tier } from "../lib/naming";

const VALID_TIERS: readonly Tier[] = ["light", "production", "production-ha"];

function tierFromEnv(): Tier {
  const raw = process.env.LOOM_TIER ?? "light";
  const invalidTierError = new Error(`loom-agents: LOOM_TIER must be one of ${VALID_TIERS.join(", ")}, got "${raw}"`);
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

// ── Cross-stack Parameters (chant#893) — real CFN Parameter declarables,
// resolved at deploy time via ../components/loom-agents.component.ts's
// cfn-deploy inputs map. ─────────────────────────────────────────────────
export const pArtifactBucket = new Parameter("String", { description: "S3 bucket name for agent config storage (shared-foundation oArtifactBucket)" });
export const pEcsSecurityGroupId = new Parameter("AWS::EC2::SecurityGroup::Id", { description: "Security group reused for AgentCore Runtime ENIs on production/production-ha (shared-foundation oEcsSecurityGroupId)" });
/**
 * Private subnet ids (with AgentCore Runtime ENI reachability on
 * production/production-ha), comma-joined — the composite only actually
 * uses these on production/production-ha (`LoomAgents` in
 * `../composites/loom-agents.ts`), but shared-foundation always exports
 * `oPrivateSubnetIds` (falling back to its public subnets on light), so this
 * is always wired the same way.
 */
export const pPrivateSubnetIds = new Parameter("String", { description: "Comma-separated private subnet ids for AgentCore Runtime ENIs (shared-foundation oPrivateSubnetIds)" });
export const pDomainName = new Parameter("String", { description: "Loom's own reachable base URL, threaded into every agent's environment (shared-foundation oDomainName)", defaultValue: "" });
export const pCognitoTokenUrl = new Parameter("String", { description: "Cognito OAuth2 token endpoint — the AgentCore Identity RFC 8693 token-exchange substrate (loom-cognito oCognitoTokenUrl)", defaultValue: "" });
export const pCognitoDiscoveryUrl = new Parameter("String", { description: "Cognito OIDC discovery URL (loom-cognito oCognitoDiscoveryUrl)", defaultValue: "" });

// ── Agent artifacts (chant#893/#973) — supplied out-of-band, no Build/Publish phase here ──
// The low-code Strands agent ships as an S3 zip run on a managed Python
// runtime (AgentCore codeConfiguration), matching Loom's own build_agent_artifact()
// upload — this is its `code.s3.prefix` within shared-foundation's artifact bucket.
export const pAssistantCodePrefix = new Parameter("String", {
  description: "S3 key of the low-code Strands agent zip within the artifact bucket (AgentCore codeConfiguration prefix; built/uploaded out-of-band — see README)",
  defaultValue: process.env.LOOM_ASSISTANT_CODE_PREFIX ?? "strands_agent/agent.zip",
});
export const pHarnessAgentImageUri = new Parameter("String", { description: "No-code AgentCore-harness agent image — config-only, stock/managed image (production/production-ha only)", defaultValue: "" });

// ── Sizing / policy knobs (chant#890 tier defaults live in the composite; overrides here) ──
export const bedrockModelArns = splitCsv(process.env.LOOM_AGENTS_BEDROCK_MODEL_ARNS);
export const memoryEventExpiryDays = process.env.LOOM_AGENTS_MEMORY_EVENT_EXPIRY_DAYS
  ? Number(process.env.LOOM_AGENTS_MEMORY_EVENT_EXPIRY_DAYS)
  : undefined;
