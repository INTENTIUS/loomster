import { describe, test, expect } from "vitest";
import { expandComposite } from "@intentius/chant";
import { resolveAttrRefs } from "@intentius/chant/discovery/resolve";
import { awsSerializer } from "@intentius/chant-lexicon-aws";
import { LoomAgents, type LoomAgentsProps } from "./loom-agents";
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

function baseProps(overrides: Partial<LoomAgentsProps> = {}): LoomAgentsProps {
  return {
    naming: lightNaming,
    artifactBucket: "loom-test-a-shared-foundation-artifacts-abc123",
    ecsSecurityGroupId: "sg-ecs-123",
    assistantCodePrefix: "strands_agent/agent.zip",
    ...overrides,
  };
}

const ASSISTANT_ONLY_MEMBERS = [
  "assistantRole", "assistantGatewayRole", "assistantRuntime", "assistantEndpoint",
  "assistantMemory", "assistantWorkloadIdentity", "assistantGateway", "assistantGatewayTarget",
  "assistantCodeInterpreterRole",
];

const HARNESS_AGENT_MEMBERS = [
  "harnessAgentRole", "harnessAgentGatewayRole", "harnessAgentRuntime", "harnessAgentEndpoint",
  "harnessAgentMemory", "harnessAgentWorkloadIdentity", "harnessAgentGateway", "harnessAgentGatewayTarget",
  "harnessAgentCodeInterpreterRole",
];

