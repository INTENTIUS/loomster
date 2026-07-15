/**
 * Environment-driven naming params for the lifecycle Ops (chant#905).
 *
 * Every stack's own `params.ts` (`../../src/{shared-foundation,loom-db,loom-cognito,
 * loom-backend,loom-frontend}/params.ts`) reads `project`/`env`/`instance`/`region`/
 * `accountId`/`owner` from the environment and reads `tier` from `LOOM_TIER` too —
 * one tier per process, because a composite file has no other way to pick a tier.
 *
 * A lifecycle Op is different: `chant run` discovers every `*.op.ts` file in one
 * process, so three Ops that differ only by tier (chant#890's dial — see
 * `./upgrade-op.ts`) cannot all read the same `LOOM_TIER` var and still resolve to
 * three distinct tiers. Each tier gets its own named Op file instead
 * (`../loom-upgrade-{light,production,production-ha}.op.ts`), and the tier is a
 * literal the file passes in — everything else still comes from the environment,
 * so the same Op names work unmodified across dev/staging/prod and across
 * instances (chant#897/#898).
 */

import type { LoomNamingParams, Tier } from "../../src/lib/naming";

/** Build this deployment's naming params for a lifecycle Op, given its fixed tier. */
export function namingParamsFor(tier: Tier): LoomNamingParams {
  return {
    project: process.env.LOOM_PROJECT ?? "loom",
    env: process.env.LOOM_ENV ?? "dev",
    instance: process.env.LOOM_INSTANCE ?? "a",
    tier,
    region: process.env.AWS_REGION ?? "us-east-1",
    accountId: process.env.AWS_ACCOUNT_ID,
    owner: process.env.LOOM_OWNER ?? "platform",
  };
}

const VALID_TIERS: readonly Tier[] = ["light", "production", "production-ha"];

/**
 * `../loom-teardown.op.ts` is the one lifecycle Op that is NOT tier-fixed — it
 * decommissions whatever tier is actually live, so (unlike the Ops above) it reads
 * `LOOM_TIER` the same way a stack's own `params.ts` does.
 */
export function namingParamsFromEnv(): LoomNamingParams {
  const raw = process.env.LOOM_TIER ?? "light";
  // Built before the `if` (never `new Error(...)` inside control flow, same
  // convention every stack's own params.ts follows — chant's EVL002 forbids a
  // `new` expression inside control flow, resource constructors and plain
  // `Error`s alike).
  const invalidTierError = new Error(`loom-teardown: LOOM_TIER must be one of ${VALID_TIERS.join(", ")}, got "${raw}"`);
  if (!(VALID_TIERS as readonly string[]).includes(raw)) {
    throw invalidTierError;
  }
  return namingParamsFor(raw as Tier);
}
