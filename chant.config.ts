import type { ChantConfig } from "@intentius/chant";

// Loom's real footprint (ALB, ECS, RDS, Cognito, ECR, KMS, S3, PrivateLink) is
// standard CloudFormation — the aws lexicon types all of it, no synthesis gap.
// `temporal` is read for the lifecycle Ops under `ops/` (chant#904 — WatchOp
// observe + ReconcileOp cloud→code, `@intentius/chant-lexicon-temporal`).
const loomEnv = process.env.LOOM_ENV ?? "dev";

export default {
  lexicons: ["aws", "temporal", "docker"],
  // Scope whole-project discovery (bare `chant lifecycle diff|snapshot`, the
  // path WatchOp/ReconcileOp use) to `src/`, so it never walks `docs-site/`'s
  // Astro config (`astro:`-scheme imports the ESM loader rejects) or `test/`
  // fixtures (loomster#94). Per-stack (`chant build src/<stack>`), component
  // (`chant build --components`), and Ops (`chant build ops`) commands pass
  // their own explicit path and are unaffected.
  sourceDir: "src",
  // Whatever LOOM_ENV this build/lint/lifecycle invocation targets is the
  // only allowed environment — same single-deployment-at-a-time convention
  // every src/*/params.ts file already follows.
  environments: [loomEnv],
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
  // supplied via `chant build --param name=value`/`--params-file`, or (only
  // where explicitly mapped below) a same-named env var — see each
  // `src/*/params.ts` for which stack reads which parameter. Names shared
  // across stacks (project/env/instance/tier/region/accountId/owner,
  // dbUsername/dbPassword/dbName, cpuArchitecture) are declared once and read
  // by every stack that needs the identical value; stack-specific names are
  // prefixed (frontendCpu vs backendCpu) to avoid colliding in this one flat
  // namespace.
  buildParams: {
    // ── Shared naming/tagging params (every stack's namingParams, plus
    // src/lib/stack-name.ts's `sn()` — chant#157) ───────────────────────────
    // `project`/`instance` gained their `env:` mappings in the #157 migration
    // (they were declared without one in #156, since nothing read
    // LOOM_PROJECT/LOOM_INSTANCE through `buildParams` yet) — `sn()` needs
    // both to resolve the same way `chant build --param`/a bare `LOOM_PROJECT`/
    // `LOOM_INSTANCE` env var already did before it moved off `process.env`.
    project: { type: "string", default: "loom", env: "LOOM_PROJECT" },
    env: { type: "string", default: "dev", env: "LOOM_ENV" },
    instance: { type: "string", default: "a", env: "LOOM_INSTANCE" },
    tier: { type: "string", enum: ["light", "production", "production-ha"], default: "light", env: "LOOM_TIER" },
    region: { type: "string", default: "us-east-1", env: "AWS_REGION" },
    accountId: { type: "string", required: false, env: "AWS_ACCOUNT_ID" },
    owner: { type: "string", default: "platform" },

    // ── loom-db ─────────────────────────────────────────────────────────
    dbMode: { type: "string", enum: ["provision", "reference-existing", "omit"], default: "provision" },
    dbAllowedCidr: { type: "string", required: false },
    dbSourceSg: { type: "boolean", default: false },
    // dbName/dbUsername/dbPassword are shared with loom-backend (../loom-backend/params.ts) — same value, same meaning.
    dbName: { type: "string", required: false },
    dbUsername: { type: "string", required: false },
    dbPassword: { type: "string", required: false },
    dbInstanceClass: { type: "string", required: false },
    dbAllocatedStorage: { type: "number", required: false },
    dbReferenceEndpoint: { type: "string", required: false },
    dbReferencePort: { type: "number", required: false },
    dbReferenceCredentialsSecretArn: { type: "string", required: false },
    dbReferenceConnectionSecretArn: { type: "string", required: false },

    // ── shared-foundation ───────────────────────────────────────────────
    domainName: { type: "string", required: false },
    hostedZoneId: { type: "string", required: false },
    route53Mode: { type: "string", required: false, enum: ["omit", "provision"] },
    certificateArn: { type: "string", required: false },
    acmMode: { type: "string", required: false, enum: ["omit", "provision"] },
    kmsKeyArn: { type: "string", required: false },
    kmsMode: { type: "string", required: false, enum: ["omit", "provision"] },
    frontendRepositoryUri: { type: "string", required: false },
    frontendRepositoryArn: { type: "string", required: false },
    backendRepositoryUri: { type: "string", required: false },
    backendRepositoryArn: { type: "string", required: false },
    ecrMode: { type: "string", required: false, enum: ["omit", "provision"] },
    agentRoleArn: { type: "string", required: false },
    agentRoleMode: { type: "string", required: false, enum: ["omit", "provision"] },
    albIngressCidr: { type: "string", required: false },
    loggingBucketName: { type: "string", required: false },
    privateLinkMode: { type: "string", required: false, enum: ["provision", "omit"] },

    // ── loom-cognito ────────────────────────────────────────────────────
    cognitoMode: { type: "string", enum: ["provision", "reference-existing", "omit"], default: "provision" },
    cognitoCallbackUrls: { type: "string", required: false },
    cognitoResourceServerId: { type: "string", required: false },
    cognitoScopesJson: { type: "string", required: false },
    cognitoUiTierGroupsJson: { type: "string", required: false },
    cognitoResourceGroupsJson: { type: "string", required: false },
    cognitoDemoSeedUsersJson: { type: "string", required: false },
    cognitoAbacApplication: { type: "string", required: false },
    cognitoAbacGroup: { type: "string", required: false },
    cognitoAbacOwner: { type: "string", required: false },
    cognitoManagedLoginBranding: { type: "boolean", required: false },
    cognitoUserPoolId: { type: "string", required: false },
    cognitoUserPoolArn: { type: "string", required: false },
    cognitoDomain: { type: "string", required: false },
    cognitoM2mClientId: { type: "string", required: false },
    cognitoUserClientId: { type: "string", required: false },
    cognitoIssuer: { type: "string", required: false },
    cognitoDiscoveryUrl: { type: "string", required: false },
    cognitoTokenUrl: { type: "string", required: false },

    // ── loom-backend / loom-frontend ────────────────────────────────────
    // Shared between both stacks — must match how the image was built.
    cpuArchitecture: { type: "string", required: false, enum: ["X86_64", "ARM64"] },
    backendCpu: { type: "string", required: false },
    backendMemory: { type: "string", required: false },
    backendDesiredCount: { type: "number", required: false },
    backendMaxCount: { type: "number", required: false },
    backendLogRetentionDays: { type: "number", required: false },
    backendExecutionRoleArn: { type: "string", required: false },
    backendTaskRoleArn: { type: "string", required: false },
    frontendCpu: { type: "string", required: false },
    frontendMemory: { type: "string", required: false },
    frontendDesiredCount: { type: "number", required: false },
    frontendLogRetentionDays: { type: "number", required: false },
    frontendExecutionRoleArn: { type: "string", required: false },
    cognitoRegion: { type: "string", required: false },
    allowedOrigins: { type: "string", required: false },
    registryId: { type: "string", required: false },
    litellmProxyBaseUrl: { type: "string", required: false },
    litellmDiscoveryBaseUrl: { type: "string", required: false },
    litellmProxyApiKeySecretArn: { type: "string", required: false },
    litellmProxyApiKeySecretKmsKeyArn: { type: "string", required: false },

    // ── loom-agents ─────────────────────────────────────────────────────
    assistantCodePrefix: { type: "string", default: "strands_agent/agent.zip" },
    agentsBedrockModelArns: { type: "string", required: false },
    agentsMemoryEventExpiryDays: { type: "number", required: false },
  },
  lint: {
    overrides: [
      {
        // EVL003/EVL004 keep composite/component authoring code statically
        // evaluable. src/lib/**, .chant/rules/**, and ops/** are plain
        // runtime helpers (the naming/tagging helper, project-local lint
        // rules, the lifecycle Ops' Temporal workflow-definition code,
        // chant#905) — never a composite property expression — so they're
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
