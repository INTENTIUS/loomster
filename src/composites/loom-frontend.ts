/**
 * loom-frontend composite (chant#889).
 *
 * Folds Loom's `frontend/iac/ecs.yaml` (v1.6.0) into one composite emitting
 * one CloudFormation stack: a dedicated CloudWatch Logs KMS key + log group,
 * the ECS task execution role, and the Fargate task definition + service.
 * Considerably smaller than `loom-backend` (`./loom-backend.ts`) because
 * Loom's own frontend template is: no task role (the frontend is a static
 * asset server behind the ALB — it calls no AWS APIs of its own), no
 * `Secrets`/`Environment` entries at all, and no autoscaling. Depends on
 * shared-foundation (#886) only — no `loom-db`/`loom-cognito` wiring, unlike
 * the backend. See `../loom-frontend/outputs.ts` for the single
 * `oServiceName` output Loom's own template exposes, and
 * `../components/loom-frontend.component.ts` for how the cross-stack inputs
 * below are actually resolved at deploy time.
 *
 * Every physical name and tag comes from the shared naming helper
 * (`../lib/naming.ts`, chant#897); nothing here is a literal (LOOM001).
 *
 * Tiers (chant#890), param-selected off `naming.tier` with no divergent
 * source: `light`/`production` = 1 task (matches Loom's own `pDesiredCount`
 * default). `production-ha` = 2 tasks, so the service always has headroom
 * across at least 2 AZs — this repo's own tiering convention (Loom's own
 * frontend template has no autoscaling and no tier concept of its own; see
 * the issue's own scope note: "Frontend has no autoscaling in Loom's
 * template").
 *
 * Style note: matches `./loom-backend.ts`'s convention — the CloudWatch Logs
 * KMS key + log group live in a module-level `buildLogs()` helper (identical
 * shape to the backend's own, just without the artifact-bucket wiring the
 * backend also has no equivalent need for on the frontend). No tier-gated
 * resource groups exist here (no autoscaling), so the `Composite()` factory
 * body needs no ternary-invoked helper of its own beyond `buildLogs()`.
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
  TaskDefinition_RuntimePlatform,
  EcsService,
  EcsService_NetworkConfiguration,
  EcsService_AwsVpcConfiguration,
  EcsService_LoadBalancer,
  Ref,
  Sub,
  AWS,
} from "@intentius/chant-lexicon-aws";
import { loomNaming, type LoomNaming, type LoomNamingParams, type Tier } from "../lib/naming";
import type { LogRetentionDays } from "./loom-backend";

// ─────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────

export interface LoomFrontendProps {
  /** Naming/tagging parameter source (chant#897) — one call derives every physical name + tag below. */
  naming: LoomNamingParams;

  // ── Cross-stack wiring (chant#889) ──────────────────────────────────────
  // Plain values here — the Ref()/stackOutput() indirection that actually
  // resolves them at deploy time lives in ../loom-frontend/{params,frontend}.ts
  // and ../components/loom-frontend.component.ts's cfn-deploy inputs.
  /** shared-foundation `oEcsClusterArn`. */
  ecsClusterArn: string;
  /** shared-foundation `oEcsSecurityGroupId`. */
  ecsSecurityGroupId: string;
  /** shared-foundation `oFrontendTargetGroupArn`. */
  targetGroupArn: string;
  /** Published image (build-once, promote-by-digest — `"@Publish.uri"`/`"@Publish.digest"` at the component layer). */
  imageUri: string;

  // ── Network (BYO, chant#886 owns provisioning) ──────────────────────────
  /** Public subnet ids — the frontend task gets a public IP directly (matches Loom's own `AssignPublicIp: ENABLED`); same `LOOM_PUBLIC_SUBNET_IDS` baseline `shared-foundation` reads, not a shared-foundation output (see `../loom-frontend/params.ts`). */
  publicSubnetIds: string[];

  // ── Sizing (chant#890 tier defaults below; all overridable, never hardcoded past the composite boundary) ──
  /** Container port. Default: 8000 (matches Loom). */
  containerPort?: number;
  /**
   * Fargate CPU architecture — must match the built image's arch. Default:
   * `X86_64` (what CI runners build). Set `ARM64` for Apple-Silicon-built
   * images or AWS Graviton. A mismatch makes the container exit immediately on
   * Fargate (exec-format error). See `loom-backend.ts`.
   */
  cpuArchitecture?: "X86_64" | "ARM64";
  /** Default: "256" (0.25 vCPU) — matches Loom's own `pCpu` default. */
  cpu?: string;
  /** Default: "512" (0.5 GB) — matches Loom's own `pMemory` default. */
  memory?: string;
  /** Default: tier-driven (1 on light/production, 2 on production-ha — see file header). */
  desiredCount?: number;
  /** CloudWatch Logs retention. Default: 30 days (matches Loom). */
  logRetentionDays?: LogRetentionDays;

  /** Per-member CloudFormation prop overrides, merged over this composite's defaults. */
  defaults?: {
    logGroup?: Partial<ConstructorParameters<typeof LogGroup>[0]>;
    executionRole?: Partial<ConstructorParameters<typeof Role>[0]>;
    taskDefinition?: Partial<ConstructorParameters<typeof TaskDefinition>[0]>;
    service?: Partial<ConstructorParameters<typeof EcsService>[0]>;
  };
}

type TagList = Array<{ Key: string; Value: string }>;

/** `{ project, env, ... }` tags -> CloudFormation `[{ Key, Value }, ...]` — same convention as every sibling composite. */
function tagList(tags: Record<string, string>): TagList {
  return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
}

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
      // IAM — "*" is the only valid Resource for this action (WAW020 only
      // flags a wildcard *Action*, never a wildcard Resource).
      Resource: "*",
    },
  ],
};

