/**
 * loom-db composite (chant#887).
 *
 * Folds Loom's `backend/iac/rds.yaml` (v1.6.0) into one composite emitting
 * one CloudFormation stack: the RDS Postgres instance, its subnet group and
 * security group, a KMS key dedicated to Secrets Manager encryption, the two
 * secrets (`RdsCredentialsSecret`/`RdsConnectionSecret` in Loom's own
 * naming), the RDS enhanced-monitoring role, and — production/production-ha
 * only — an RDS Proxy (+ its IAM role and target group) and automatic secret
 * rotation. #889 (the backend ECS service) reads its endpoint and secret
 * ARNs by cross-stack reference (`stackOutput("loom-db", "<key>")` — see
 * `../loom-db/outputs.ts` for the exact key list).
 *
 * Every physical name and tag comes from the shared naming helper
 * (`../lib/naming.ts`, chant#897); nothing here is a literal (LOOM001).
 *
 * Seams:
 * - `data` (chant#898, BYO-DB): `provision | reference-existing | omit`.
 *   `reference-existing` points #889 at an external DB endpoint + secret ARNs
 *   with none of this stack's own RDS declarables; `omit` drops the data tier
 *   entirely (no members, no outputs — a BYO-DB deployment that chant
 *   doesn't track at all).
 * - `dbIngress` (provision only): `cidr` (Loom's own `pAllowedCidr` posture)
 *   or `security-group` — reference a sibling stack's security group (e.g.
 *   shared-foundation's ECS task SG) instead of a CIDR block.
 * - Network (VPC id + subnet ids) is always reference-existing — loom-db
 *   never provisions a VPC (chant#886/shared-foundation owns that).
 *
 * Tiers (chant#890), all param-selected off `naming.tier` with no divergent
 * source: `light` = single-AZ, no proxy (matches Loom's own defaults
 * `pDbMultiAZ=false`/`pEnableProxy=false`). `production` = single-AZ + RDS
 * Proxy. `production-ha` = Multi-AZ + RDS Proxy + automatic secret rotation.
 *
 * Style note: each seam/tier's resource creation lives in its own
 * module-level `buildXxx()` helper below, invoked with a ternary in the
 * `Composite()` factory body (never an `if` wrapping a resource
 * constructor) — chant's EVL002 requires resources to be reachable without
 * control flow, and EVL001 requires every `new Xxx(...)` property value
 * outside the factory body to be statically evaluable (an identifier or
 * literal, never a function call) — so anything dynamic (a `Ref(...)`, a
 * `naming.name(...)`, a `.join(",")`) is computed into a local `const`
 * *before* the resource constructor that consumes it. Only the final
 * per-seam spread-merge (`...(x ?? {})`) happens back in the factory body
 * proper, where EVL004 exempts it — see `LoomDb`'s `return` below.
 */

import { Composite } from "@intentius/chant";
import {
  SecurityGroup,
  SecurityGroup_Ingress,
  RDSDBSubnetGroup,
  KmsKey,
  KMSAlias,
  Role,
  Role_Policy,
  DbInstance,
  Secret,
  DBProxy,
  DBProxy_AuthFormat,
  DBProxyTargetGroup,
  DBProxyTargetGroup_ConnectionPoolConfigurationInfoFormat,
  RotationSchedule,
  RotationSchedule_HostedRotationLambda,
  RotationSchedule_RotationRules,
  Ref,
  Sub,
  AWS,
} from "@intentius/chant-lexicon-aws";
import { loomNaming, type LoomNaming, type LoomNamingParams, type Tier } from "../lib/naming";

// ─────────────────────────────────────────────────────────────────────────
// Seams
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ingress source for port 5432 on the RDS security group. `cidr` mirrors
 * Loom's own `pAllowedCidr` (default `10.0.0.0/8`); `security-group`
 * references a sibling stack's SG instead (chant#898) — e.g.
 * shared-foundation's ECS task security group, threaded in via
 * `stackOutput("shared-foundation", "oEcsSecurityGroupId")` at the
 * deployable-stack level (see `../loom-db/db.ts`).
 */
