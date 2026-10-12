/**
 * Teardown plan (chant#905, loomster#44): the marker-scoped, owned-only delete
 * order for `../loom-teardown.op.ts`.
 *
 * **Owned-only, marker-scoped, no foreign deletes, by construction.** Each
 * component below is one CloudFormation stack boundary: the teardown deletes
 * exactly the resources this project's own `chant build` declared into that
 * stack and nothing else (`docs/guide/ops.mdx`'s "Gates and compensation"
 * section: the CFN stack boundary is chant's ownership marker for a
 * CloudFormation target). There is no "delete anything tagged
 * `owner=platform`" sweep that could reach a foreign resource.
 *
 * **Derived from the component graph, not a hand list.** The order comes from
 * the same discovery `chant graph --components` runs over
 * `src/components/*.component.ts` (`computeComponentGraph`), with the deploy
 * waves reversed: the last wave to deploy is the first to go. A component
 * added later is picked up automatically. The old hand list missed
 * `loom-agents` and `downstream-stub` (loomster#44), which left the AgentCore
 * runtimes running and then tried to delete the `shared-foundation` network
 * they still sat on.
 *
 * Cross-stack wiring is chant's own `stackOutput(...)`, resolved at deploy
 * time as plain Parameter values (no CFN `Export`/`Fn::ImportValue`), so CFN
 * itself would not refuse an out-of-order delete. Deleting a consumer's
 * dependencies while it still runs is never the sane order anyway, so this
 * always goes consumer-before-dependency.
 */

import { fileURLToPath } from "node:url";
import { computeComponentGraph } from "@intentius/chant/components";

/** `src/components/`, where every deployable component is declared. */
export const COMPONENTS_DIR = fileURLToPath(new URL("../../src/components/", import.meta.url));

/**
 * Reverse the deploy waves into a delete order. Components inside one wave
 * share no dependency, so their relative order is free; each wave arrives
 * sorted from chant, which keeps the result deterministic.
 */
export function teardownOrderFromWaves(waves: readonly (readonly string[])[]): string[] {
  return [...waves].reverse().flat();
}

/** Discover the components under `dir` and return their delete order (consumers first). */
export async function discoverTeardownOrder(dir: string = COMPONENTS_DIR): Promise<string[]> {
  const graph = await computeComponentGraph(dir);
  if (!graph.success) {
    throw new Error(`loom-teardown: could not resolve the component graph under ${dir}: ${graph.error}`);
  }
  return teardownOrderFromWaves(graph.waves);
}

/**
 * Optional stacks an Op deploys outside the component graph that sit on a
 * component's network or database, so they go before every component:
 * the SSM tunnel host (`../loom-tunnel-host.op.ts`, loomster#37) holds an
 * ENI in shared-foundation's subnets and an ingress rule on loom-db's
 * security group. Deleting one that was never deployed is a no-op. (Per-agent
 * role stacks, `../loom-agent-role.op.ts`, block nothing and are left.)
 */
export const OPTIONAL_STACKS_FIRST: readonly string[] = ["tunnel-host"];

/** The full delete order: the optional stacks, then every component, consumers first. */
export async function teardownStackOrder(dir: string = COMPONENTS_DIR): Promise<string[]> {
  return [...OPTIONAL_STACKS_FIRST, ...(await discoverTeardownOrder(dir))];
}

/**
 * DELETE_FAILED reasons that clear on their own, so the delete is worth
 * re-issuing after a pause rather than failing the step:
 *  - "dependent object": Bedrock AgentCore's managed `ela-attach` ENIs outlive
 *    the `loom-agents` stack and hold `shared-foundation`'s ECS security group
 *    (and subnets) until AWS releases them.
 *  - "still using": the RDS subnet group while the DB instance is still
 *    draining.
 * Anything else (deletion protection, a non-empty bucket) fails immediately.
 */
export const TRANSIENT_DELETE_FAILURES: readonly string[] = ["dependent object", "still using"];

export interface DeleteRetryOptions {
  /** Delete attempts before giving up. */
  attempts: number;
  /** Seconds to sleep between attempts. */
  intervalSeconds: number;
}

export const DEFAULT_DELETE_RETRY: DeleteRetryOptions = { attempts: 4, intervalSeconds: 240 };

/**
 * `aws cloudformation delete-stack` + wait, for one stack, re-issued while the
 * failure is one of {@link TRANSIENT_DELETE_FAILURES}. Shells the real AWS CLI
 * (ambient credentials sign the request) rather than `awsDelete`
 * (`@intentius/chant-lexicon-aws`'s direct CFN-API applier): that applier's
 * injectable `http` is a plain unauthenticated `fetch` today, fine for a local
 * Floci emulator but not a substitute for SigV4 signing against real AWS.
 * Idempotent: deleting a stack that is already gone is a no-op.
 */
export function deleteStackScript(stackName: string, retry: DeleteRetryOptions = DEFAULT_DELETE_RETRY): string {
  const transient = TRANSIENT_DELETE_FAILURES.map((r) => `*"${r}"*`).join("|");
  return [
    "set -euo pipefail",
    `for attempt in $(seq 1 ${retry.attempts}); do`,
    `  aws cloudformation delete-stack --stack-name "${stackName}"`,
    `  if aws cloudformation wait stack-delete-complete --stack-name "${stackName}"; then`,
    `    echo "teardown: ${stackName} deleted"`,
    "    exit 0",
    "  fi",
    `  reason=$(aws cloudformation describe-stack-events --stack-name "${stackName}" --query "StackEvents[?ResourceStatus=='DELETE_FAILED'] | [0].ResourceStatusReason" --output text 2>/dev/null || true)`,
    `  case "$reason" in`,
    `    ${transient})`,
    `      echo "teardown: ${stackName} delete blocked (attempt $attempt/${retry.attempts}): $reason; retrying in ${retry.intervalSeconds}s" >&2`,
    `      sleep ${retry.intervalSeconds} ;;`,
    "    *)",
    `      echo "teardown: ${stackName} delete failed: $reason" >&2`,
    "      exit 1 ;;",
    "  esac",
    "done",
    `echo "teardown: ${stackName} still blocked after ${retry.attempts} attempts; re-run loom-teardown once AWS releases the dependency" >&2`,
    "exit 1",
  ].join("\n");
}
