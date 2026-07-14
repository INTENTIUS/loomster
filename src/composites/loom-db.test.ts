import { describe, test, expect } from "vitest";
import { expandComposite } from "@intentius/chant";
import { resolveAttrRefs } from "@intentius/chant/discovery/resolve";
import { awsSerializer } from "@intentius/chant-lexicon-aws";
import { LoomDb, type LoomDbProps } from "./loom-db";
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

const prodNaming: LoomNamingParams = { ...lightNaming, tier: "production" };
const prodHaNaming: LoomNamingParams = { ...lightNaming, tier: "production-ha" };

const network = { vpcId: "vpc-123", subnetIds: ["subnet-priv1", "subnet-priv2"] };

function baseProvisionProps(overrides: Partial<LoomDbProps> = {}): LoomDbProps {
  return {
    naming: lightNaming,
    data: { mode: "provision", network, dbPassword: "s3cret-not-real" },
    ...overrides,
  };
}

describe("LoomDb — provision, light tier", () => {
  test("returns the core members, no proxy/rotation", () => {
    const instance = LoomDb(baseProvisionProps());
    const names = Object.keys(instance.members);
    for (const expected of [
      "rdsSecurityGroup", "rdsSubnetGroup", "secretsKmsKey", "secretsKmsKeyAlias",
      "rdsMonitoringRole", "rdsInstance", "rdsCredentialsSecret", "rdsConnectionSecret",
    ]) {
      expect(names).toContain(expected);
    }
    for (const absent of ["rdsProxyRole", "rdsProxy", "rdsProxyTargetGroup", "rotationSchedule"]) {
      expect(names).not.toContain(absent);
    }
  });

  test("single-AZ, no deletion protection", () => {
    const instance = LoomDb(baseProvisionProps());
    const props = (instance.rdsInstance as any).props;
    expect(props.MultiAZ).toBe(false);
    expect(props.DeletionProtection).toBe(false);
  });

  test("default ingress is Loom's own CIDR posture (10.0.0.0/8)", () => {
    const instance = LoomDb(baseProvisionProps());
    const sgProps = (instance.rdsSecurityGroup as any).props;
    const ingressProps = (sgProps.SecurityGroupIngress[0] as any).props;
    expect(ingressProps.CidrIp).toBe("10.0.0.0/8");
    expect(ingressProps.SourceSecurityGroupId).toBeUndefined();
  });

  test("security-group ingress mode uses SourceSecurityGroupId, no CidrIp", () => {
    const instance = LoomDb(baseProvisionProps({
      data: { mode: "provision", network, dbPassword: "s3cret-not-real", dbIngress: { mode: "security-group", sourceSecurityGroupId: "sg-ecs-123" } },
    }));
    const sgProps = (instance.rdsSecurityGroup as any).props;
    const ingressProps = (sgProps.SecurityGroupIngress[0] as any).props;
    expect(ingressProps.SourceSecurityGroupId).toBe("sg-ecs-123");
    expect(ingressProps.CidrIp).toBeUndefined();
  });

  test("custom CIDR overrides the default", () => {
    const instance = LoomDb(baseProvisionProps({
      data: { mode: "provision", network, dbPassword: "x", dbIngress: { mode: "cidr", cidr: "10.1.2.0/24" } },
    }));
    const sgProps = (instance.rdsSecurityGroup as any).props;
    expect((sgProps.SecurityGroupIngress[0] as any).props.CidrIp).toBe("10.1.2.0/24");
  });

  test("throws when fewer than 2 subnet ids are given", () => {
    expect(() =>
      LoomDb(baseProvisionProps({ data: { mode: "provision", network: { vpcId: "vpc-1", subnetIds: ["only-one"] }, dbPassword: "x" } })),
    ).toThrow(/at least 2 subnets/);
  });

  test("defaults dbName/dbUsername/dbInstanceClass/dbAllocatedStorage to Loom's own values", () => {
    const instance = LoomDb(baseProvisionProps());
    const props = (instance.rdsInstance as any).props;
    expect(props.DBName).toBe("loom");
    expect(props.MasterUsername).toBe("loom");
    expect(props.DBInstanceClass).toBe("db.t3.small");
    expect(props.AllocatedStorage).toBe("20");
  });

  test("never hardcodes the password — it flows straight from data.dbPassword", () => {
    const instance = LoomDb(baseProvisionProps({
      data: { mode: "provision", network, dbPassword: "hunter2-example-only" },
    }));
    const props = (instance.rdsInstance as any).props;
    expect(props.MasterUserPassword).toBe("hunter2-example-only");
  });

  test("data.mode defaults to \"provision\" when omitted entirely", () => {
    const instance = LoomDb({ naming: lightNaming, data: { network, dbPassword: "x" } });
    expect(Object.keys(instance.members)).toContain("rdsInstance");
  });
});

