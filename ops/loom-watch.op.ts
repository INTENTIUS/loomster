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
 * see ./loom-reconcile.op.ts). Drift lands as the run's `Drift` outcome
 * on the chant/lifecycle ledger.
 *
 *   chant run loom-watch
 *
 * `schedule` is a property of the Op; `.github/workflows/watch.yml` is the
 * CI-cron host that fires it.
 */
import { WatchOp } from "@intentius/chant/op";
import { loomEnv } from "./params";

const { op } = WatchOp({
  name: "loom-watch",
  env: loomEnv,
  schedule: "*/15 * * * *", // every 15 minutes
  live: true, // chant lifecycle diff --live — query the cloud, not just the last snapshot's digest
});

export default op; // discovered by `chant run loom-watch`
