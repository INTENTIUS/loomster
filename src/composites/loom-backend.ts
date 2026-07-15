/**
 * loom-backend composite (chant#889).
 *
 * Folds Loom's `backend/iac/ecs.yaml` (v1.6.0) into one composite emitting
 * one CloudFormation stack: a dedicated CloudWatch Logs KMS key + log group,
 * the ECS task execution role + task role, the Fargate task definition and
 * service, and — production/production-ha only — Application Auto Scaling
 * (`ScalableTarget` + a CPU target-tracking `ScalingPolicy`). The backend is
 * the one service that spans all three upstream stacks: shared-foundation
 * (#886, cluster/SG/target-group/ECR-KMS/artifact-bucket), loom-db (#887,
 * the connection secret + its KMS key), and loom-cognito (#888, the user
 * pool it validates bearer tokens against). See `../loom-backend/outputs.ts`
 * for the single `oServiceName` output Loom's own template exposes, and
 * `../components/loom-backend.component.ts` for how the cross-stack inputs
 * below are actually resolved at deploy time.
 *
 * **Scope boundary (chant#893, agent runtime).** Loom's real `TaskRole` also
 * carries the full Bedrock/AgentCore invoke+control-plane permission set, an
 * `iam:PassRole` grant for `loom-role-*`, a `bedrock-agentcore-identity!`-
 * prefixed Secrets Manager grant, and a CloudWatch Logs delivery-pipeline
 * grant for AgentCore-vended logs — all of that is the agent runtime's own
 * concern (#889's acceptance scope explicitly excludes #893), so this
 * composite's `taskRole` only carries what #889 itself is responsible for:
 * S3 read/write on the artifact bucket, Cognito group/user lookups against
 * the pool #888 provisions, and Secrets Manager read on the DB connection
 * secret. Extend this role (or compose an additional one) in #893, not here.
 *
 * Every physical name and tag comes from the shared naming helper
 * (`../lib/naming.ts`, chant#897); nothing here is a literal (LOOM001).
 *
 * Tiers (chant#890), all param-selected off `naming.tier` with no divergent
 * source: `light` = 1 task, no autoscaling (matches Loom's own
 * `pDesiredCount` default of 1 and no `ScalableTarget`/`ScalingPolicy` at
 * all). `production` = 1 baseline task + autoscaling (`ScalableTarget` min 1,
 * max `maxCount`, target-tracking CPU 70% — Loom's own `ScalingPolicy`
 * defaults). `production-ha` = the same autoscaling with a 2-task floor
 * (`DesiredCount` 2, `ScalableTarget` min 2) so the service always has
 * headroom across at least 2 AZs (this repo's own tiering convention, not
 * literally in Loom's template — Loom's own autoscaling shape has no HA
 * variant of its own).
 *
 * Style note: each tier's resource creation lives in its own module-level
 * `buildXxx()` helper below, invoked with a ternary in the `Composite()`
 * factory body (never an `if` wrapping a resource constructor) — chant's
 * EVL002 requires resources to be reachable without control flow, and
 * EVL001 requires every `new Xxx(...)` property value outside the factory
 * body to be statically evaluable — so anything dynamic (a `Sub`, a
 * `.Arn` attribute access) is computed into a local `const` *before* the
 * resource constructor that consumes it. Only the final per-tier
 * spread-merge (`...(x ?? {})`) happens back in the factory body proper,
 * where EVL004 exempts it — see `LoomBackend`'s `return` below.
 */

import { Composite, mergeDefaults } from "@intentius/chant";
import {
  KmsKey,
  LogGroup,
  Role,
  Role_Policy,
  TaskDefinition,
  TaskDefinition_ContainerDefinition,
  TaskDefinition_PortMapping,
  TaskDefinition_LogConfiguration,
  TaskDefinition_KeyValuePair,
  TaskDefinition_Secret,
  EcsService,
  EcsService_NetworkConfiguration,
  EcsService_AwsVpcConfiguration,
  EcsService_LoadBalancer,
  ScalableTarget,
  ApplicationAutoScalingScalingPolicy,
  ApplicationAutoScalingScalingPolicy_TargetTrackingScalingPolicyConfiguration,
  ApplicationAutoScalingScalingPolicy_PredefinedMetricSpecification,
  Ref,
  Sub,
  AWS,
} from "@intentius/chant-lexicon-aws";
import { loomNaming, type LoomNaming, type LoomNamingParams, type Tier } from "../lib/naming";

