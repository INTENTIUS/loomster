import { describe, test, expect } from "vitest";
import { expandComposite } from "@intentius/chant";
import { resolveAttrRefs } from "@intentius/chant/discovery/resolve";
import { awsSerializer } from "@intentius/chant-lexicon-aws";
import { LoomFrontend, type LoomFrontendProps } from "./loom-frontend";
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

const prodHaNaming: LoomNamingParams = { ...lightNaming, tier: "production-ha" };

function baseProps(overrides: Partial<LoomFrontendProps> = {}): LoomFrontendProps {
  return {
    naming: lightNaming,
    ecsClusterArn: "arn:aws:ecs:us-east-1:111111111111:cluster/loom-cluster",
    ecsSecurityGroupId: "sg-ecs-123",
    targetGroupArn: "arn:aws:elasticloadbalancing:us-east-1:111111111111:targetgroup/loom-fe-tg/abc",
    imageUri: "111111111111.dkr.ecr.us-east-1.amazonaws.com/loom-frontend@sha256:abc",
    publicSubnetIds: ["subnet-pub1", "subnet-pub2"],
    ...overrides,
  };
}

describe("LoomFrontend — light tier", () => {
  test("RuntimePlatform defaults to X86_64/LINUX; ARM64 when set (#62)", () => {
    const def = (LoomFrontend(baseProps()).taskDefinition as any).props.RuntimePlatform.props;
    expect(def.CpuArchitecture).toBe("X86_64");
    expect(def.OperatingSystemFamily).toBe("LINUX");
    const arm = (LoomFrontend(baseProps({ cpuArchitecture: "ARM64" })).taskDefinition as any).props.RuntimePlatform.props;
    expect(arm.CpuArchitecture).toBe("ARM64");
  });

  test("network configuration uses the given public subnets + SG, public IP assigned (matches Loom's own template)", () => {
    const instance = LoomFrontend(baseProps());
    const props = (instance.service as any).props;
    const netConfig = (props.NetworkConfiguration as any).props;
    const vpcConfig = (netConfig.AwsvpcConfiguration as any).props;
    expect(vpcConfig.Subnets).toEqual(["subnet-pub1", "subnet-pub2"]);
    expect(vpcConfig.SecurityGroups).toEqual(["sg-ecs-123"]);
    expect(vpcConfig.AssignPublicIp).toBe("ENABLED");
  });
});

describe("LoomFrontend — production-ha tier", () => {
  test("desiredCount bumps to 2 (this repo's own HA convention — Loom's own template has no tier concept)", () => {
    const instance = LoomFrontend(baseProps({ naming: prodHaNaming }));
    const props = (instance.service as any).props;
    expect(props.DesiredCount).toBe(2);
  });

  test("still no autoscaling resources — Loom's frontend template never has any, at any tier", () => {
    const instance = LoomFrontend(baseProps({ naming: prodHaNaming }));
    const names = Object.keys(instance.members);
    expect(names).not.toContain("scalableTarget");
    expect(names).not.toContain("scalingPolicy");
  });
});

describe("LoomFrontend — naming and tags", () => {
  // chant#896 — component/tier/env/owner/instance, always all five, sourced
  // from the one `naming.tags()` call. Checked on every member this composite
  // returns (no tier-gated members here — see file header) across tiers so
  // `tier` itself is proven to flow through.
  test("every taggable resource carries the full tag set (light tier)", () => {
    const instance = LoomFrontend(baseProps());
    const expectedTags = [
      { Key: "component", Value: "loom-frontend" },
      { Key: "tier", Value: "light" },
      { Key: "env", Value: "test" },
      { Key: "owner", Value: "platform" },
      { Key: "instance", Value: "a" },
    ];
    for (const member of [instance.logsKmsKey, instance.logGroup, instance.executionRole, instance.taskDefinition, instance.service]) {
      const props = (member as any).props;
      for (const tag of expectedTags) {
        expect(props.Tags).toContainEqual(tag);
      }
    }
  });

  test("production-ha tier: tag's tier value is production-ha on the service", () => {
    const instance = LoomFrontend(baseProps({ naming: prodHaNaming }));
    const serviceProps = (instance.service as any).props;
    expect(serviceProps.Tags).toContainEqual({ Key: "tier", Value: "production-ha" });
    expect(serviceProps.Tags).toContainEqual({ Key: "owner", Value: "platform" });
  });
});

describe("LoomFrontend — serializes to valid CloudFormation", () => {
  test("light tier: template has Resources for every member, no dangling refs", () => {
    const instance = LoomFrontend(baseProps());
    const expanded = expandComposite("loomFrontend", instance);
    resolveAttrRefs(expanded);
    const output = awsSerializer.serialize(expanded) as string;

    // Guards against chant#918-style bugs: template-literal concatenation on
    // a Ref/AttrRef intrinsic silently stringifies to "[object Object]"
    // instead of a valid CFN intrinsic.
    expect(output).not.toContain("[object Object]");

    const template = JSON.parse(output);

    expect(template.AWSTemplateFormatVersion).toBe("2010-09-09");
    expect(Object.keys(template.Resources)).toHaveLength(expanded.size);
    for (const resource of Object.values(template.Resources) as any[]) {
      expect(typeof resource.Type).toBe("string");
      expect(resource.Type.startsWith("AWS::")).toBe(true);
    }
    expect(template.Resources.loomFrontendTaskDefinition.Type).toBe("AWS::ECS::TaskDefinition");
    expect(template.Resources.loomFrontendService.Type).toBe("AWS::ECS::Service");
    expect(template.Resources.loomFrontendLogGroup.Type).toBe("AWS::Logs::LogGroup");
  });
});

describe("LoomFrontend — reference-existing execution role (loomster#66)", () => {
  const executionRoleArn = "arn:aws:iam::111111111111:role/platform-loom-fe-exec";

  test("creates no execution Role resource; the task def uses the provided ARN", () => {
    const instance = LoomFrontend(baseProps({
      iamRole: { mode: "reference-existing", executionRoleArn },
    }));
    expect(Object.keys(instance.members)).not.toContain("executionRole");
    expect((instance.taskDefinition as any).props.ExecutionRoleArn).toBe(executionRoleArn);
  });

  test("provision (default) still creates the execution role", () => {
    expect(Object.keys(LoomFrontend(baseProps()).members)).toContain("executionRole");
  });
});
