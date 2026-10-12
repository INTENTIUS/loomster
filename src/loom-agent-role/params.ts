/**
 * Parameter source for one per-agent `loom-agent-role` stack (loomster#2).
 * Declared build-time parameters only (chant#1064, see `../../chant.config.ts`):
 * the agent and its Loom group come from LOOM_AGENT_ROLE_AGENT and
 * LOOM_AGENT_ROLE_GROUP, which `chant run loom-agent-role` sets
 * (`../../ops/loom-agent-role.op.ts`).
 *
 * This stack is not a component: `chant run --components` never deploys it.
 * With no agent name set it declares nothing, so whole-project builds
 * (`chant lifecycle diff`) see no role here.
 */

import { params } from "@intentius/chant/params";
import type { LoomNamingParams, Tier } from "../lib/naming";

export const namingParams: LoomNamingParams = {
  project: (params.project as string | undefined) ?? "loom",
  env: (params.env as string | undefined) ?? "dev",
  instance: (params.instance as string | undefined) ?? "a",
  tier: (params.tier as Tier | undefined) ?? "light",
  region: (params.region as string | undefined) ?? "us-east-1",
  accountId: params.accountId as string | undefined,
  owner: (params.owner as string | undefined) ?? "platform",
};

/** The Loom agent the role is for, exactly as named in Loom. */
export const agentName = params.agentRoleAgent as string | undefined;
/** `loom:group` tag: the Loom group whose members may deploy with the role. */
export const group = (params.agentRoleGroup as string | undefined) ?? "loomster";
/** AgentCore Memory ARN to grant; unset grants none. */
export const memoryArn = params.agentRoleMemoryArn as string | undefined;
/** Include Code Interpreter permissions. */
export const codeInterpreter = (params.agentRoleCodeInterpreter as boolean | undefined) ?? false;
/** Comma-separated Bedrock model ARNs; unset uses the composite's default. */
export const bedrockModelArns = (params.agentRoleBedrockModelArns as string | undefined)?.split(",").map((s) => s.trim()).filter(Boolean);
