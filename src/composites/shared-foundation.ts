/**
 * shared-foundation composite (chant#886).
 *
 * Folds Loom's `shared/iac/{infra,dns,security_group,privatelink,ecs,role}.yaml`
 * (v1.6.0) into one composite emitting one CloudFormation stack: the ALB +
 * listener/rules/target-groups, ACM cert, Route53 zone + record, KMS key,
 * S3 artifact bucket, 2 ECR repos, security groups, ECS cluster, PrivateLink
 * VPCEndpointService, and the agent IAM role. Every service/agent Loom
 * deploys depends on this stack's outputs (`stackOutput("shared-foundation",
 * "<key>")` — see src/shared-foundation/outputs.ts for the exact key list).
 *
 * Decomposition is chant's, not Loom's — no 1:1 mapping to Loom's SAM-file
 * split. Every physical name and tag comes from the shared naming helper
 * (`../lib/naming.ts`, chant#897); nothing here is a literal (LOOM001).
 *
 * Seams (chant#898): network, KMS, ACM, Route53, ECR, and the agent IAM role
 * each expose `provision | reference-existing` (KMS/ACM/Route53/ECR/agent
 * role additionally expose `omit`). Reference-existing threads the given
 * id/ARN straight through with no other code path change. PrivateLink and
 * the ACM/Route53 custom domain are gated to the `production`/
 * `production-ha` tiers (chant#890) — `light` runs ALB DNS + HTTP only.
 *
 * Style note: each seam's resource creation lives in its own module-level
 * `buildXxx()` helper below, invoked with a ternary at the call site (never
 * an `if` wrapping a resource constructor) — chant's EVL002 requires
 * resources to be reachable without control flow. Each helper returns only
 * Declarable members (spread straight into this composite's return value);
 * any scalar derived from them (an ARN, a Ref) is computed back in the
 * factory body proper.
 */

import { Composite, mergeDefaults } from "@intentius/chant";
import type { Declarable } from "@intentius/chant/declarable";
import {
  Vpc,
  Subnet,
  InternetGateway,
  VPCGatewayAttachment,
  RouteTable,
  EC2Route,
  SubnetRouteTableAssociation,
  Select,
  GetAZs,
  LoadBalancer,
  Listener,
  Listener_Action,
  Listener_Certificate,
  ListenerRule,
  ListenerRule_Action,
  ListenerRule_RuleCondition,
  ListenerRule_PathPatternConfig,
  TargetGroup,
  AcmCertificate,
  AcmCertificate_DomainValidationOption,
  HostedZone,
  HostedZone_HostedZoneConfig,
  RecordSet,
  RecordSet_AliasTarget,
  KmsKey,
  KMSAlias,
  Bucket,
  Bucket_BucketEncryption,
  Bucket_ServerSideEncryptionRule,
  Bucket_ServerSideEncryptionByDefault,
  Bucket_PublicAccessBlockConfiguration,
  Bucket_LoggingConfiguration,
  Bucket_LifecycleConfiguration,
  Bucket_Rule,
  Bucket_NoncurrentVersionExpiration,
  ECRRepository,
  ECRRepository_EncryptionConfiguration,
  ECRRepository_ImageScanningConfiguration,
  ECRRepository_LifecyclePolicy,
  SecurityGroup,
  SecurityGroup_Ingress,
  VPCEndpointService,
  EcsCluster,
  EcsCluster_ClusterSettings,
  EcsCluster_CapacityProviderStrategyItem,
  Role,
  Role_Policy,
  Ref,
  Sub,
  SubIntrinsic,
  AWS,
  ECRActions,
  LogsActions,
} from "@intentius/chant-lexicon-aws";
import { loomNaming, type LoomNaming, type LoomNamingParams } from "../lib/naming";

// ─────────────────────────────────────────────────────────────────────────
// Seams (chant#898) — each area independently provisioned, referenced, or
// omitted. `mode` defaults to "provision" everywhere it is optional, so the
// composite is fully self-standing with no other props set.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Network is BYO by default (Loom's own `infra.yaml` only ever takes the VPC
 * as a parameter — it never creates one). `reference-existing` is the
 * first-class path; `provision` is the opt-in, useful for a from-scratch
 * light-tier/local deploy. There is no "omit" — the ALB, ECS tasks, and
 * security groups all need a VPC to live in.
 */
export type NetworkSeam =
  | { mode: "reference-existing"; vpcId: string; publicSubnetIds: string[]; privateSubnetIds?: string[] }
  | { mode: "provision"; cidr?: string };

export type KmsSeam =
  | { mode?: "provision" }
  | { mode: "reference-existing"; kmsKeyArn: string }
  | { mode: "omit" };

