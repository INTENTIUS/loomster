import { describe, test, expect } from "vitest";
import { expandComposite } from "@intentius/chant";
import { resolveAttrRefs } from "@intentius/chant/discovery/resolve";
import { awsSerializer } from "@intentius/chant-lexicon-aws";
import { LoomTunnelHost, al2023ImageId, type LoomTunnelHostProps } from "./loom-tunnel-host";
import type { LoomNamingParams } from "../lib/naming";

const naming: LoomNamingParams = {
  project: "loom",
  env: "test",
  instance: "a",
  tier: "production",
  region: "us-east-1",
  accountId: "111111111111",
  owner: "platform",
};

function synth(overrides: Partial<LoomTunnelHostProps> = {}) {
  const instance = LoomTunnelHost({ naming, vpcId: "vpc-1", subnetIds: ["subnet-a", "subnet-b"], ...overrides });
  const expanded = expandComposite("tunnel", instance);
  resolveAttrRefs(expanded);
  const output = awsSerializer.serialize(expanded) as string;
  const template = JSON.parse(output);
  const ofType = (type: string) =>
    Object.entries<any>(template.Resources).filter(([, r]) => r.Type === type);
  return { output, template, ofType };
}

// Pinned to awslabs/loom v1.9.0 backend/iac/ec2.yaml (a3050669).
describe("LoomTunnelHost — Loom v1.9.0 ec2.yaml (loomster#37)", () => {
  test("ec2.yaml's four resources, nothing else by default", () => {
    const { output, template } = synth();
    expect(output).not.toContain("[object Object]");
    expect(Object.values<any>(template.Resources).map((r) => r.Type).sort()).toEqual([
      "AWS::EC2::Instance",
      "AWS::EC2::SecurityGroup",
      "AWS::IAM::InstanceProfile",
      "AWS::IAM::Role",
    ]);
  });

  test("the instance: private subnet, no public IP, AL2023 via SSM, IMDSv2 only, profile attached", () => {
    const { template } = synth();
    const props = template.Resources.tunnelInstance.Properties;
    expect(props.ImageId).toBe("{{resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64}}");
    expect(props.InstanceType).toBe("t3.micro");
    expect(props.IamInstanceProfile).toEqual({ Ref: "tunnelInstanceProfile" });
    expect(props.NetworkInterfaces).toEqual([
      {
        AssociatePublicIpAddress: false,
        DeviceIndex: "0",
        SubnetId: "subnet-a",
        GroupSet: [{ "Fn::GetAtt": ["tunnelSecurityGroup", "GroupId"] }],
      },
    ]);
    expect(props.MetadataOptions.HttpTokens).toBe("required");
    expect(props.KeyName).toBeUndefined();
    const tags = Object.fromEntries(props.Tags.map((t: { Key: string; Value: string }) => [t.Key, t.Value]));
    expect(tags).toMatchObject({ "loom:application": "loomster", "loom:group": "loomster", "loom:owner": "platform" });
  });

  test("the role is EC2-assumed with AmazonSSMManagedInstanceCore only; the security group has no inbound rules", () => {
    const { template } = synth();
    const role = template.Resources.tunnelRole.Properties;
    expect(role.AssumeRolePolicyDocument.Statement).toEqual([
      { Effect: "Allow", Principal: { Service: "ec2.amazonaws.com" }, Action: "sts:AssumeRole" },
    ]);
    expect(role.ManagedPolicyArns).toEqual([{ "Fn::Sub": "arn:${AWS::Partition}:iam::aws:policy/AmazonSSMManagedInstanceCore" }]);
    expect(role.Policies ?? []).toEqual([]);
    expect(template.Resources.tunnelSecurityGroup.Properties.SecurityGroupIngress).toBeUndefined();
    expect(template.Resources.tunnelSecurityGroup.Properties.VpcId).toBe("vpc-1");
  });

  test("dbSecurityGroupId opens the database's group to the host on the DB port", () => {
    const { ofType } = synth({ dbSecurityGroupId: "sg-db", dbPort: 6432 });
    const [[, ingress]] = ofType("AWS::EC2::SecurityGroupIngress");
    expect(ingress.Properties).toMatchObject({
      GroupId: "sg-db",
      IpProtocol: "tcp",
      FromPort: 6432,
      ToPort: 6432,
      SourceSecurityGroupId: { "Fn::GetAtt": ["tunnelSecurityGroup", "GroupId"] },
    });
  });

  test("ssmEndpoints adds the ssm, ssmmessages and ec2messages interface endpoints, open to the host on 443", () => {
    const { ofType, template } = synth({ ssmEndpoints: true });
    const endpoints = ofType("AWS::EC2::VPCEndpoint").map(([, r]) => r.Properties);
    expect(endpoints.map((e) => e.ServiceName["Fn::Sub"]).sort()).toEqual([
      "com.amazonaws.${AWS::Region}.ec2messages",
      "com.amazonaws.${AWS::Region}.ssm",
      "com.amazonaws.${AWS::Region}.ssmmessages",
    ]);
    for (const e of endpoints) {
      expect(e).toMatchObject({ VpcEndpointType: "Interface", VpcId: "vpc-1", SubnetIds: ["subnet-a", "subnet-b"], PrivateDnsEnabled: true });
    }
    const ingress = template.Resources.tunnelEndpointSecurityGroup.Properties.SecurityGroupIngress;
    expect(ingress).toEqual([
      expect.objectContaining({ FromPort: 443, ToPort: 443, SourceSecurityGroupId: { "Fn::GetAtt": ["tunnelSecurityGroup", "GroupId"] } }),
    ]);
  });

  test("a Graviton instance type gets the arm64 AMI", () => {
    expect(al2023ImageId("t4g.micro")).toContain("al2023-ami-kernel-default-arm64");
    expect(al2023ImageId("c8gd.large")).toContain("-arm64}}");
    expect(al2023ImageId("t3.small")).toContain("-x86_64}}");
    expect(synth({ instanceType: "t4g.nano" }).template.Resources.tunnelInstance.Properties.ImageId).toContain("arm64");
  });

  test("needs a subnet", () => {
    expect(() => synth({ subnetIds: [] })).toThrow(/at least one private subnet/);
  });
});
