import { describe, test, expect } from "vitest";
import { expandComposite } from "@intentius/chant";
import { resolveAttrRefs } from "@intentius/chant/discovery/resolve";
import { awsSerializer } from "@intentius/chant-lexicon-aws";
import { LoomBackend, type LoomBackendProps } from "./loom-backend";
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

function baseProps(overrides: Partial<LoomBackendProps> = {}): LoomBackendProps {
  return {
    naming: lightNaming,
    ecsClusterArn: "arn:aws:ecs:us-east-1:111111111111:cluster/loom-cluster",
    ecsClusterName: "loom-cluster",
    ecsSecurityGroupId: "sg-ecs-123",
    targetGroupArn: "arn:aws:elasticloadbalancing:us-east-1:111111111111:targetgroup/loom-be-tg/abc",
    artifactBucket: "loom-test-a-shared-foundation-artifacts-abc123",
    ecrKmsKeyArn: "arn:aws:kms:us-east-1:111111111111:key/ecr-key",
    databaseSecretArn: "arn:aws:secretsmanager:us-east-1:111111111111:secret:loom-db-url",
    secretsKmsKeyArn: "arn:aws:kms:us-east-1:111111111111:key/secrets-key",
    imageUri: "111111111111.dkr.ecr.us-east-1.amazonaws.com/loom-backend@sha256:abc",
    privateSubnetIds: ["subnet-priv1", "subnet-priv2"],
    cognitoUserPoolId: "us-east-1_ABC123",
    ...overrides,
  };
}

describe("LoomBackend — light tier", () => {
  test("returns the core members, no autoscaling", () => {
    const instance = LoomBackend(baseProps());
    const names = Object.keys(instance.members);
    for (const expected of ["logsKmsKey", "logGroup", "executionRole", "taskRole", "taskDefinition", "service"]) {
      expect(names).toContain(expected);
    }
    for (const absent of ["scalableTarget", "scalingPolicy"]) {
      expect(names).not.toContain(absent);
    }
  });

  test("desiredCount defaults to 1", () => {
    const instance = LoomBackend(baseProps());
    const props = (instance.service as any).props;
    expect(props.DesiredCount).toBe(1);
  });

  test("cpu/memory default to Loom's own values (1024/2048)", () => {
    const instance = LoomBackend(baseProps());
    const props = (instance.taskDefinition as any).props;
    expect(props.Cpu).toBe("1024");
    expect(props.Memory).toBe("2048");
  });

  test("container never runs privileged and always has a LogConfiguration (WAW047/WAW048)", () => {
    const instance = LoomBackend(baseProps());
    const props = (instance.taskDefinition as any).props;
    const container = (props.ContainerDefinitions[0] as any).props;
    expect(container.Privileged).toBeUndefined();
    expect(container.LogConfiguration).toBeDefined();
  });

  test("by default (no databaseUrlPlain) the DB URL is threaded via Secrets, never plaintext Environment (WAW046)", () => {
    const instance = LoomBackend(baseProps());
    const props = (instance.taskDefinition as any).props;
    const container = (props.ContainerDefinitions[0] as any).props;
    const secretNames = (container.Secrets as any[]).map((s) => (s as any).props.Name);
    expect(secretNames).toContain("LOOM_DATABASE_URL");
    const envNames = (container.Environment as any[]).map((e) => (e as any).props.Name);
    expect(envNames).not.toContain("LOOM_DATABASE_URL");
    // No secret-looking name ever rides in plaintext Environment.
    for (const name of envNames) {
      expect(name).not.toMatch(/password|secret|token|api[_-]?key|credential/i);
    }
  });

  test("databaseUrlPlain (#46, light tier): LOOM_DATABASE_URL rides plain Environment and the DB-URL Secret is omitted", () => {
    const instance = LoomBackend(baseProps({ databaseUrlPlain: "postgresql+psycopg2://loom:pw@ep:5432/loom" }));
    const container = ((instance.taskDefinition as any).props.ContainerDefinitions[0] as any).props;
    const env = (container.Environment as any[]).map((e) => (e as any).props);
    const dbEnv = env.find((e) => e.Name === "LOOM_DATABASE_URL");
    expect(dbEnv?.Value).toBe("postgresql+psycopg2://loom:pw@ep:5432/loom");
    const secretNames = (container.Secrets as any[]).map((s) => (s as any).props.Name);
    expect(secretNames).not.toContain("LOOM_DATABASE_URL");
    // WAW046 keys on the variable name; LOOM_DATABASE_URL is not a secret-name, so this stays lint-clean.
    expect("LOOM_DATABASE_URL").not.toMatch(/password|secret|token|api[_-]?key|credential/i);
  });

  test("secrets audit (#47): light tier (databaseUrlPlain, no litellm key) emits ZERO Secrets — nothing for Floci's ECS to fail to inject", () => {
    const instance = LoomBackend(baseProps({ databaseUrlPlain: "postgresql+psycopg2://loom:pw@ep:5432/loom" }));
    const container = ((instance.taskDefinition as any).props.ContainerDefinitions[0] as any).props;
    // The DB URL is the only required secret and rides plain Environment on light;
    // LOOM_LITELLM_PROXY_API_KEY is optional (absent unless a key ARN is configured).
    expect(container.Secrets).toEqual([]);
  });

  test("network configuration uses the given private subnets + SG, no public IP", () => {
    const instance = LoomBackend(baseProps());
    const props = (instance.service as any).props;
    const netConfig = (props.NetworkConfiguration as any).props;
    const vpcConfig = (netConfig.AwsvpcConfiguration as any).props;
    expect(vpcConfig.Subnets).toEqual(["subnet-priv1", "subnet-priv2"]);
    expect(vpcConfig.SecurityGroups).toEqual(["sg-ecs-123"]);
    expect(vpcConfig.AssignPublicIp).toBe("DISABLED");
  });
});

