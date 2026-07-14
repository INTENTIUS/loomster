/**
 * The deployable `loom-cognito` stack (chant#888) — the Cognito UserPool,
 * hosted-UI domain, resource server, M2M client, and (production/
 * production-ha) user client + groups + Managed Login branding. One
 * `LoomCognito(...)` call; `identity.mode` defaults to "provision" (see
 * ../composites/loom-cognito.ts). Assembles the `identity` seam from
 * `./params.ts` — this file has zero resource constructors of its own, so
 * none of chant's EVL rules apply to it.
 */

import { LoomCognito, type IdentitySeam } from "../composites/loom-cognito";
import * as params from "./params";

function buildIdentity(): IdentitySeam {
  if (params.identityMode === "omit") {
    return { mode: "omit" };
  }

  if (params.identityMode === "reference-existing") {
    return {
      mode: "reference-existing",
      userPoolId: params.referenceUserPoolId as string,
      userPoolArn: params.referenceUserPoolArn,
      domain: params.referenceDomain as string,
      resourceServerIdentifier: params.referenceResourceServerIdentifier as string,
      m2mClientId: params.referenceM2MClientId as string,
      userClientId: params.referenceUserClientId,
      issuer: params.referenceIssuer,
      discoveryUrl: params.referenceDiscoveryUrl,
      tokenUrl: params.referenceTokenUrl,
    };
  }

  return {
    mode: "provision",
    callbackUrls: params.callbackUrls,
    resourceServerIdentifier: params.resourceServerIdentifier,
    scopes: params.scopes,
    groups: {
      uiTiers: params.uiTierGroups,
      resourceGroups: params.resourceGroups,
    },
    demoSeed: params.demoSeedUsers ? { users: params.demoSeedUsers } : undefined,
    abacTags: {
      application: params.abacApplication,
      group: params.abacGroup,
      owner: params.abacOwner,
    },
    managedLoginBranding: params.managedLoginBranding,
  };
}

export const cognito = LoomCognito({ naming: params.namingParams, identity: buildIdentity() });
