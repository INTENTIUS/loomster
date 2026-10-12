/**
 * The one deployment this run's yodel commands talk to, named like its
 * stacks: `{LOOM_PROJECT}-{LOOM_ENV}-{LOOM_INSTANCE}` (`loom-dev-a`). It is the
 * SQL Yodeler environment, so each deployment has its own profile, its own
 * migrate Op and gate (`migrate-loom-dev-a`, `approve-migrate-loom-dev-a`) and
 * its own drift watch, and an approval for one deployment never counts for
 * another. Same single-deployment-at-a-time convention as ../chant.config.ts.
 */
export const deployment = `${process.env.LOOM_PROJECT ?? "loom"}-${process.env.LOOM_ENV ?? "dev"}-${process.env.LOOM_INSTANCE ?? "a"}`;

/** yodel's history table (and the apply lock's advisory key) live in this schema, never in Loom's `public`. */
export const historySchema = "yodeler";

/** Loom keeps every table in `public`. */
export const loomSchema = "public";
