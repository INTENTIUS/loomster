/**
 * Seed Op (loomster#103) — populate Loom's app DB with the defaults a fresh
 * deploy needs to be usable. Loom's own `init_db()` seeds only tags + demo
 * tag-profiles, so the Security screen's role/authorizer pickers are empty and
 * an agent can't be deployed until they're filled. This imports the agent
 * execution role + a Cognito authorizer (and, on the `demo` profile, a sample
 * MCP server) by driving Loom's OWN supported endpoints — never forking Loom.
 *
 *   chant run loom-seed                                  # tier-default profile
 *   LOOM_SEED_PROFILE=foundation chant run loom-seed     # config only, no demo content
 *   LOOM_API_BASE_URL=https://loom.example.com chant run loom-seed   # a deployed target
 *
 * Idempotent and additive (every write is existence-guarded), so it runs on the
 * local executor with no gate — tier-agnostic like `./loom-backup.op.ts`, the
 * profile default coming from the tier (`demo` on light, `foundation` on
 * production/production-ha) and overridable via `LOOM_SEED_PROFILE`.
 */

import { Op, phase, shell } from "@intentius/chant-lexicon-temporal";
import { loomNaming } from "../src/lib/naming";
import { namingParamsFromEnv } from "./lib/naming-env";
import { stackRefs } from "./lib/stack-refs";
import { seedDefaultsScript, type SeedProfile } from "./lib/seed";

const naming = namingParamsFromEnv();
const refs = stackRefs(naming);

/** The shared-foundation agent execution role name (`../src/composites/shared-foundation.ts`'s `naming.name("agent-role")`). */
const agentRoleName = loomNaming(naming, "shared-foundation").name("agent-role");

/** Tier default: light gets demo content; production tiers get config only (no cost-incurring demo resources). */
const defaultProfile: SeedProfile = naming.tier === "light" ? "demo" : "foundation";

export default Op({
  name: "loom-seed",
  overview: `Seed Loom's app DB so a fresh deploy is usable (env=${naming.env}, tier=${naming.tier}, default profile=${defaultProfile}): import the agent execution role + a Cognito authorizer, plus demo content on the demo profile. Idempotent, ungated, local executor. Override with LOOM_SEED_PROFILE (demo|foundation|none) and LOOM_API_BASE_URL.`,
  taskQueue: "loom-lifecycle",
  searchAttributes: { Env: naming.env },
  phases: [
    phase("Seed", [
      shell(seedDefaultsScript({ agentRoleName, cognitoUserPoolName: refs.cognitoUserPoolName, defaultProfile }), { profile: "fastIdempotent" }),
    ]),
  ],
});
