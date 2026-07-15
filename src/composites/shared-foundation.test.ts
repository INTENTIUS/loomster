import { describe, test, expect } from "vitest";
import { expandComposite } from "@intentius/chant";
import { resolveAttrRefs } from "@intentius/chant/discovery/resolve";
import { awsSerializer } from "@intentius/chant-lexicon-aws";
import { SharedFoundation, type SharedFoundationProps } from "./shared-foundation";
import type { LoomNamingParams } from "../lib/naming";

const lightNaming: LoomNamingParams = {
  project: "loom",
  env: "test",
  instance: "a",
  tier: "light",
  region: "us-east-1",
  accountId: "111111111111",
  owner: "platform",
};

const prodNaming: LoomNamingParams = {
  ...lightNaming,
  tier: "production",
};

const referenceExistingNetwork = {
  mode: "reference-existing" as const,
  vpcId: "vpc-123",
  publicSubnetIds: ["subnet-pub1", "subnet-pub2"],
  privateSubnetIds: ["subnet-priv1", "subnet-priv2"],
};

function baseLightProps(overrides: Partial<SharedFoundationProps> = {}): SharedFoundationProps {
  return {
    naming: lightNaming,
    network: referenceExistingNetwork,
    ...overrides,
  };
}

function baseProdProps(overrides: Partial<SharedFoundationProps> = {}): SharedFoundationProps {
  return {
    naming: prodNaming,
    network: referenceExistingNetwork,
    domainName: "loom.example.com",
    ...overrides,
  };
}

describe("SharedFoundation — base shape (light tier, reference-existing network)", () => {
  test("returns the unconditional members plus provisioned KMS/ECR/agent role", () => {
    const instance = SharedFoundation(baseLightProps());
    const names = Object.keys(instance.members);

    for (const expected of [
      "albSg", "ecsSg", "alb", "frontendTargetGroup", "backendTargetGroup",
      "httpsListener", "backendListenerRule", "artifactBucket", "artifactBucketPolicy", "ecsCluster",
      "kmsKey", "kmsAlias", "frontendRepo", "backendRepo", "agentRole",
    ]) {
      expect(names).toContain(expected);
    }
  });

  test("light tier has no ACM/Route53/PrivateLink members", () => {
    const instance = SharedFoundation(baseLightProps());
    const names = Object.keys(instance.members);
    for (const absent of ["certificate", "hostedZone", "dnsRecord", "nlb", "nlbTargetGroup", "nlbListener", "vpcEndpointService"]) {
      expect(names).not.toContain(absent);
    }
  });

  test("light tier ALB listens on plain HTTP:80, no certificate", () => {
    const instance = SharedFoundation(baseLightProps());
    const listenerProps = (instance.httpsListener as any).props;
    expect(listenerProps.Protocol).toBe("HTTP");
    expect(listenerProps.Port).toBe(80);
    expect(listenerProps.Certificates).toBeUndefined();
  });

  test("reference-existing network: no VPC/subnet members, props threaded straight through", () => {
    const instance = SharedFoundation(baseLightProps());
    const names = Object.keys(instance.members);
    expect(names).not.toContain("vpc");
    expect(names).not.toContain("publicSubnet1");

    const albProps = (instance.alb as any).props;
    expect(albProps.Subnets).toEqual(["subnet-pub1", "subnet-pub2"]);

    const sgProps = (instance.albSg as any).props;
    expect(sgProps.VpcId).toBe("vpc-123");
  });

  test("expandComposite produces a flat, prefixed entity map with no duplicate names", () => {
    const instance = SharedFoundation(baseLightProps());
    const expanded = expandComposite("sf", instance);
    expect(expanded.size).toBe(Object.keys(instance.members).length);
    expect(expanded.has("sfAlb")).toBe(true);
    expect(expanded.has("sfEcsCluster")).toBe(true);
  });
});