export type AcmSeam =
  | { mode?: "provision" }
  | { mode: "reference-existing"; certificateArn: string }
  | { mode: "omit" };

export type Route53Seam =
  | { mode?: "provision" }
  | { mode: "reference-existing"; hostedZoneId: string }
  | { mode: "omit" };

export type EcrSeam =
  | { mode?: "provision" }
  | {
      mode: "reference-existing";
      frontendRepositoryUri: string;
      frontendRepositoryArn: string;
      backendRepositoryUri: string;
      backendRepositoryArn: string;
    }
  | { mode: "omit" };

/**
 * The Bedrock AgentCore execution role (Loom's `role.yaml`). Scoped here to
 * what this composite itself creates (artifact bucket, ECR KMS key, logs) —
 * the full agent-runtime permission set (Bedrock model invoke, AgentCore
 * workload identity, Secrets Manager, memory, code interpreter) belongs to
 * the agent-runtime composite (chant#893), out of scope for shared-foundation.
 */
export type AgentRoleSeam =
  | { mode?: "provision"; bedrockModelArns?: string[] }
  | { mode: "reference-existing"; agentRoleArn: string }
  | { mode: "omit" };

export interface SharedFoundationProps {
  /** Naming/tagging parameter source (chant#897) — one call derives every physical name + tag below. */
  naming: LoomNamingParams;

  network: NetworkSeam;

  /** CIDR allowed to reach the ALB. Default: 0.0.0.0/0 (public HTTPS/HTTP entrypoint — matches Loom's own default posture). */
  albIngressCidr?: string;
  /** Port the frontend/backend containers listen on behind the ALB. Default: 8000 (matches Loom). */
  frontendPort?: number;
  backendPort?: number;
  /** Path patterns routed to the backend target group. Default: ["/api/*", "/health"] (matches Loom). */
  backendPathPatterns?: string[];

  /**
   * Custom domain name (e.g. "loom.example.com"). Required when the tier is
   * `production`/`production-ha` unless both `acm` and `route53` are
   * `{ mode: "omit" }`. Unused on `light` (ALB DNS + HTTP only).
   */
  domainName?: string;
  acm?: AcmSeam;
  route53?: Route53Seam;

  kms?: KmsSeam;
  ecr?: EcrSeam;
  agentRole?: AgentRoleSeam;

  /**
   * PrivateLink (Loom's `privatelink.yaml`) — production/production-ha only.
   * Needs private subnets to place the NLB in; when network is provisioned,
   * the composite's own private subnets are used automatically. When network
   * is reference-existing, pass `network.privateSubnetIds` (used here too).
   */
  privateLink?: {
    /** Port the AgentCore Runtime (or equivalent) listens on behind the NLB. Default: 443. */
    agentRuntimePort?: number;
  };

  /** Pre-existing S3 bucket for ALB/NLB access logs and artifact-bucket server access logs. Always reference-existing — Loom never creates this bucket itself. Omit to skip access logging entirely (e.g. light tier / local synth). */
  loggingBucketName?: string;

  /** Per-member CloudFormation prop overrides, merged over this composite's defaults. */
  defaults?: {
    albSg?: Partial<ConstructorParameters<typeof SecurityGroup>[0]>;
    ecsSg?: Partial<ConstructorParameters<typeof SecurityGroup>[0]>;
    alb?: Partial<ConstructorParameters<typeof LoadBalancer>[0]>;
    httpsListener?: Partial<ConstructorParameters<typeof Listener>[0]>;
    frontendTargetGroup?: Partial<ConstructorParameters<typeof TargetGroup>[0]>;
    backendTargetGroup?: Partial<ConstructorParameters<typeof TargetGroup>[0]>;
    artifactBucket?: Partial<ConstructorParameters<typeof Bucket>[0]>;
    ecsCluster?: Partial<ConstructorParameters<typeof EcsCluster>[0]>;
  };
}

type TagList = Array<{ Key: string; Value: string }>;

/** `{ project, env, ... }` tags → CloudFormation `[{ Key, Value }, ...]`. Every resource type below models Tags identically at the JSON level, so one plain array works for all of them (no per-type `_Tag` wrapper needed). */
function tagList(tags: Record<string, string>): TagList {
  return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
}

/**
 * Wrap a plain, already-known-at-author-time string (e.g. a reference-existing
 * ARN threaded straight through from props, or a literal like a domain name)
 * so it can safely be passed to the aws lexicon's `output(ref, name)` helper.
 *
 * `output()` handles an `AttrRef` (a resource attribute) or an `Intrinsic`
 * (e.g. `Ref(someResource)`) correctly, but a bare JS string is not resolved
 * to a valid `Value` at synthesis — wrapping it in an `Fn::Sub` with no
 * `${...}` placeholders round-trips it as the literal value CloudFormation
 * ultimately needs, with no other code path change for reference-existing
 * mode (chant#898's "zero source edits" requirement).
 */
