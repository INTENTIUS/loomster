/**
 * Named outputs for the `loom-agents` stack (chant#893) — the identifiers a
 * future `agentcore-deploy` version-promotion capability (deferred, GA-gated
 * — see chant#882) would eventually need, plus the Memory/WorkloadIdentity
 * ARNs the blog-refinement comment calls out (chant#893). `oHarness*` only
 * exist on production/production-ha, matching `agents.harnessAgentRuntime`
 * (and its siblings) being undefined on light (chant#890).
 */

import { output } from "@intentius/chant-lexicon-aws";
import { agents } from "./agents";

export const oAssistantRuntimeArn = output(agents.assistantRuntime.AgentRuntimeArn, "oAssistantRuntimeArn");
export const oAssistantRuntimeVersion = output(agents.assistantRuntime.AgentRuntimeVersion, "oAssistantRuntimeVersion");
// Present only if the endpoint was opted in (chant#978) — by default it's created
// out-of-band once the Runtime is READY, so there's no CFN endpoint to reference.
export const oAssistantEndpointArn = agents.assistantEndpoint
  ? output(agents.assistantEndpoint.AgentRuntimeEndpointArn, "oAssistantEndpointArn")
  : undefined;
export const oAssistantMemoryArn = output(agents.assistantMemory.MemoryArn, "oAssistantMemoryArn");
export const oAssistantWorkloadIdentityArn = output(agents.assistantWorkloadIdentity.WorkloadIdentityArn, "oAssistantWorkloadIdentityArn");
export const oAssistantGatewayUrl = output(agents.assistantGateway.GatewayUrl, "oAssistantGatewayUrl");
export const oAssistantCodeInterpreterRoleArn = agents.assistantCodeInterpreterRole
  ? output(agents.assistantCodeInterpreterRole.Arn, "oAssistantCodeInterpreterRoleArn")
  : undefined;

export const oHarnessAgentRuntimeArn = agents.harnessAgentRuntime
  ? output(agents.harnessAgentRuntime.AgentRuntimeArn, "oHarnessAgentRuntimeArn")
  : undefined;
export const oHarnessAgentRuntimeVersion = agents.harnessAgentRuntime
  ? output(agents.harnessAgentRuntime.AgentRuntimeVersion, "oHarnessAgentRuntimeVersion")
  : undefined;
export const oHarnessAgentEndpointArn = agents.harnessAgentEndpoint
  ? output(agents.harnessAgentEndpoint.AgentRuntimeEndpointArn, "oHarnessAgentEndpointArn")
  : undefined;
export const oHarnessAgentMemoryArn = agents.harnessAgentMemory
  ? output(agents.harnessAgentMemory.MemoryArn, "oHarnessAgentMemoryArn")
  : undefined;
export const oHarnessAgentCodeInterpreterRoleArn = agents.harnessAgentCodeInterpreterRole
  ? output(agents.harnessAgentCodeInterpreterRole.Arn, "oHarnessAgentCodeInterpreterRoleArn")
  : undefined;
