/**
 * Concrete parameter source for the deployable `loom-agents` stack
 * (chant#893). Everything here is a declared build-time parameter
 * (chant#1064) — see `../../chant.config.ts`'s `buildParams`, same
 * convention `../loom-backend/params.ts`/`../loom-db/params.ts` use.
 *
 * The seven cross-stack values (artifact bucket + ECS security group +
 * private subnets from shared-foundation, the OAuth2 token/discovery URLs
 * from loom-cognito) are genuine CloudFormation `Parameter`s — real
 * Ref()-able declarables, resolved at deploy time by
 * `../components/loom-agents.component.ts`'s `cfn-deploy` step, keyed by
 * export name so their logical id in the synthesized template exactly
 * matches the key that wiring uses.
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
import { params } from "@intentius/chant/params";
import type { LoomNamingParams, Tier } from "../lib/naming";
import { splitCsv } from "../lib/params-helpers";

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
  defaultValue: (params.assistantCodePrefix as string | undefined) ?? "strands_agent/agent.zip",
});
export const pHarnessAgentImageUri = new Parameter("String", { description: "No-code AgentCore-harness agent image — config-only, stock/managed image (production/production-ha only)", defaultValue: "" });

/**
 * Whether a real harness image was supplied for this build. `pHarnessAgentImageUri`
 * above is always a CFN `Ref`, so the composite can't tell "supplied" from
 * "empty" — this is the gate that makes it emit no harness Runtime by default
 * (loomster#128).
 *
 * A declared build-time parameter rather than an ambient `process.env` read:
 * chant's fold engine can only get an ambient read by executing the file, so
 * `./agents.ts` fell back to run purely because of this one condition
 * (loomster#160). Used to be read through a hand-rolled `paramOrEnv` (declared
 * value first, `LOOM_HARNESS_AGENT_IMAGE_URI` second) because `chant build
 * <subdir>` — every `npm run synth:*` script — never discovered a repo-root
 * `chant.config.ts`, leaving this param's own `env:` mapping inert there
 * (intentius/chant#1117, fixed in `@intentius/chant@0.24.0`) — `params.*`
 * alone resolves the same env var now (loomster#162).
 */
export const harnessAgentImageUri = params.harnessAgentImageUri as string | undefined;

// ── Sizing / policy knobs (chant#890 tier defaults live in the composite; overrides here) ──
export const bedrockModelArns = splitCsv(params.agentsBedrockModelArns as string | undefined);
export const memoryEventExpiryDays = params.agentsMemoryEventExpiryDays as number | undefined;
