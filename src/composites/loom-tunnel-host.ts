/**
 * loom-tunnel-host composite (loomster#37).
 *
 * The chant version of Loom's `backend/iac/ec2.yaml` (pinned v1.9.0), the
 * host behind Loom's `make tunnel`: an EC2 instance in a private subnet with
 * no public IP, reachable only through SSM Session Manager, so an operator
 * can port-forward to the RDS Proxy (or the RDS instance on light) with
 * `AWS-StartPortForwardingSessionToRemoteHost`. No inbound rules, no SSH key.
 *
 * Same resources as ec2.yaml: a security group, a role with
 * `AmazonSSMManagedInstanceCore`, its instance profile, and the instance
 * (latest Amazon Linux 2023 through the public SSM parameter, the
 * `loom:application`/`loom:group`/`loom:owner` tags). Additions, each opt-in:
 * - `dbSecurityGroupId`: an ingress rule on the database's security group
 *   (RDS and the proxy share it, see ./loom-db.ts) from this host's group, so
 *   the tunnel reaches the database whatever `dbIngress` mode loom-db uses.
 *   ec2.yaml has no equivalent: Loom's RDS group admits a CIDR.
 * - `ssmEndpoints`: the `ssm`, `ssmmessages` and `ec2messages` interface
 *   endpoints the SSM agent needs when the subnet has no NAT route. ec2.yaml
 *   assumes they exist. Off by default: they cost money per AZ, and a VPC
 *   that already has them with private DNS would reject a second set.
 * Instance metadata is IMDSv2-only.
 */

import { Composite, mergeDefaults } from "@intentius/chant";
import {
  SecurityGroup,
  SecurityGroup_Ingress,
  EC2SecurityGroupIngress,
  Role,
  InstanceProfile,
  Instance,
  Instance_NetworkInterface,
  Instance_MetadataOptions,
  VPCEndpoint,
  Ref,
  Sub,
  AWS,
} from "@intentius/chant-lexicon-aws";
import { loomNaming, type LoomNamingParams } from "../lib/naming";

/** The interface endpoints Session Manager needs without a NAT route. */
export const SSM_ENDPOINT_SERVICES = ["ssm", "ssmmessages", "ec2messages"] as const;

/** ec2.yaml's `pInstanceType` default. */
export const DEFAULT_TUNNEL_INSTANCE_TYPE = "t3.micro";

/**
 * The AL2023 AMI parameter for an instance type: arm64 for Graviton families
 * (`t4g`, `m7g`, `c8gd`, ...), x86_64 otherwise (ec2.yaml hard-codes x86_64,
 * since it only allows t3 sizes).
 */
export function al2023ImageId(instanceType: string): string {
  const arch = /^[a-z]+\d+g[a-z]*\./.test(instanceType) ? "arm64" : "x86_64";
  return `{{resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-${arch}}}`;
}

export interface LoomTunnelHostProps {
  naming: LoomNamingParams;
  /** VPC the host (and its security group) live in: shared-foundation's `oVpcId`. */
  vpcId: string;
  /** Private subnets: the host goes in the first; the SSM endpoints, when asked for, span all of them. */
  subnetIds: string[];
  /** EC2 instance type. Default: t3.micro. */
  instanceType?: string;
  /** The database's security group (loom-db's `oRdsSecurityGroupId`): adds ingress from this host on `dbPort`. */
  dbSecurityGroupId?: string;
  /** Database port. Default: 5432. */
  dbPort?: number;
  /** Create the ssm/ssmmessages/ec2messages interface endpoints. Default: false. */
  ssmEndpoints?: boolean;
  /** `loom:group` tag value. Default: "loomster". */
  group?: string;
  defaults?: {
    instance?: Partial<ConstructorParameters<typeof Instance>[0]>;
    role?: Partial<ConstructorParameters<typeof Role>[0]>;
  };
}

export type LoomTunnelHostResult = {
  securityGroup: InstanceType<typeof SecurityGroup>;
  role: InstanceType<typeof Role>;
  instanceProfile: InstanceType<typeof InstanceProfile>;
  instance: InstanceType<typeof Instance>;
  dbIngress?: InstanceType<typeof EC2SecurityGroupIngress>;
  endpointSecurityGroup?: InstanceType<typeof SecurityGroup>;
  ssmEndpoint?: InstanceType<typeof VPCEndpoint>;
  ssmmessagesEndpoint?: InstanceType<typeof VPCEndpoint>;
  ec2messagesEndpoint?: InstanceType<typeof VPCEndpoint>;
};

const EC2_ASSUME_ROLE_POLICY = {
  Version: "2012-10-17",
  Statement: [{ Effect: "Allow", Principal: { Service: "ec2.amazonaws.com" }, Action: "sts:AssumeRole" }],
};