interface LogsResult {
  logsKmsKey: InstanceType<typeof KmsKey>;
  logGroup: InstanceType<typeof LogGroup>;
}

/** Identical shape to `../composites/loom-backend.ts`'s own `buildLogs()` — a dedicated per-service CloudWatch Logs KMS key + log group, matching Loom's own frontend `ecs.yaml`. */
function buildLogs(naming: LoomNaming, tags: TagList, retentionDays: LogRetentionDays, defs: LoomFrontendProps["defaults"]): LogsResult {
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
    Description: "KMS key for the Loom frontend's CloudWatch Logs encryption",
    EnableKeyRotation: true,
    KeyPolicy: keyPolicy,
    Tags: tags,
  });

  const logGroupName = `/ecs/${naming.name("frontend-logs")}`;
  const logsKmsKeyArn = logsKmsKey.Arn as string;
  const logGroup = new LogGroup(mergeDefaults({
    LogGroupName: logGroupName,
    RetentionInDays: retentionDays,
    KmsKeyId: logsKmsKeyArn,
    Tags: tags,
  }, defs?.logGroup));

  return { logsKmsKey, logGroup };
}

export type LoomFrontendResult = {
  logsKmsKey: InstanceType<typeof KmsKey>;
  logGroup: InstanceType<typeof LogGroup>;
  executionRole: InstanceType<typeof Role>;
  taskDefinition: InstanceType<typeof TaskDefinition>;
  service: InstanceType<typeof EcsService>;
};

export const LoomFrontend = Composite<LoomFrontendProps, LoomFrontendResult>((props) => {
  const naming = loomNaming(props.naming, "loom-frontend");
  const tier: Tier = props.naming.tier;
  const tags = tagList(naming.tags());
  const { defaults: defs } = props;

  const containerPort = props.containerPort ?? 8000;
  const cpu = props.cpu ?? "256";
  const memory = props.memory ?? "512";
  const desiredCount = props.desiredCount ?? (tier === "production-ha" ? 2 : 1);
  const logRetentionDays = props.logRetentionDays ?? 30;
  const regionSub = Sub`${AWS.Region}`;

  // ── CloudWatch Logs (dedicated KMS key + log group) ──────────────────
  const { logsKmsKey, logGroup } = buildLogs(naming, tags, logRetentionDays, defs);

  // ── IAM (execution role only — no task role, matches Loom's own template) ──
  const logGroupArn = logGroup.Arn as string;
  const logGroupArnWildcard = Sub`${logGroupArn}:*`;
  const executionRoleName = naming.name("exec-role");
  const executionRole = new Role(mergeDefaults({
    RoleName: executionRoleName,
    AssumeRolePolicyDocument: ECS_TASKS_ASSUME_ROLE_POLICY,
    Policies: [
      new Role_Policy({ PolicyName: naming.name("ecr-pull-policy"), PolicyDocument: ECR_PULL_POLICY_DOCUMENT as unknown as string }),
      new Role_Policy({
        PolicyName: naming.name("logs-policy"),
        PolicyDocument: {
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], Resource: [logGroupArn, logGroupArnWildcard] }],
        } as unknown as string,
      }),
    ],
    Tags: tags,
  }, defs?.executionRole));

  // ── Task definition ───────────────────────────────────────────────────
  const containerDefinition = new TaskDefinition_ContainerDefinition({
    Name: "frontend",
    Image: props.imageUri,
    Essential: true,
    // Privileged intentionally omitted (WAW047 — never elevated host access).
    PortMappings: [new TaskDefinition_PortMapping({ ContainerPort: containerPort, Protocol: "tcp" })],
    LogConfiguration: new TaskDefinition_LogConfiguration({
      LogDriver: "awslogs",
      Options: {
        "awslogs-group": Ref(logGroup) as unknown as string,
        "awslogs-region": regionSub as unknown as string,
        "awslogs-stream-prefix": "frontend",
      },
    }),
  });

  const taskDefinitionFamily = naming.name("frontend-task");
  const executionRoleArn = executionRole.Arn as string;
  const runtimePlatform = new TaskDefinition_RuntimePlatform({
    CpuArchitecture: props.cpuArchitecture ?? "X86_64",
    OperatingSystemFamily: "LINUX",
  });
  const taskDefinition = new TaskDefinition(mergeDefaults({
    Family: taskDefinitionFamily,
    NetworkMode: "awsvpc",
    RequiresCompatibilities: ["FARGATE"],
    RuntimePlatform: runtimePlatform,
    Cpu: cpu,
    Memory: memory,
    ExecutionRoleArn: executionRoleArn,
    ContainerDefinitions: [containerDefinition],
    Tags: tags,
  }, defs?.taskDefinition));

  // ── ECS service ───────────────────────────────────────────────────────
  const awsVpcConfig = new EcsService_AwsVpcConfiguration({
    Subnets: props.publicSubnetIds,
    SecurityGroups: [props.ecsSecurityGroupId],
    AssignPublicIp: "ENABLED",
  });

  const networkConfiguration = new EcsService_NetworkConfiguration({ AwsvpcConfiguration: awsVpcConfig });

  const loadBalancer = new EcsService_LoadBalancer({
    ContainerName: "frontend",
    ContainerPort: containerPort,
    TargetGroupArn: props.targetGroupArn,
  });

  const serviceName = naming.name("frontend-svc");
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

  return { logsKmsKey, logGroup, executionRole, taskDefinition, service };
}, "LoomFrontend");