export type DbIngressSeam =
  | { mode?: "cidr"; cidr?: string }
  | { mode: "security-group"; sourceSecurityGroupId: string };

export interface LoomDbProvisionData {
  mode?: "provision";
  /**
   * Reference-existing only — loom-db never provisions a VPC (owned by
   * chant#886/shared-foundation). Subnet ids need at least 2, across 2 AZs.
   *
   * `subnetIdsCsv` is the same subnets already comma-joined, for
   * `RotationSchedule_HostedRotationLambda.VpcSubnetIds` (a genuine
   * comma-separated `string`, unlike `DBProxy.VpcSubnetIds`'s real list —
   * see `buildRotation` below). Optional because it only needs to be passed
   * explicitly when `subnetIds` is a deploy-time `Fn::Split` this composite
   * can't `.join(",")` in JS at synth time (chant#928/loomster#35 —
   * `../loom-db/db.ts`'s shared-foundation cross-stack wiring supplies the
   * pre-joined string it already has instead); defaults to
   * `subnetIds.join(",")` when omitted, which is exactly right for every
   * literal-array caller (every composite unit test included).
   */
  network: { vpcId: string; subnetIds: string[]; subnetIdsCsv?: string };
  dbIngress?: DbIngressSeam;
  /** Loom's `pDbName`. Default: "loom". */
  dbName?: string;
  /** Loom's `pDbUsername`. Default: "loom". */
  dbUsername?: string;
  /**
   * Loom's `pDbPassword`. Required, no default — never hardcode. Source it
   * from an env var/secret at the deployable-stack level (chant#897's LOOM001
   * spirit extends to secrets, not just physical names). Marking the
   * CloudFormation parameter NoEcho is chant#894 (RDS hardening) — out of
   * scope here.
   */
  dbPassword: string;
  /** Loom's `pDbInstanceClass`. Default: "db.t3.small". */
  dbInstanceClass?: string;
  /** Loom's `pDbAllocatedStorage` (GB). Default: 20. */
  dbAllocatedStorage?: number;
}

export interface LoomDbReferenceExistingData {
  mode: "reference-existing";
  /** External DB endpoint (host) — an RDS instance, proxy, or Aurora cluster this stack does not own. */
  endpoint: string;
  /** Default: 5432 (Postgres). */
  port?: number;
  dbName?: string;
  /** ARN of an externally-managed Secrets Manager secret holding `{username,password}`. */
  credentialsSecretArn: string;
  /** ARN of an externally-managed secret holding the full connection URL, if one exists. */
  connectionSecretArn?: string;
}

export interface LoomDbOmitData {
  mode: "omit";
}

/**
 * BYO-DB (chant#898). `reference-existing` skips every RDS declarable and
 * threads the given endpoint + secret ARNs downstream unchanged; `omit`
 * drops the data tier entirely (no members, no outputs).
 */
export type DataSeam = LoomDbProvisionData | LoomDbReferenceExistingData | LoomDbOmitData;

export interface LoomDbProps {
  /** Naming/tagging parameter source (chant#897) — one call derives every physical name + tag below. */
  naming: LoomNamingParams;
  data: DataSeam;
}

type TagList = Array<{ Key: string; Value: string }>;

/** `{ project, env, ... }` tags → CloudFormation `[{ Key, Value }, ...]` — same convention as `../composites/shared-foundation.ts`. */
function tagList(tags: Record<string, string>): TagList {
  return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
}

// ─────────────────────────────────────────────────────────────────────────
// Fixed policy/document constants — hoisted to module scope (not per-call)
// so `new Xxx(...)` calls in the buildXxx() helpers below only ever
// reference them by identifier (EVL001: statically evaluable).
// ─────────────────────────────────────────────────────────────────────────

const SECRETS_KMS_KEY_POLICY = {
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
      Sid: "AllowSecretsManagerService",
      Effect: "Allow",
      Principal: { Service: "secretsmanager.amazonaws.com" },
      Action: ["kms:GenerateDataKey", "kms:Decrypt"],
      Resource: "*",
    },
  ],
};