describe("SharedFoundation — production tier", () => {
  test("provisions Route53 zone, ACM cert, DNS record, and PrivateLink", () => {
    const instance = SharedFoundation(baseProdProps());
    const names = Object.keys(instance.members);
    for (const expected of ["hostedZone", "certificate", "dnsRecord", "nlb", "nlbTargetGroup", "nlbListener", "vpcEndpointService"]) {
      expect(names).toContain(expected);
    }
  });

  test("ALB listens on HTTPS:443 with the provisioned certificate", () => {
    const instance = SharedFoundation(baseProdProps());
    const listenerProps = (instance.httpsListener as any).props;
    expect(listenerProps.Protocol).toBe("HTTPS");
    expect(listenerProps.Port).toBe(443);
    expect(listenerProps.Certificates).toHaveLength(1);
  });

  test("throws when domainName is missing and route53/acm are not omitted", () => {
    expect(() =>
      SharedFoundation(baseProdProps({ domainName: undefined })),
    ).toThrow(/domainName is required/);
  });

  test("throws when production network.mode is \"provision\"", () => {
    expect(() =>
      SharedFoundation(baseProdProps({ network: { mode: "provision" } })),
    ).toThrow(/only supports the light tier/);
  });

  test("throws when production reference-existing network has no private subnets", () => {
    expect(() =>
      SharedFoundation(baseProdProps({
        network: { mode: "reference-existing", vpcId: "vpc-1", publicSubnetIds: ["a", "b"] },
      })),
    ).toThrow(/privateSubnetIds are required/);
  });

  test("acm: omit + route53: omit skips both without requiring domainName", () => {
    const instance = SharedFoundation(baseProdProps({
      domainName: undefined,
      acm: { mode: "omit" },
      route53: { mode: "omit" },
    }));
    const names = Object.keys(instance.members);
    expect(names).not.toContain("certificate");
    expect(names).not.toContain("hostedZone");
    expect(names).not.toContain("dnsRecord");
    const listenerProps = (instance.httpsListener as any).props;
    expect(listenerProps.Protocol).toBe("HTTPS");
    expect(listenerProps.Certificates).toBeUndefined();
  });
});

