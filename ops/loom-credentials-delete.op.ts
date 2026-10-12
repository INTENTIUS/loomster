/**
 * Credentials-delete Op (loomster#39) — Loom's `make
 * agentcore.credentials.delete-all`, owned-only. Upstream deletes every OAuth2
 * provider in the account; provider names carry no deployment marker, so
 * that would take other Loom instances' (and anyone else's) providers with
 * it. This deletes only the providers this Loom recorded in its database
 * (`./lib/operator.ts`), the same set Loom removes when an agent is deleted.
 * Gated and never over MCP:
 *
 *   chant run loom-credentials-delete        # lists what it would delete, exit 3 at the gate
 *   chant approve loom-credentials-delete approve-loom-credentials-delete
 *   chant run loom-credentials-delete        # deletes them
 *
 * The agents keep their config, so a redeploy recreates what it needs.
 * `loom-teardown` runs the same delete before it removes the stacks.
 */

import { Op, phase, gate, shell } from "@intentius/chant/op";
import { preflightPhase, stackPrefixOf } from "./lib/preflight";
import { namingParamsFromEnv } from "./lib/naming-env";
import { operatorRefs, ownedCredentialProvidersScript } from "./lib/operator";

const naming = namingParamsFromEnv();
const refs = operatorRefs(naming);

export default Op({
  name: "loom-credentials-delete",
  overview: `Delete the AgentCore credential providers this Loom recorded (env=${naming.env}, instance=${naming.instance}): list them, approve, delete. Owned-only, gated, never over MCP.`,
  labels: { Env: naming.env },
  neverOverMcp: true,
  phases: [
    preflightPhase({ env: naming.env, stacks: ["loom-backend"].map((c) => `${stackPrefixOf(naming)}-${c}`) }),
    phase("Plan", [shell(ownedCredentialProvidersScript(refs.backend, "list"), { profile: "longInfra" })]),
    phase("Approve", [
      gate("approve-loom-credentials-delete", {
        timeout: "24h",
        description: `Approve deleting every AgentCore credential provider the Loom database records (env=${naming.env}/instance=${naming.instance}); the Plan phase listed them. Agents using them lose their MCP/A2A/LiteLLM credentials until redeployed.`,
      }),
    ]),
    phase("Delete", [shell(ownedCredentialProvidersScript(refs.backend, "delete"), { profile: "longInfra" })]),
  ],
});