const MONITORING_ASSUME_ROLE_POLICY = {
  Version: "2012-10-17",
  Statement: [{ Effect: "Allow", Principal: { Service: "monitoring.rds.amazonaws.com" }, Action: "sts:AssumeRole" }],
};

// cfn-lint / AWS-recommended fixed ARN for the RDS enhanced-monitoring
// managed policy — not a physical name this project controls.
const RDS_MONITORING_MANAGED_POLICY_ARN = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole";

const PROXY_ASSUME_ROLE_POLICY = {
  Version: "2012-10-17",
  Statement: [{ Effect: "Allow", Principal: { Service: "rds.amazonaws.com" }, Action: "sts:AssumeRole" }],
};

// ─────────────────────────────────────────────────────────────────────────
// Per-phase resource builders. Each is a plain module-level function (not
// nested in the Composite() factory below) so it can be invoked with a
// ternary — never an `if` wrapping a resource constructor.
// ─────────────────────────────────────────────────────────────────────────

interface DbCoreResult {
  members: {
    rdsSecurityGroup: InstanceType<typeof SecurityGroup>;
    rdsSubnetGroup: InstanceType<typeof RDSDBSubnetGroup>;
    secretsKmsKey: InstanceType<typeof KmsKey>;
    secretsKmsKeyAlias: InstanceType<typeof KMSAlias>;
    rdsMonitoringRole: InstanceType<typeof Role>;
    rdsInstance: InstanceType<typeof DbInstance>;
    rdsCredentialsSecret: InstanceType<typeof Secret>;
  };
  rdsInstance: InstanceType<typeof DbInstance>;
  dbInstanceIdentifier: string;
  credentialsSecretArn: string;
  kmsKeyId: string;
  kmsKeyArn: string;
  securityGroupId: string;
  subnetIds: string[];
  subnetIdsCsv: string;
  dbName: string;
  dbUsername: string;
  dbPassword: string;
}

/**
 * The always-built-together core of a provisioned loom-db: security group,
 * subnet group, secrets KMS key, monitoring role, the RDS instance itself,
 * and the credentials secret RDS Proxy authenticates with. Present whenever
 * `data.mode` is `"provision"` (default), regardless of tier.
 */
