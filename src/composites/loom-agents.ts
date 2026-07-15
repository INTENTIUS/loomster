/**
 * loom-agents composite (chant#893).
 *
 * The Bedrock AgentCore agents Loom's backend provisions at runtime
 * (`backend/app/services/deployment.py`, pinned v1.6.0) expressed as a
 * static, chant-managed reference deployment: one `AgentCoreAgent(...)` call
 * (chant#882, `@intentius/chant-lexicon-aws`) per agent, composed into one
 * CloudFormation stack via nested-composite expansion. The #882 composite is
 * reused as-is — no AgentCore resource is re-modeled here.
 * Runtime/RuntimeEndpoint/Memory/Gateway/GatewayTarget/WorkloadIdentity all
 * come from that composite; this file only wires its props per agent and
 * extends each agent's own composite-created role.
 *
 * **Two agent flavors** (chant#893 blog-refinement comment):
 * - **low-code** — a Strands Python agent (Loom's own
 *   `agents/strands_agent`). One per deployment, every tier. Its container
 *   image is built/published out-of-band: this repo has no agent-specific
 *   ECR repo to publish into (shared-foundation, chant#886, only provisions
 *   frontend/backend repos), so `assistantImageUri` is a plain "already
 *   exists in ECR" value — the same boundary the sibling
 *   `examples/bedrock-agentcore-agent` (chant#882) draws around
 *   `containerUri`.
 * - **no-code** — a config-only AgentCore-managed-harness agent: no custom
 *   code, a stock/managed image supplied via `harnessImageUri`. Present only
 *   on production/production-ha (the "full" agent set, chant#890).
 *
 * **Memory + Identity** (chant#893 blog-refinement comment: model AgentCore
 * Memory + Identity, not just Runtime/Endpoint, wherever the #882 composite
 * exposes them). Both come straight out of that composite's own result:
 * `memory` (session/conversation memory, retention tier-driven below) and
 * `workloadIdentity` (`allowedResourceOauth2ReturnUrls`, wired at
 * loom-cognito's own OAuth2 token endpoint — see `./loom-cognito.ts`'s
 * "AgentCore Identity + RFC 8693 token exchange" file-header comment, which
 * named this composite as the consumer of that substrate). Agent Registry
 * (preview) and a standalone `OAuth2CredentialProvider` resource are NOT
 * modeled: the former has no CloudFormation resource yet, and the latter
 * isn't part of the #882 composite this file consumes — both stay out of
 * scope until either lands there.
 *
 * **Scope boundary.** `./loom-backend.ts`'s own file header ("Scope boundary
 * (chant#893, agent runtime)") notes that Loom's real backend `TaskRole`
 * also needs Bedrock/AgentCore invoke, an `iam:PassRole` grant on
 * shared-foundation's `agentRole`, an AgentCore-Identity-managed Secrets
 * Manager grant, and CloudWatch-Logs vended-log-delivery permissions —
 * deliberately left out of #889's own scope, to "extend this role (or
 * compose an additional one) in #893." This file takes the "compose an
 * additional one" branch, scoped to what THIS composite's own agents need
 * to operate: `buildAgentExecutionPolicies` below grants Bedrock invoke, the
 * CloudWatch Logs delivery pipeline AgentCore Runtime ships vended logs
 * through, and read access to AgentCore-Identity-managed Secrets Manager
 * credential-provider secrets — attached to each agent's own
 * composite-created role via `AgentCoreAgent`'s `Policies` prop (the #882
 * composite always provisions its own role; it has no "reference-existing
 * role" seam to plug shared-foundation's `agentRole` into directly).
 * Attaching an equivalent grant onto the *backend's* TaskRole (so it can
 * dynamically `iam:PassRole`/invoke these runtimes) needs loom-backend to
 * expose its TaskRole name as a stack output first — a follow-up, not this
 * file's job.
 *
 * Tiers (chant#890): `light` = the Strands agent only, `PUBLIC` network mode
 * (matches Loom's own `create_runtime` default), Memory at the #882
 * composite's own 30-day default. `production`/`production-ha` add the
 * no-code harness agent, run both agents in `VPC` mode (shared-foundation's
 * private subnets + its ECS security group — no dedicated agent security
 * group, same posture the ECS tasks already run under), and extend Memory
 * retention to 90 days. No divergent files — `naming.tier` alone selects the
 * set, same convention `../loom-backend.ts`'s autoscaling tiering uses.
 *
 * Every physical name and tag comes from the shared naming helper
 * (`../lib/naming.ts`, chant#897); nothing here is a literal (LOOM001).
 */

