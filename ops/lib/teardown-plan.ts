/**
 * Teardown plan (chant#905) — the marker-scoped, owned-only delete order for
 * `../loom-teardown.op.ts`.
 *
 * **Owned-only, marker-scoped, no foreign deletes, by construction — not by
 * convention.** Each entry below is one CloudFormation **stack boundary**: the
 * teardown deletes exactly the resources this project's own `chant build`
 * declared into that stack and nothing else (`docs/guide/ops.mdx`'s "Gates and
 * compensation" section: the CFN stack boundary *is* chant's ownership marker
 * for a CloudFormation target). There is no broader "delete anything tagged
 * `owner=platform`" sweep that could ever reach a foreign resource — deleting
 * stack `X` can only ever delete what stack `X` itself created.
 *
 * **Reverse dependency order.** `loom-backend` depends on all of
 * `shared-foundation`/`loom-db`/`loom-cognito` (chant's own cross-stack
 * `stackOutput(...)` wiring, resolved at deploy time as plain Parameter values
 * — not a CloudFormation `Export`/`Fn::ImportValue`, so CFN itself would not
 * block deleting them out of order) — but tearing down a consumer's
 * dependencies while it is still running is never the sane order regardless of
 * what CFN would technically permit, so this always goes
 * consumer-before-dependency, mirroring `README.md`'s own component table
 * (`chant graph --components`) in reverse.
 */

/** Stack names in delete order — `loom-backend` first (the sole multi-dependency consumer), `shared-foundation`/`loom-cognito` last (nothing left depends on them). */
export const TEARDOWN_ORDER: readonly string[] = [
  "loom-backend",
  "loom-db",
  "loom-frontend",
  "loom-cognito",
  "shared-foundation",
];

/**
 * `aws cloudformation delete-stack` + wait, for one stack. Shells the real AWS
 * CLI (ambient credentials sign the request) rather than `awsDelete`
 * (`@intentius/chant-lexicon-aws`'s direct CFN-API applier) — that applier's
 * injectable `http` is a plain unauthenticated `fetch` today, correct for a
 * local Floci emulator but not a substitute for the CLI's own SigV4 signing
 * against real AWS, which is what a real teardown needs.
 */
export function deleteStackScript(stackName: string): string {
  return [
    "set -euo pipefail",
    `aws cloudformation delete-stack --stack-name "${stackName}"`,
    `aws cloudformation wait stack-delete-complete --stack-name "${stackName}"`,
    `echo "teardown: ${stackName} deleted"`,
  ].join("\n");
}