describe("LoomBackend — production tier", () => {
  test("adds ScalableTarget + ScalingPolicy, min capacity 1", () => {
    const instance = LoomBackend(baseProps({ naming: prodNaming }));
    const names = Object.keys(instance.members);
    expect(names).toContain("scalableTarget");
    expect(names).toContain("scalingPolicy");
    const targetProps = (instance.scalableTarget as any).props;
    expect(targetProps.MinCapacity).toBe(1);
    expect(targetProps.MaxCapacity).toBe(4);
  });

  test("desiredCount stays 1 on production", () => {
    const instance = LoomBackend(baseProps({ naming: prodNaming }));
    const props = (instance.service as any).props;
    expect(props.DesiredCount).toBe(1);
  });
});

describe("LoomBackend — production-ha tier", () => {
  test("desiredCount and ScalableTarget MinCapacity both bump to 2", () => {
    const instance = LoomBackend(baseProps({ naming: prodHaNaming }));
    const serviceProps = (instance.service as any).props;
    expect(serviceProps.DesiredCount).toBe(2);
    const targetProps = (instance.scalableTarget as any).props;
    expect(targetProps.MinCapacity).toBe(2);
  });
});

describe("LoomBackend — overrides", () => {
  test("cpu/memory/desiredCount/maxCount are all overridable", () => {
    const instance = LoomBackend(baseProps({
      naming: prodNaming,
      cpu: "2048",
      memory: "4096",
      desiredCount: 3,
      maxCount: 10,
    }));
    const taskProps = (instance.taskDefinition as any).props;
    expect(taskProps.Cpu).toBe("2048");
    expect(taskProps.Memory).toBe("4096");
    const serviceProps = (instance.service as any).props;
    expect(serviceProps.DesiredCount).toBe(3);
    const targetProps = (instance.scalableTarget as any).props;
    expect(targetProps.MaxCapacity).toBe(10);
  });

  test("litellm proxy API key secret, when given, is threaded via Secrets and grants an extra KMS statement", () => {
    const instance = LoomBackend(baseProps({
      litellmProxyApiKeySecretArn: "arn:aws:secretsmanager:us-east-1:111111111111:secret:litellm-key",
      litellmProxyApiKeySecretKmsKeyArn: "arn:aws:kms:us-east-1:111111111111:key/litellm-key",
    }));
    const taskProps = (instance.taskDefinition as any).props;
    const container = (taskProps.ContainerDefinitions[0] as any).props;
    const secretNames = (container.Secrets as any[]).map((s) => (s as any).props.Name);
    expect(secretNames).toContain("LOOM_LITELLM_PROXY_API_KEY");
  });
});