/** CloudWatch Logs' own fixed `RetentionInDays` enum (AWS::Logs::LogGroup) — not a Loom or chant convention, just the AWS-mandated value set. */
export type LogRetentionDays = 1 | 3 | 5 | 7 | 14 | 30 | 60 | 90 | 120 | 150 | 180 | 365 | 400 | 545 | 731 | 1096 | 1827 | 2192 | 2557 | 2922 | 3288 | 3653;

// ─────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────

export interface LoomBackendProps {
  /** Naming/tagging parameter source (chant#897) — one call derives every physical name + tag below. */
  naming: LoomNamingParams;

  // ── Cross-stack wiring (chant#889) ──────────────────────────────────────
  // Plain values here — the Ref()/stackOutput() indirection that actually
  // resolves them at deploy time lives in ../loom-backend/{params,backend}.ts
  // and ../components/loom-backend.component.ts's cfn-deploy inputs, not in
  // this composite. Every one of these is a real cross-stack value (an ARN,
  // id, or secret reference generated by another stack's deploy) — nothing
  // here is re-derivable from naming params alone (contrast shared-
  // foundation's own `oEcsClusterName`, which *is* re-derivable — see that
  // composite's outputs.ts).
  /** shared-foundation `oEcsClusterArn`. */
  ecsClusterArn: string;
  /** shared-foundation `oEcsClusterName` — needed for the autoscaling `ScalableTarget`'s `ResourceId`, which is name- not ARN-shaped. */
  ecsClusterName: string;
  /** shared-foundation `oEcsSecurityGroupId`. */
  ecsSecurityGroupId: string;
  /** shared-foundation `oBackendTargetGroupArn`. */
  targetGroupArn: string;
  /** shared-foundation `oArtifactBucket` (a bucket name, not an ARN — matches `Ref` on `AWS::S3::Bucket`). */
  artifactBucket: string;
  /** shared-foundation `oEcrKmsKeyArn`. */
  ecrKmsKeyArn: string;
  /** loom-db `oRdsSecretArn` (the SQLAlchemy connection-URL secret — matches Loom's own `pDatabaseSecretArn` doc: "from RDS stack output oRdsSecretArn"). */
  databaseSecretArn: string;
  /**
   * Light tier only (#46): a pre-built plain `postgresql+psycopg2://` URL. When
   * set, `LOOM_DATABASE_URL` is emitted as a plain `Environment` var and the
   * Secrets-Manager DB-URL secret is omitted — Floci's ECS does not inject
   * `Secrets` into containers, so the light/local tier delivers the URL as
   * plain env from loom-db's resolved endpoint output (see `../loom-backend/
   * backend.ts`). When undefined (production/production-ha), the Secrets-Manager
   * secret is used, unchanged. `LOOM_DATABASE_URL` does not match WAW046's
   * secret-name pattern, so plain env here is lint-clean; the password-in-env
   * divergence is a documented light-tier-only shortcut.
   */
  databaseUrlPlain?: string;
  /** loom-db `oSecretsKmsKeyArn`. */
  secretsKmsKeyArn: string;
  /** Published image (build-once, promote-by-digest — `"@Publish.uri"`/`"@Publish.digest"` at the component layer). */
  imageUri: string;

  // ── Network (BYO, chant#886 owns provisioning) ──────────────────────────
  /** Private subnet ids (with RDS/Cognito reachability) — same `LOOM_PRIVATE_SUBNET_IDS` baseline `loom-db`/`shared-foundation` read, not a shared-foundation output (see `../loom-backend/params.ts`). */
  privateSubnetIds: string[];

  // ── loom-cognito (#888) — optional; Loom's own template defaults both empty ──
  cognitoUserPoolId?: string;
  /** Default: the stack's own deploy region (`Sub`${AWS::Region}``) — matches Loom's own `CognitoRegionEmpty` fallback. */
  cognitoRegion?: string;

