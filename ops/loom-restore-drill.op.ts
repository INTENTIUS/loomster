/**
 * Restore-verification drill Op — prove the latest backup actually restores,
 * without touching the live database:
 *
 *   chant run loom-restore-drill                          # latest loom-backup snapshot
 *   LOOM_RESTORE_SNAPSHOT_ID=<id> chant run loom-restore-drill   # a specific snapshot
 *
 * One phase: restore the snapshot to a throwaway `<id>-drill-<ts>` instance,
 * assert it reaches `available` with the source's engine/version/storage, then
 * always delete the drill instance (a shell `trap` guarantees the delete even on
 * assertion failure — see ops/lib/restore-drill.ts).
 *
 * Non-destructive to the live data plane (it only ever creates and deletes its
 * own `-drill-` instance and never repoints the connection secret), so it runs
 * ungated on the local executor — unlike `./loom-restore.op.ts`, whose cutover
 * gates. Tier-agnostic (drills whatever is live), like `./loom-backup.op.ts`.
 *
 * Scheduling is a separate trigger host: `.github/workflows/restore-drill.yml`
 * runs this on a monthly cron (inert until opted in), the same CI-cron pattern
 * `backup.yml` uses.
 */

import { Op, phase, shell } from "@intentius/chant-lexicon-temporal";
import { namingParamsFromEnv } from "./lib/naming-env";
import { stackRefs } from "./lib/stack-refs";
import { restoreDrillScript, type DrillRefs } from "./lib/restore-drill";

const naming = namingParamsFromEnv();
const refs = stackRefs(naming);
const drillRefs: DrillRefs = {
  dbInstanceIdentifier: refs.dbInstanceIdentifier,
  dbSubnetGroupName: refs.dbSubnetGroupName,
  rdsSecurityGroupName: refs.rdsSecurityGroupName,
};

export default Op({
  name: "loom-restore-drill",
  overview: `Restore-verification drill for the Loom deployment (env=${naming.env}, instance=${naming.instance}): restore the latest backup snapshot to a throwaway instance, assert it comes up healthy with matching config, then delete it. Non-destructive, ungated, local executor.`,
  taskQueue: "loom-lifecycle",
  searchAttributes: { Env: naming.env, RestoreDrill: "true" },
  phases: [
    phase("Drill", [shell(restoreDrillScript(drillRefs), { profile: "longInfra" })]),
  ],
});