describe("LoomAgents — light tier", () => {
  test("returns only the assistant agent's members (low-code Strands, minimal set)", () => {
    const instance = LoomAgents(baseProps());
    expect(Object.keys(instance.members)).toEqual(ASSISTANT_ONLY_MEMBERS);
    expect(instance.harnessAgentRuntime).toBeUndefined();
  });

  test("assistant runs in PUBLIC network mode with no VPC config", () => {
    const instance = LoomAgents(baseProps());
    const runtimeProps = (instance.assistantRuntime as any).props;
    const netConfigProps = (runtimeProps.NetworkConfiguration as any).props;
    expect(netConfigProps.NetworkMode).toBe("PUBLIC");
    expect(netConfigProps.NetworkModeConfig).toBeUndefined();
  });

  test("protocol matches Loom's own create_runtime default (HTTP, not the composite's own MCP default)", () => {
    const instance = LoomAgents(baseProps());
    const runtimeProps = (instance.assistantRuntime as any).props;
    const protocolProps = (runtimeProps.ProtocolConfiguration as any)?.props ?? runtimeProps.ProtocolConfiguration;
    expect(protocolProps).toBe("HTTP");
  });

  test("assistant deploys as a code artifact (S3 zip on PYTHON_3_13), not a container", () => {
    const instance = LoomAgents(baseProps());
    const artifactProps = ((instance.assistantRuntime as any).props.AgentRuntimeArtifact as any).props;
    expect(artifactProps.ContainerConfiguration).toBeUndefined();
    const codeProps = (artifactProps.CodeConfiguration as any).props;
    expect(codeProps.Runtime).toBe("PYTHON_3_13");
    // Matches Loom's own create_runtime entryPoint (vendor/loom .../deployment.py).
    expect(codeProps.EntryPoint).toEqual(["opentelemetry-instrument", "src/handler.py"]);
    const s3 = (codeProps.Code as any).props.S3;
    expect(s3.Bucket).toBe("loom-test-a-shared-foundation-artifacts-abc123");
    expect(s3.Prefix).toBe("strands_agent/agent.zip");
  });

  test("privateSubnetIds is not required on light", () => {
    expect(() => LoomAgents(baseProps({ privateSubnetIds: undefined }))).not.toThrow();
  });

  test("physical names derive from the naming helper, not literals", () => {
    const instance = LoomAgents(baseProps());
    const runtimeProps = (instance.assistantRuntime as any).props;
    expect(runtimeProps.AgentRuntimeName).toBe("loom_test_a_loom_agents_assistant");
  });

  test("every taggable resource carries the full tag set (chant#896)", () => {
    const instance = LoomAgents(baseProps());
    const expectedTags = [
      { Key: "component", Value: "loom-agents" },
      { Key: "tier", Value: "light" },
      { Key: "env", Value: "test" },
      { Key: "owner", Value: "platform" },
      { Key: "instance", Value: "a" },
    ];
    for (const member of [instance.assistantRole, instance.assistantGatewayRole]) {
      const props = (member as any).props;
      for (const tag of expectedTags) {
        expect(props.Tags).toContainEqual(tag);
      }
    }
  });

  test("the assistant's role carries the Bedrock invoke, logs-delivery, identity-secrets, and artifact-bucket policies (execution-role extension, see file header)", () => {
    const instance = LoomAgents(baseProps());
    const roleProps = (instance.assistantRole as any).props;
    const policyNames = (roleProps.Policies as any[]).map((p) => (p as any).props.PolicyName);
    expect(policyNames).toEqual(
      expect.arrayContaining([
        "loom-test-a-loom-agents-assistant-bedrock-policy",
        "loom-test-a-loom-agents-assistant-artifact-bucket-policy",
        "loom-test-a-loom-agents-assistant-logs-delivery-policy",
        "loom-test-a-loom-agents-assistant-identity-secrets-policy",
      ]),
    );
  });

  test("WorkloadIdentity's OAuth2 return URL is unset when no cognitoTokenUrl is given", () => {
    const instance = LoomAgents(baseProps());
    const identityProps = (instance.assistantWorkloadIdentity as any).props;
    expect(identityProps.AllowedResourceOauth2ReturnUrls).toBeUndefined();
  });

  test("WorkloadIdentity's OAuth2 return URL threads loom-cognito's token endpoint when given (AgentCore Identity / RFC 8693 token exchange)", () => {
    const instance = LoomAgents(baseProps({ cognitoTokenUrl: "https://loom-test-a.auth.us-east-1.amazoncognito.com/oauth2/token" }));
    const identityProps = (instance.assistantWorkloadIdentity as any).props;
    expect(identityProps.AllowedResourceOauth2ReturnUrls).toEqual([
      "https://loom-test-a.auth.us-east-1.amazoncognito.com/oauth2/token",
    ]);
  });

  test("bedrockModelArns defaults match shared-foundation's own agentRole default", () => {
    const instance = LoomAgents(baseProps());
    const roleProps = (instance.assistantRole as any).props;
    const bedrockPolicy = (roleProps.Policies as any[])
      .map((p) => (p as any).props)
      .find((p) => p.PolicyName === "loom-test-a-loom-agents-assistant-bedrock-policy");
    expect((bedrockPolicy.PolicyDocument as any).Statement[0].Resource).toEqual(["arn:aws:bedrock:*::foundation-model/*"]);
  });

  test("provisions a Code Interpreter sandbox execution role for the assistant (Loom's code_interpreter_role.yaml)", () => {
    const instance = LoomAgents(baseProps());
    expect(instance.assistantCodeInterpreterRole).toBeDefined();
    const ciProps = (instance.assistantCodeInterpreterRole as any).props;
    expect(ciProps.RoleName).toBe("loom-test-a-loom-agents-assistant-ci-role");
    // Trust: bedrock-agentcore, with the confused-deputy SourceAccount guard.
    const trust = ciProps.AssumeRolePolicyDocument as any;
    expect(trust.Statement[0].Principal.Service).toBe("bedrock-agentcore.amazonaws.com");
    expect(trust.Statement[0].Condition.StringEquals["aws:SourceAccount"]).toBeDefined();
    // Sandbox permissions: S3 (code-interpreter bucket) + CloudWatch Logs.
    const policyDoc = ((ciProps.Policies as any[])[0] as any).props.PolicyDocument as any;
    const actions = policyDoc.Statement.flatMap((s: any) => s.Action);
    expect(actions).toEqual(
      expect.arrayContaining(["s3:GetObject", "s3:PutObject", "logs:CreateLogGroup", "logs:PutLogEvents"]),
    );
    // The loom:role_type discriminator Loom's own role carries.
    expect(ciProps.Tags).toContainEqual({ Key: "loom:role_type", Value: "code_interpreter" });
  });

  test("codeInterpreter: false omits the Code Interpreter role", () => {
    const instance = LoomAgents(baseProps({ codeInterpreter: false }));
    expect(instance.assistantCodeInterpreterRole).toBeUndefined();
    expect(Object.keys(instance.members)).not.toContain("assistantCodeInterpreterRole");
  });
});

