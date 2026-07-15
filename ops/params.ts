/**
 * Parameter source for the Loom lifecycle Ops (chant#904 — observe +
 * reconcile). Same convention as every per-component `params.ts` file: everything
 * comes from the environment, nothing hardcoded (LOOM001's spirit, even
 * though these files sit outside its composite-only scope).
 *
 * `loomEnv` is threaded straight into `WatchOp`/`ReconcileOp`'s `env` —
 * chant's lifecycle commands (`chant lifecycle snapshot|diff <env>`) build
 * the *whole* project for whatever `LOOM_ENV`/`LOOM_TIER` is set at synth
 * time, so a single Op run already covers every stack this repo builds
 * (shared-foundation, loom-cognito, loom-db, loom-frontend, loom-backend) —
 * there is no separate per-stack scoping knob to thread through.
 *
 * `reconcilesOnSchedule` is the per-env dial from chant#890: light observes
 * only; production/production-ha additionally reconcile on a schedule. See
 * ./loom-reconcile.op.ts for how the flag gates the `TemporalSchedule`.
 */

import type { Tier } from "../src/lib/naming";

const VALID_TIERS: readonly Tier[] = ["light", "production", "production-ha"];

function tierFromEnv(): Tier {
  const raw = process.env.LOOM_TIER ?? "light";
  const invalidTierError = new Error(`loom lifecycle ops: LOOM_TIER must be one of ${VALID_TIERS.join(", ")}, got "${raw}"`);
  if (!(VALID_TIERS as readonly string[]).includes(raw)) {
    throw invalidTierError;
  }
  return raw as Tier;
}

/** Environment label passed to `WatchOp`/`ReconcileOp` — same source as every composite's `naming.env` (`LOOM_ENV`, default "dev"). */
export const loomEnv = process.env.LOOM_ENV ?? "dev";

/** Tier this build targets (`LOOM_TIER`, default "light") — drives the reconcile dial below. */
export const tier: Tier = tierFromEnv();

/**
 * chant#890's per-env dial for the reconcile half only — observe runs on
 * every tier. `light` is observe-only (no scheduled reconcile);
 * `production`/`production-ha` additionally reconcile on a schedule.
 *
 * Pure function (not just a computed constant) so a test can exercise every
 * tier directly without needing to re-import this module under a different
 * `LOOM_TIER` (module-level `process.env` reads only evaluate once per
 * process).
 */
export function reconcilesOnScheduleForTier(t: Tier): boolean {
  return t !== "light";
}

/** `reconcilesOnScheduleForTier` applied to this process's own `tier`. */
export const reconcilesOnSchedule = reconcilesOnScheduleForTier(tier);