describe("LoomDb — provision, production tier", () => {
  function prodProps(overrides: Partial<LoomDbProps> = {}): LoomDbProps {
    return { naming: prodNaming, data: { mode: "provision", network, dbPassword: "s3cret-not-real" }, ...overrides };
  }

  test("adds RDS Proxy members, still no rotation", () => {
    const instance = LoomDb(prodProps());
    const names = Object.keys(instance.members);
    for (const expected of ["rdsProxyRole", "rdsProxy", "rdsProxyTargetGroup"]) {
      expect(names).toContain(expected);
    }
    expect(names).not.toContain("rotationSchedule");
  });

  test("still single-AZ, but deletion protection is on", () => {
    const instance = LoomDb(prodProps());
    const props = (instance.rdsInstance as any).props;
    expect(props.MultiAZ).toBe(false);
    expect(props.DeletionProtection).toBe(true);
  });

  test("proxy target group's DBProxyName references the proxy resource", () => {
    const instance = LoomDb(prodProps());
    const tgProps = (instance.rdsProxyTargetGroup as any).props;
    expect((tgProps.DBProxyName as any).target).toBe(instance.rdsProxy);
    expect(tgProps.TargetGroupName).toBe("default");
  });
});

describe("LoomDb — provision, production-ha tier", () => {
  function prodHaProps(overrides: Partial<LoomDbProps> = {}): LoomDbProps {
    return { naming: prodHaNaming, data: { mode: "provision", network, dbPassword: "s3cret-not-real" }, ...overrides };
  }

  test("Multi-AZ + proxy + rotation, all present", () => {
    const instance = LoomDb(prodHaProps());
    const names = Object.keys(instance.members);
    for (const expected of ["rdsProxyRole", "rdsProxy", "rdsProxyTargetGroup", "rotationSchedule"]) {
      expect(names).toContain(expected);
    }
    const props = (instance.rdsInstance as any).props;
    expect(props.MultiAZ).toBe(true);
  });

  test("rotation schedule targets the credentials secret and rotates PostgreSQLSingleUser", () => {
    const instance = LoomDb(prodHaProps());
    const rotationProps = (instance.rotationSchedule as any).props;
    expect((rotationProps.SecretId as any).target).toBe(instance.rdsCredentialsSecret);
    const hostedLambdaProps = (rotationProps.HostedRotationLambda as any).props;
    expect(hostedLambdaProps.RotationType).toBe("PostgreSQLSingleUser");
    expect(hostedLambdaProps.VpcSubnetIds).toBe("subnet-priv1,subnet-priv2");
  });
});

describe("LoomDb — BYO-DB (chant#898): reference-existing | omit", () => {
  test("reference-existing produces no members — the composite tracks nothing of its own", () => {
    const instance = LoomDb({
      naming: lightNaming,
      data: { mode: "reference-existing", endpoint: "external-db.example.com", credentialsSecretArn: "arn:aws:secretsmanager:us-east-1:111111111111:secret:external-creds" },
    });
    expect(Object.keys(instance.members)).toHaveLength(0);
  });

  test("omit produces no members — the data tier is dropped entirely", () => {
    const instance = LoomDb({ naming: lightNaming, data: { mode: "omit" } });
    expect(Object.keys(instance.members)).toHaveLength(0);
  });
});

