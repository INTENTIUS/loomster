/**
 * Teardown Op (chant#905) — decommission a Loom deployment: gated, owned-only,
 * marker-scoped, no foreign deletes (see `./lib/teardown-plan.ts` for why a
 * per-stack CloudFormation delete already satisfies all three by
 * construction). One Op, not one per tier — decommissioning is a single
 * destructive action regardless of which tier is actually live, so it always
 * gates, and it deletes every component stack `src/components/` declares:
 *
 *   chant run loom-teardown                 # stops at the gate, exit 3
 *   chant approve loom-teardown approve-loom-teardown
 *   chant run loom-teardown                 # continues past the approved gate
 *
 * After the gate and before any stack goes, the AgentCore credential
 * providers this Loom's database records are deleted (`./lib/operator.ts`;
 * Loom creates them outside every stack, so no stack delete reaches them).
 *
 * Deletes run **sequentially**: the optional tunnel host if it exists
 * (`OPTIONAL_STACKS_FIRST`), then the order `discoverTeardownOrder()`
 * derives from the component graph (the deploy waves reversed, so
 * `loom-agents` first and `shared-foundation`/`loom-cognito` last), not
 * `parallel: true`, since that order is the whole point of tearing down
 * consumers before what they depend on.
 *
 * No `onFailure` rollback: an already-gated delete is not something to
 * saga-compensate — if one stack's delete fails, the workflow simply stops
 * (the failed stack's CloudFormation events are the diagnostic, same as any
 * other `DELETE_FAILED`), and a re-run resumes from wherever it left off
 * (each `deleteStackScript` is idempotent — deleting an already-gone stack is
 * a no-op in CloudFormation).
 */

import { Op, phase, gate, shell } from "@intentius/chant/op";
import { preflightPhase } from "./lib/preflight";
import { namingParamsFromEnv } from "./lib/naming-env";
import { teardownStackOrder, deleteStackScript } from "./lib/teardown-plan";
import { operatorRefs, ownedCredentialProvidersScript } from "./lib/operator";

const naming = namingParamsFromEnv();
const refs = operatorRefs(naming);

// CFN stack names are namespaced by project+env+instance (loomster#140), so this
// tears down exactly THIS deployment's stacks, never another instance's.
const stackName = (component: string): string => `${naming.project}-${naming.env}-${naming.instance}-${component}`;
// The optional tunnel host first (it sits on the network and the database),
// then every component, consumers first.
const stacks = (await teardownStackOrder()).map(stackName);

export default Op({
  name: "loom-teardown",
  overview: `Decommission the Loom deployment (env=${naming.env}, instance=${naming.instance}): gated; deletes the credential providers this Loom recorded, then owned-only, marker-scoped stack deletes, no foreign deletes`,
  labels: { Env: naming.env, Teardown: "true" },
  // A person starts and approves this Op; an agent never does over MCP (#25).
  neverOverMcp: true,
  phases: [
    preflightPhase({ env: naming.env }),
    phase("Approve", [
      gate("approve-loom-teardown", {
        timeout: "72h",
        description: `Approve deleting all ${stacks.length} Loom stacks for env=${naming.env}/instance=${naming.instance}: ${stacks.join(", ")}`,
      }),
    ]),
    // AgentCore credential providers Loom created for MCP/A2A/LiteLLM live
    // outside every stack. Delete the ones this Loom's database records
    // (owned-only, like the stacks) while the backend can still read it; a
    // re-run after the backend is gone skips this.
    phase("Credentials", [shell(ownedCredentialProvidersScript(refs.backend, "delete", { missingServiceOk: true }), { profile: "longInfra" })]),
    phase(
      "Teardown",
      stacks.map((s) => shell(deleteStackScript(s), { profile: "longInfra" })),
    ),
  ],
});