export function literalOutputValue(value: string): SubIntrinsic {
  return new SubIntrinsic(["", ""], [value]);
}

/** Loom's ECR lifecycle policy (keep the last 10 images) — identical for both repos. Hoisted to a module-level constant so `buildEcrRepos` only ever references it by name (EVL001: resource constructor properties must be statically evaluable). */
const ECR_LIFECYCLE_POLICY_TEXT = JSON.stringify({
  rules: [
    {
      rulePriority: 1,
      description: "Keep last 10 images",
      selection: { tagStatus: "any", countType: "imageCountMoreThan", countNumber: 10 },
      action: { type: "expire" },
    },
  ],
});

// ─────────────────────────────────────────────────────────────────────────
// Per-seam resource builders. Each is a plain module-level function (not
// nested in the Composite() factory below) so it can be invoked with a
// ternary — `mode === "provision" ? buildX(...) : undefined` — instead of an
// `if` wrapping a resource constructor.
// ─────────────────────────────────────────────────────────────────────────

function buildProvisionedNetwork(cidr: string | undefined, tags: TagList) {
  const resolvedCidr = cidr ?? "10.0.0.0/16";
  const az1 = Select(0, GetAZs(""));
  const az2 = Select(1, GetAZs(""));

  const vpc = new Vpc({
    CidrBlock: resolvedCidr,
    EnableDnsSupport: true,
    EnableDnsHostnames: true,
    Tags: tags,
  });

  const igw = new InternetGateway({ Tags: tags });

  const igwAttachment = new VPCGatewayAttachment({
    VpcId: vpc.VpcId,
    InternetGatewayId: igw.InternetGatewayId,
  });

  const publicSubnet1 = new Subnet({
    VpcId: vpc.VpcId,
    CidrBlock: "10.0.0.0/20",
    AvailabilityZone: az1,
    MapPublicIpOnLaunch: true,
    Tags: tags,
  });

  const publicSubnet2 = new Subnet({
    VpcId: vpc.VpcId,
    CidrBlock: "10.0.16.0/20",
    AvailabilityZone: az2,
    MapPublicIpOnLaunch: true,
    Tags: tags,
  });

  const publicRouteTable = new RouteTable({ VpcId: vpc.VpcId, Tags: tags });

  const publicRoute = new EC2Route(
    { RouteTableId: publicRouteTable.RouteTableId, DestinationCidrBlock: "0.0.0.0/0", GatewayId: igw.InternetGatewayId },
    { DependsOn: [igwAttachment] },
  );

  const publicRta1 = new SubnetRouteTableAssociation({
    SubnetId: publicSubnet1.SubnetId,
    RouteTableId: publicRouteTable.RouteTableId,
  });

  const publicRta2 = new SubnetRouteTableAssociation({
    SubnetId: publicSubnet2.SubnetId,
    RouteTableId: publicRouteTable.RouteTableId,
  });

  return { vpc, igw, igwAttachment, publicSubnet1, publicSubnet2, publicRouteTable, publicRoute, publicRta1, publicRta2 };
}

// Account root + ECR service grant on the ECR encryption key — identical for
// every SharedFoundation instance, so this is a module-level const (not
// per-call), same reasoning as ECR_LIFECYCLE_POLICY_TEXT above.
export const ECR_KMS_KEY_POLICY = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "AllowAccountAdmin",
      Effect: "Allow",
      Principal: { AWS: Sub`arn:${AWS.Partition}:iam::${AWS.AccountId}:root` },
      Action: "kms:*",
      Resource: "*",
    },
    {
      Sid: "AllowECRService",
      Effect: "Allow",
      Principal: { Service: "ecr.amazonaws.com" },
      Action: ["kms:GenerateDataKey", "kms:Decrypt"],
      Resource: "*",
    },
  ],
};

function buildKms(naming: LoomNaming, tags: TagList) {
  const aliasName = `alias/${naming.name("ecr")}`;

  const kmsKey = new KmsKey({
    Description: "KMS key for ECR repository encryption",
    EnableKeyRotation: true,
    KeyPolicy: ECR_KMS_KEY_POLICY,
    Tags: tags,
  });

  const kmsAlias = new KMSAlias({ AliasName: aliasName, TargetKeyId: kmsKey.KeyId });

  return { kmsKey, kmsAlias };
}

