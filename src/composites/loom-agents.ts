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
 *   `agents/strands_agent`). One per deployment, every tier. It ships as a
 *   **zip code artifact**, not a container: vendoring real Loom v1.6.0 source
 *   (#20) found `agents/strands_agent/` has no `Dockerfile` upstream at all —
 *   Loom's own backend zips this agent and uploads it to S3
 *   (`build_agent_artifact()` in `backend/app/services/deployment.py`), then
 *   deploys it via Bedrock AgentCore Runtime's `codeConfiguration`
 *   (`code.s3.{bucket,prefix}`, `runtime: PYTHON_3_13`,
 *   `entryPoint: ["opentelemetry-instrument", "src/handler.py"]`), never a
 *   container image. This composite mirrors that exactly through
 *   `AgentCoreAgent`'s `code` artifact source (chant#973): the assistant zip
 *   already exists in the artifact bucket (built/uploaded out-of-band, the
 *   same boundary the container path drew — this repo has no agent build
 *   phase), addressed by `artifactBucket` + `assistantCodePrefix`.
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
  Role,
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

  // ── Agent artifacts — built/uploaded out-of-band (see file header) ──
  /**
   * S3 key of the low-code Strands agent's zip within `artifactBucket` — the
   * `code.s3.prefix` Loom's own `create_runtime` passes (its
   * `build_agent_artifact()` uploads under `strands_agent/.../agent.zip`).
   * Runs on a managed Python runtime via AgentCore `codeConfiguration`, no
   * container image. Every tier deploys this one agent.
   */
  assistantCodePrefix: string;
  /** No-code AgentCore-harness agent's image — config-only, a stock/managed image. Required only on production/production-ha; ignored on light. */
  harnessImageUri?: string;

  /**
   * Provision an AgentCore Code Interpreter sandbox execution role per agent
   * (Loom's own `shared/iac/code_interpreter_role.yaml`, v1.6.0). Default:
   * `true` — Loom ships this role as part of the standard deploy, so agents
   * that use the code-interpreter tool have an execution role. Set `false` to
   * omit it (e.g. a deployment whose agents never invoke the sandbox).
   */
  codeInterpreter?: boolean;
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
  /** AgentCore Code Interpreter sandbox execution role (Loom's `code_interpreter_role.yaml`). Present unless `codeInterpreter: false`. */
  assistantCodeInterpreterRole?: InstanceType<typeof Role>;

  harnessAgentRole?: AgentCoreAgentResult["role"];
  harnessAgentGatewayRole?: AgentCoreAgentResult["gatewayRole"];
  harnessAgentRuntime?: AgentCoreAgentResult["runtime"];
  harnessAgentEndpoint?: AgentCoreAgentResult["endpoint"];
  harnessAgentMemory?: AgentCoreAgentResult["memory"];
  harnessAgentWorkloadIdentity?: AgentCoreAgentResult["workloadIdentity"];
  harnessAgentGateway?: AgentCoreAgentResult["gateway"];
  harnessAgentGatewayTarget?: AgentCoreAgentResult["gatewayTarget"];
  /** AgentCore Code Interpreter sandbox execution role for the harness agent (production/production-ha, unless `codeInterpreter: false`). */
  harnessAgentCodeInterpreterRole?: InstanceType<typeof Role>;
};

// Loom's fixed AgentCore code-config contract for the Strands agent
// (`create_runtime` in vendor/loom/backend/app/services/deployment.py) — the
// managed runtime + entry point are Loom's own, not per-deploy config, so they
// live here as constants (the same way `bedrockModelArns` defaults to an AWS
// contract literal below, not from the naming helper — LOOM001 governs
// physical names/tags, not upstream API contract values).
const ASSISTANT_RUNTIME = "PYTHON_3_13" as const;
const ASSISTANT_ENTRY_POINT = ["opentelemetry-instrument", "src/handler.py"] as const;

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

/**
 * The AgentCore Code Interpreter sandbox execution role — a standalone IAM
 * role the Code Interpreter sandbox assumes at runtime, separate from the
 * agent's own Runtime role (`buildAgentExecutionPolicies` above), modeled on
 * Loom's own `shared/iac/code_interpreter_role.yaml` (v1.6.0). Scoped to the
 * AgentCore-managed code-interpreter S3 bucket + its CloudWatch log group,
 * both under fixed `bedrock-agentcore-*` name patterns AWS owns — narrowed to
 * this deploy's own account + region (tighter than Loom's own default `*`
 * region pattern, which loomster doesn't need: one deploy is one region).
 * Provisioned per agent (Loom scopes it per-agent via `pRoleSuffix`).
 * Module-level so EVL001/EVL002 see a plain, unconditional `new Role(...)`,
 * the same convention `buildAgentExecutionPolicies` follows.
 */
