import { phase, stackOutput, type Component } from "@intentius/chant/components";
import { sn } from "../lib/stack-name";

/**
 * The `loom-agents` stack (chant#893) — the base path from #882: apply the
 * CloudFormation template `chant build src/loom-agents --lexicon aws`
 * synthesizes, then wait for the stack to settle. `cfn-deploy` +
 * `wait-for-stack` are both existing aws-lexicon capabilities — no bespoke
 * verb (same shape `examples/bedrock-agentcore-agent/agent.component.ts`,
 * chant#882, establishes). `archetype: "infra"` — no Build/Publish phase:
 * the agent artifacts are supplied out-of-band (see
 * `../composites/loom-agents.ts`'s file header — the Strands agent zip and
 * the harness's stock image both already exist).
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
 * `runtime: PYTHON_3_13`,
 * `entryPoint: ["opentelemetry-instrument", "src/handler.py"]`) — never
 * `containerConfiguration`. The composite models this directly through
 * `AgentCoreAgent`'s `code` artifact source (chant#973): `pAssistantCodePrefix`
 * (see `../loom-agents/params.ts`) is the zip's `code.s3.prefix` within the
 * shared-foundation artifact bucket. What stays out-of-band is only the zip
 * *build+upload* — pip-install the agent's `requirements.txt` and push the
 * archive to that prefix — which would need a new `agent-artifact-build`-shaped
 * verb to close (out of #20's scope). `harnessImageUri`'s "stock/managed
 * image" is unaffected either way — it was never Loom source to vendor.
 */
// A caller's own harness container image, threaded to the CFN parameter. Unset
// (the default) means the composite emits no harness Runtime (loomster#128).
const harnessAgentImageUri = process.env.LOOM_HARNESS_AGENT_IMAGE_URI ?? "";

export const loomAgents: Component = {
  name: "loom-agents",
  archetype: "infra",
  dependsOn: ["shared-foundation", "loom-cognito", "loom-backend"],
  deploy: [
    // Build + upload the Strands assistant zip to the artifact bucket first, so
    // the code-config Runtime's `code.s3` target exists before the stack applies
    // (loomster#128). shared-foundation is already up (dependsOn), so its bucket
    // exists. The `shell` escape hatch is the honest fit until an
    // `agent-artifact-build` verb exists.
    phase("Build", [
      {
        kind: "shell",
        cmd: "bash scripts/build-assistant-zip.sh",
        reason: "build + upload the Strands assistant zip to the artifact bucket for the code-config Runtime (loomster#128); no dedicated agent-artifact-build verb yet",
      },
    ]),
    phase("Apply", [
      {
        kind: "cfn-deploy",
        stack: sn("loom-agents"),
        template: "dist/loom-agents.template.json",
        inputs: {
          pArtifactBucket: stackOutput(sn("shared-foundation"), "oArtifactBucket"),
          pEcsSecurityGroupId: stackOutput(sn("shared-foundation"), "oEcsSecurityGroupId"),
          pPrivateSubnetIds: stackOutput(sn("shared-foundation"), "oPrivateSubnetIds"),
          pDomainName: stackOutput(sn("shared-foundation"), "oDomainName"),
          pCognitoTokenUrl: stackOutput(sn("loom-cognito"), "oCognitoTokenUrl"),
          pCognitoDiscoveryUrl: stackOutput(sn("loom-cognito"), "oCognitoDiscoveryUrl"),
          // Only meaningful when a caller supplies their own harness container
          // image (LOOM_HARNESS_AGENT_IMAGE_URI); unset → the composite emits no
          // harness Runtime (loomster#128), and this param stays its "" default.
          pHarnessAgentImageUri: harnessAgentImageUri,
        },
      },
    ]),
    phase("Verify", [
      { kind: "wait-for-stack", stack: sn("loom-agents") },
    ]),
  ],
};