function buildEcrRepos(naming: LoomNaming, tags: TagList, kmsArn: string | undefined) {
  const frontendRepoName = naming.name("frontend", { service: "ecrRepo" });
  const backendRepoName = naming.name("backend", { service: "ecrRepo" });
  const encryptionConfiguration = kmsArn
    ? new ECRRepository_EncryptionConfiguration({ EncryptionType: "KMS", KmsKey: kmsArn })
    : undefined;
  const imageScanningConfiguration = new ECRRepository_ImageScanningConfiguration({ ScanOnPush: true });
  const lifecyclePolicy = new ECRRepository_LifecyclePolicy({ LifecyclePolicyText: ECR_LIFECYCLE_POLICY_TEXT });

  const frontendRepo = new ECRRepository({
    RepositoryName: frontendRepoName,
    ImageTagMutability: "IMMUTABLE",
    EncryptionConfiguration: encryptionConfiguration,
    ImageScanningConfiguration: imageScanningConfiguration,
    LifecyclePolicy: lifecyclePolicy,
    Tags: tags,
  });

  const backendRepo = new ECRRepository({
    RepositoryName: backendRepoName,
    ImageTagMutability: "IMMUTABLE",
    EncryptionConfiguration: encryptionConfiguration,
    ImageScanningConfiguration: imageScanningConfiguration,
    LifecyclePolicy: lifecyclePolicy,
    Tags: tags,
  });

  return { frontendRepo, backendRepo };
}

function buildHostedZone(domainName: string, tags: TagList) {
  const comment = `Loom subdomain hosted zone for ${domainName}`;
  const hostedZone = new HostedZone({
    Name: domainName,
    HostedZoneConfig: new HostedZone_HostedZoneConfig({ Comment: comment }),
    HostedZoneTags: tags,
  });
  return { hostedZone };
}

function buildCertificate(domainName: string, hostedZoneRef: string, tags: TagList) {
  const certificate = new AcmCertificate({
    DomainName: domainName,
    ValidationMethod: "DNS",
    DomainValidationOptions: [
      new AcmCertificate_DomainValidationOption({ DomainName: domainName, HostedZoneId: hostedZoneRef }),
    ],
    Tags: tags,
  });
  return { certificate };
}

function buildDnsRecord(hostedZoneRef: string, domainName: string, albDnsName: string, albCanonicalHostedZoneId: string) {
  const dnsRecord = new RecordSet({
    HostedZoneId: hostedZoneRef,
    Name: domainName,
    Type: "A",
    AliasTarget: new RecordSet_AliasTarget({ DNSName: albDnsName, HostedZoneId: albCanonicalHostedZoneId }),
  });
  return { dnsRecord };
}

function buildPrivateLink(
  naming: LoomNaming,
  tags: TagList,
  vpcId: string,
  privateSubnetIds: string[],
  agentRuntimePort: number,
  loggingBucketName: string | undefined,
) {
  const nlbName = naming.name("nlb", { service: "alb" });
  const nlbTargetGroupName = naming.name("nlb-tg", { service: "targetGroup" });
  const agentRuntimePortString = `${agentRuntimePort}`;

  // Built with push(), not [...spread], so this stays outside chant's
  // EVL004 (spreads must trace to a module-level const; loggingBucketName
  // is a per-call parameter, not a fixed one).
  const nlbAttributes: TagList = [{ Key: "load_balancing.cross_zone.enabled", Value: "true" }];
  if (loggingBucketName) {
    nlbAttributes.push(
      { Key: "access_logs.s3.enabled", Value: "true" },
      { Key: "access_logs.s3.bucket", Value: loggingBucketName },
      { Key: "access_logs.s3.prefix", Value: "nlb" },
    );
  }

  const nlb = new LoadBalancer({
    Name: nlbName,
    Type: "network",
    Scheme: "internal",
    Subnets: privateSubnetIds,
    LoadBalancerAttributes: nlbAttributes,
    Tags: tags,
  });

  const nlbTargetGroup = new TargetGroup({
    Name: nlbTargetGroupName,
    VpcId: vpcId,
    Protocol: "TCP",
    Port: agentRuntimePort,
    TargetType: "ip",
    HealthCheckProtocol: "TCP",
    HealthCheckPort: agentRuntimePortString,
    HealthCheckIntervalSeconds: 30,
    HealthyThresholdCount: 3,
    UnhealthyThresholdCount: 3,
    Tags: tags,
  });

  const nlbListener = new Listener({
    LoadBalancerArn: nlb.LoadBalancerArn,
    Protocol: "TCP",
    Port: agentRuntimePort,
    DefaultActions: [new Listener_Action({ Type: "forward", TargetGroupArn: nlbTargetGroup.TargetGroupArn })],
  });

  const vpcEndpointService = new VPCEndpointService({
    NetworkLoadBalancerArns: [nlb.LoadBalancerArn],
    AcceptanceRequired: false,
    Tags: tags,
  });

  return { nlb, nlbTargetGroup, nlbListener, vpcEndpointService };
}