describe("SharedFoundation — seams: provision | reference-existing | omit", () => {
  test("kms reference-existing: no KMS members, ECR encrypted with the given ARN", () => {
    const instance = SharedFoundation(baseLightProps({
      kms: { mode: "reference-existing", kmsKeyArn: "arn:aws:kms:us-east-1:111111111111:key/abc" },
    }));
    const names = Object.keys(instance.members);
    expect(names).not.toContain("kmsKey");
    expect(names).not.toContain("kmsAlias");

    const repoProps = (instance.frontendRepo as any).props;
    const encConfig = (repoProps.EncryptionConfiguration as any).props;
    expect(encConfig.KmsKey).toBe("arn:aws:kms:us-east-1:111111111111:key/abc");
  });

  test("kms omit: no KMS members, ECR has no EncryptionConfiguration", () => {
    const instance = SharedFoundation(baseLightProps({ kms: { mode: "omit" } }));
    const names = Object.keys(instance.members);
    expect(names).not.toContain("kmsKey");
    const repoProps = (instance.frontendRepo as any).props;
    expect(repoProps.EncryptionConfiguration).toBeUndefined();
  });

  test("ecr omit: no ECR repo members; agent role policy has no KMS statement gap", () => {
    const instance = SharedFoundation(baseLightProps({ ecr: { mode: "omit" } }));
    const names = Object.keys(instance.members);
    expect(names).not.toContain("frontendRepo");
    expect(names).not.toContain("backendRepo");
    // KMS (default provision) is independent of ecr mode — still present.
    expect(names).toContain("kmsKey");
  });

  test("agentRole reference-existing: no Role member built", () => {
    const instance = SharedFoundation(baseLightProps({
      agentRole: { mode: "reference-existing", agentRoleArn: "arn:aws:iam::111111111111:role/existing-agent" },
    }));
    expect(Object.keys(instance.members)).not.toContain("agentRole");
  });

  test("agentRole omit: no Role member built", () => {
    const instance = SharedFoundation(baseLightProps({ agentRole: { mode: "omit" } }));
    expect(Object.keys(instance.members)).not.toContain("agentRole");
  });

  test("route53 reference-existing on production: no hostedZone member, DNS record still created against the given zone id", () => {
    const instance = SharedFoundation(baseProdProps({
      route53: { mode: "reference-existing", hostedZoneId: "Z123EXISTING" },
    }));
    const names = Object.keys(instance.members);
    expect(names).not.toContain("hostedZone");
    expect(names).toContain("dnsRecord");
    const recordProps = (instance.dnsRecord as any).props;
    expect(recordProps.HostedZoneId).toBe("Z123EXISTING");
  });

  test("acm reference-existing on production: no certificate member, listener uses the given ARN", () => {
    const instance = SharedFoundation(baseProdProps({
      acm: { mode: "reference-existing", certificateArn: "arn:aws:acm:us-east-1:111111111111:certificate/existing" },
    }));
    const names = Object.keys(instance.members);
    expect(names).not.toContain("certificate");
    const listenerProps = (instance.httpsListener as any).props;
    const cert = (listenerProps.Certificates[0] as any).props;
    expect(cert.CertificateArn).toBe("arn:aws:acm:us-east-1:111111111111:certificate/existing");
  });

  test("ecr reference-existing: no repo members built", () => {
    const instance = SharedFoundation(baseLightProps({
      ecr: {
        mode: "reference-existing",
        frontendRepositoryUri: "111111111111.dkr.ecr.us-east-1.amazonaws.com/existing-fe",
        frontendRepositoryArn: "arn:aws:ecr:us-east-1:111111111111:repository/existing-fe",
        backendRepositoryUri: "111111111111.dkr.ecr.us-east-1.amazonaws.com/existing-be",
        backendRepositoryArn: "arn:aws:ecr:us-east-1:111111111111:repository/existing-be",
      },
    }));
    const names = Object.keys(instance.members);
    expect(names).not.toContain("frontendRepo");
    expect(names).not.toContain("backendRepo");
  });

  test("network provision (light tier): builds a VPC + 2 public subnets, no private subnets", () => {
    const instance = SharedFoundation(baseLightProps({ network: { mode: "provision" } }));
    const names = Object.keys(instance.members);
    for (const expected of ["vpc", "igw", "igwAttachment", "publicSubnet1", "publicSubnet2", "publicRouteTable", "publicRoute", "publicRta1", "publicRta2"]) {
      expect(names).toContain(expected);
    }
    const albProps = (instance.alb as any).props;
    expect(albProps.Subnets).toHaveLength(2);
  });

  test("network reference-existing: fewer than 2 public subnets throws", () => {
    expect(() =>
      SharedFoundation(baseLightProps({
        network: { mode: "reference-existing", vpcId: "vpc-1", publicSubnetIds: ["only-one"] },
      })),
    ).toThrow(/at least 2 subnets/);
  });
});

