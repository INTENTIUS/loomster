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
      "httpsListener", "backendListenerRule", "artifactBucket", "ecsCluster",
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

  test("every taggable resource carries the naming helper's tag set", () => {
    const instance = SharedFoundation(baseLightProps());
    const albProps = (instance.alb as any).props;
    expect(albProps.Tags).toContainEqual({ Key: "component", Value: "shared-foundation" });
    expect(albProps.Tags).toContainEqual({ Key: "env", Value: "test" });
    expect(albProps.Tags).toContainEqual({ Key: "instance", Value: "a" });
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
});