  // ── Other Loom app-level knobs (author-time, env-driven — never a hardcoded literal; chant#897) ──
  allowedOrigins?: string;
  registryId?: string;
  litellmProxyBaseUrl?: string;
  /** Default: `litellmProxyBaseUrl` — matches Loom's own "leave empty to reuse pLitellmProxyBaseUrl" default. */
  litellmDiscoveryBaseUrl?: string;
  /** Secrets Manager ARN holding the LiteLLM proxy API key. Omit to disable (matches Loom's own default). */
  litellmProxyApiKeySecretArn?: string;
  /** KMS key encrypting `litellmProxyApiKeySecretArn`, if a customer-managed key (not the default `aws/secretsmanager` key). */
  litellmProxyApiKeySecretKmsKeyArn?: string;

  // ── Sizing (chant#890 tier defaults below; all overridable, never hardcoded past the composite boundary) ──
  /** Container port. Default: 8000 (matches Loom). */
  containerPort?: number;
  /** Default: "1024" (1 vCPU) — matches Loom's own `pCpu` default. */
  cpu?: string;
  /** Default: "2048" (2 GB) — matches Loom's own `pMemory` default. */
  memory?: string;
  /** Default: tier-driven (1 on light/production, 2 on production-ha — see file header). */
  desiredCount?: number;
  /** Autoscaling ceiling (production/production-ha only). Default: 4 — matches Loom's own `pMaxCount`. */
  maxCount?: number;
  /** CloudWatch Logs retention. Default: 30 days (matches Loom). */
  logRetentionDays?: LogRetentionDays;

  /** Per-member CloudFormation prop overrides, merged over this composite's defaults. */
  defaults?: {
    logGroup?: Partial<ConstructorParameters<typeof LogGroup>[0]>;
    executionRole?: Partial<ConstructorParameters<typeof Role>[0]>;
    taskRole?: Partial<ConstructorParameters<typeof Role>[0]>;
    taskDefinition?: Partial<ConstructorParameters<typeof TaskDefinition>[0]>;
    service?: Partial<ConstructorParameters<typeof EcsService>[0]>;
  };
}

type TagList = Array<{ Key: string; Value: string }>;

/** `{ project, env, ... }` tags -> CloudFormation `[{ Key, Value }, ...]` — same convention as every sibling composite. */
function tagList(tags: Record<string, string>): TagList {
  return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
}

// ─────────────────────────────────────────────────────────────────────────
// Fixed policy documents — hoisted to module scope (not per-call) so the
// `buildXxx()` helpers below only ever reference them by identifier
// (EVL001: statically evaluable outside the Composite factory).
// ─────────────────────────────────────────────────────────────────────────

const ECS_TASKS_ASSUME_ROLE_POLICY = {
  Version: "2012-10-17",
  Statement: [{ Effect: "Allow", Principal: { Service: "ecs-tasks.amazonaws.com" }, Action: "sts:AssumeRole" }],
};

