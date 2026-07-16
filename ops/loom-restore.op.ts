/**
 * Restore Op — restore the database and cut the app over to it. Gated, because
 * cutover is destructive to the live data plane (it repoints the connection
 * secret and redeploys the backend), so it needs a durable approval:
 *
 *   chant run loom-restore --temporal                          # pauses at "Approve"
 *   chant run signal loom-restore approve-loom-restore
 *
 * Restore mode is a run-time env var (see ops/lib/restore.ts):
 *   LOOM_RESTORE_TIME=2026-07-16T03:00:00Z   -> point-in-time (within 7-day window)
 *   LOOM_RESTORE_SNAPSHOT_ID=<id>            -> that snapshot
 *   (neither)                                -> the latest loom-backup snapshot
 *
 * Phases: Restore (to a new instance, network-placed) -> Approve -> Cutover
 * (repoint the connection secret + redeploy the backend). The old instance is
 * deliberately left running; decommissioning it is a documented, human-confirmed
 * follow-up (guides/backup-restore), not an automatic delete of a live
 * production database.
 *
 * Tier-agnostic (restores whatever is live), like ../loom-teardown.op.ts.
 */

import { Op, phase, gate, shell } from "@intentius/chant-lexicon-temporal";
import { namingParamsFromEnv } from "./lib/naming-env";
import { stackRefs } from "./lib/stack-refs";
import { restoreScript, cutoverScript, type RestoreRefs } from "./lib/restore";

const naming = namingParamsFromEnv();
const refs = stackRefs(naming);
const restoreRefs: RestoreRefs = {
  dbInstanceIdentifier: refs.dbInstanceIdentifier,
  dbSubnetGroupName: refs.dbSubnetGroupName,
  rdsSecurityGroupName: refs.rdsSecurityGroupName,
  connectionSecretName: refs.connectionSecretName,
  ecsClusterName: refs.ecsClusterName,
  backendServiceName: refs.backendServiceName,
};

export default Op({
  name: "loom-restore",
  overview: `Restore the Loom database and cut over to it (env=${naming.env}, instance=${naming.instance}): restore to a new instance (snapshot or PITR), approve, then repoint the connection secret and redeploy the backend. Gated — cutover is destructive.`,
  taskQueue: "loom-lifecycle",
  searchAttributes: { Env: naming.env, Restore: "true" },
  phases: [
    phase("Restore", [shell(restoreScript(restoreRefs), { profile: "longInfra" })]),
    phase("Approve", [
      gate("approve-loom-restore", {
        timeout: "72h",
        description: `Approve cutting the live Loom backend (env=${naming.env}/instance=${naming.instance}) over to the restored instance: this repoints the connection secret and redeploys the backend. The old instance is left running.`,
      }),
    ]),
    phase("Cutover", [shell(cutoverScript(restoreRefs), { profile: "longInfra" })]),
  ],
});