import { Composite } from "@intentius/chant";
import {
  AgentCoreAgent,
  type AgentCoreAgentProps,
  type AgentCoreAgentResult,
  Role_Policy,
  Sub,
  AWS,
} from "@intentius/chant-lexicon-aws";
import { loomNaming, type LoomNaming, type LoomNamingParams, type Tier } from "../lib/naming";

export interface LoomAgentsProps {
  /** Naming/tagging parameter source (chant#897) — one call derives every physical name + tag below. */
  naming: LoomNamingParams;

  // ── shared-foundation (chant#886) ───────────────────────────────────────
  /** shared-foundation `oArtifactBucket` — reused for Loom's own `store_large_config()` convention (large per-agent config values live at `s3://{bucket}/{agentName}/config/{key}`). */
  artifactBucket: string;
  /** shared-foundation `oEcsSecurityGroupId` — reused as the AgentCore Runtime ENI security group on production/production-ha (`VPC` network mode). No dedicated agent security group. */
  ecsSecurityGroupId: string;
  /** Private subnet ids (BYO, same `LOOM_PRIVATE_SUBNET_IDS` baseline `loom-db`/`loom-backend` read). Required when the tier runs agents in `VPC` mode (production/production-ha) — unused, and therefore optional, on light. */
  privateSubnetIds?: string[];
  /** shared-foundation `oDomainName` — threaded into every agent's environment so its tools can call back into Loom's own API once #889 is live. Default: "" (matches Loom's own empty-string knobs, e.g. `../loom-backend.ts`'s `allowedOrigins`). */
  backendBaseUrl?: string;

  // ── loom-cognito (chant#888) — the AgentCore Identity / RFC 8693 token-exchange substrate ──
  /** loom-cognito `oCognitoTokenUrl` — wired onto each agent's `WorkloadIdentity.AllowedResourceOauth2ReturnUrls`. */
  cognitoTokenUrl?: string;
  /** loom-cognito `oCognitoDiscoveryUrl` — threaded into each agent's environment for the agent's own OIDC token validation. */
  cognitoDiscoveryUrl?: string;

  // ── Published container images — built/published out-of-band (see file header) ──
  /** Low-code Strands agent's image. Every tier deploys this one agent. */
  assistantImageUri: string;
  /** No-code AgentCore-harness agent's image — config-only, a stock/managed image. Required only on production/production-ha; ignored on light. */
  harnessImageUri?: string;

  /** Bedrock model ARNs this agent set's roles may invoke. Default: `["arn:aws:bedrock:*::foundation-model/*"]` (matches shared-foundation's own `agentRole` default, chant#886). */
  bedrockModelArns?: string[];
  /** AgentCore Memory event retention, in days. Default: tier-driven — the #882 composite's own 30-day default on light, 90 on production/production-ha. CFN bounds: 3-365 (enforced by the #882 composite). */
  memoryEventExpiryDays?: number;

  /** Per-agent `AgentCoreAgent` prop overrides, merged over this composite's own defaults. */
  defaults?: {
    assistant?: Partial<AgentCoreAgentProps>;
    harnessAgent?: Partial<AgentCoreAgentProps>;
  };
}