const ECR_PULL_POLICY_DOCUMENT = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: ["ecr:GetAuthorizationToken", "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"],
      // ecr:GetAuthorizationToken has no resource-level permissions in AWS
      // IAM — "*" is the only valid Resource for this action, not a
      // least-privilege gap (WAW020 only flags a wildcard *Action*, never a
      // wildcard Resource, for exactly this reason).
      Resource: "*",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Per-phase resource builders. Each is a plain module-level function (not
// nested in the Composite() factory below) so it can be invoked with a
// ternary — never an `if` wrapping a resource constructor.
// ─────────────────────────────────────────────────────────────────────────

interface LogsResult {
  logsKmsKey: InstanceType<typeof KmsKey>;
  logGroup: InstanceType<typeof LogGroup>;
}

function buildLogs(naming: LoomNaming, tags: TagList, retentionDays: LogRetentionDays, defs: LoomBackendProps["defaults"]): LogsResult {
  const cloudWatchLogsPrincipal = Sub`logs.${AWS.Region}.amazonaws.com`;
  const encryptionContextArn = Sub`arn:${AWS.Partition}:logs:${AWS.Region}:${AWS.AccountId}:*`;
  const keyPolicy = {
    Version: "2012-10-17",
    Statement: [
      { Sid: "AllowAccountAdmin", Effect: "Allow", Principal: { AWS: Sub`arn:${AWS.Partition}:iam::${AWS.AccountId}:root` }, Action: "kms:*", Resource: "*" },
      {
        Sid: "AllowCloudWatchLogsService",
        Effect: "Allow",
        Principal: { Service: cloudWatchLogsPrincipal },
        Action: ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"],
        Resource: "*",
        Condition: { ArnLike: { "kms:EncryptionContext:aws:logs:arn": encryptionContextArn } },
      },
    ],
  };

  const logsKmsKey = new KmsKey({
    Description: "KMS key for the Loom backend's CloudWatch Logs encryption",
    EnableKeyRotation: true,
    KeyPolicy: keyPolicy,
    Tags: tags,
  });

  const logGroupName = `/ecs/${naming.name("backend-logs")}`;
  const logsKmsKeyArn = logsKmsKey.Arn as string;
  const logGroup = new LogGroup(mergeDefaults({
    LogGroupName: logGroupName,
    RetentionInDays: retentionDays,
    KmsKeyId: logsKmsKeyArn,
    Tags: tags,
  }, defs?.logGroup));

  return { logsKmsKey, logGroup };
}

interface RolesResult {
  executionRole: InstanceType<typeof Role>;
  taskRole: InstanceType<typeof Role>;
}

function buildRoles(
  naming: LoomNaming,
  tags: TagList,
  logGroup: InstanceType<typeof LogGroup>,
  props: LoomBackendProps,
  defs: LoomBackendProps["defaults"],
): RolesResult {
  const secretsManagerResources = props.litellmProxyApiKeySecretArn
    ? [props.databaseSecretArn, props.litellmProxyApiKeySecretArn]
    : [props.databaseSecretArn];

  const secretsKmsResources: string | string[] = props.litellmProxyApiKeySecretKmsKeyArn
    ? [props.secretsKmsKeyArn, props.litellmProxyApiKeySecretKmsKeyArn]
    : props.secretsKmsKeyArn;

  const logGroupArn = logGroup.Arn as string;
  const logGroupArnWildcard = Sub`${logGroupArn}:*`;
  const artifactBucketArn = Sub`arn:${AWS.Partition}:s3:::${props.artifactBucket}`;
  const artifactBucketArnWildcard = Sub`arn:${AWS.Partition}:s3:::${props.artifactBucket}/*`;
  const cognitoUserPoolArn = Sub`arn:${AWS.Partition}:cognito-idp:${AWS.Region}:${AWS.AccountId}:userpool/${props.cognitoUserPoolId ?? ""}`;

  // naming.name(...) is a method call — EVL001 requires every `new Xxx(...)`
  // property value outside the Composite factory body to be statically
  // evaluable (an identifier or literal, never a call expression), so every
  // policy name is resolved into a local const first (same convention
  // `loom-db.ts`/`loom-cognito.ts` use throughout their own buildXxx() helpers).
  const executionRoleName = naming.name("exec-role");
  const ecrPullPolicyName = naming.name("ecr-pull-policy");
  const logsPolicyName = naming.name("logs-policy");
  const secretsPolicyName = naming.name("secrets-policy");
  const ecrKmsPolicyName = naming.name("ecr-kms-policy");
  const secretsKmsPolicyName = naming.name("secrets-kms-policy");

  const executionRole = new Role(mergeDefaults({
    RoleName: executionRoleName,
    AssumeRolePolicyDocument: ECS_TASKS_ASSUME_ROLE_POLICY,
    Policies: [
      new Role_Policy({ PolicyName: ecrPullPolicyName, PolicyDocument: ECR_PULL_POLICY_DOCUMENT as unknown as string }),
      new Role_Policy({
        PolicyName: logsPolicyName,
        PolicyDocument: {
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], Resource: [logGroupArn, logGroupArnWildcard] }],
        } as unknown as string,
      }),
      new Role_Policy({
        PolicyName: secretsPolicyName,
        PolicyDocument: {
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["secretsmanager:GetSecretValue"], Resource: secretsManagerResources }],
        } as unknown as string,
      }),
      new Role_Policy({
        PolicyName: ecrKmsPolicyName,
        PolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["kms:Decrypt", "kms:GenerateDataKey"], Resource: props.ecrKmsKeyArn }] } as unknown as string,
      }),
      new Role_Policy({
        PolicyName: secretsKmsPolicyName,
        PolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["kms:Decrypt"], Resource: secretsKmsResources }] } as unknown as string,
      }),
    ],
    Tags: tags,
  }, defs?.executionRole));

  // Scope boundary — see file header. Only what #889 itself needs: the
  // artifact bucket, Cognito group/user lookups, and the DB secret (the
  // application code's own runtime read, distinct from the execution role's
  // container-launch-time Secrets injection above).
  const taskRoleName = naming.name("task-role");
  const artifactBucketPolicyName = naming.name("artifact-bucket-policy");
  const cognitoPolicyName = naming.name("cognito-policy");
  const dbSecretPolicyName = naming.name("db-secret-policy");

  const taskRole = new Role(mergeDefaults({
    RoleName: taskRoleName,
    AssumeRolePolicyDocument: ECS_TASKS_ASSUME_ROLE_POLICY,
    Policies: [
      new Role_Policy({
        PolicyName: artifactBucketPolicyName,
        PolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            { Effect: "Allow", Action: ["s3:GetObject", "s3:PutObject"], Resource: artifactBucketArnWildcard },
            { Effect: "Allow", Action: ["s3:ListBucket"], Resource: artifactBucketArn },
          ],
        } as unknown as string,
      }),
      new Role_Policy({
        PolicyName: cognitoPolicyName,
        PolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: ["cognito-idp:AdminListGroupsForUser", "cognito-idp:ListUsers", "cognito-idp:ListUsersInGroup", "cognito-idp:ListGroups", "cognito-idp:AdminGetUser", "cognito-idp:DescribeUserPool"],
              Resource: cognitoUserPoolArn,
            },
          ],
        } as unknown as string,
      }),
      new Role_Policy({
        PolicyName: dbSecretPolicyName,
        PolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["secretsmanager:GetSecretValue"], Resource: props.databaseSecretArn }] } as unknown as string,
      }),
    ],
    Tags: tags,
  }, defs?.taskRole));

  return { executionRole, taskRole };
}