function buildAgentRole(
  naming: LoomNaming,
  tags: TagList,
  bedrockModelArns: string[],
  ecrKmsKeyArn: string | undefined,
  artifactBucketArn: string,
) {
  const roleName = naming.name("agent-role");
  const policyName = naming.name("agent-policy");

  // Plain array construction, not a resource constructor — chant's
  // EVL001/EVL002 only govern `new Xxx(...)` calls, so building this
  // conditionally with ordinary pushes is fine.
  const statements: Record<string, unknown>[] = [
    {
      Effect: "Allow",
      Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      Resource: bedrockModelArns,
    },
    { Effect: "Allow", Action: ECRActions.Pull, Resource: "*" },
    { Effect: "Allow", Action: LogsActions.Write, Resource: "*" },
    {
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
      Resource: [artifactBucketArn, `${artifactBucketArn}/*`],
    },
  ];
  if (ecrKmsKeyArn) {
    statements.push({ Effect: "Allow", Action: ["kms:Decrypt", "kms:GenerateDataKey"], Resource: ecrKmsKeyArn });
  }

  const assumeRolePolicyDocument = {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Principal: { Service: "bedrock-agentcore.amazonaws.com" }, Action: "sts:AssumeRole" },
    ],
  };
  const policyDocument = { Version: "2012-10-17", Statement: statements };

  const agentRole = new Role({
    RoleName: roleName,
    AssumeRolePolicyDocument: assumeRolePolicyDocument,
    Policies: [new Role_Policy({ PolicyName: policyName, PolicyDocument: policyDocument as unknown as string })],
    Tags: tags,
  });

  return { agentRole };
}

/**
 * Every member `SharedFoundation` can return. Only the ALB/listener/target-
 * groups/security-groups/artifact-bucket/ECS-cluster are unconditional —
 * everything else is present or absent depending on the seam mode and tier,
 * hence optional here (same shape as `VpcDefaultResult`'s `publicSubnet3?`
 * pattern in the aws lexicon's own composites).
 */
export type SharedFoundationResult = {
  albSg: InstanceType<typeof SecurityGroup>;
  ecsSg: InstanceType<typeof SecurityGroup>;
  alb: InstanceType<typeof LoadBalancer>;
  frontendTargetGroup: InstanceType<typeof TargetGroup>;
  backendTargetGroup: InstanceType<typeof TargetGroup>;
  httpsListener: InstanceType<typeof Listener>;
  backendListenerRule: InstanceType<typeof ListenerRule>;
  artifactBucket: InstanceType<typeof Bucket>;
  ecsCluster: InstanceType<typeof EcsCluster>;

  // Network — present only when network.mode is "provision" (light tier only).
  vpc?: InstanceType<typeof Vpc>;
  igw?: InstanceType<typeof InternetGateway>;
  igwAttachment?: InstanceType<typeof VPCGatewayAttachment>;
  publicSubnet1?: InstanceType<typeof Subnet>;
  publicSubnet2?: InstanceType<typeof Subnet>;
  publicRouteTable?: InstanceType<typeof RouteTable>;
  publicRoute?: InstanceType<typeof EC2Route>;
  publicRta1?: InstanceType<typeof SubnetRouteTableAssociation>;
  publicRta2?: InstanceType<typeof SubnetRouteTableAssociation>;

  // KMS — present when kms.mode is "provision" (default).
  kmsKey?: InstanceType<typeof KmsKey>;
  kmsAlias?: InstanceType<typeof KMSAlias>;

  // ECR — present when ecr.mode is "provision" (default).
  frontendRepo?: InstanceType<typeof ECRRepository>;
  backendRepo?: InstanceType<typeof ECRRepository>;

  // Route53 / ACM — present on production/production-ha with provision mode.
  hostedZone?: InstanceType<typeof HostedZone>;
  certificate?: InstanceType<typeof AcmCertificate>;
  dnsRecord?: InstanceType<typeof RecordSet>;

  // PrivateLink — present on production/production-ha only.
  nlb?: InstanceType<typeof LoadBalancer>;
  nlbTargetGroup?: InstanceType<typeof TargetGroup>;
  nlbListener?: InstanceType<typeof Listener>;
  vpcEndpointService?: InstanceType<typeof VPCEndpointService>;

  // Agent IAM role — present when agentRole.mode is "provision" (default).
  agentRole?: InstanceType<typeof Role>;
};

