/**
 * Memory Op (loomster#39) — Loom's `make agentcore.memory.*` inspection
 * targets, read-only, with the AWS CLI (`./lib/operator.ts`):
 *
 *   chant run loom-memory                                                  # list
 *   LOOM_MEMORY_QUERY=get LOOM_MEMORY_ID=<id> chant run loom-memory
 *   LOOM_MEMORY_QUERY=records LOOM_MEMORY_ID=<id> LOOM_MEMORY_ACTOR_ID=<user> chant run loom-memory
 *   LOOM_MEMORY_QUERY=records-by-namespace LOOM_MEMORY_ID=<id> LOOM_MEMORY_NAMESPACE=<ns> chant run loom-memory
 *   LOOM_MEMORY_QUERY=extraction-jobs LOOM_MEMORY_ID=<id> chant run loom-memory
 *
 * `just memory <query> [memory-id] [actor-or-namespace]` sets these for you.
 * Records are user data: the output goes to the terminal only (an Op run
 * record on the ledger keeps step status, not output).
 */

import { Op, phase, shell } from "@intentius/chant/op";
import { namingParamsFromEnv } from "./lib/naming-env";
import { memoryQueryScript, MEMORY_QUERIES } from "./lib/operator";

const naming = namingParamsFromEnv();

export default Op({
  name: "loom-memory",
  overview: `Inspect AgentCore memory (env=${naming.env}): LOOM_MEMORY_QUERY=${MEMORY_QUERIES.join("|")} (default list), with LOOM_MEMORY_ID, LOOM_MEMORY_ACTOR_ID, LOOM_MEMORY_NAMESPACE as the query needs. Read-only, ungated.`,
  labels: { Env: naming.env },
  phases: [phase("Query", [shell(memoryQueryScript(), { profile: "fastIdempotent" })])],
});