interface AutoscalingResult {
  scalableTarget: InstanceType<typeof ScalableTarget>;
  scalingPolicy: InstanceType<typeof ApplicationAutoScalingScalingPolicy>;
}

/** `ScalableTarget` + CPU target-tracking `ScalingPolicy` — production/production-ha only (chant#890; light stays at a fixed 1 task, matching Loom's own no-autoscaling default). */
function buildAutoscaling(
  naming: LoomNaming,
  clusterName: string,
  serviceName: string,
  minCapacity: number,
  maxCount: number,
  service: InstanceType<typeof EcsService>,
): AutoscalingResult {
  const resourceId = Sub`service/${clusterName}/${serviceName}`;

  // Explicit DependsOn on the Service — the ResourceId's Fn::Sub already
  // embeds a reference to it (`${backendService.Name}`), which is enough for
  // CloudFormation's own dependency ordering, but chant's WAW030 post-synth
  // check only recognizes a direct Ref/Fn::GetAtt, not a Sub-embedded
  // attribute placeholder, so it flags this as ambiguous — cheap to make
  // explicit either way.
  const scalableTarget = new ScalableTarget(
    {
      ServiceNamespace: "ecs",
      ScalableDimension: "ecs:service:DesiredCount",
      ResourceId: resourceId as unknown as string,
      MinCapacity: minCapacity,
      MaxCapacity: maxCount,
    },
    { DependsOn: [service] },
  );

  const scalingTargetId = Ref(scalableTarget) as unknown as string;
  const scalingPolicyName = naming.name("cpu-scaling");
  const scalingPolicy = new ApplicationAutoScalingScalingPolicy({
    PolicyName: scalingPolicyName,
    PolicyType: "TargetTrackingScaling",
    ScalingTargetId: scalingTargetId,
    TargetTrackingScalingPolicyConfiguration: new ApplicationAutoScalingScalingPolicy_TargetTrackingScalingPolicyConfiguration({
      TargetValue: 70,
      PredefinedMetricSpecification: new ApplicationAutoScalingScalingPolicy_PredefinedMetricSpecification({
        PredefinedMetricType: "ECSServiceAverageCPUUtilization",
      }),
      ScaleInCooldown: 300,
      ScaleOutCooldown: 60,
    }),
  });

  return { scalableTarget, scalingPolicy };
}

