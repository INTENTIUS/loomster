/**
 * "Bring-your-own-everything" adoption example (chant#898) — the
 * `loom-cognito` half, and the **shared-identity-across-Looms** pattern
 * (chant#898's other settled decision): `identity.mode:
 * "reference-existing"` points this Loom instance at one org-level Cognito
 * pool a platform/security team owns — groups and the 23-scope catalog are
 * defined ONCE at the org level, not re-provisioned per Loom instance.
 * `chant build src/examples/byo/loom-cognito --lexicon aws` creates zero
 * Cognito resources.
 *
 * `../loom-cognito-second-instance/params.ts` references this exact same
 * pool (same `userPoolId`/`domain`/client ids) under a second, independent
 * `naming.instance` — proving two Loom instances share one pool with no
 * second pool ever created (chant#898 acceptance: "A shared org Cognito
 * pool / external IdP is referenced by two Loom instances; groups/scopes
 * defined once, no per-Loom pool").
 *
 * Values below are illustrative placeholders. Zero edits to
 * `../../../composites/loom-cognito.ts`.
 */

import type { LoomNamingParams } from "../../../lib/naming";
import type { IdentitySeam } from "../../../composites/loom-cognito";

export const namingParams: LoomNamingParams = {
  project: "loom",
  env: "prod",
  instance: "shared-a",
  tier: "production",
  region: "us-east-1",
  accountId: "123456789012",
  owner: "platform-team",
};

/**
 * The org's one Cognito pool — provisioned once, outside any single Loom
 * instance's own stacks, with its own groups/scopes defined at the org
 * level (not this file's concern; this file only references the pool).
 */
export const identity: IdentitySeam = {
  mode: "reference-existing",
  userPoolId: "us-east-1_ExAmPle1",
  userPoolArn: "arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_ExAmPle1",
  domain: "loom-org-shared",
  resourceServerIdentifier: "https://api.loom.example.com",
  m2mClientId: "1exampleclientid0123456789abcd",
  userClientId: "2exampleclientid0123456789abcd",
};
