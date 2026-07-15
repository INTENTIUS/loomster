/**
 * Second Loom instance in the BYO-everything example (chant#898) —
 * demonstrates the **shared-identity-across-Looms** pattern: this instance
 * references the exact same org Cognito pool
 * (`../loom-cognito/params.ts`'s `identity`) under a different
 * `naming.instance` ("shared-b" vs. "shared-a"). Two independent Loom
 * instances, one pool, zero per-instance pool provisioning — the
 * multi-boundary pattern chant#898's comment thread calls "not just an
 * option... the multi-instance pattern."
 *
 * Everything else about this instance (its own shared-foundation/loom-db/
 * loom-backend/loom-frontend stacks) is intentionally out of scope here —
 * this directory exists solely to prove the identity seam, not to duplicate
 * the full stack set a second time.
 */

import type { LoomNamingParams } from "../../../lib/naming";
import type { IdentitySeam } from "../../../composites/loom-cognito";
import { identity as sharedIdentity } from "../loom-cognito/params";

export const namingParams: LoomNamingParams = {
  project: "loom",
  env: "prod",
  instance: "shared-b",
  tier: "production",
  region: "us-east-1",
  accountId: "123456789012",
  owner: "platform-team",
};

/** Identical to `../loom-cognito/params.ts`'s `identity` — same pool, same clients, same scopes; nothing re-provisioned. */
export const identity: IdentitySeam = sharedIdentity;
