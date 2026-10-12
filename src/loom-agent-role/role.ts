/**
 * The deployable per-agent `loom-agent-role` stack (loomster#2): one
 * `LoomAgentRole(...)` call, the chant version of a Loom role stack from
 * `shared/iac/role.yaml`. Deployed by `chant run loom-agent-role`, never by
 * `chant run --components`. Zero resource constructors of its own.
 */

import { LoomAgentRole } from "../composites/loom-agent-role";
import * as params from "./params";

export const agentRole = params.agentName
  ? LoomAgentRole({
      naming: params.namingParams,
      agentName: params.agentName,
      group: params.group,
      memoryArn: params.memoryArn,
      codeInterpreter: params.codeInterpreter,
      bedrockModelArns: params.bedrockModelArns,
    })
  : undefined;