function buildCodeInterpreterRole(
  naming: LoomNaming,
  agentId: string,
  tags: TagList,
): InstanceType<typeof Role> {
  const roleName = naming.name(`${agentId}-ci-role`);
  const policyName = naming.name(`${agentId}-ci-sandbox-policy`);
  const sandboxBucketResource = Sub`arn:${AWS.Partition}:s3:::bedrock-agentcore-${AWS.AccountId}-${AWS.Region}-code-interpreter/*`;
  const sandboxLogsResource = Sub`arn:${AWS.Partition}:logs:${AWS.Region}:${AWS.AccountId}:log-group:/aws/bedrock-agentcore/code-interpreter*`;

  const assumeRolePolicyDocument = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "bedrock-agentcore.amazonaws.com" },
        Action: "sts:AssumeRole",
        // Loom's own confused-deputy guard — only AgentCore acting for this
        // account may assume the sandbox role.
        Condition: { StringEquals: { "aws:SourceAccount": AWS.AccountId } },
      },
    ],
  };
  const policyDocument = {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["s3:GetObject", "s3:PutObject"], Resource: sandboxBucketResource },
      {
        Effect: "Allow",
        Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: sandboxLogsResource,
      },
    ],
  };

  return new Role({
    RoleName: roleName,
    Path: "/",
    AssumeRolePolicyDocument: assumeRolePolicyDocument as unknown as string,
    Policies: [new Role_Policy({ PolicyName: policyName, PolicyDocument: policyDocument as unknown as string })],
    // Pre-merged by the caller (includes the `loom:role_type=code_interpreter`
    // discriminator Loom's own role carries) — a bare param, the same way
    // `buildAgentExecutionPolicies` passes `bedrockModelArns` straight through
    // (merging here would need a spread/`.concat` at the property site, which
    // chant's EVL004/EVL001 forbid).
    Tags: tags,
  });
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
  // Presence only (`undefined`), not `.length` — a deploy-time `Fn::Split`
  // (chant#928/loomster#35's shared-foundation cross-stack wiring, see
  // ../loom-agents/agents.ts) is a real, present value here but isn't a real
  // array, so `.length` would be `undefined` and wrongly trip this guard
  // even though a value genuinely was supplied. CloudFormation itself
  // rejects an empty subnet list when the runtime actually deploys.
  if (fullTier && !props.privateSubnetIds) {
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
    // Code artifact, not a container — the Strands agent zip in the artifact
    // bucket, run on a managed Python runtime (matches Loom's own
    // create_runtime, see file header + ASSISTANT_RUNTIME/ENTRY_POINT above).
    code: {
      s3Bucket: props.artifactBucket,
      s3Prefix: props.assistantCodePrefix,
      runtime: ASSISTANT_RUNTIME,
      entryPoint: [...ASSISTANT_ENTRY_POINT],
    },
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

  // ── No-code: the AgentCore-managed harness agent (opt-in) ──
  // Loom's real no-code harness is a *managed agent loop* created on demand
  // through the app's own `create_harness` API (AWS::BedrockAgentCore::Harness,
  // no container image) — it is not pre-provisioned infrastructure. Modeling it
  // here as an AgentCore *Runtime* with a `containerUri` was wrong on two counts
  // (wrong resource, and there is no stock harness image to point at), and a
  // real AgentCore deploy rejects an empty `ContainerUri` (loomster#128). So the
  // harness Runtime is provisioned ONLY when a caller explicitly supplies a real
  // `harnessImageUri` (their own container agent). Unset — the default — no
  // harness is emitted, and users create no-code harnesses through the Loom UI.
  const harnessOverrides = defaults?.harnessAgent ?? {};
  const harnessAgent = fullTier && props.harnessImageUri
    ? AgentCoreAgent({
        name: naming.name("harness-agent"),
        containerUri: props.harnessImageUri,
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

  // ── Code Interpreter sandbox execution roles (Loom's code_interpreter_role.yaml) ──
  // Per-agent, gated by `codeInterpreter` (default on — Loom ships it). The
  // ternary only calls a module-level helper (no `new Xxx(...)` lexically
  // inside the conditional), same EVL002-safe shape as `harnessAgent` above.
  const codeInterpreter = props.codeInterpreter ?? true;
  // Merge the `loom:role_type` marker here in the body (a plain statement, not
  // a resource-constructor property) so the helper passes it straight through
  // — EVL001/EVL004 only constrain expressions at the property site.
  const codeInterpreterTags = tags.concat([{ Key: "loom:role_type", Value: "code_interpreter" }]);
  const assistantCodeInterpreterRole = codeInterpreter
    ? buildCodeInterpreterRole(naming, "assistant", codeInterpreterTags)
    : undefined;
  // Only when the harness agent itself is provisioned (loomster#128) — no orphan
  // code-interpreter role for an agent that no longer exists.
  const harnessAgentCodeInterpreterRole = codeInterpreter && harnessAgent
    ? buildCodeInterpreterRole(naming, "harness-agent", codeInterpreterTags)
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
    ...(assistantCodeInterpreterRole ? { assistantCodeInterpreterRole } : {}),

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
    ...(harnessAgentCodeInterpreterRole ? { harnessAgentCodeInterpreterRole } : {}),
  };
}, "LoomAgents");