function buildDbCore(naming: LoomNaming, tags: TagList, tier: Tier, data: LoomDbProvisionData): DbCoreResult {
  const notEnoughSubnetsError = new Error(
    "LoomDb: data.network.subnetIds needs at least 2 subnets (across 2 AZs) for the DB subnet group",
  );
  // Only a real, synth-time-known array has a meaningful `.length` — a
  // deploy-time `Fn::Split` (chant#928/loomster#35's cross-stack wiring)
  // isn't a real array here, so this check harmlessly no-ops for that path
  // (`undefined < 2` is `false`); CloudFormation itself will reject too few
  // subnets when the DB subnet group actually deploys.
  if (data.network.subnetIds.length < 2) {
    throw notEnoughSubnetsError;
  }

  const dbIngress = data.dbIngress;
  const dbIngressSourceSgId = dbIngress?.mode === "security-group" ? dbIngress.sourceSecurityGroupId : undefined;
  const dbIngressCidr = dbIngress?.mode === "security-group" ? undefined : (dbIngress?.cidr ?? "10.0.0.0/8");

  const sgName = naming.name("sg");
  const ingress = dbIngressSourceSgId
    ? new SecurityGroup_Ingress({
        IpProtocol: "tcp",
        FromPort: 5432,
        ToPort: 5432,
        SourceSecurityGroupId: dbIngressSourceSgId,
        Description: "Allow PostgreSQL access from the referenced security group",
      })
    : new SecurityGroup_Ingress({
        IpProtocol: "tcp",
        FromPort: 5432,
        ToPort: 5432,
        CidrIp: dbIngressCidr,
        Description: "Allow PostgreSQL access from the allowed CIDR",
      });

  const rdsSecurityGroup = new SecurityGroup({
    GroupDescription: "Allow PostgreSQL access to the Loom RDS instance",
    GroupName: sgName,
    VpcId: data.network.vpcId,
    SecurityGroupIngress: [ingress],
    Tags: tags,
  });

  const subnetGroupName = naming.name("subnet-group");
  const rdsSubnetGroup = new RDSDBSubnetGroup({
    DBSubnetGroupDescription: "Subnet group for the Loom RDS instance",
    DBSubnetGroupName: subnetGroupName,
    SubnetIds: data.network.subnetIds,
    Tags: tags,
  });

  const kmsAliasName = `alias/${naming.name("secrets")}`;
  const secretsKmsKey = new KmsKey({
    Description: "KMS key for Secrets Manager secrets in the loom-db stack",
    EnableKeyRotation: true,
    KeyPolicy: SECRETS_KMS_KEY_POLICY,
    Tags: tags,
  });
  const secretsKmsKeyAlias = new KMSAlias({ AliasName: kmsAliasName, TargetKeyId: secretsKmsKey.KeyId });
  const kmsKeyId = secretsKmsKey.KeyId as string;
  const kmsKeyArn = secretsKmsKey.Arn as string;

  const monitoringRoleName = naming.name("monitoring-role");
  const rdsMonitoringRole = new Role({
    RoleName: monitoringRoleName,
    AssumeRolePolicyDocument: MONITORING_ASSUME_ROLE_POLICY,
    ManagedPolicyArns: [RDS_MONITORING_MANAGED_POLICY_ARN],
    Tags: tags,
  });

  const dbInstanceIdentifier = naming.name("instance", { service: "rdsInstance" });
  const dbName = data.dbName ?? "loom";
  const dbUsername = data.dbUsername ?? "loom";
  const dbInstanceClass = data.dbInstanceClass ?? "db.t3.small";
  const dbAllocatedStorage = data.dbAllocatedStorage ?? 20;
  const dbAllocatedStorageText = `${dbAllocatedStorage}`;
  const multiAz = tier === "production-ha";
  const deletionProtection = tier !== "light";
  const securityGroupId = rdsSecurityGroup.GroupId as string;
  const monitoringRoleArn = rdsMonitoringRole.Arn as string;

  const rdsInstance = new DbInstance(
    {
      DBInstanceIdentifier: dbInstanceIdentifier,
      DBName: dbName,
      DBInstanceClass: dbInstanceClass,
      Engine: "postgres",
      EngineVersion: "15",
      MasterUsername: dbUsername,
      MasterUserPassword: data.dbPassword,
      AllocatedStorage: dbAllocatedStorageText,
      StorageType: "gp3",
      StorageEncrypted: true,
      EnableIAMDatabaseAuthentication: true,
      MultiAZ: multiAz,
      DBSubnetGroupName: subnetGroupName,
      VPCSecurityGroups: [securityGroupId],
      BackupRetentionPeriod: 7,
      DeletionProtection: deletionProtection,
      PubliclyAccessible: false,
      MonitoringInterval: 60,
      MonitoringRoleArn: monitoringRoleArn,
      Tags: tags,
    },
    { DeletionPolicy: "Snapshot", UpdateReplacePolicy: "Snapshot" },
  );

  const credentialsSecretName = naming.name("credentials");
  const credentialsSecretString = Sub`{"username":"${dbUsername}","password":"${data.dbPassword}"}`;
  const rdsCredentialsSecret = new Secret({
    Name: credentialsSecretName,
    Description: "RDS master credentials used by RDS Proxy for authentication",
    KmsKeyId: kmsKeyId,
    SecretString: credentialsSecretString as unknown as string,
    Tags: tags,
  });
  const credentialsSecretArn = Ref(rdsCredentialsSecret) as unknown as string;

  const subnetIdsCsv = data.network.subnetIdsCsv ?? data.network.subnetIds.join(",");

  return {
    members: { rdsSecurityGroup, rdsSubnetGroup, secretsKmsKey, secretsKmsKeyAlias, rdsMonitoringRole, rdsInstance, rdsCredentialsSecret },
    rdsInstance,
    dbInstanceIdentifier,
    credentialsSecretArn,
    kmsKeyId,
    kmsKeyArn,
    securityGroupId,
    subnetIds: data.network.subnetIds,
    subnetIdsCsv,
    dbName,
    dbUsername,
    dbPassword: data.dbPassword,
  };
}