/**
 * Every member `LoomAgents` can return — the #882 composite's own 8 members
 * (`role`/`gatewayRole`/`runtime`/`endpoint`/`memory`/`workloadIdentity`/
 * `gateway`/`gatewayTarget`), flattened per agent under an `assistant*`/
 * `harnessAgent*` prefix rather than nested as a sub-composite (chant's own
 * `CompositeMembers` constraint is `Record<string, Declarable>` — a nested
 * `CompositeInstance` needs an unsound cast to satisfy it, so this composite
 * flattens instead, same shape every other member below already uses). The
 * `harnessAgent*` members are present only on production/production-ha
 * (chant#890 — the "full" agent set).
 */
export type LoomAgentsResult = {
  assistantRole: AgentCoreAgentResult["role"];
  assistantGatewayRole: AgentCoreAgentResult["gatewayRole"];
  assistantRuntime: AgentCoreAgentResult["runtime"];
  assistantEndpoint: AgentCoreAgentResult["endpoint"];
  assistantMemory: AgentCoreAgentResult["memory"];
  assistantWorkloadIdentity: AgentCoreAgentResult["workloadIdentity"];
  assistantGateway: AgentCoreAgentResult["gateway"];
  assistantGatewayTarget: AgentCoreAgentResult["gatewayTarget"];

  harnessAgentRole?: AgentCoreAgentResult["role"];
  harnessAgentGatewayRole?: AgentCoreAgentResult["gatewayRole"];
  harnessAgentRuntime?: AgentCoreAgentResult["runtime"];
  harnessAgentEndpoint?: AgentCoreAgentResult["endpoint"];
  harnessAgentMemory?: AgentCoreAgentResult["memory"];
  harnessAgentWorkloadIdentity?: AgentCoreAgentResult["workloadIdentity"];
  harnessAgentGateway?: AgentCoreAgentResult["gateway"];
  harnessAgentGatewayTarget?: AgentCoreAgentResult["gatewayTarget"];
};

type TagList = Array<{ Key: string; Value: string }>;

/** `{ project, env, ... }` tags -> CloudFormation `[{ Key, Value }, ...]` — same convention as every sibling composite. */
function tagList(tags: Record<string, string>): TagList {
  return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
}

// ─────────────────────────────────────────────────────────────────────────
// Execution-role extension (see file header "Scope boundary"). Module-level
// so EVL001/EVL002 apply the same way they do to every sibling composite's
// own buildXxx() helper — a plain, unconditional construction, never an `if`
// wrapping a `new Xxx(...)` (chant's EVL002).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Bedrock invoke + the CloudWatch Logs vended-log-delivery pipeline
 * AgentCore Runtime ships its logs through + read access to
 * AgentCore-Identity-managed Secrets Manager credential-provider secrets +
 * read-only S3 on this agent's own slice of the artifact bucket (Loom's own
 * `store_large_config()` convention: `s3://{bucket}/{agentName}/config/*`).
 * Attached via `AgentCoreAgent`'s own `Policies` prop, merging onto that
 * composite's auto-created Runtime/Memory role.
 */