/**
 * Every member `LoomBackend` can return. `scalableTarget`/`scalingPolicy`
 * are present only on production/production-ha (chant#890).
 */
export type LoomBackendResult = {
  logsKmsKey: InstanceType<typeof KmsKey>;
  logGroup: InstanceType<typeof LogGroup>;
  executionRole: InstanceType<typeof Role>;
  taskRole: InstanceType<typeof Role>;
  taskDefinition: InstanceType<typeof TaskDefinition>;
  service: InstanceType<typeof EcsService>;
  scalableTarget?: InstanceType<typeof ScalableTarget>;
  scalingPolicy?: InstanceType<typeof ApplicationAutoScalingScalingPolicy>;
};

export const LoomBackend = Composite<LoomBackendProps, LoomBackendResult>((props) => {
  const naming = loomNaming(props.naming, "loom-backend");
  const tier: Tier = props.naming.tier;
  const tags = tagList(naming.tags());
  const { defaults: defs } = props;

  const containerPort = props.containerPort ?? 8000;
  const cpu = props.cpu ?? "1024";
  const memory = props.memory ?? "2048";
  const desiredCount = props.desiredCount ?? (tier === "production-ha" ? 2 : 1);
  const maxCount = props.maxCount ?? 4;
  const logRetentionDays = props.logRetentionDays ?? 30;
  const regionSub = Sub`${AWS.Region}`;
  const cognitoRegion = props.cognitoRegion ?? (regionSub as unknown as string);
  const litellmDiscoveryBaseUrl = props.litellmDiscoveryBaseUrl ?? props.litellmProxyBaseUrl ?? "";

  // ── CloudWatch Logs (dedicated KMS key + log group) ──────────────────
  const { logsKmsKey, logGroup } = buildLogs(naming, tags, logRetentionDays, defs);

  // ── IAM (execution role + task role) ─────────────────────────────────
  const { executionRole, taskRole } = buildRoles(naming, tags, logGroup, props, defs);

  // ── Task definition ───────────────────────────────────────────────────
  const environment: InstanceType<typeof TaskDefinition_KeyValuePair>[] = [
    new TaskDefinition_KeyValuePair({ Name: "AWS_REGION", Value: regionSub as unknown as string }),
    new TaskDefinition_KeyValuePair({ Name: "LOOM_ARTIFACT_BUCKET", Value: props.artifactBucket }),
    new TaskDefinition_KeyValuePair({ Name: "LOOM_COGNITO_USER_POOL_ID", Value: props.cognitoUserPoolId ?? "" }),
    new TaskDefinition_KeyValuePair({ Name: "LOOM_COGNITO_REGION", Value: cognitoRegion }),
    new TaskDefinition_KeyValuePair({ Name: "LOOM_ALLOWED_ORIGINS", Value: props.allowedOrigins ?? "" }),
    new TaskDefinition_KeyValuePair({ Name: "LOOM_REGISTRY_ID", Value: props.registryId ?? "" }),
    new TaskDefinition_KeyValuePair({ Name: "LOOM_LITELLM_PROXY_BASE_URL", Value: props.litellmProxyBaseUrl ?? "" }),
    new TaskDefinition_KeyValuePair({ Name: "LOOM_LITELLM_DISCOVERY_BASE_URL", Value: litellmDiscoveryBaseUrl }),
    new TaskDefinition_KeyValuePair({ Name: "LOG_LEVEL", Value: "info" }),
    // Light tier (#46): LOOM_DATABASE_URL as plain env when the deployable
    // stack pre-built it (Floci doesn't inject Secrets). `LOOM_DATABASE_URL`
    // is not a WAW046 secret-name, so this is lint-clean.
    ...(props.databaseUrlPlain !== undefined
      ? [new TaskDefinition_KeyValuePair({ Name: "LOOM_DATABASE_URL", Value: props.databaseUrlPlain })]
      : []),
  ];

  // Secrets Manager — the default (production) path. LOOM_DATABASE_URL pulls
  // just the "url" key out of loom-db's JSON connection secret, matching Loom's
  // own `!Sub "${pDatabaseSecretArn}:url::"` selector. Omitted on light tier,
  // where the URL is a plain Environment var above (Floci can't inject Secrets).
  const databaseUrlSecretRef = Sub`${props.databaseSecretArn}:url::`;
  const secrets: InstanceType<typeof TaskDefinition_Secret>[] = [
    ...(props.databaseUrlPlain === undefined
      ? [new TaskDefinition_Secret({ Name: "LOOM_DATABASE_URL", ValueFrom: databaseUrlSecretRef as unknown as string })]
      : []),
    ...(props.litellmProxyApiKeySecretArn
      ? [new TaskDefinition_Secret({ Name: "LOOM_LITELLM_PROXY_API_KEY", ValueFrom: props.litellmProxyApiKeySecretArn })]
      : []),
  ];

  const containerDefinition = new TaskDefinition_ContainerDefinition({
    Name: "backend",
    Image: props.imageUri,
    Essential: true,
    // Privileged intentionally omitted (WAW047 — never elevated host access).
    PortMappings: [new TaskDefinition_PortMapping({ ContainerPort: containerPort, Protocol: "tcp" })],
    LogConfiguration: new TaskDefinition_LogConfiguration({
      LogDriver: "awslogs",
      Options: {
        "awslogs-group": Ref(logGroup) as unknown as string,
        "awslogs-region": regionSub as unknown as string,
        "awslogs-stream-prefix": "backend",
      },
    }),
    Environment: environment,
    Secrets: secrets,
  });

  const taskDefinitionFamily = naming.name("backend-task");
  const executionRoleArn = executionRole.Arn as string;
  const taskRoleArn = taskRole.Arn as string;
  const taskDefinition = new TaskDefinition(mergeDefaults({
    Family: taskDefinitionFamily,
    NetworkMode: "awsvpc",
    RequiresCompatibilities: ["FARGATE"],
    Cpu: cpu,
    Memory: memory,
    ExecutionRoleArn: executionRoleArn,
    TaskRoleArn: taskRoleArn,
    ContainerDefinitions: [containerDefinition],
    Tags: tags,
  }, defs?.taskDefinition));

  // ── ECS service ───────────────────────────────────────────────────────
  const awsVpcConfig = new EcsService_AwsVpcConfiguration({
    Subnets: props.privateSubnetIds,
    SecurityGroups: [props.ecsSecurityGroupId],
    AssignPublicIp: "DISABLED",
  });

  const networkConfiguration = new EcsService_NetworkConfiguration({ AwsvpcConfiguration: awsVpcConfig });

  const loadBalancer = new EcsService_LoadBalancer({
    ContainerName: "backend",
    ContainerPort: containerPort,
    TargetGroupArn: props.targetGroupArn,
  });

  const serviceName = naming.name("backend-svc");
  const taskDefinitionArn = taskDefinition.TaskDefinitionArn as string;
  const service = new EcsService(mergeDefaults({
    ServiceName: serviceName,
    Cluster: props.ecsClusterArn,
    TaskDefinition: taskDefinitionArn,
    DesiredCount: desiredCount,
    LaunchType: "FARGATE",
    NetworkConfiguration: networkConfiguration,
    LoadBalancers: [loadBalancer],
    Tags: tags,
  }, defs?.service));

  // ── Autoscaling (production/production-ha only) ─────────────────────
  const minCapacity = tier === "production-ha" ? 2 : 1;
  const serviceNameAttr = service.Name as unknown as string;
  const autoscaling = tier !== "light"
    ? buildAutoscaling(naming, props.ecsClusterName, serviceNameAttr, minCapacity, maxCount, service)
    : undefined;

  return {
    logsKmsKey,
    logGroup,
    executionRole,
    taskRole,
    taskDefinition,
    service,
    ...(autoscaling ?? {}),
  };
}, "LoomBackend");