describe("LoomAgents — production tier", () => {
  const fullTierOverrides: Partial<LoomAgentsProps> = {
    naming: prodNaming,
    privateSubnetIds: ["subnet-priv1", "subnet-priv2"],
    harnessImageUri: "111111111111.dkr.ecr.us-east-1.amazonaws.com/loom-harness-agent@sha256:def",
  };

  test("adds the no-code harness agent's members (full agent set)", () => {
    const instance = LoomAgents(baseProps(fullTierOverrides));
    expect(Object.keys(instance.members)).toEqual([...ASSISTANT_ONLY_MEMBERS, ...HARNESS_AGENT_MEMBERS]);
    expect(instance.harnessAgentRuntime).toBeDefined();
  });

  test("privateSubnetIds is required — throws a clear error when missing", () => {
    expect(() => LoomAgents(baseProps({ naming: prodNaming }))).toThrow(/privateSubnetIds is required/);
  });

  test("both agents run in VPC network mode using the given subnets + SG", () => {
    const instance = LoomAgents(baseProps(fullTierOverrides));
    for (const runtime of [instance.assistantRuntime, instance.harnessAgentRuntime!]) {
      const runtimeProps = (runtime as any).props;
      const netConfigProps = (runtimeProps.NetworkConfiguration as any).props;
      expect(netConfigProps.NetworkMode).toBe("VPC");
      const vpcConfigProps = (netConfigProps.NetworkModeConfig as any).props;
      expect(vpcConfigProps.Subnets).toEqual(["subnet-priv1", "subnet-priv2"]);
      expect(vpcConfigProps.SecurityGroups).toEqual(["sg-ecs-123"]);
    }
  });

  test("memory retention extends to 90 days on full tier (light stays at the #882 composite's own 30-day default)", () => {
    const light = LoomAgents(baseProps());
    const full = LoomAgents(baseProps(fullTierOverrides));
    expect((light.assistantMemory as any).props.EventExpiryDuration).toBe(30);
    expect((full.assistantMemory as any).props.EventExpiryDuration).toBe(90);
    expect((full.harnessAgentMemory as any).props.EventExpiryDuration).toBe(90);
  });

  test("memoryEventExpiryDays is overridable", () => {
    const instance = LoomAgents(baseProps({ ...fullTierOverrides, memoryEventExpiryDays: 45 }));
    expect((instance.assistantMemory as any).props.EventExpiryDuration).toBe(45);
  });

  test("provisions a Code Interpreter role for the harness agent too (per-agent, like Loom)", () => {
    const instance = LoomAgents(baseProps(fullTierOverrides));
    expect(instance.harnessAgentCodeInterpreterRole).toBeDefined();
    expect((instance.harnessAgentCodeInterpreterRole as any).props.RoleName).toBe(
      "loom-test-a-loom-agents-harness-agent-ci-role",
    );
  });
});

describe("LoomAgents — production-ha tier", () => {
  test("same full agent set as production (chant#890 — tier alone selects the set)", () => {
    const instance = LoomAgents(baseProps({
      naming: prodHaNaming,
      privateSubnetIds: ["subnet-priv1", "subnet-priv2"],
    }));
    expect(Object.keys(instance.members)).toEqual([...ASSISTANT_ONLY_MEMBERS, ...HARNESS_AGENT_MEMBERS]);
  });
});

describe("LoomAgents — naming collisions across tiers/instances", () => {
  test("two instances in the same project/env/account never collide on physical names", () => {
    const a = LoomAgents(baseProps({ naming: { ...lightNaming, instance: "a" } }));
    const b = LoomAgents(baseProps({ naming: { ...lightNaming, instance: "b" } }));
    const nameA = (a.assistantRuntime as any).props.AgentRuntimeName;
    const nameB = (b.assistantRuntime as any).props.AgentRuntimeName;
    expect(nameA).not.toBe(nameB);
  });
});

describe("LoomAgents — serializes to valid CloudFormation", () => {
  test("light tier: template has Resources for every member, no dangling refs", () => {
    const instance = LoomAgents(baseProps());
    const expanded = expandComposite("loomAgents", instance);
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
    expect(template.Resources.loomAgentsAssistantRuntime.Type).toBe("AWS::BedrockAgentCore::Runtime");
    expect(template.Resources.loomAgentsAssistantEndpoint.Type).toBe("AWS::BedrockAgentCore::RuntimeEndpoint");
    expect(template.Resources.loomAgentsAssistantMemory.Type).toBe("AWS::BedrockAgentCore::Memory");
    expect(template.Resources.loomAgentsAssistantGateway.Type).toBe("AWS::BedrockAgentCore::Gateway");
    expect(template.Resources.loomAgentsAssistantWorkloadIdentity.Type).toBe("AWS::BedrockAgentCore::WorkloadIdentity");
    expect(Object.keys(template.Resources)).not.toContain("loomAgentsHarnessAgentRuntime");
  });

  test("production tier: template includes both agents and stays internally consistent", () => {
    const instance = LoomAgents(baseProps({
      naming: prodNaming,
      privateSubnetIds: ["subnet-priv1", "subnet-priv2"],
      harnessImageUri: "111111111111.dkr.ecr.us-east-1.amazonaws.com/loom-harness-agent@sha256:def",
    }));
    const expanded = expandComposite("loomAgents", instance);
    resolveAttrRefs(expanded);
    const output = awsSerializer.serialize(expanded) as string;
    expect(output).not.toContain("[object Object]");

    const template = JSON.parse(output);
    expect(template.Resources.loomAgentsHarnessAgentRuntime.Type).toBe("AWS::BedrockAgentCore::Runtime");
    expect(template.Resources.loomAgentsAssistantRuntime.Type).toBe("AWS::BedrockAgentCore::Runtime");
    // Endpoint's AgentRuntimeId references its own agent's Runtime, not the other agent's.
    expect(template.Resources.loomAgentsAssistantEndpoint.Properties.AgentRuntimeId).toEqual({
      "Fn::GetAtt": ["loomAgentsAssistantRuntime", "AgentRuntimeId"],
    });
    expect(template.Resources.loomAgentsHarnessAgentEndpoint.Properties.AgentRuntimeId).toEqual({
      "Fn::GetAtt": ["loomAgentsHarnessAgentRuntime", "AgentRuntimeId"],
    });
  });
});