interface ProxyResult {
  members: {
    rdsProxyRole: InstanceType<typeof Role>;
    rdsProxy: InstanceType<typeof DBProxy>;
    rdsProxyTargetGroup: InstanceType<typeof DBProxyTargetGroup>;
  };
  proxyEndpoint: string;
}

/** RDS Proxy + its IAM role + target group (production/production-ha only). */
function buildProxy(naming: LoomNaming, tags: TagList, core: DbCoreResult): ProxyResult {
  const roleName = naming.name("proxy-role");
  const policyName = naming.name("proxy-policy");
  const proxyName = naming.name("proxy", { service: "rdsProxy" });

  const proxyPolicyDocument = {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"], Resource: core.credentialsSecretArn },
      { Effect: "Allow", Action: ["kms:Decrypt", "kms:GenerateDataKey"], Resource: core.kmsKeyArn },
    ],
  };

  const rdsProxyRole = new Role({
    RoleName: roleName,
    AssumeRolePolicyDocument: PROXY_ASSUME_ROLE_POLICY,
    Policies: [new Role_Policy({ PolicyName: policyName, PolicyDocument: proxyPolicyDocument as unknown as string })],
    Tags: tags,
  });
  const proxyRoleArn = rdsProxyRole.Arn as string;

  const proxyAuth = new DBProxy_AuthFormat({ AuthScheme: "SECRETS", SecretArn: core.credentialsSecretArn, IAMAuth: "DISABLED" });

  const rdsProxy = new DBProxy(
    {
      DBProxyName: proxyName,
      EngineFamily: "POSTGRESQL",
      RoleArn: proxyRoleArn,
      VpcSubnetIds: core.subnetIds,
      Auth: [proxyAuth],
      VpcSecurityGroupIds: [core.securityGroupId],
      // WAW041 — require TLS on every client connection through the proxy;
      // plaintext is never acceptable, production or production-ha alike.
      RequireTLS: true,
      IdleClientTimeout: 1800,
      Tags: tags,
    },
    { DependsOn: [core.rdsInstance] },
  );
  const proxyNameRef = Ref(rdsProxy) as unknown as string;
  const proxyEndpoint = rdsProxy.Endpoint as string;

  const connectionPoolConfig = new DBProxyTargetGroup_ConnectionPoolConfigurationInfoFormat({
    MaxConnectionsPercent: 90,
    MaxIdleConnectionsPercent: 50,
    ConnectionBorrowTimeout: 120,
  });
  const rdsProxyTargetGroup = new DBProxyTargetGroup({
    DBProxyName: proxyNameRef,
    // chant-disable-next-line LOOM001 -- "default" is CFN's own fixed DBProxyTargetGroup name (RDS Proxy allows exactly one target group per proxy), not a physical resource name we control.
    TargetGroupName: "default",
    DBInstanceIdentifiers: [core.dbInstanceIdentifier],
    ConnectionPoolConfigurationInfo: connectionPoolConfig,
  });

  return { members: { rdsProxyRole, rdsProxy, rdsProxyTargetGroup }, proxyEndpoint };
}

interface ConnectionSecretResult {
  members: { rdsConnectionSecret: InstanceType<typeof Secret> };
}

/**
 * The SQLAlchemy connection-URL secret (Loom's `RdsConnectionSecret`) —
 * points at the proxy endpoint when one exists, the RDS instance's own
 * endpoint otherwise. Always built in provision mode, matching Loom's own
 * template (which builds this unconditionally, branching only on which
 * endpoint to embed).
 */
