import { phase, stackOutput, type Component } from "@intentius/chant/components";

/**
 * The `loom-agents` stack (chant#893) — the base path from #882: apply the
 * CloudFormation template `chant build src/loom-agents --lexicon aws`
 * synthesizes, then wait for the stack to settle. `cfn-deploy` +
 * `wait-for-stack` are both existing aws-lexicon capabilities — no bespoke
 * verb (same shape `examples/bedrock-agentcore-agent/agent.component.ts`,
 * chant#882, establishes). `archetype: "infra"` — no Build/Publish phase:
 * both agent images are supplied out-of-band (see
 * `../composites/loom-agents.ts`'s file header — this repo has no
 * agent-specific ECR repo to publish into).
 *
 * `dependsOn` orders agents last: `shared-foundation` (chant#886, the
 * artifact bucket + ECS security group agents reuse), `loom-cognito`
 * (chant#888, the OAuth2 token/discovery URLs AgentCore Identity's token
 * exchange sits on top of), and `loom-backend` (chant#889, so the backend
 * service the agents' tools call back into is already live).
 *
 * The `agentcore-deploy` version-promotion capability that would repoint
 * each agent's `RuntimeEndpoint` at a new `Runtime` version is deferred —
 * see chant#882 (GA-gated on Bedrock AgentCore Runtime, not on this stack).
 *
 * **No `docker-build` here, and not just a modeling choice (#20).** Vendoring
 * real `awslabs/loom` v1.6.0 source to wire `loom-backend`/`loom-frontend`'s
 * `docker-build` context (#20) turned up the reason this stack has never had
 * one: `agents/strands_agent/` ships no `Dockerfile` at all. Loom's own
 * backend builds this agent's deploy artifact at runtime
 * (`backend/app/services/deployment.py`'s `build_agent_artifact()` — pip-
 * installs the agent's `requirements.txt` and zips `agents/strands_agent/
 * src/` into an S3 object) and deploys it to Bedrock AgentCore Runtime via
 * `agentRuntimeArtifact.codeConfiguration` (a Python zip/code artifact,
 * `entryPoint: ["opentelemetry-instrument", "src/handler.py"]`) — never
 * `containerConfiguration`. So `assistantImageUri` staying an "already
 * exists, supplied out-of-band" `Parameter` (see
 * `../loom-agents/params.ts`) isn't a gap this repo could close by vendoring
 * a Dockerfile that doesn't exist upstream; it would need a different
 * capability (build a zip artifact, publish to S3, most likely a new
 * `agent-artifact-build`-shaped verb) to genuinely close, which is out of
 * #20's scope. `harnessImageUri`'s "stock/managed image" is unaffected
 * either way — it was never Loom source to vendor in the first place.
 */
export const loomAgents: Component = {
  name: "loom-agents",
  archetype: "infra",
  dependsOn: ["shared-foundation", "loom-cognito", "loom-backend"],
  deploy: [
    phase("Apply", [
      {
        kind: "cfn-deploy",
        stack: "loom-agents",
        template: "dist/loom-agents.template.json",
        inputs: {
          pArtifactBucket: stackOutput("shared-foundation", "oArtifactBucket"),
          pEcsSecurityGroupId: stackOutput("shared-foundation", "oEcsSecurityGroupId"),
          pPrivateSubnetIds: stackOutput("shared-foundation", "oPrivateSubnetIds"),
          pDomainName: stackOutput("shared-foundation", "oDomainName"),
          pCognitoTokenUrl: stackOutput("loom-cognito", "oCognitoTokenUrl"),
          pCognitoDiscoveryUrl: stackOutput("loom-cognito", "oCognitoDiscoveryUrl"),
        },
      },
    ]),
    phase("Verify", [
      { kind: "wait-for-stack", stack: "loom-agents" },
    ]),
  ],
};
