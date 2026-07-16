/**
 * Backup Op — a first-class, on-demand or scheduled RDS backup for a running
 * Loom deployment, independent of the upgrade path (where a snapshot is only a
 * side effect). Two phases: a labelled manual snapshot, then a cross-region
 * disaster-recovery copy that only does work when `LOOM_DR_REGION` is set.
 *
 *   chant run loom-backup                       # local executor, no gate
 *   LOOM_DR_REGION=us-west-2 chant run loom-backup   # + a DR copy to us-west-2
 *
 * A backup is additive and non-destructive, so this runs on the local executor
 * with no approval gate — unlike `../loom-restore.op.ts`, which is destructive
 * at cutover and gates. Tier-agnostic (it backs up whatever is live), so it
 * reads `LOOM_TIER` from the environment the same way `../loom-teardown.op.ts`
 * does, rather than being one Op per tier.
 *
 * Scheduling is a separate trigger host: `.github/workflows/backup.yml` runs
 * this on a daily cron (inert until opted in), the same CI-cron pattern
 * `watch.yml` / `reconcile.yml` use.
 */

import { Op, phase, shell } from "@intentius/chant-lexicon-temporal";
import { namingParamsFromEnv } from "./lib/naming-env";
import { stackRefs } from "./lib/stack-refs";
import { backupSnapshotScript, drCopySnapshotScript } from "./lib/backup";

const naming = namingParamsFromEnv();
const refs = stackRefs(naming);
const dbRefs = { dbInstanceIdentifier: refs.dbInstanceIdentifier };

export default Op({
  name: "loom-backup",
  overview: `RDS backup for the Loom deployment (env=${naming.env}, instance=${naming.instance}): a labelled manual snapshot, then a cross-region DR copy when LOOM_DR_REGION is set. Additive, ungated, local executor.`,
  taskQueue: "loom-lifecycle",
  searchAttributes: { Env: naming.env, Backup: "true" },
  phases: [
    phase("Snapshot", [shell(backupSnapshotScript(dbRefs), { profile: "longInfra" })]),
    phase("DrCopy", [shell(drCopySnapshotScript(dbRefs), { profile: "longInfra" })]),
  ],
});