function buildConnectionSecret(naming: LoomNaming, tags: TagList, core: DbCoreResult, connectEndpoint: string): ConnectionSecretResult {
  const secretName = naming.name("database-url");
  const secretString = Sub`{"url":"postgresql+psycopg2://${core.dbUsername}:${core.dbPassword}@${connectEndpoint}:5432/${core.dbName}"}`;

  const rdsConnectionSecret = new Secret({
    Name: secretName,
    Description: "SQLAlchemy connection URL for the Loom backend (proxy endpoint when proxy is enabled)",
    KmsKeyId: core.kmsKeyId,
    SecretString: secretString as unknown as string,
    Tags: tags,
  });

  return { members: { rdsConnectionSecret } };
}

interface RotationResult {
  members: { rotationSchedule: InstanceType<typeof RotationSchedule> };
}

/** Automatic secret rotation for the credentials secret (production-ha only, chant#890). */
function buildRotation(naming: LoomNaming, core: DbCoreResult): RotationResult {
  const rotationLambdaName = naming.name("secrets-rotation");

  const hostedRotationLambda = new RotationSchedule_HostedRotationLambda({
    RotationType: "PostgreSQLSingleUser",
    RotationLambdaName: rotationLambdaName,
    KmsKeyArn: core.kmsKeyArn,
    VpcSecurityGroupIds: core.securityGroupId,
    VpcSubnetIds: core.subnetIdsCsv,
  });
  const rotationRules = new RotationSchedule_RotationRules({ AutomaticallyAfterDays: 30 });

  const rotationSchedule = new RotationSchedule({
    SecretId: core.credentialsSecretArn,
    HostedRotationLambda: hostedRotationLambda,
    RotationRules: rotationRules,
  });

  return { members: { rotationSchedule } };
}

/**
 * Every member `LoomDb` can return. All optional — `data.mode:
 * "reference-existing"`/`"omit"` return none of them; `"provision"` on
 * `light` omits the proxy/rotation members; `"provision"` on `production`
 * omits only `rotationSchedule`.
 */
export type LoomDbResult = {
  rdsSecurityGroup?: InstanceType<typeof SecurityGroup>;
  rdsSubnetGroup?: InstanceType<typeof RDSDBSubnetGroup>;
  secretsKmsKey?: InstanceType<typeof KmsKey>;
  secretsKmsKeyAlias?: InstanceType<typeof KMSAlias>;
  rdsMonitoringRole?: InstanceType<typeof Role>;
  rdsInstance?: InstanceType<typeof DbInstance>;
  rdsCredentialsSecret?: InstanceType<typeof Secret>;
  rdsConnectionSecret?: InstanceType<typeof Secret>;

  // RDS Proxy — production/production-ha only.
  rdsProxyRole?: InstanceType<typeof Role>;
  rdsProxy?: InstanceType<typeof DBProxy>;
  rdsProxyTargetGroup?: InstanceType<typeof DBProxyTargetGroup>;

  // Secret rotation — production-ha only.
  rotationSchedule?: InstanceType<typeof RotationSchedule>;
};

export const LoomDb = Composite<LoomDbProps, LoomDbResult>((props) => {
  const naming = loomNaming(props.naming, "loom-db");
  const tier = props.naming.tier;
  const tags = tagList(naming.tags());

  const data = props.data;
  const core = data.mode !== "reference-existing" && data.mode !== "omit"
    ? buildDbCore(naming, tags, tier, data)
    : undefined;

  const proxy = core && tier !== "light" ? buildProxy(naming, tags, core) : undefined;

  const connectEndpoint = core ? (proxy ? proxy.proxyEndpoint : (core.rdsInstance.Endpoint_Address as string)) : undefined;
  const connectionSecret = core && connectEndpoint ? buildConnectionSecret(naming, tags, core, connectEndpoint) : undefined;

  const rotation = core && tier === "production-ha" ? buildRotation(naming, core) : undefined;

  return {
    ...(core?.members ?? {}),
    ...(proxy?.members ?? {}),
    ...(connectionSecret?.members ?? {}),
    ...(rotation?.members ?? {}),
  };
}, "LoomDb");
