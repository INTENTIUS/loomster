/**
 * Server-side search-attribute registration for the Loom lifecycle Ops
 * (chant#904). `WatchOp`/`ReconcileOp` auto-emit `upsertSearchAttributes()`
 * calls in the generated workflow (`OpName`, `Watch`/`Reconcile`, `Env`,
 * `Drift`, and — in `pull-request` mode — `PR`), but that first upsert only
 * succeeds once the attribute name is registered server-side. Declaring the
 * `SearchAttribute` resource here is what makes `chant build` emit the
 * registration commands (see `docs/.../guide/watching-lifecycle.mdx`'s
 * "Search-attribute registration" note).
 *
 * All are `Keyword` — every value the workflows emit is an exact-match
 * string ("true"/"false", an env name, a PR URL), never free text.
 */

import { SearchAttribute } from "@intentius/chant-lexicon-temporal";

/** Every Op's auto-emitted identity attribute (chant Op codegen, always present). */
export const opNameAttr = new SearchAttribute({ name: "OpName", type: "Keyword" });

/** WatchOp: `Watch = "true"` marks every observe-position workflow run. */
export const watchAttr = new SearchAttribute({ name: "Watch", type: "Keyword" });

/** WatchOp + ReconcileOp: which environment the run acted on. */
export const envAttr = new SearchAttribute({ name: "Env", type: "Keyword" });

/** WatchOp + ReconcileOp: `outcomeAttribute` from `lifecycleDiff`'s `drifted` field. */
export const driftAttr = new SearchAttribute({ name: "Drift", type: "Keyword" });

/** ReconcileOp: `Reconcile = "true"` marks every reconcile-position workflow run. */
export const reconcileAttr = new SearchAttribute({ name: "Reconcile", type: "Keyword" });

/** ReconcileOp (`onDrift: "pull-request"`): the opened PR's URL, from `reconcilePr`'s `prUrl`. */
export const prAttr = new SearchAttribute({ name: "PR", type: "Keyword" });

/** loom-backup: `Backup = "true"` marks every backup workflow run. */
export const backupAttr = new SearchAttribute({ name: "Backup", type: "Keyword" });
