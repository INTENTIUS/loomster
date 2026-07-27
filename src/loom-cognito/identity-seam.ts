/**
 * `loom-cognito`'s identity-seam builder (loomster#160), lifted out of
 * `./cognito.ts` — the same move, for the same two structural reasons, as
 * `../loom-db/data-seam.ts`:
 *
 * - a call nested as a value inside a composite's props object literal is
 *   reduced by chant's general reducer, which has no call case;
 * - a callee defined in the same file cannot be resolved without running that
 *   file.
 *
 * `./identity.ts` holds the single `export const identity = buildIdentity(params)`
 * — the one position where chant resolves the callee through the file's own
 * imports and invokes the real function with statically-folded arguments —
 * and `cognito.ts` reads `identity` as an ordinary cross-file constant.
 */

import type { IdentitySeam } from "../composites/loom-cognito";

/**
 * Assemble the `identity` seam from this stack's parameter source. Takes the
 * whole `./params` module rather than twenty positional arguments; every
 * value it reads is a plain string/array/boolean, so there is nothing here
 * whose object identity the build depends on.
 */
export function buildIdentity(input: typeof import("./params")): IdentitySeam {
  if (input.identityMode === "omit") {
    return { mode: "omit" };
  }

  if (input.identityMode === "reference-existing") {
    return {
      mode: "reference-existing",
      userPoolId: input.referenceUserPoolId as string,
      userPoolArn: input.referenceUserPoolArn,
      domain: input.referenceDomain as string,
      resourceServerIdentifier: input.referenceResourceServerIdentifier as string,
      m2mClientId: input.referenceM2MClientId as string,
      userClientId: input.referenceUserClientId,
      issuer: input.referenceIssuer,
      discoveryUrl: input.referenceDiscoveryUrl,
      tokenUrl: input.referenceTokenUrl,
    };
  }

  return {
    mode: "provision",
    callbackUrls: input.callbackUrls,
    resourceServerIdentifier: input.resourceServerIdentifier,
    scopes: input.scopes,
    groups: {
      uiTiers: input.uiTierGroups,
      resourceGroups: input.resourceGroups,
    },
    demoSeed: input.demoSeedUsers ? { users: input.demoSeedUsers } : undefined,
    abacTags: {
      application: input.abacApplication,
      group: input.abacGroup,
      owner: input.abacOwner,
    },
    managedLoginBranding: input.managedLoginBranding,
  };
}