describe("LoomBackend — naming and tags", () => {
  test("physical names derive from the naming helper, not literals", () => {
    const instance = LoomBackend(baseProps());
    const taskProps = (instance.taskDefinition as any).props;
    expect(taskProps.Family).toBe("loom-test-a-loom-backend-backend-task");
    const serviceProps = (instance.service as any).props;
    expect(serviceProps.ServiceName).toBe("loom-test-a-loom-backend-backend-svc");
  });

  // chant#896 — component/tier/env/owner/instance, always all five, sourced
  // from the one `naming.tags()` call. Checked on every always-present
  // member (KMS, execution/task roles, task definition, service) plus the
  // production/production-ha-only autoscaling members, across tiers so
  // `tier` itself is proven to flow through.
  test("every taggable resource carries the full tag set (light tier)", () => {
    const instance = LoomBackend(baseProps());
    const expectedTags = [
      { Key: "component", Value: "loom-backend" },
      { Key: "tier", Value: "light" },
      { Key: "env", Value: "test" },
      { Key: "owner", Value: "platform" },
      { Key: "instance", Value: "a" },
    ];
    for (const member of [instance.logsKmsKey, instance.logGroup, instance.executionRole, instance.taskRole, instance.taskDefinition, instance.service]) {
      const props = (member as any).props;
      for (const tag of expectedTags) {
        expect(props.Tags).toContainEqual(tag);
      }
    }
  });

  test("production-ha tier: tag's tier value is production-ha on the service", () => {
    const instance = LoomBackend(baseProps({ naming: prodHaNaming }));
    const serviceProps = (instance.service as any).props;
    expect(serviceProps.Tags).toContainEqual({ Key: "tier", Value: "production-ha" });
    expect(serviceProps.Tags).toContainEqual({ Key: "owner", Value: "platform" });
  });
});

describe("LoomBackend — serializes to valid CloudFormation", () => {
  test("light tier: template has Resources for every member, no dangling refs", () => {
    const instance = LoomBackend(baseProps());
    const expanded = expandComposite("loomBackend", instance);
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
    expect(template.Resources.loomBackendTaskDefinition.Type).toBe("AWS::ECS::TaskDefinition");
    expect(template.Resources.loomBackendService.Type).toBe("AWS::ECS::Service");
    expect(template.Resources.loomBackendLogGroup.Type).toBe("AWS::Logs::LogGroup");
  });

  test("production tier: template includes the autoscaling resources and stays internally consistent", () => {
    const instance = LoomBackend(baseProps({ naming: prodNaming }));
    const expanded = expandComposite("loomBackend", instance);
    resolveAttrRefs(expanded);
    const output = awsSerializer.serialize(expanded) as string;
    const template = JSON.parse(output);

    expect(template.Resources.loomBackendScalableTarget.Type).toBe("AWS::ApplicationAutoScaling::ScalableTarget");
    expect(template.Resources.loomBackendScalingPolicy.Type).toBe("AWS::ApplicationAutoScaling::ScalingPolicy");
    const policyProps = template.Resources.loomBackendScalingPolicy.Properties;
    expect(policyProps.ScalingTargetId).toEqual({ Ref: "loomBackendScalableTarget" });
  });
});
