/**
 * Teardown Op (chant#905) — decommission a Loom deployment: gated, owned-only,
 * marker-scoped, no foreign deletes (see `./lib/teardown-plan.ts` for why a
 * per-stack CloudFormation delete already satisfies all three by
 * construction). One Op, not one per tier — decommissioning is a single
 * destructive action regardless of which tier is actually live, so it always
 * gates, and it deletes whichever of the five stacks it finds:
 *
 *   chant run loom-teardown --temporal
 *   chant run signal loom-teardown approve-loom-teardown
 *
 * Deletes run **sequentially**, in `TEARDOWN_ORDER` (reverse dependency
 * order) — not `parallel: true` — since that order is the whole point of
 * tearing down consumers before what they depend on.
 *
 * No `onFailure` rollback: an already-gated delete is not something to
 * saga-compensate — if one stack's delete fails, the workflow simply stops
 * (the failed stack's CloudFormation events are the diagnostic, same as any
 * other `DELETE_FAILED`), and a re-run resumes from wherever it left off
 * (each `deleteStackScript` is idempotent — deleting an already-gone stack is
 * a no-op in CloudFormation).
 */

import { Op, phase, gate, shell } from "@intentius/chant-lexicon-temporal";
import { namingParamsFromEnv } from "./lib/naming-env";
import { TEARDOWN_ORDER, deleteStackScript } from "./lib/teardown-plan";

const naming = namingParamsFromEnv();

// CFN stack names are namespaced by project+env+instance (loomster#140), so this
// tears down exactly THIS deployment's stacks, never another instance's.
const stackName = (component: string): string => `${naming.project}-${naming.env}-${naming.instance}-${component}`;
const stacks = TEARDOWN_ORDER.map(stackName);

export default Op({
  name: "loom-teardown",
  overview: `Decommission the Loom deployment (env=${naming.env}, instance=${naming.instance}): gated, owned-only, marker-scoped stack deletes, no foreign deletes`,
  taskQueue: "loom-lifecycle",
  searchAttributes: { Env: naming.env, Teardown: "true" },
  phases: [
    phase("Approve", [
      gate("approve-loom-teardown", {
        timeout: "72h",
        description: `Approve deleting all ${stacks.length} Loom stacks for env=${naming.env}/instance=${naming.instance}: ${stacks.join(", ")}`,
      }),
    ]),
    phase(
      "Teardown",
      stacks.map((s) => shell(deleteStackScript(s), { profile: "longInfra" })),
    ),
  ],
});
