/**
 * Bootstrap Op (loomster#38) — the chant version of Loom's run-once-per-account
 * make targets (`shared/makefile`: `ecs.init`, `agentcore.init`). Creates the
 * ECS and AgentCore runtime-identity service-linked roles if the account
 * doesn't have them yet, so a fresh account's first deploy doesn't fail on
 * them.
 *
 *   chant run loom-bootstrap        # or: just bootstrap
 *
 * Run it before the first `chant run --components all` in an account. It's
 * idempotent (an existing role is left alone), so it is also safe before every
 * deploy; CI's deploy workflow does that. Ungated: it only ever adds the two
 * AWS-managed roles. See ./lib/bootstrap.ts.
 */

import { Op, phase, shell } from "@intentius/chant/op";
import { bootstrapScript } from "./lib/bootstrap";

export default Op({
  name: "loom-bootstrap",
  overview:
    "Create the account-level service-linked roles Loom needs (ecs.amazonaws.com, runtime-identity.bedrock-agentcore.amazonaws.com) when missing, as Loom's make ecs.init/agentcore.init do. Once per account, idempotent, ungated, local executor.",
  phases: [phase("Service-linked roles", [shell(bootstrapScript(), { profile: "fastIdempotent" })])],
});