export const SharedFoundation = Composite<SharedFoundationProps, SharedFoundationResult>((props) => {
  const naming = loomNaming(props.naming, "shared-foundation");
  const tier = props.naming.tier;
  const fullTier = tier !== "light";
  const tags = tagList(naming.tags());
  const { defaults: defs } = props;

  // ── Network ──────────────────────────────────────────────────────────
  // Reference-existing is first-class (the platform team hands over a VPC);
  // provision is the light/local opt-in only — it builds 2 public subnets
  // and nothing else, so it cannot back PrivateLink (which needs private
  // subnets). Bring your own VPC for production/production-ha. Errors are
  // constructed unconditionally and thrown conditionally (EVL002 governs
  // `new` expressions, not `throw` statements).
  const notEnoughSubnetsError = new Error(
    "SharedFoundation: network.publicSubnetIds needs at least 2 subnets (across 2 AZs) for the ALB",
  );
  if (props.network.mode === "reference-existing" && props.network.publicSubnetIds.length < 2) {
    throw notEnoughSubnetsError;
  }
  const provisionNeedsLightTierError = new Error(
    "SharedFoundation: network.mode \"provision\" only supports the light tier (2 public subnets, no NAT/private subnets). " +
    "Bring your own VPC (network.mode \"reference-existing\") for production/production-ha.",
  );
  if (props.network.mode === "provision" && tier !== "light") {
    throw provisionNeedsLightTierError;
  }

  const provisionedNetwork = props.network.mode === "provision" ? buildProvisionedNetwork(props.network.cidr, tags) : undefined;

  const vpcId = props.network.mode === "reference-existing" ? props.network.vpcId : provisionedNetwork!.vpc.VpcId;
  const publicSubnetIds = props.network.mode === "reference-existing"
    ? props.network.publicSubnetIds
    : [provisionedNetwork!.publicSubnet1.SubnetId, provisionedNetwork!.publicSubnet2.SubnetId];
  const privateSubnetIds = props.network.mode === "reference-existing" ? props.network.privateSubnetIds : undefined;

  // ── Tier-driven ALB posture ──────────────────────────────────────────
  const albListenerPort = fullTier ? 443 : 80;
  const albProtocol: "HTTP" | "HTTPS" = fullTier ? "HTTPS" : "HTTP";
  const frontendPort = props.frontendPort ?? 8000;
  const backendPort = props.backendPort ?? 8000;
  const backendPathPatterns = props.backendPathPatterns ?? ["/api/*", "/health"];
  const albIngressCidr = props.albIngressCidr ?? "0.0.0.0/0";

  // ── Security groups (infra.yaml AlbSecurityGroup / EcsSecurityGroup) ──
  const albSg = new SecurityGroup(mergeDefaults({
    GroupDescription: `Allow inbound ${albProtocol} traffic to the ALB`,
    GroupName: naming.name("alb-sg"),
    VpcId: vpcId,
    SecurityGroupIngress: [
      new SecurityGroup_Ingress({
        IpProtocol: "tcp",
        FromPort: albListenerPort,
        ToPort: albListenerPort,
        CidrIp: albIngressCidr,
        Description: `Allow inbound ${albProtocol} from allowed clients`,
      }),
    ],
    Tags: tags,
  }, defs?.albSg));

  const ecsSg = new SecurityGroup(mergeDefaults({
    GroupDescription: "Allow inbound traffic from ALB to ECS tasks",
    GroupName: naming.name("ecs-sg"),
    VpcId: vpcId,
    SecurityGroupIngress: [
      new SecurityGroup_Ingress({
        IpProtocol: "tcp",
        FromPort: frontendPort,
        ToPort: frontendPort,
        SourceSecurityGroupId: albSg.GroupId,
        Description: "Allow inbound traffic from the ALB security group",
      }),
    ],
    Tags: tags,
  }, defs?.ecsSg));

  // ── KMS (ECR encryption key) ──────────────────────────────────────────
  const kmsMode = props.kms?.mode ?? "provision";
  const kms = kmsMode === "provision" ? buildKms(naming, tags) : undefined;
  const ecrKmsKeyArn =
    kms ? (kms.kmsKey.Arn as string)
    : kmsMode === "reference-existing" && props.kms?.mode === "reference-existing" ? props.kms.kmsKeyArn
    : undefined;

  // ── ECR (2 repos: frontend / backend) ────────────────────────────────
  const ecrMode = props.ecr?.mode ?? "provision";
  const ecr = ecrMode === "provision" ? buildEcrRepos(naming, tags, ecrKmsKeyArn) : undefined;

  // ── Route53 zone + ACM certificate (full tier only) ──────────────────
  const route53Mode = props.route53?.mode ?? "provision";
  const acmMode = props.acm?.mode ?? "provision";

  const domainNameRequiredError = new Error(
    "SharedFoundation: domainName is required on production/production-ha tiers unless route53 and acm are both omitted",
  );
  if (fullTier && route53Mode !== "omit" && !props.domainName) {
    throw domainNameRequiredError;
  }

  const hostedZoneResult = fullTier && route53Mode === "provision"
    ? buildHostedZone(props.domainName as string, tags)
    : undefined;

  // Ref(...)/AttrRef masquerade as `string` here, same convention as every
  // attribute accessor elsewhere in this file (e.g. `alb.DNSName`).
  const hostedZoneRef =
    hostedZoneResult ? (Ref(hostedZoneResult.hostedZone) as unknown as string)
    : fullTier && route53Mode === "reference-existing" && props.route53?.mode === "reference-existing" ? props.route53.hostedZoneId
    : undefined;

  const certificateResult = fullTier && acmMode === "provision" && hostedZoneRef !== undefined
    ? buildCertificate(props.domainName as string, hostedZoneRef, tags)
    : undefined;

  const certificateArn =
    certificateResult ? (Ref(certificateResult.certificate) as unknown as string)
    : fullTier && acmMode === "reference-existing" && props.acm?.mode === "reference-existing" ? props.acm.certificateArn
    : undefined;

  // ── Application Load Balancer + listener + target groups ────────────
  const alb = new LoadBalancer(mergeDefaults({
    Name: naming.name("alb", { service: "alb" }),
    Scheme: "internet-facing",
    Type: "application",
    Subnets: publicSubnetIds,
    SecurityGroups: [albSg.GroupId],
    LoadBalancerAttributes: [
      { Key: "idle_timeout.timeout_seconds", Value: "300" },
      { Key: "routing.http.drop_invalid_header_fields.enabled", Value: "true" },
      ...(props.loggingBucketName
        ? [
            { Key: "access_logs.s3.enabled", Value: "true" },
            { Key: "access_logs.s3.bucket", Value: props.loggingBucketName },
            { Key: "access_logs.s3.prefix", Value: "alb" },
          ]
        : []),
    ],
    Tags: tags,
  }, defs?.alb));

  const frontendTargetGroup = new TargetGroup(mergeDefaults({
    Name: naming.name("fe-tg", { service: "targetGroup" }),
    VpcId: vpcId,
    Protocol: "HTTP",
    Port: frontendPort,
    TargetType: "ip",
    HealthCheckPath: "/",
    HealthCheckIntervalSeconds: 60,
    HealthyThresholdCount: 2,
    UnhealthyThresholdCount: 3,
    HealthCheckTimeoutSeconds: 5,
    Tags: tags,
  }, defs?.frontendTargetGroup));

  const backendTargetGroup = new TargetGroup(mergeDefaults({
    Name: naming.name("be-tg", { service: "targetGroup" }),
    VpcId: vpcId,
    Protocol: "HTTP",
    Port: backendPort,
    TargetType: "ip",
    HealthCheckPath: "/health",
    HealthCheckIntervalSeconds: 60,
    HealthyThresholdCount: 2,
    UnhealthyThresholdCount: 3,
    HealthCheckTimeoutSeconds: 5,
    TargetGroupAttributes: [{ Key: "deregistration_delay.timeout_seconds", Value: "300" }],
    Tags: tags,
  }, defs?.backendTargetGroup));

  const httpsListener = new Listener(mergeDefaults({
    LoadBalancerArn: alb.LoadBalancerArn,
    Port: albListenerPort,
    Protocol: albProtocol,
    DefaultActions: [
      new Listener_Action({ Type: "forward", TargetGroupArn: frontendTargetGroup.TargetGroupArn }),
    ],
    ...(albProtocol === "HTTPS" && certificateArn
      ? {
          Certificates: [new Listener_Certificate({ CertificateArn: certificateArn })],
          SslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
        }
      : {}),
  }, defs?.httpsListener));

  const backendListenerRule = new ListenerRule({
    ListenerArn: httpsListener.ListenerArn,
    Priority: 1,
    Conditions: [
      new ListenerRule_RuleCondition({
        Field: "path-pattern",
        PathPatternConfig: new ListenerRule_PathPatternConfig({ Values: backendPathPatterns }),
      }),
    ],
    Actions: [
      new ListenerRule_Action({ Type: "forward", TargetGroupArn: backendTargetGroup.TargetGroupArn }),
    ],
  });

  // ── Route53 alias record for the ALB (full tier only) ────────────────
  const dnsRecordResult = fullTier && route53Mode !== "omit" && hostedZoneRef !== undefined
    ? buildDnsRecord(hostedZoneRef, props.domainName as string, alb.DNSName, alb.CanonicalHostedZoneID)
    : undefined;

  // ── S3 artifact bucket ────────────────────────────────────────────────
  const artifactBucket = new Bucket(mergeDefaults({
    BucketName: naming.name("artifacts", { service: "s3Bucket" }),
    VersioningConfiguration: { Status: "Enabled" },
    BucketEncryption: new Bucket_BucketEncryption({
      ServerSideEncryptionConfiguration: [
        new Bucket_ServerSideEncryptionRule({
          ServerSideEncryptionByDefault: new Bucket_ServerSideEncryptionByDefault({ SSEAlgorithm: "AES256" }),
        }),
      ],
    }),
    PublicAccessBlockConfiguration: new Bucket_PublicAccessBlockConfiguration({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    }),
    LoggingConfiguration: props.loggingBucketName
      ? new Bucket_LoggingConfiguration({
          DestinationBucketName: props.loggingBucketName,
          LogFilePrefix: "artifact-bucket/",
        })
      : undefined,
    LifecycleConfiguration: new Bucket_LifecycleConfiguration({
      Rules: [
        new Bucket_Rule({
          Status: "Enabled",
          NoncurrentVersionExpiration: new Bucket_NoncurrentVersionExpiration({ NoncurrentDays: 90 }),
        }),
      ],
    }),
    Tags: tags,
  }, defs?.artifactBucket), { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" });

  // ── ECS cluster (shared by frontend/backend services) ────────────────
  const ecsCluster = new EcsCluster(mergeDefaults({
    ClusterName: naming.name("cluster"),
    CapacityProviders: ["FARGATE", "FARGATE_SPOT"],
    DefaultCapacityProviderStrategy: [
      new EcsCluster_CapacityProviderStrategyItem({ CapacityProvider: "FARGATE", Weight: 0, Base: 1 }),
      new EcsCluster_CapacityProviderStrategyItem({ CapacityProvider: "FARGATE_SPOT", Weight: 1 }),
    ],
    // chant-disable-next-line LOOM001 -- "containerInsights" is the fixed AWS setting name, not a physical resource name.
    ClusterSettings: [new EcsCluster_ClusterSettings({ Name: "containerInsights", Value: "enabled" })],
    Tags: tags,
  }, defs?.ecsCluster));

  // ── PrivateLink (full tier only): NLB + VPCEndpointService ───────────
  const privateLinkNeedsSubnetsError = new Error(
    "SharedFoundation: privateSubnetIds are required on production/production-ha tiers for PrivateLink's NLB",
  );
  if (fullTier && (!privateSubnetIds || privateSubnetIds.length === 0)) {
    throw privateLinkNeedsSubnetsError;
  }
  const privateLinkResult = fullTier
    ? buildPrivateLink(naming, tags, vpcId, privateSubnetIds as string[], props.privateLink?.agentRuntimePort ?? 443, props.loggingBucketName)
    : undefined;

  // ── Agent IAM role (Loom's role.yaml, scoped to this stack's own resources) ──
  const agentRoleMode = props.agentRole?.mode ?? "provision";
  const bedrockModelArns =
    (props.agentRole?.mode === "provision" && props.agentRole.bedrockModelArns) || ["arn:aws:bedrock:*::foundation-model/*"];
  const agentRoleResult = agentRoleMode === "provision"
    ? buildAgentRole(naming, tags, bedrockModelArns, ecrKmsKeyArn, artifactBucket.Arn as string)
    : undefined;
  // reference-existing / omit: nothing to build — the ARN comes from
  // `props.agentRole.agentRoleArn` (reference-existing) directly, or the
  // output is simply absent (omit). See src/shared-foundation/outputs.ts.

  return {
    albSg,
    ecsSg,
    alb,
    frontendTargetGroup,
    backendTargetGroup,
    httpsListener,
    backendListenerRule,
    artifactBucket,
    ecsCluster,
    ...(provisionedNetwork ?? {}),
    ...(kms ?? {}),
    ...(ecr ?? {}),
    ...(hostedZoneResult ?? {}),
    ...(certificateResult ?? {}),
    ...(dnsRecordResult ?? {}),
    ...(privateLinkResult ?? {}),
    ...(agentRoleResult ?? {}),
  };
}, "SharedFoundation");