function buildAgentExecutionPolicies(
  naming: LoomNaming,
  agentId: string,
  bedrockModelArns: string[],
  artifactBucket: string,
): InstanceType<typeof Role_Policy>[] {
  const bedrockInvokePolicyName = naming.name(`${agentId}-bedrock-policy`);
  const logsDeliveryPolicyName = naming.name(`${agentId}-logs-delivery-policy`);
  const identitySecretsPolicyName = naming.name(`${agentId}-identity-secrets-policy`);
  const artifactBucketPolicyName = naming.name(`${agentId}-artifact-bucket-policy`);
  const identitySecretsResource = Sub`arn:${AWS.Partition}:secretsmanager:${AWS.Region}:${AWS.AccountId}:secret:bedrock-agentcore-identity!*`;
  const artifactConfigResource = Sub`arn:${AWS.Partition}:s3:::${artifactBucket}/${agentId}/config/*`;

  return [
    new Role_Policy({
      PolicyName: bedrockInvokePolicyName,
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          { Effect: "Allow", Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"], Resource: bedrockModelArns },
        ],
      } as unknown as string,
    }),
    new Role_Policy({
      PolicyName: artifactBucketPolicyName,
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          { Effect: "Allow", Action: ["s3:GetObject"], Resource: artifactConfigResource as unknown as string },
        ],
      } as unknown as string,
    }),
    new Role_Policy({
      PolicyName: logsDeliveryPolicyName,
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            // The Log Delivery API AgentCore Runtime uses to ship vended
            // Runtime/Gateway logs to CloudWatch Logs — not the ordinary
            // logs:PutLogEvents an ECS task uses (contrast
            // ../loom-backend.ts's own logs policy).
            Action: [
              "logs:CreateLogDelivery",
              "logs:GetLogDelivery",
              "logs:UpdateLogDelivery",
              "logs:DeleteLogDelivery",
              "logs:ListLogDeliveries",
              "logs:PutResourcePolicy",
              "logs:DescribeResourcePolicies",
              "logs:DescribeLogGroups",
            ],
            // None of these actions have resource-level permissions in AWS
            // IAM — "*" is the only valid Resource, same reasoning
            // ../loom-backend.ts's ECR_PULL_POLICY_DOCUMENT documents for
            // ecr:GetAuthorizationToken (WAW020 only flags a wildcard
            // *Action*, never a wildcard Resource, for exactly this reason).
            Resource: "*",
          },
        ],
      } as unknown as string,
    }),
    new Role_Policy({
      PolicyName: identitySecretsPolicyName,
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["secretsmanager:GetSecretValue"],
            // AgentCore Identity's own credential-provider secrets are all
            // named under this fixed "bedrock-agentcore-identity!" prefix —
            // narrower than a bare "*".
            Resource: identitySecretsResource as unknown as string,
          },
        ],
      } as unknown as string,
    }),
  ];
}

