/**
 * Preflight checks for the mutating Ops (loomster#27): a first phase that
 * refuses to start when the run would act as the wrong identity, against
 * stacks that are mid-change, or (for the upgrade) against a database whose
 * schema history isn't ready. Each check runs before anything changes, so a
 * refused run leaves no snapshot, gate fact or half-applied step behind.
 *
 * - **Identity.** `chant lifecycle whoami <env>` prints who chant would act as
 *   in each lexicon. It reads static keys from the environment only, so it
 *   reports a profile, SSO or role session as unresolved; it is printed, not
 *   enforced. The enforced check is `aws sts get-caller-identity`, which
 *   resolves every credential source the AWS CLI does, plus a match against
 *   `AWS_ACCOUNT_ID` when that is set, so an Op never runs in an account the
 *   operator didn't name.
 * - **Stable stacks.** Every stack the Op reads or changes must exist and be
 *   in a `*_COMPLETE` state other than `ROLLBACK_COMPLETE` (a stack that never
 *   created). One mid-update or failed stack stops the run.
 * - **Schema readiness** (upgrade only). The Schema phase applies SQL
 *   Yodeler migrations through the SSM tunnel on AWS. This checks the tunnel's
 *   prerequisites (the Session Manager plugin and the tunnel host stack) and
 *   that the deployment's yodel history is usable: a recorded baseline, and no
 *   checksum mismatch or out-of-order migration (`yodel status` exit 4).
 *
 * What chant covers now and this doesn't repeat: chant's plan classifies each
 * change's disruption (replacement, interruption) on component deploys, which
 * the backend and frontend rolls run through. `./rds-safety.ts` is a different
 * job, a snapshot before the schema changes and the documented restore path,
 * so it stays.
 */

import { phase, shell } from "@intentius/chant/op";
import { TUNNEL_HOST_STACK } from "./tunnel-host";

/** CloudFormation statuses a preflight accepts: settled, and holding resources. */
export const STABLE_STACK_STATUSES = [
  "CREATE_COMPLETE",
  "UPDATE_COMPLETE",
  "UPDATE_ROLLBACK_COMPLETE",
  "IMPORT_COMPLETE",
  "IMPORT_ROLLBACK_COMPLETE",
] as const;

/** `aws sts get-caller-identity` must resolve, and match `AWS_ACCOUNT_ID` when that is set. */
export function identityPreflightScript(env: string): string {
  return [
    "set -euo pipefail",
    // Printed, not enforced: whoami reads static keys only (see the module doc).
    `npx chant lifecycle whoami "${env}" || true`,
    `ACCOUNT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" || { echo "preflight: AWS credentials don't resolve (aws sts get-caller-identity failed)" >&2; exit 1; }`,
    `if [ -n "\${AWS_ACCOUNT_ID:-}" ] && [ "$ACCOUNT" != "$AWS_ACCOUNT_ID" ]; then echo "preflight: the credentials resolve to account $ACCOUNT, but AWS_ACCOUNT_ID is $AWS_ACCOUNT_ID" >&2; exit 1; fi`,
    `echo "preflight: acting as $(aws sts get-caller-identity --query Arn --output text) in account $ACCOUNT"`,
  ].join("\n");
}

/** Every named stack exists and is in one of {@link STABLE_STACK_STATUSES}. */
export function stableStacksPreflightScript(stacks: string[]): string {
  return [
    "set -euo pipefail",
    'BAD=""',
    `for s in ${stacks.map((s) => `"${s}"`).join(" ")}; do`,
    `  st="$(aws cloudformation describe-stacks --stack-name "$s" --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo MISSING)"`,
    `  case "$st" in ${STABLE_STACK_STATUSES.join("|")}) echo "preflight: $s is $st" ;; *) BAD="$BAD $s=$st" ;; esac`,
    "done",
    `[ -z "$BAD" ] || { echo "preflight: not every stack is settled:$BAD. Wait for an in-progress change, or fix a failed one, then run again." >&2; exit 1; }`,
  ].join("\n");
}

/**
 * The Schema phase's prerequisites (`../../scripts/db/yodel.sh`): on AWS the
 * Session Manager plugin and the tunnel host, and on every target a yodel
 * history with a baseline and no mismatch.
 */
export function schemaPreflightScript(stackPrefix: string): string {
  return [
    "set -euo pipefail",
    `case "\${LOOM_ENV:-dev}" in local|floci) ON_FLOCI=1 ;; *) ON_FLOCI= ;; esac`,
    `if [ -z "$ON_FLOCI" ] && [ -z "\${LOOM_YODEL_URL:-}" ]; then`,
    `  command -v session-manager-plugin >/dev/null 2>&1 || { echo "preflight: the schema step reaches the database through SSM; install the AWS CLI Session Manager plugin" >&2; exit 1; }`,
    `  aws cloudformation describe-stacks --stack-name "${stackPrefix}-${TUNNEL_HOST_STACK}" >/dev/null 2>&1 || { echo "preflight: no ${stackPrefix}-${TUNNEL_HOST_STACK} stack; deploy the tunnel host first (just tunnel-host)" >&2; exit 1; }`,
    "fi",
    "set +e",
    'STATUS="$(bash scripts/db/yodel.sh status --json 2>/dev/null)"',
    "CODE=$?",
    "set -e",
    `case "$CODE" in`,
    `  0|3) ;;`,
    `  4) echo "preflight: the schema history has a checksum mismatch or an out-of-order migration; see just db status" >&2; exit 1 ;;`,
    `  *) echo "preflight: yodel status failed (exit $CODE); see just db status" >&2; exit 1 ;;`,
    "esac",
    `APPLIED="$(printf '%s' "$STATUS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s.slice(s.indexOf("{"))).applied??[]).length)}catch{console.log("")}})')"`,
    `if [ "$APPLIED" = 0 ] && [ "\${LOOM_DB_APPLY_BASELINE:-}" != 1 ]; then echo "preflight: the schema history records no migration; record the baseline first (just db baseline)" >&2; exit 1; fi`,
    `echo "preflight: schema history ready ($APPLIED applied, yodel status exit $CODE)"`,
  ].join("\n");
}

export interface PreflightOptions {
  /** The chant environment the Op runs in (`LOOM_ENV`). */
  env: string;
  /** Stacks that must be settled, full names. */
  stacks?: string[];
  /** Check the Schema phase's prerequisites, under this stack prefix (`{project}-{env}-{instance}`). */
  schemaStackPrefix?: string;
}

/** The `Preflight` phase a mutating Op starts with: identity, then settled stacks, then schema readiness. */
export function preflightPhase(opts: PreflightOptions) {
  const steps = [shell(identityPreflightScript(opts.env), { profile: "fastIdempotent" })];
  if (opts.stacks && opts.stacks.length > 0) steps.push(shell(stableStacksPreflightScript(opts.stacks), { profile: "fastIdempotent" }));
  if (opts.schemaStackPrefix) steps.push(shell(schemaPreflightScript(opts.schemaStackPrefix), { profile: "longInfra" }));
  return phase("Preflight", steps);
}

/** `{project}-{env}-{instance}`, the prefix every stack of a deployment carries. */
export function stackPrefixOf(naming: { project: string; env: string; instance: string }): string {
  return `${naming.project}-${naming.env}-${naming.instance}`;
}
