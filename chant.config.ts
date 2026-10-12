import type { ChantConfig } from "@intentius/chant";

// Loom's real footprint (ALB, ECS, RDS, Cognito, ECR, KMS, S3, PrivateLink) is
// standard CloudFormation — the aws lexicon types all of it, no synthesis gap.
// The lifecycle Ops under `ops/` come from `@intentius/chant/op` and need no
// lexicon of their own.
const loomEnv = process.env.LOOM_ENV ?? "dev";
// The environments that live on Floci rather than AWS: `local` (local-up) and
// `floci` (the production-tier Floci E2E), both on :4566. Declaring the
// endpoint makes `chant lifecycle diff local --live` (and `graph --live`)
// read Floci without an exported AWS_ENDPOINT_URL, instead of quietly asking
// real AWS for a stack that isn't there (chant#1166). Only the endpoint is
// injected: the shell still needs Floci's `test` keys, since real AWS keys are
// unknown to Floci and rejected when its IAM enforcement is on.
const FLOCI_ENDPOINT = "http://localhost:4566";
const onFloci = loomEnv === "local" || loomEnv === "floci";

export default {
  lexicons: ["aws", "docker"],
  // Scope whole-project discovery (bare `chant lifecycle diff|snapshot`, the
  // path WatchOp/ReconcileOp use) to `src/`, so it never walks `docs-site/`'s
  // Astro config (`astro:`-scheme imports the ESM loader rejects) or `test/`
  // fixtures (loomster#94). Per-stack (`chant build src/<stack>`), component
  // (`chant build --components`), and Ops (`chant build ops`) commands pass
  // their own explicit path and are unaffected.
  sourceDir: "src",
  // `chant lint .` and Op discovery share one walk of the whole project
  // (chant 0.81). Keep it out of the Astro docs site, whose config imports
  // `astro:` modules the ESM loader refuses.
  exclude: ["docs-site"],
  // Whatever LOOM_ENV this build/lint/lifecycle invocation targets is the
  // only allowed environment — same single-deployment-at-a-time convention
  // every src/*/params.ts file already follows.
  environments: [onFloci ? { name: loomEnv, endpoint: FLOCI_ENDPOINT } : loomEnv],
  // Stamps a chant ownership marker (tags `chant:managed-by`/`chant:stack`/
  // `chant:env`) onto every supported resource, so `loom-reconcile`'s
  // `scope: { owned: true }` (ops/loom-reconcile.op.ts, chant#904) can scope
  // its cloud→code PRs to chant-owned resources and never touch a foreign
  // one (chant#897).
  ownership: { stack: "loom", env: loomEnv },
  // Build-time parameters (chant#1064 migration) — every src/*/params.ts file
  // used to read process.env directly, which chant's fold engine correctly
  // can never reduce to a value (an ambient read depends on whatever process
  // happens to be running the build, not on the source). Declared here once;
  // referenced from source as `params.<name>` (`@intentius/chant/params`),
  // supplied via `chant build --param name=value`/`--params-file`, or the
  // `LOOM_*` env var named by its `env:` mapping (precedence in that order).
  // Every parameter keeps an `env:` mapping: CI, scripts and docs set these
  // vars, and chant ignores any env var a parameter doesn't map
  // (src/build-params.test.ts checks this). See each `src/*/params.ts` for
  // which stack reads which parameter. Names shared
  // across stacks (project/env/instance/tier/region/accountId/owner,
  // dbUsername/dbPassword/dbName, cpuArchitecture) are declared once and read
  // by every stack that needs the identical value; stack-specific names are
  // prefixed (frontendCpu vs backendCpu) to avoid colliding in this one flat
  // namespace.
  buildParams: {
    // ── Shared naming/tagging params (every stack's namingParams, plus
    // src/lib/stack-name.ts's `sn()` — chant#157) ───────────────────────────
    project: { type: "string", default: "loom", env: "LOOM_PROJECT" },
    env: { type: "string", default: "dev", env: "LOOM_ENV" },
    instance: { type: "string", default: "a", env: "LOOM_INSTANCE" },
    tier: { type: "string", enum: ["light", "production", "production-ha"], default: "light", env: "LOOM_TIER" },
    region: { type: "string", default: "us-east-1", env: "AWS_REGION" },
    accountId: { type: "string", required: false, env: "AWS_ACCOUNT_ID" },
    owner: { type: "string", default: "platform", env: "LOOM_OWNER" },

    // ── loom-db ─────────────────────────────────────────────────────────
    dbMode: { type: "string", enum: ["provision", "reference-existing", "omit"], default: "provision", env: "LOOM_DB_MODE" },
    dbAllowedCidr: { type: "string", required: false, env: "LOOM_DB_ALLOWED_CIDR" },
    dbSourceSg: { type: "boolean", default: false, env: "LOOM_DB_SOURCE_SG" },
    // dbName/dbUsername/dbPassword are shared with loom-backend (../loom-backend/params.ts) — same value, same meaning.
    dbName: { type: "string", required: false, env: "LOOM_DB_NAME" },
    dbUsername: { type: "string", required: false, env: "LOOM_DB_USERNAME" },
    dbPassword: { type: "string", required: false, env: "LOOM_DB_PASSWORD" },
    dbInstanceClass: { type: "string", required: false, env: "LOOM_DB_INSTANCE_CLASS" },
    dbAllocatedStorage: { type: "number", required: false, env: "LOOM_DB_ALLOCATED_STORAGE" },
    dbReferenceEndpoint: { type: "string", required: false, env: "LOOM_DB_ENDPOINT" },
    dbReferencePort: { type: "number", required: false, env: "LOOM_DB_PORT" },
    dbReferenceCredentialsSecretArn: { type: "string", required: false, env: "LOOM_DB_CREDENTIALS_SECRET_ARN" },
    dbReferenceConnectionSecretArn: { type: "string", required: false, env: "LOOM_DB_CONNECTION_SECRET_ARN" },

    // ── shared-foundation ───────────────────────────────────────────────
    domainName: { type: "string", required: false, env: "LOOM_DOMAIN_NAME" },
    hostedZoneId: { type: "string", required: false, env: "LOOM_HOSTED_ZONE_ID" },
    route53Mode: { type: "string", required: false, enum: ["omit", "provision"], env: "LOOM_ROUTE53" },
    certificateArn: { type: "string", required: false, env: "LOOM_CERTIFICATE_ARN" },
    acmMode: { type: "string", required: false, enum: ["omit", "provision"], env: "LOOM_ACM" },
    kmsKeyArn: { type: "string", required: false, env: "LOOM_KMS_KEY_ARN" },
    kmsMode: { type: "string", required: false, enum: ["omit", "provision"], env: "LOOM_KMS" },
    frontendRepositoryUri: { type: "string", required: false, env: "LOOM_FRONTEND_REPOSITORY_URI" },
    frontendRepositoryArn: { type: "string", required: false, env: "LOOM_FRONTEND_REPOSITORY_ARN" },
    backendRepositoryUri: { type: "string", required: false, env: "LOOM_BACKEND_REPOSITORY_URI" },
    backendRepositoryArn: { type: "string", required: false, env: "LOOM_BACKEND_REPOSITORY_ARN" },
    ecrMode: { type: "string", required: false, enum: ["omit", "provision"], env: "LOOM_ECR" },
    agentRoleArn: { type: "string", required: false, env: "LOOM_AGENT_ROLE_ARN" },
    agentRoleMode: { type: "string", required: false, enum: ["omit", "provision"], env: "LOOM_AGENT_ROLE" },
    albIngressCidr: { type: "string", required: false, env: "LOOM_ALB_INGRESS_CIDR" },
    loggingBucketName: { type: "string", required: false, env: "LOOM_LOGGING_BUCKET_NAME" },
    privateLinkMode: { type: "string", required: false, enum: ["provision", "omit"], env: "LOOM_PRIVATELINK" },

    // ── loom-cognito ────────────────────────────────────────────────────
    cognitoMode: { type: "string", enum: ["provision", "reference-existing", "omit"], default: "provision", env: "LOOM_COGNITO_MODE" },
    cognitoCallbackUrls: { type: "string", required: false, env: "LOOM_COGNITO_CALLBACK_URLS" },
    cognitoResourceServerId: { type: "string", required: false, env: "LOOM_COGNITO_RESOURCE_SERVER_ID" },
    cognitoScopesJson: { type: "string", required: false, env: "LOOM_COGNITO_SCOPES_JSON" },
    cognitoUiTierGroupsJson: { type: "string", required: false, env: "LOOM_COGNITO_UI_TIER_GROUPS_JSON" },
    cognitoResourceGroupsJson: { type: "string", required: false, env: "LOOM_COGNITO_RESOURCE_GROUPS_JSON" },
    cognitoDemoSeedUsersJson: { type: "string", required: false, env: "LOOM_COGNITO_DEMO_SEED_USERS_JSON" },
    cognitoAbacApplication: { type: "string", required: false, env: "LOOM_COGNITO_ABAC_APPLICATION" },
    cognitoAbacGroup: { type: "string", required: false, env: "LOOM_COGNITO_ABAC_GROUP" },
    cognitoAbacOwner: { type: "string", required: false, env: "LOOM_COGNITO_ABAC_OWNER" },
    cognitoManagedLoginBranding: { type: "boolean", required: false, env: "LOOM_COGNITO_MANAGED_LOGIN_BRANDING" },
    cognitoUserPoolId: { type: "string", required: false, env: "LOOM_COGNITO_USER_POOL_ID" },
    cognitoUserPoolArn: { type: "string", required: false, env: "LOOM_COGNITO_USER_POOL_ARN" },
    cognitoDomain: { type: "string", required: false, env: "LOOM_COGNITO_DOMAIN" },
    cognitoM2mClientId: { type: "string", required: false, env: "LOOM_COGNITO_M2M_CLIENT_ID" },
    cognitoUserClientId: { type: "string", required: false, env: "LOOM_COGNITO_USER_CLIENT_ID" },
    cognitoIssuer: { type: "string", required: false, env: "LOOM_COGNITO_ISSUER" },
    cognitoDiscoveryUrl: { type: "string", required: false, env: "LOOM_COGNITO_DISCOVERY_URL" },
    cognitoTokenUrl: { type: "string", required: false, env: "LOOM_COGNITO_TOKEN_URL" },

    // ── loom-backend / loom-frontend ────────────────────────────────────
    // Shared between both stacks — must match how the image was built.
    cpuArchitecture: { type: "string", required: false, enum: ["X86_64", "ARM64"], env: "LOOM_CPU_ARCHITECTURE" },
    backendCpu: { type: "string", required: false, env: "LOOM_BACKEND_CPU" },
    backendMemory: { type: "string", required: false, env: "LOOM_BACKEND_MEMORY" },
    backendDesiredCount: { type: "number", required: false, env: "LOOM_BACKEND_DESIRED_COUNT" },
    backendMaxCount: { type: "number", required: false, env: "LOOM_BACKEND_MAX_COUNT" },
    backendLogRetentionDays: { type: "number", required: false, env: "LOOM_BACKEND_LOG_RETENTION_DAYS" },
    backendExecutionRoleArn: { type: "string", required: false, env: "LOOM_BACKEND_EXECUTION_ROLE_ARN" },
    backendTaskRoleArn: { type: "string", required: false, env: "LOOM_BACKEND_TASK_ROLE_ARN" },
    frontendCpu: { type: "string", required: false, env: "LOOM_FRONTEND_CPU" },
    frontendMemory: { type: "string", required: false, env: "LOOM_FRONTEND_MEMORY" },
    frontendDesiredCount: { type: "number", required: false, env: "LOOM_FRONTEND_DESIRED_COUNT" },
    frontendLogRetentionDays: { type: "number", required: false, env: "LOOM_FRONTEND_LOG_RETENTION_DAYS" },
    frontendExecutionRoleArn: { type: "string", required: false, env: "LOOM_FRONTEND_EXECUTION_ROLE_ARN" },
    cognitoRegion: { type: "string", required: false, env: "LOOM_COGNITO_REGION" },
    allowedOrigins: { type: "string", required: false, env: "LOOM_ALLOWED_ORIGINS" },
    registryId: { type: "string", required: false, env: "LOOM_REGISTRY_ID" },
    useSystemTrustStore: { type: "boolean", required: false, env: "LOOM_USE_SYSTEM_TRUST_STORE" },
    litellmProxyBaseUrl: { type: "string", required: false, env: "LOOM_LITELLM_PROXY_BASE_URL" },
    litellmDiscoveryBaseUrl: { type: "string", required: false, env: "LOOM_LITELLM_DISCOVERY_BASE_URL" },
    litellmProxyApiKeySecretArn: { type: "string", required: false, env: "LOOM_LITELLM_PROXY_API_KEY_SECRET_ARN" },
    litellmProxyApiKeySecretKmsKeyArn: { type: "string", required: false, env: "LOOM_LITELLM_PROXY_API_KEY_SECRET_KMS_KEY_ARN" },

    // ── loom-agents ─────────────────────────────────────────────────────
    assistantCodePrefix: { type: "string", default: "strands_agent/agent.zip", env: "LOOM_ASSISTANT_CODE_PREFIX" },
    agentsBedrockModelArns: { type: "string", required: false, env: "LOOM_AGENTS_BEDROCK_MODEL_ARNS" },
    agentsMemoryEventExpiryDays: { type: "number", required: false, env: "LOOM_AGENTS_MEMORY_EVENT_EXPIRY_DAYS" },

    // ── loom-agent-role (one stack per Loom agent, `chant run loom-agent-role`) ──
    agentRoleAgent: { type: "string", required: false, env: "LOOM_AGENT_ROLE_AGENT" },
    agentRoleGroup: { type: "string", required: false, env: "LOOM_AGENT_ROLE_GROUP" },
    agentRoleMemoryArn: { type: "string", required: false, env: "LOOM_AGENT_ROLE_MEMORY_ARN" },
    agentRoleCodeInterpreter: { type: "boolean", required: false, env: "LOOM_AGENT_ROLE_CODE_INTERPRETER" },
    agentRoleBedrockModelArns: { type: "string", required: false, env: "LOOM_AGENT_ROLE_BEDROCK_MODEL_ARNS" },
  },
  lint: {
    overrides: [
      {
        // EVL003/EVL004 keep composite/component authoring code statically
        // evaluable. src/lib/**, .chant/rules/**, and ops/** are plain
        // runtime helpers (the naming/tagging helper, project-local lint
        // rules, the lifecycle Ops' definition code, chant#905) — never a composite property expression — so they're
        // out of scope. EVL004 in particular only traces a spread source to
        // a *module-top-level* const declaration (see
        // packages/core/src/lint/rules/evl004-spread-non-const.ts's
        // `isConstIdentifier`), so it cannot see a const declared inside an
        // ordinary function body — exactly the shape an Op-factory function
        // (e.g. ops/lib/upgrade-op.ts's `buildLoomUpgradeOp`) needs for its
        // tier-conditioned `onFailure`/step lists.
        files: ["src/lib/**", ".chant/rules/**", "ops/**"],
        rules: { EVL003: "off", EVL004: "off" },
      },
      {
        // scripts/** (chant#901's export-bundle tooling) is the same class
        // of plain runtime/tooling code as ops/** above — it drives chant's
        // programmatic build API and assembles/validates a Build Archive
        // manifest, never a composite property expression. EVL002 in
        // particular has no way to distinguish `new SomeError(...)` (a
        // plain thrown error, conditionally constructed as ordinary control
        // flow) from a genuine Declarable resource constructor, so a
        // tier/component loop that throws a validation error per iteration
        // trips it the same way EVL003's dynamic property access does for
        // `Record<string, ...>` lookups keyed by a loop variable (component
        // name, tier name) — again, not a composite prop expression.
        files: ["scripts/**"],
        rules: { EVL002: "off", EVL003: "off", EVL004: "off" },
      },
      {
        // src/local/** is the docker-lexicon local-run compose graph (#49,
        // epic #45) — Service/Network props for `docker-compose.yml`, not AWS
        // CloudFormation composites. They use the docker lexicon's own `env()`
        // interpolation (resolved by docker compose at runtime as `${VAR}`),
        // which chant's AWS-oriented EVL static-evaluability rules misflag as
        // non-literal resource-constructor properties.
        files: ["src/local/**"],
        rules: { EVL001: "off", EVL002: "off", EVL003: "off", EVL004: "off" },
      },
    ],
  },
} satisfies ChantConfig;
