/**
 * Observe position of the lifecycle dial (chant#904, part of the #903
 * lifecycle umbrella under epic #885).
 *
 * `WatchOp` runs `chant lifecycle snapshot <env>` + `chant lifecycle diff
 * <env> --live` on a cron. Because chant's lifecycle commands build the
 * *whole* project for whatever `LOOM_ENV`/`LOOM_TIER` this repo is
 * currently synthesized for, one `WatchOp` already covers every stack it
 * builds — shared-foundation, loom-cognito, loom-db, loom-frontend, and
 * loom-backend — in a single tick; there is no separate per-stack Op.
 *
 * Every tier watches (chant#890's per-env dial only gates *reconcile* —
 * see ./loom-reconcile.op.ts). Drift surfaces as the `Drift` search
 * attribute; `./search-attributes.ts` registers it (plus `Watch`/`Env`/
 * `OpName`) so the first run's upsert succeeds.
 *
 * One-shot on the local executor:  chant run loom-watch
 * Scheduled on Temporal:            chant build (emits the TemporalSchedule
 *                                    below), then apply + start it
 */
import { WatchOp } from "@intentius/chant-lexicon-temporal";
import { loomEnv } from "./params";

const { op, schedule } = WatchOp({
  name: "loom-watch",
  env: loomEnv,
  schedule: "*/15 * * * *", // every 15 minutes
  live: true, // chant lifecycle diff --live — query the cloud, not just the last snapshot's digest
});

export default op; // discovered by `chant run loom-watch`
// Named uniquely (not `schedule`) — chant's discovery keys named exports by
// their literal binding name project-wide (unlike `export default`, which is
// keyed per-file), and ./loom-reconcile.op.ts also exports a schedule.
export const loomWatchSchedule = schedule; // deployed by `chant build`
