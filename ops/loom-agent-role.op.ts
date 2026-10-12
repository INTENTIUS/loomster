/**
 * Agent-role Op (loomster#2) — the chant version of Loom's per-agent role
 * stack (`shared/iac/role.yaml`, `make role` upstream). Loom v1.9.0 never
 * creates IAM itself: every agent deploys with a role that already exists and
 * is registered under Security > Roles, tagged into the caller's group.
 *
 *   LOOM_AGENT_ROLE_AGENT=support_bot LOOM_AGENT_ROLE_GROUP=support chant run loom-agent-role
 *
 * Two phases:
 *   1. Deploy — build `src/loom-agent-role` for that agent and deploy it as
 *      `{project}-{env}-{instance}-agent-role-<agent>`.
 *   2. Import — register the role in Loom with `loom:group` set, so members of
 *      the group can pick it when they deploy the agent.
 *
 * Optional: LOOM_AGENT_ROLE_MEMORY_ARN, LOOM_AGENT_ROLE_CODE_INTERPRETER=true,
 * LOOM_AGENT_ROLE_BEDROCK_MODEL_ARNS, LOOM_API_BASE_URL and LOOM_API_TOKEN
 * (as for loom-seed). Idempotent and ungated; the stack is not a component, so
 * loom-teardown leaves it (delete it with `aws cloudformation delete-stack`).
 */

import { Op, phase, shell } from "@intentius/chant/op";
import { namingParamsFromEnv } from "./lib/naming-env";
import { deployAgentRoleScript, importAgentRoleScript } from "./lib/agent-role";

const naming = namingParamsFromEnv();
const refs = { stackPrefix: `${naming.project}-${naming.env}-${naming.instance}` };

export default Op({
  name: "loom-agent-role",
  overview: `Create one Loom agent's execution role the way Loom's role.yaml does and register it in Loom (env=${naming.env}): deploy ${refs.stackPrefix}-agent-role-<agent> for LOOM_AGENT_ROLE_AGENT, then import it under Security > Roles tagged into LOOM_AGENT_ROLE_GROUP. Idempotent, ungated, local executor.`,
  labels: { Env: naming.env },
  phases: [
    phase("Deploy", [shell(deployAgentRoleScript(refs), { profile: "longInfra" })]),
    phase("Import", [shell(importAgentRoleScript(refs), { profile: "fastIdempotent" })]),
  ],
});