describe("SharedFoundation — naming and tags", () => {
  test("physical names derive from the naming helper, not literals", () => {
    const instance = SharedFoundation(baseLightProps());

    // ALB names are capped at 32 chars (truncate + hash) — the naming
    // helper's own concern (chant#897); just assert the prefix + limit hold.
    const albProps = (instance.alb as any).props;
    expect(albProps.Name.length).toBeLessThanOrEqual(32);
    expect(albProps.Name).toMatch(/^loom-test-a-shared-founda/);

    const bucketProps = (instance.artifactBucket as any).props;
    expect(bucketProps.BucketName).toMatch(/^loom-test-a-shared-foundation-artifacts-[0-9a-f]{6}$/);

    const clusterProps = (instance.ecsCluster as any).props;
    expect(clusterProps.ClusterName).toBe("loom-test-a-shared-foundation-cluster");
  });

  // chant#896 — the cost-allocation tag set is component/tier/env/owner/
  // instance, always all five, sourced from the one `naming.tags()` call.
  // Checked on a representative resource per always-present member group
  // (network SG, KMS, ECR, ALB/target-group, S3, ECS, IAM) plus the
  // production/production-ha-only members (Route53/ACM/PrivateLink), across
  // every tier so `tier` itself is proven to flow through, not just the
  // fixed keys.
  test("every taggable resource carries the full component/tier/env/owner/instance tag set (light tier)", () => {
    const instance = SharedFoundation(baseLightProps());
    const expectedTags = [
      { Key: "component", Value: "shared-foundation" },
      { Key: "tier", Value: "light" },
      { Key: "env", Value: "test" },
      { Key: "owner", Value: "platform" },
      { Key: "instance", Value: "a" },
    ];
    for (const member of [instance.albSg, instance.ecsSg, instance.alb, instance.frontendTargetGroup, instance.backendTargetGroup, instance.artifactBucket, instance.ecsCluster, instance.kmsKey, instance.frontendRepo, instance.backendRepo, instance.agentRole]) {
      const props = (member as any).props;
      for (const tag of expectedTags) {
        expect(props.Tags).toContainEqual(tag);
      }
    }
  });

  test("every taggable resource carries the full tag set on production tier, including Route53/ACM/PrivateLink members", () => {
    const instance = SharedFoundation(baseProdProps());
    const expectedTags = [
      { Key: "component", Value: "shared-foundation" },
      { Key: "tier", Value: "production" },
      { Key: "env", Value: "test" },
      { Key: "owner", Value: "platform" },
      { Key: "instance", Value: "a" },
    ];
    for (const member of [instance.alb, instance.certificate, instance.nlb, instance.nlbTargetGroup, instance.vpcEndpointService]) {
      const props = (member as any).props;
      for (const tag of expectedTags) {
        expect(props.Tags).toContainEqual(tag);
      }
    }
    // Route53 HostedZone tags land on `HostedZoneTags`, not `Tags`.
    const hostedZoneProps = (instance.hostedZone as any).props;
    for (const tag of expectedTags) {
      expect(hostedZoneProps.HostedZoneTags).toContainEqual(tag);
    }
  });

  test("production-ha tier: tag's tier value is production-ha, not the instance or any other axis", () => {
    const instance = SharedFoundation(baseProdProps({ naming: { ...prodNaming, tier: "production-ha" } }));
    const albProps = (instance.alb as any).props;
    expect(albProps.Tags).toContainEqual({ Key: "tier", Value: "production-ha" });
    expect(albProps.Tags).toContainEqual({ Key: "owner", Value: "platform" });
  });
});

describe("SharedFoundation — serializes to valid CloudFormation", () => {
  test("light tier: template has AWSTemplateFormatVersion, Resources for every member, and no dangling refs", () => {
    const instance = SharedFoundation(baseLightProps());
    const expanded = expandComposite("sharedFoundation", instance);
    resolveAttrRefs(expanded);
    const output = awsSerializer.serialize(expanded) as string;
    const template = JSON.parse(output);

    expect(template.AWSTemplateFormatVersion).toBe("2010-09-09");
    expect(template.Resources).toBeDefined();
    expect(Object.keys(template.Resources)).toHaveLength(expanded.size);

    // Every resource has a CloudFormation type string.
    for (const resource of Object.values(template.Resources) as any[]) {
      expect(typeof resource.Type).toBe("string");
      expect(resource.Type.startsWith("AWS::")).toBe(true);
    }

    // Spot-check a couple of well-known logical ids and their wiring.
    expect(template.Resources.sharedFoundationAlb.Type).toBe("AWS::ElasticLoadBalancingV2::LoadBalancer");
    expect(template.Resources.sharedFoundationEcsCluster.Type).toBe("AWS::ECS::Cluster");
    const listenerProps = template.Resources.sharedFoundationHttpsListener.Properties;
    expect(listenerProps.LoadBalancerArn).toEqual({ "Fn::GetAtt": ["sharedFoundationAlb", "LoadBalancerArn"] });
  });

  test("production tier: template includes DNS/ACM/PrivateLink resources and stays internally consistent", () => {
    const instance = SharedFoundation(baseProdProps());
    const expanded = expandComposite("sharedFoundation", instance);
    resolveAttrRefs(expanded);
    const output = awsSerializer.serialize(expanded) as string;
    const template = JSON.parse(output);

    expect(template.Resources.sharedFoundationCertificate.Type).toBe("AWS::CertificateManager::Certificate");
    expect(template.Resources.sharedFoundationHostedZone.Type).toBe("AWS::Route53::HostedZone");
    expect(template.Resources.sharedFoundationVpcEndpointService.Type).toBe("AWS::EC2::VPCEndpointService");

    const dnsProps = template.Resources.sharedFoundationDnsRecord.Properties;
    expect(dnsProps.HostedZoneId).toEqual({ Ref: "sharedFoundationHostedZone" });
  });

  // chant#918: `buildAgentRole` used JS template-literal concatenation
  // (`` `${artifactBucketArn}/*` ``) on the artifact bucket's `Arn` AttrRef,
  // which stringifies to "[object Object]/*" instead of a valid ARN. Fixed
  // with chant's tagged-template `Sub`, mirroring `loom-backend.ts`'s own
  // `artifactBucketArnWildcard` convention.
  test("agent role policy: artifact bucket ARN resources are real CFN intrinsics, never \"[object Object]\" (chant#918)", () => {
    const instance = SharedFoundation(baseLightProps());
    const expanded = expandComposite("sharedFoundation", instance);
    resolveAttrRefs(expanded);
    const output = awsSerializer.serialize(expanded) as string;

    expect(output).not.toContain("[object Object]");

    const template = JSON.parse(output);
    const policyDocument = template.Resources.sharedFoundationAgentRole.Properties.Policies[0].PolicyDocument;
    const s3Statement = policyDocument.Statement.find(
      (s: any) => Array.isArray(s.Action) && s.Action.includes("s3:GetObject"),
    );

    expect(s3Statement.Resource).toEqual([
      { "Fn::GetAtt": ["sharedFoundationArtifactBucket", "Arn"] },
      { "Fn::Sub": "${sharedFoundationArtifactBucket.Arn}/*" },
    ]);
  });
});