describe("LoomDb — naming and tags", () => {
  test("physical names derive from the naming helper, not literals", () => {
    const instance = LoomDb(baseProvisionProps());
    const instanceProps = (instance.rdsInstance as any).props;
    expect(instanceProps.DBInstanceIdentifier).toBe("loom-test-a-loom-db-instance");
    const subnetGroupProps = (instance.rdsSubnetGroup as any).props;
    expect(subnetGroupProps.DBSubnetGroupName).toBe("loom-test-a-loom-db-subnet-group");
  });

  test("every taggable resource carries the naming helper's tag set", () => {
    const instance = LoomDb(baseProvisionProps());
    const props = (instance.rdsInstance as any).props;
    expect(props.Tags).toContainEqual({ Key: "component", Value: "loom-db" });
    expect(props.Tags).toContainEqual({ Key: "env", Value: "test" });
    expect(props.Tags).toContainEqual({ Key: "instance", Value: "a" });
  });
});

describe("LoomDb — serializes to valid CloudFormation", () => {
  test("light tier: template has Resources for every member, no dangling refs", () => {
    const instance = LoomDb(baseProvisionProps());
    const expanded = expandComposite("loomDb", instance);
    resolveAttrRefs(expanded);
    const output = awsSerializer.serialize(expanded) as string;
    const template = JSON.parse(output);

    expect(template.AWSTemplateFormatVersion).toBe("2010-09-09");
    expect(Object.keys(template.Resources)).toHaveLength(expanded.size);
    for (const resource of Object.values(template.Resources) as any[]) {
      expect(typeof resource.Type).toBe("string");
      expect(resource.Type.startsWith("AWS::")).toBe(true);
    }
    expect(template.Resources.loomDbRdsInstance.Type).toBe("AWS::RDS::DBInstance");
    expect(template.Resources.loomDbRdsInstance.DeletionPolicy).toBe("Snapshot");
  });

  test("production tier: template includes the RDS Proxy resources and stays internally consistent", () => {
    const instance = LoomDb({ naming: prodNaming, data: { mode: "provision", network, dbPassword: "s3cret-not-real" } });
    const expanded = expandComposite("loomDb", instance);
    resolveAttrRefs(expanded);
    const output = awsSerializer.serialize(expanded) as string;
    const template = JSON.parse(output);

    expect(template.Resources.loomDbRdsProxy.Type).toBe("AWS::RDS::DBProxy");
    expect(template.Resources.loomDbRdsProxyTargetGroup.Type).toBe("AWS::RDS::DBProxyTargetGroup");
    const proxyDependsOn = template.Resources.loomDbRdsProxy.DependsOn;
    const proxyDependsOnList = Array.isArray(proxyDependsOn) ? proxyDependsOn : [proxyDependsOn];
    expect(proxyDependsOnList).toContain("loomDbRdsInstance");

    const targetGroupProps = template.Resources.loomDbRdsProxyTargetGroup.Properties;
    expect(targetGroupProps.DBProxyName).toEqual({ Ref: "loomDbRdsProxy" });
  });

  test("production-ha tier: template includes the rotation schedule", () => {
    const instance = LoomDb({ naming: prodHaNaming, data: { mode: "provision", network, dbPassword: "s3cret-not-real" } });
    const expanded = expandComposite("loomDb", instance);
    resolveAttrRefs(expanded);
    const output = awsSerializer.serialize(expanded) as string;
    const template = JSON.parse(output);

    expect(template.Resources.loomDbRotationSchedule.Type).toBe("AWS::SecretsManager::RotationSchedule");
  });
});
