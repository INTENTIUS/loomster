/**
 * Concrete parameter source for the deployable `loom-cognito` stack
 * (chant#888). Everything here comes from the environment (LOOM001 —
 * nothing hardcoded in this file or the composite), same convention
 * `shared-foundation/params.ts`/`loom-db/params.ts` use.
 *
 * Groups/scopes/demo-seed are genuinely rich, nested policy data (a team's
 * real org structure — chant#888's access-model comment thread), not a
 * single scalar a CSV env var can express — so those few accept a JSON
 * blob via `..._JSON` env vars, parsed with `JSON.parse` against a specific,
 * literal `process.env.NAME` read (never a computed `process.env[name]` —
 * chant's EVL003 forbids dynamic element access project-wide).
 */

import type { LoomNamingParams, Tier } from "../lib/naming";
import type { CognitoScopeDef, CognitoGroupDef, CognitoDemoUser } from "../composites/loom-cognito";

const VALID_TIERS: readonly Tier[] = ["light", "production", "production-ha"];

function tierFromEnv(): Tier {
  const raw = process.env.LOOM_TIER ?? "light";
  const invalidTierError = new Error(`loom-cognito: LOOM_TIER must be one of ${VALID_TIERS.join(", ")}, got "${raw}"`);
  if (!(VALID_TIERS as readonly string[]).includes(raw)) {
    throw invalidTierError;
  }
  return raw as Tier;
}

export const namingParams: LoomNamingParams = {
  project: process.env.LOOM_PROJECT ?? "loom",
  env: process.env.LOOM_ENV ?? "dev",
  instance: process.env.LOOM_INSTANCE ?? "a",
  tier: tierFromEnv(),
  region: process.env.AWS_REGION ?? "us-east-1",
  accountId: process.env.AWS_ACCOUNT_ID,
  owner: process.env.LOOM_OWNER ?? "platform",
};

/** Adoption (chant#898): `"provision"` (default) | `"reference-existing"` | `"omit"`. */
export type IdentityMode = "provision" | "reference-existing" | "omit";

const VALID_IDENTITY_MODES: readonly IdentityMode[] = ["provision", "reference-existing", "omit"];

function identityModeFromEnv(): IdentityMode {
  const raw = process.env.LOOM_COGNITO_MODE ?? "provision";
  const invalidModeError = new Error(`loom-cognito: LOOM_COGNITO_MODE must be one of ${VALID_IDENTITY_MODES.join(", ")}, got "${raw}"`);
  if (!(VALID_IDENTITY_MODES as readonly string[]).includes(raw)) {
    throw invalidModeError;
  }
  return raw as IdentityMode;
}

export const identityMode = identityModeFromEnv();

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function parseJson<T>(raw: string | undefined, envVarName: string): T | undefined {
  if (!raw) return undefined;
  // `new Error(...)` is constructed unconditionally, outside the try/catch,
  // then thrown conditionally — chant's EVL002 forbids a resource
  // constructor (any `new Xxx(...)`, including a plain `Error`) from
  // appearing inside a try/catch itself, same reasoning as the
  // unconditional-then-conditionally-thrown `Error`s in ../lib/naming.ts's
  // sibling composites (e.g. loom-db.ts's `notEnoughSubnetsError`).
  let parsed: T | undefined;
  let failureMessage: string | undefined;
  try {
    parsed = JSON.parse(raw) as T;
  } catch (err) {
    failureMessage = (err as Error).message;
  }
  const parseError = new Error(`loom-cognito: ${envVarName} must be valid JSON — ${failureMessage}`);
  if (failureMessage !== undefined) throw parseError;
  return parsed;
}

// ── provision-mode inputs ───────────────────────────────────────────────
export const callbackUrls = splitCsv(process.env.LOOM_COGNITO_CALLBACK_URLS);
export const resourceServerIdentifier = process.env.LOOM_COGNITO_RESOURCE_SERVER_ID;
export const scopes = parseJson<CognitoScopeDef[]>(process.env.LOOM_COGNITO_SCOPES_JSON, "LOOM_COGNITO_SCOPES_JSON");
export const uiTierGroups = parseJson<CognitoGroupDef[]>(process.env.LOOM_COGNITO_UI_TIER_GROUPS_JSON, "LOOM_COGNITO_UI_TIER_GROUPS_JSON");
export const resourceGroups = parseJson<CognitoGroupDef[]>(process.env.LOOM_COGNITO_RESOURCE_GROUPS_JSON, "LOOM_COGNITO_RESOURCE_GROUPS_JSON");
export const demoSeedUsers = parseJson<CognitoDemoUser[]>(process.env.LOOM_COGNITO_DEMO_SEED_USERS_JSON, "LOOM_COGNITO_DEMO_SEED_USERS_JSON");
export const abacApplication = process.env.LOOM_COGNITO_ABAC_APPLICATION;
export const abacGroup = process.env.LOOM_COGNITO_ABAC_GROUP;
export const abacOwner = process.env.LOOM_COGNITO_ABAC_OWNER;
/** Unset/"true" -> default (on); "false" -> off. */
export const managedLoginBranding = process.env.LOOM_COGNITO_MANAGED_LOGIN_BRANDING === "false" ? false : undefined;

// ── reference-existing-mode inputs (chant#898) ──────────────────────────
export const referenceUserPoolId = process.env.LOOM_COGNITO_USER_POOL_ID;
export const referenceUserPoolArn = process.env.LOOM_COGNITO_USER_POOL_ARN;
export const referenceDomain = process.env.LOOM_COGNITO_DOMAIN;
export const referenceResourceServerIdentifier = process.env.LOOM_COGNITO_RESOURCE_SERVER_ID;
export const referenceM2MClientId = process.env.LOOM_COGNITO_M2M_CLIENT_ID;
export const referenceUserClientId = process.env.LOOM_COGNITO_USER_CLIENT_ID;
export const referenceIssuer = process.env.LOOM_COGNITO_ISSUER;
export const referenceDiscoveryUrl = process.env.LOOM_COGNITO_DISCOVERY_URL;
export const referenceTokenUrl = process.env.LOOM_COGNITO_TOKEN_URL;