// WAW042 — the artifact bucket needs a companion BucketPolicy denying any
// request made over plaintext (a Deny statement keyed on
// `aws:SecureTransport` being false). Always-on hardening, no seam/opt-out —
// unlike KMS/ACM/Route53/ECR/agentRole above, this has no "omit" and is
// present on every tier (chant#890's light-tier synth error, fixed here).
describe("SharedFoundation — artifact bucket TLS-only policy (WAW042, every tier)", () => {
  test("light tier: artifactBucketPolicy is present", () => {
    const instance = SharedFoundation(baseLightProps());
    expect(Object.keys(instance.members)).toContain("artifactBucketPolicy");
  });

  test("production tier: artifactBucketPolicy is present", () => {
    const instance = SharedFoundation(baseProdProps());
    expect(Object.keys(instance.members)).toContain("artifactBucketPolicy");
  });

  test("production-ha tier: artifactBucketPolicy is present", () => {
    const instance = SharedFoundation(baseProdProps({ naming: { ...prodNaming, tier: "production-ha" } }));
    expect(Object.keys(instance.members)).toContain("artifactBucketPolicy");
  });

  test("denies non-TLS requests on the artifact bucket, scoped to the bucket + its objects", () => {
    const instance = SharedFoundation(baseLightProps());
    const policyProps = (instance.artifactBucketPolicy as any).props;
    expect((policyProps.Bucket as any).target).toBe(instance.artifactBucket);

    const statement = policyProps.PolicyDocument.Statement[0];
    expect(statement.Effect).toBe("Deny");
    expect(statement.Principal).toBe("*");
    expect(statement.Condition).toEqual({ Bool: { "aws:SecureTransport": "false" } });
  });

  test("serializes to a real CFN BucketPolicy targeting the artifact bucket, satisfying WAW042's own check", () => {
    const instance = SharedFoundation(baseLightProps());
    const expanded = expandComposite("sharedFoundation", instance);
    resolveAttrRefs(expanded);
    const output = awsSerializer.serialize(expanded) as string;
    const template = JSON.parse(output);

    const policyResource = template.Resources.sharedFoundationArtifactBucketPolicy;
    expect(policyResource.Type).toBe("AWS::S3::BucketPolicy");
    expect(policyResource.Properties.Bucket).toEqual({ Ref: "sharedFoundationArtifactBucket" });

    // Mirrors WAW042's own `statementDeniesInsecureTransport` check (see
    // lexicons/aws/src/lint/post-synth/waw042.ts) so this test fails the
    // same way the real post-synth lint pass would if the statement regressed.
    const statements = policyResource.Properties.PolicyDocument.Statement;
    const hasTlsDeny = statements.some(
      (s: any) => s.Effect === "Deny" && s.Condition?.Bool?.["aws:SecureTransport"] === "false",
    );
    expect(hasTlsDeny).toBe(true);
  });
});
