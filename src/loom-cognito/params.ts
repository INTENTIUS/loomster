/**
 * Concrete parameter source for the deployable `loom-cognito` stack
 * (chant#888). Everything here is a declared build-time parameter
 * (chant#1064) — see `../../chant.config.ts`'s `buildParams`.
 *
 * Groups/scopes/demo-seed are genuinely rich, nested policy data (a team's
 * real org structure — chant#888's access-model comment thread), not a
 * single scalar — so those few are declared as `string` build-time
 * parameters carrying a JSON blob, parsed via `parseJson` (../lib/params-helpers.ts).
 */

import { params } from "@intentius/chant/params";
import type { LoomNamingParams, Tier } from "../lib/naming";
import type { CognitoScopeDef, CognitoGroupDef, CognitoDemoUser } from "../composites/loom-cognito";
import { splitCsv, parseJson } from "../lib/params-helpers";

// `?? <default>` mirrors chant.config.ts's own declared `default` — a real
// safety net for anything that imports this module outside chant's build
// pipeline (a unit test), where `setBuildParams(...)` never ran.
export const namingParams: LoomNamingParams = {
  project: (params.project as string | undefined) ?? "loom",
  env: (params.env as string | undefined) ?? "dev",
  instance: (params.instance as string | undefined) ?? "a",
  tier: (params.tier as Tier | undefined) ?? "light",
  region: (params.region as string | undefined) ?? "us-east-1",
  accountId: params.accountId as string | undefined,
  owner: (params.owner as string | undefined) ?? "platform",
};

/** Adoption (chant#898): `"provision"` (default) | `"reference-existing"` | `"omit"`. */
export type IdentityMode = "provision" | "reference-existing" | "omit";

export const identityMode: IdentityMode = (params.cognitoMode as IdentityMode | undefined) ?? "provision";

// ── provision-mode inputs ───────────────────────────────────────────────
export const callbackUrls = splitCsv(params.cognitoCallbackUrls as string | undefined);
export const resourceServerIdentifier = params.cognitoResourceServerId as string | undefined;
export const scopes = parseJson<CognitoScopeDef[]>(params.cognitoScopesJson as string | undefined, "cognitoScopesJson");
export const uiTierGroups = parseJson<CognitoGroupDef[]>(params.cognitoUiTierGroupsJson as string | undefined, "cognitoUiTierGroupsJson");
export const resourceGroups = parseJson<CognitoGroupDef[]>(params.cognitoResourceGroupsJson as string | undefined, "cognitoResourceGroupsJson");
export const demoSeedUsers = parseJson<CognitoDemoUser[]>(params.cognitoDemoSeedUsersJson as string | undefined, "cognitoDemoSeedUsersJson");
export const abacApplication = params.cognitoAbacApplication as string | undefined;
export const abacGroup = params.cognitoAbacGroup as string | undefined;
export const abacOwner = params.cognitoAbacOwner as string | undefined;
/** Unset/`true` -> default (on); `false` -> off. */
export const managedLoginBranding = params.cognitoManagedLoginBranding === false ? false : undefined;

// ── reference-existing-mode inputs (chant#898) ──────────────────────────
export const referenceUserPoolId = params.cognitoUserPoolId as string | undefined;
export const referenceUserPoolArn = params.cognitoUserPoolArn as string | undefined;
export const referenceDomain = params.cognitoDomain as string | undefined;
export const referenceResourceServerIdentifier = params.cognitoResourceServerId as string | undefined;
export const referenceM2MClientId = params.cognitoM2mClientId as string | undefined;
export const referenceUserClientId = params.cognitoUserClientId as string | undefined;
export const referenceIssuer = params.cognitoIssuer as string | undefined;
export const referenceDiscoveryUrl = params.cognitoDiscoveryUrl as string | undefined;
export const referenceTokenUrl = params.cognitoTokenUrl as string | undefined;
