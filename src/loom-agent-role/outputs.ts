/**
 * Named outputs for a per-agent `loom-agent-role` stack — the same keys
 * Loom's role.yaml exposes (`oAgentRole`, `oAgentRoleArn`). The Op imports
 * `oAgentRoleArn` into Loom (Security > Roles).
 */

import { output, Ref } from "@intentius/chant-lexicon-aws";
import { agentRole } from "./role";

export const oAgentRole = agentRole ? output(Ref(agentRole.role), "oAgentRole") : undefined;
export const oAgentRoleArn = agentRole ? output(agentRole.role.Arn, "oAgentRoleArn") : undefined;