export const LoomAgents = Composite<LoomAgentsProps, LoomAgentsResult>((props) => {
  const naming = loomNaming(props.naming, "loom-agents");
  const tier: Tier = props.naming.tier;
  const fullTier = tier !== "light";
  const { defaults } = props;

  // Construct unconditionally, throw conditionally — chant's EVL002 forbids
  // a resource constructor (any `new Xxx(...)`, including a plain `Error`)
  // from appearing inside an `if`, same convention `../loom-db.ts`'s
  // `notEnoughSubnetsError` uses.
  const missingSubnetsError = new Error(
    "LoomAgents: privateSubnetIds is required on production/production-ha (agents run in VPC network mode)",
  );
  if (fullTier && !props.privateSubnetIds?.length) {
    throw missingSubnetsError;
  }

  const tags = tagList(naming.tags());
  const bedrockModelArns = props.bedrockModelArns ?? ["arn:aws:bedrock:*::foundation-model/*"];
  const memoryEventExpiryDays = props.memoryEventExpiryDays ?? (fullTier ? 90 : undefined);
  const networkMode: "PUBLIC" | "VPC" = fullTier ? "VPC" : "PUBLIC";
  const protocolConfiguration: "A2A" | "AGUI" | "HTTP" | "MCP" = "HTTP"; // matches Loom's own create_runtime default protocol
  const vpcSubnetIds = fullTier ? props.privateSubnetIds : undefined;
  const vpcSecurityGroupIds = fullTier ? [props.ecsSecurityGroupId] : undefined;
  const allowedResourceOauth2ReturnUrls = props.cognitoTokenUrl ? [props.cognitoTokenUrl] : undefined;

  const sharedEnvironment = {
    LOOM_ARTIFACT_BUCKET: props.artifactBucket,
    LOOM_BACKEND_BASE_URL: props.backendBaseUrl ?? "",
    LOOM_COGNITO_DISCOVERY_URL: props.cognitoDiscoveryUrl ?? "",
    LOG_LEVEL: "info",
  };

  // ── Low-code: the Strands agent (every tier) ─────────────────────────
  // A plain spread, not `mergeDefaults` — `defaults.assistant` overrides
  // this composite's own *top-level* `AgentCoreAgentProps` (e.g. swap
  // `protocolConfiguration`), a different layer than the array-concatenating
  // `defaults.assistant.defaults` escape hatch `AgentCoreAgent` itself
  // already provides for raw per-member CFN prop overrides. `defaults` is
  // assembled *after* that spread and stays last, so `role`/`gatewayRole`
  // always carry the full tag set (chant#896) even when a caller's own
  // `defaults.assistant` sets other top-level fields — the #882 composite's
  // Runtime/RuntimeEndpoint/Memory/Gateway/GatewayTarget/WorkloadIdentity
  // stay untagged here: their `Tags` property shape isn't exercised anywhere
  // in that composite today, and guessing it risks a malformed template
  // rather than an actually-missing tag (IAM's `Tags: [{Key,Value}]` shape,
  // used below, is proven throughout every sibling composite in this repo).
  const assistantOverrides = defaults?.assistant ?? {};
  const assistantProps: AgentCoreAgentProps = {
    name: naming.name("assistant"),
    containerUri: props.assistantImageUri,
    networkMode,
    vpcSubnetIds,
    vpcSecurityGroupIds,
    protocolConfiguration,
    environmentVariables: sharedEnvironment,
    memoryEventExpiryDays,
    allowedResourceOauth2ReturnUrls,
    Policies: buildAgentExecutionPolicies(naming, "assistant", bedrockModelArns, props.artifactBucket),
    ...assistantOverrides,
    defaults: {
      role: { Tags: tags },
      gatewayRole: { Tags: tags },
      ...(assistantOverrides.defaults ?? {}),
    },
  };
  const assistant = AgentCoreAgent(assistantProps);

  // ── No-code: the AgentCore-managed harness agent (production/production-ha only) ──
  const harnessOverrides = defaults?.harnessAgent ?? {};
  const harnessAgent = fullTier
    ? AgentCoreAgent({
        name: naming.name("harness-agent"),
        containerUri: props.harnessImageUri ?? "",
        networkMode,
        vpcSubnetIds,
        vpcSecurityGroupIds,
        protocolConfiguration,
        environmentVariables: sharedEnvironment,
        memoryEventExpiryDays,
        allowedResourceOauth2ReturnUrls,
        Policies: buildAgentExecutionPolicies(naming, "harness-agent", bedrockModelArns, props.artifactBucket),
        ...harnessOverrides,
        defaults: {
          role: { Tags: tags },
          gatewayRole: { Tags: tags },
          ...(harnessOverrides.defaults ?? {}),
        },
      } satisfies AgentCoreAgentProps)
    : undefined;

  return {
    assistantRole: assistant.role,
    assistantGatewayRole: assistant.gatewayRole,
    assistantRuntime: assistant.runtime,
    assistantEndpoint: assistant.endpoint,
    assistantMemory: assistant.memory,
    assistantWorkloadIdentity: assistant.workloadIdentity,
    assistantGateway: assistant.gateway,
    assistantGatewayTarget: assistant.gatewayTarget,

    ...(harnessAgent
      ? {
          harnessAgentRole: harnessAgent.role,
          harnessAgentGatewayRole: harnessAgent.gatewayRole,
          harnessAgentRuntime: harnessAgent.runtime,
          harnessAgentEndpoint: harnessAgent.endpoint,
          harnessAgentMemory: harnessAgent.memory,
          harnessAgentWorkloadIdentity: harnessAgent.workloadIdentity,
          harnessAgentGateway: harnessAgent.gateway,
          harnessAgentGatewayTarget: harnessAgent.gatewayTarget,
        }
      : {}),
  };
}, "LoomAgents");