function buildSsmEndpoints(
  naming: ReturnType<typeof loomNaming>,
  tags: Array<{ Key: string; Value: string }>,
  props: LoomTunnelHostProps,
  hostSecurityGroupId: string,
) {
  const endpointIngress = new SecurityGroup_Ingress({
    IpProtocol: "tcp",
    FromPort: 443,
    ToPort: 443,
    SourceSecurityGroupId: hostSecurityGroupId,
    Description: "HTTPS from the SSM tunnel host",
  });
  const endpointSecurityGroup = new SecurityGroup({
    GroupName: naming.name("ssm-endpoints"),
    GroupDescription: "SSM interface endpoints for the tunnel host",
    VpcId: props.vpcId,
    SecurityGroupIngress: [endpointIngress],
    Tags: tags,
  });
  const endpoint = (service: (typeof SSM_ENDPOINT_SERVICES)[number]) =>
    new VPCEndpoint({
      VpcEndpointType: "Interface",
      ServiceName: Sub`com.amazonaws.${AWS.Region}.${service}` as unknown as string,
      VpcId: props.vpcId,
      SubnetIds: props.subnetIds,
      SecurityGroupIds: [endpointSecurityGroup.GroupId as string],
      PrivateDnsEnabled: true,
    });
  return {
    endpointSecurityGroup,
    ssmEndpoint: endpoint("ssm"),
    ssmmessagesEndpoint: endpoint("ssmmessages"),
    ec2messagesEndpoint: endpoint("ec2messages"),
  };
}

export const LoomTunnelHost = Composite<LoomTunnelHostProps, LoomTunnelHostResult>((props) => {
  const naming = loomNaming(props.naming, "tunnel-host");
  const instanceType = props.instanceType ?? DEFAULT_TUNNEL_INSTANCE_TYPE;
  const dbPort = props.dbPort ?? 5432;
  const noSubnetError = new Error("LoomTunnelHost: subnetIds needs at least one private subnet");
  if (props.subnetIds.length === 0) throw noSubnetError;

  const tags = [
    ...Object.entries(naming.tags()).map(([Key, Value]) => ({ Key, Value })),
    { Key: "loom:application", Value: "loomster" },
    { Key: "loom:group", Value: props.group ?? "loomster" },
    { Key: "loom:owner", Value: props.naming.owner },
  ];

  // ec2.yaml: "no inbound rules required". Egress stays the default (all),
  // which covers the database port and Session Manager's 443.
  const securityGroup = new SecurityGroup({
    GroupName: naming.name("sg"),
    GroupDescription: "SSM tunnel host - no inbound rules required",
    VpcId: props.vpcId,
    Tags: tags,
  });

  const role = new Role(mergeDefaults({
    RoleName: naming.name("role"),
    AssumeRolePolicyDocument: EC2_ASSUME_ROLE_POLICY,
    ManagedPolicyArns: [Sub`arn:${AWS.Partition}:iam::aws:policy/AmazonSSMManagedInstanceCore` as unknown as string],
    Tags: tags,
  }, props.defaults?.role));

  const instanceProfile = new InstanceProfile({ Roles: [Ref(role) as unknown as string] });

  const networkInterface = new Instance_NetworkInterface({
    AssociatePublicIpAddress: false,
    DeviceIndex: "0",
    SubnetId: props.subnetIds[0],
    GroupSet: [securityGroup.GroupId as string],
  });

  const instance = new Instance(mergeDefaults({
    ImageId: al2023ImageId(instanceType),
    InstanceType: instanceType,
    IamInstanceProfile: Ref(instanceProfile) as unknown as string,
    NetworkInterfaces: [networkInterface],
    MetadataOptions: new Instance_MetadataOptions({ HttpTokens: "required", HttpEndpoint: "enabled" }),
    Tags: [{ Key: "Name", Value: naming.name("host") }, ...tags],
  }, props.defaults?.instance));

  const dbIngress = props.dbSecurityGroupId
    ? new EC2SecurityGroupIngress({
        GroupId: props.dbSecurityGroupId,
        IpProtocol: "tcp",
        FromPort: dbPort,
        ToPort: dbPort,
        SourceSecurityGroupId: securityGroup.GroupId as string,
        Description: "Database from the SSM tunnel host (loom-tunnel)",
      })
    : undefined;

  const endpoints = props.ssmEndpoints
    ? buildSsmEndpoints(naming, tags, props, securityGroup.GroupId as string)
    : undefined;

  return {
    securityGroup,
    role,
    instanceProfile,
    instance,
    ...(dbIngress ? { dbIngress } : {}),
    ...(endpoints ?? {}),
  };
}, "LoomTunnelHost");
