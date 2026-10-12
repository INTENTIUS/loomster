import { describe, test, expect } from "vitest";
import { expandComposite } from "@intentius/chant";
import { resolveAttrRefs } from "@intentius/chant/discovery/resolve";
import { awsSerializer } from "@intentius/chant-lexicon-aws";
import { LoomAgentRole, type LoomAgentRoleProps } from "./loom-agent-role";
import type { LoomNamingParams } from "../lib/naming";

const naming: LoomNamingParams = {
  project: "loom",
  env: "test",
  instance: "a",
  tier: "light",
  region: "us-east-1",
  accountId: "111111111111",
  owner: "platform",
};

function synth(overrides: Partial<LoomAgentRoleProps> = {}) {
  const instance = LoomAgentRole({ naming, agentName: "support_bot", group: "g-support", ...overrides });
  const expanded = expandComposite("agentRole", instance);
  resolveAttrRefs(expanded);
  const output = awsSerializer.serialize(expanded) as string;
  const template = JSON.parse(output);
  const role = template.Resources.agentRoleRole;
  const policies: Record<string, any[]> = {};
  for (const p of role.Properties.Policies) policies[p.PolicyName.replace("loom-test-a-agent-role-support-bot-", "")] = p.PolicyDocument.Statement;
  return { output, role, policies };
}

const sub = (s: string) => ({ "Fn::Sub": s });

// Pinned to awslabs/loom v1.9.0 shared/iac/role.yaml (a3050669). When Loom
// changes that file, port the change to loom-agent-role.ts and update these.
describe("LoomAgentRole — Loom v1.9.0 role.yaml, statement for statement (loomster#2)", () => {
  test("role name, trust policy and loom:* tags", () => {
    const { role, output } = synth();
    expect(output).not.toContain("[object Object]");
    expect(role.Type).toBe("AWS::IAM::Role");
    // Starts with the project, so the backend task role's iam:PassRole (loom-*) covers it.
    expect(role.Properties.RoleName).toBe("loom-test-a-agent-role-support-bot");
    expect(role.Properties.AssumeRolePolicyDocument.Statement).toEqual([
      {
        Effect: "Allow",
        Principal: { Service: "bedrock-agentcore.amazonaws.com" },
        Action: "sts:AssumeRole",
        Condition: { StringEquals: { "aws:SourceAccount": { "Fn::Sub": "${AWS::AccountId}" } } },
      },
    ]);
    expect(role.Properties.Tags).toEqual(expect.arrayContaining([
      { Key: "loom:application", Value: "loomster" },
      { Key: "loom:group", Value: "g-support" },
      { Key: "loom:owner", Value: "platform" },
    ]));
  });

  test("the four always-present policies, in role.yaml's order", () => {
    expect(Object.keys(synth().policies)).toEqual(["bedrock", "bedrock-agentcore", "secretsmanager", "observability"]);
  });

  test("bedrock: invoke only", () => {
    expect(synth().policies.bedrock).toEqual([
      {
        Effect: "Allow",
        Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        Resource: [
          sub("arn:${AWS::Partition}:bedrock:*:${AWS::AccountId}:inference-profile/*"),
          sub("arn:${AWS::Partition}:bedrock:*::foundation-model/*"),
        ],
      },
    ]);
  });

  test("bedrock-agentcore: workload identity split out; credential providers scoped to loom-<agent>-* (v1.8.1, H1-3956464)", () => {
    expect(synth().policies["bedrock-agentcore"]).toEqual([
      {
        Effect: "Allow",
        Action: [
          "bedrock-agentcore:CreateWorkloadIdentity",
          "bedrock-agentcore:GetWorkloadAccessToken",
          "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
          "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
        ],
        Resource: [sub("arn:${AWS::Partition}:bedrock-agentcore:*:${AWS::AccountId}:workload-identity-directory/*")],
      },
      {
        Effect: "Allow",
        Action: ["bedrock-agentcore:GetApiKeyCredential", "bedrock-agentcore:GetResourceApiKey", "bedrock-agentcore:GetResourceOauth2Token"],
        Resource: [
          sub("arn:${AWS::Partition}:bedrock-agentcore:*:${AWS::AccountId}:token-vault/default/oauth2credentialprovider/loom-support_bot-*"),
          sub("arn:${AWS::Partition}:bedrock-agentcore:*:${AWS::AccountId}:token-vault/default/apikeycredentialprovider/loom-support_bot-*"),
        ],
      },
    ]);
  });

  test("secretsmanager: AgentCore identity secrets plus this agent's own", () => {
    expect(synth().policies.secretsmanager).toEqual([
      {
        Effect: "Allow",
        Action: "secretsmanager:GetSecretValue",
        Resource: [
          sub("arn:${AWS::Partition}:secretsmanager:*:${AWS::AccountId}:secret:bedrock-agentcore-identity!*"),
          sub("arn:${AWS::Partition}:secretsmanager:*:${AWS::AccountId}:secret:loom/agents/support_bot*"),
          sub("arn:${AWS::Partition}:secretsmanager:*:${AWS::AccountId}:secret:loom/agents/harness_support_bot*"),
        ],
      },
    ]);
  });

  test("observability: logs incl. PutResourcePolicy on this agent's runtime log groups", () => {
    expect(synth().policies.observability).toEqual([
      { Effect: "Allow", Action: ["logs:DescribeLogGroups", "xray:PutTelemetryRecords", "xray:PutTraceSegments"], Resource: "*" },
      {
        Effect: "Allow",
        Action: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:DescribeLogStreams",
          "logs:FilterLogEvents",
          "logs:GetLogEvents",
          "logs:PutLogEvents",
          "logs:PutResourcePolicy",
        ],
        Resource: [
          sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/bedrock-agentcore/runtimes/support_bot*"),
          sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/bedrock-agentcore/runtimes/harness_support_bot*"),
        ],
      },
    ]);
  });

  test("memory and code-interpreter policies only when asked for", () => {
    const memoryArn = "arn:aws:bedrock-agentcore:us-east-1:111111111111:memory/demo-abc";
    const { policies } = synth({ memoryArn, codeInterpreter: true });
    expect(Object.keys(policies)).toEqual(["bedrock", "bedrock-agentcore", "secretsmanager", "observability", "memory", "code-interpreter"]);
    expect(policies.memory[0].Resource).toBe(memoryArn);
    expect(policies.memory[0].Action).toContain("bedrock-agentcore:RetrieveMemoryRecords");
    expect(policies["code-interpreter"][0].Resource).toEqual([
      sub("arn:${AWS::Partition}:bedrock-agentcore:*:aws:code-interpreter/*"),
      sub("arn:${AWS::Partition}:bedrock-agentcore:*:${AWS::AccountId}:code-interpreter/*"),
      sub("arn:${AWS::Partition}:bedrock-agentcore:*:${AWS::AccountId}:code-interpreter-custom/*"),
    ]);
  });

  test("an agent name that makes the role name over 64 characters is refused", () => {
    expect(() => synth({ agentName: "a_very_long_agent_name_that_will_never_fit_in_an_iam_role" })).toThrow(/over 64 characters/);
  });
});
