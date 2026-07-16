/**
 * loom-cognito composite (chant#888).
 *
 * Folds Loom's `shared/iac/cognito.yaml` (v1.6.0) into one composite emitting
 * one CloudFormation stack: the Cognito UserPool, its hosted-UI domain, the
 * OAuth resource server carrying the 23-scope API surface (`invoke` + 11
 * domains x read/write — catalog/agent/memory/security/settings/tagging/
 * costs/mcp/a2a/registry/admin), the machine-to-machine client
 * (client_credentials, `invoke` only) and — production/production-ha only —
 * the user-facing client (authorization code, full scope catalog), Cognito
 * groups, and Managed Login branding.
 *
 * **Access model is RBAC + ABAC, not scopes alone** (chant#888 comment
 * thread): OAuth scopes gate *which API* a token can call; Cognito groups
 * (RBAC) gate *which UI/role* a user has; the `loom:group`/`loom:application`/
 * `loom:owner` UserPool tags (ABAC) are what Loom's backend checks against a
 * *resource's own tag* to scope access per group/tenant — three independent
 * mechanisms, all modeled here. Groups split two ways, same as Loom's own
 * template: **UI-tier** groups (`t-admin`/`t-user`) pick which dashboard a
 * user sees — product structure, not org policy, so they default to Loom's
 * own pair. **Resource-owning** groups (`g-*`) are a team's real org
 * structure — chant#888's access-model comment is explicit that these (and
 * the scope catalog) are "policy-driven parameters a team sets to its real
 * org structure — empty/minimal by default," so `groups.resourceGroups`
 * defaults to `[]`. Loom's own demo `g-admins-demo`/`g-users-demo`/
 * `g-users-test`/`g-users-strategics` groups are NOT defaulted in — bring
 * your own.
 *
 * **Demo seed is parameterized OUT** (chant#888 comment thread): Loom's own
 * 22 demo/test users and 46 group attachments are demo content, not
 * infrastructure policy — `identity.demoSeed` is `undefined` by default
 * (no users, no attachments built at all) and only produces resources when a
 * caller opts in with an explicit user list.
 *
 * **AgentCore Identity + RFC 8693 token exchange** (chant#888 blog-refinement
 * comment): production auth runs deeper than this UserPool alone — Bedrock
 * AgentCore Identity performs OAuth 2.0 token exchange (RFC 8693) to
 * propagate a caller's identity across an agent delegation chain (e.g.
 * exchanging a UserClient-issued end-user ID token for a downstream
 * M2M-scoped access token limited to one resource-server scope). AgentCore
 * Identity's own workload-identity/credential-provider resources are out of
 * scope for this composite — same split shared-foundation already drew for
 * the AgentCore execution role (deferred to chant#893's agent-runtime
 * composite) — but this composite is the identity substrate that token
 * exchange sits on top of, so its issuer, discovery URL, and resource-server
 * identifier (the audience clients — including a future token-exchange call —
 * request scopes against) are all named outputs (`../loom-cognito/outputs.ts`).
 *
 * Every physical name and tag comes from the shared naming helper
 * (`../lib/naming.ts`, chant#897); nothing here is a literal (LOOM001).
 * Cognito group names and usernames are a deliberate exception — they are
 * caller-supplied org policy/seed content meaningful only inside one
 * UserPool, not physical resources needing cross-deployment uniqueness, so
 * they are used as-authored rather than run through `naming.name()` (LOOM001
 * does not enforce `GroupName`/`ClientName`/`Username` for exactly this
 * reason — see `.chant/rules/no-hardcoded-name.ts`'s `PHYSICAL_NAME_KEYS`).
 *
 * Seams:
 * - `identity` (chant#898, adoption): `provision | reference-existing | omit`.
 *   `reference-existing` is first-class — a shared org-level Cognito pool (or
 *   an external OIDC IdP fronted the same way) referenced across multiple
 *   Loom instances, so groups/scopes live once at the org level instead of
 *   being re-provisioned per instance. `omit` drops the identity tier
 *   entirely (no members, no outputs) for a deployment whose auth is fully
 *   externally managed.
 *
 * Tiers (chant#890), all param-selected off `naming.tier` with no divergent
 * source: `light` = UserPool + hosted-UI domain + resource server (scope
 * catalog trimmed to just `invoke`, matching Loom's own `pScopes` parameter
 * default) + the M2M client only — no groups, no user-facing client, no
 * branding, no seed. `production`/`production-ha` = the full 23-scope
 * catalog, both clients, Cognito groups, and Managed Login branding.
 * `AdvancedSecurityMode` is `AUDIT` on light and `ENFORCED` on full tier;
 * `MfaConfiguration` is `OFF` on light and `ON` (software-token TOTP) on full
 * tier — chant's Cognito hardening post-synth checks (WAW050 advanced
 * security, WAW051 no implicit grant, WAW052 MFA on the full tier) are
 * satisfied at every tier: neither client ever requests the implicit grant.
 *
 * Style note: each seam/tier's resource creation lives in its own
 * module-level `buildXxx()` helper below, invoked with a ternary in the
 * `Composite()` factory body (never an `if` wrapping a resource
 * constructor) — chant's EVL002 requires resources to be reachable without
 * control flow, and EVL001 requires every `new Xxx(...)` property value
 * outside the factory body to be statically evaluable (an identifier or
 * literal, never a function call) — so anything dynamic is computed into a
 * local `const` *before* the resource constructor that consumes it. A
 * variable number of groups/demo-users/attachments (chant's EVL003 forbids
 * computed `obj[key]` element access anywhere in this file) are threaded
 * through a `Map`, built with `.set()`/`.get()` (method calls, not bracket
 * access) and converted to the composite's returned member object with
 * `Object.fromEntries()` — never `obj[dynamicKey]`. Only the final per-seam
 * spread-merge (`...(x ?? {})`) happens back in the factory body proper,
 * where EVL004 exempts it — see `LoomCognito`'s `return` below.
 */

import { Composite } from "@intentius/chant";
import {
  UserPool,
  UserPool_Policies,
  UserPool_PasswordPolicy,
  UserPool_AdminCreateUserConfig,
  UserPool_UserPoolAddOns,
  UserPoolDomain,
  UserPoolResourceServer,
  UserPoolResourceServer_ResourceServerScopeType,
  UserPoolClient,
  UserPoolGroup,
  UserPoolUser,
  UserPoolUser_AttributeType,
  UserPoolUserToGroupAttachment,
  ManagedLoginBranding,
  Ref,
} from "@intentius/chant-lexicon-aws";
import { loomNaming, type LoomNaming, type LoomNamingParams, type Tier } from "../lib/naming";

// ─────────────────────────────────────────────────────────────────────────
// Seams
// ─────────────────────────────────────────────────────────────────────────

export interface CognitoScopeDef {
  /** OAuth scope name, e.g. "catalog:read" or "invoke". */
  name: string;
  description: string;
}

export interface CognitoGroupDef {
  /** Cognito group name, e.g. "t-admin" or "g-security-team". As-authored — not run through the naming helper (see file header). */
  name: string;
  description?: string;
  precedence?: number;
}

/**
 * RBAC groups (chant#888). `uiTiers` picks which dashboard a user sees —
 * product structure, defaults to Loom's own `t-admin`/`t-user` pair.
 * `resourceGroups` is a team's real org structure (ABAC-tag-scoped resource
 * ownership) — policy-driven, defaults to `[]` (bring your own; Loom's own
 * demo/test resource groups are not defaulted in).
 */
export interface CognitoGroupsSeam {
  uiTiers?: CognitoGroupDef[];
  resourceGroups?: CognitoGroupDef[];
}

/**
 * One demo/seed user (Loom's own 22, opt-in only — see file header). `uiTier`
 * must name a group present in `groups.uiTiers`; each entry in
 * `resourceGroups` must name one present in `groups.resourceGroups` — both
 * validated at build time (a typo throws instead of silently producing a
 * User with no attachment).
 */
export interface CognitoDemoUser {
  username: string;
  email: string;
  uiTier: string;
  resourceGroups?: string[];
}

/** ABAC tag values (Loom's `loom:application`/`loom:group`/`loom:owner` UserPool tags). Defaults derive from the naming params — see `buildCore`. */
export interface CognitoAbacTags {
  application?: string;
  group?: string;
  owner?: string;
}

export interface CognitoProvisionData {
  mode?: "provision";
  /** OAuth callback URLs for both clients. Default: `["https://localhost"]` (matches Loom's own `pCallbackUrls` default). */
  callbackUrls?: string[];
  /** Resource server identifier (Loom's `pResourceServerIdentifier`) — the audience clients request scopes against. Default: derived from the naming helper. */
  resourceServerIdentifier?: string;
  /** OAuth scope catalog. Default: Loom's own 23 (chant#888: `invoke` + 11 domains x read/write) on production/production-ha; `invoke` only on light (matches Loom's own `pScopes` default). Override to set your own org's API surface. */
  scopes?: CognitoScopeDef[];
  /** RBAC groups (chant#888) — present on production/production-ha only (chant#890: light has no groups at all). */
  groups?: CognitoGroupsSeam;
  /** Demo/seed users + group attachments — opt-in only, `undefined` by default (see file header). Ignored on light tier (no groups exist there to attach to). */
  demoSeed?: { users: CognitoDemoUser[] };
  /** ABAC tag values. Defaults: `application` -> `naming.project`, `group` -> `naming.instance`, `owner` -> `naming.owner`. */
  abacTags?: CognitoAbacTags;
  /** Managed Login branding on the user-facing client — production/production-ha only (no user client exists on light to brand). Default: `true`. */
  managedLoginBranding?: boolean;
}

/**
 * A shared org-level Cognito pool (or an external OIDC IdP fronted the same
 * way) referenced across multiple Loom instances (chant#898's multi-instance
 * pattern) — no resources of this composite's own. `issuer`/`discoveryUrl`/
 * `tokenUrl` are computed from `userPoolId`/`domain` when omitted (see
 * `../loom-cognito/outputs.ts`).
 */
export interface CognitoReferenceExistingData {
  mode: "reference-existing";
  userPoolId: string;
  userPoolArn?: string;
  domain: string;
  resourceServerIdentifier: string;
  m2mClientId: string;
  userClientId?: string;
  issuer?: string;
  discoveryUrl?: string;
  tokenUrl?: string;
}

export interface CognitoOmitData {
  mode: "omit";
}

/** Adoption (chant#898): `provision | reference-existing | omit`. */
export type IdentitySeam = CognitoProvisionData | CognitoReferenceExistingData | CognitoOmitData;

export interface LoomCognitoProps {
  /** Naming/tagging parameter source (chant#897) — one call derives every physical name below. */
  naming: LoomNamingParams;
  identity: IdentitySeam;
}

// ─────────────────────────────────────────────────────────────────────────
// Fixed catalogs — hoisted to module scope (plain data, safe to share across
// calls; never a Declarable instance — see file header's EVL note on why
// property-type `new Xxx(...)` instances are built fresh per call instead).
// ─────────────────────────────────────────────────────────────────────────

const LOOM_INVOKE_SCOPE: CognitoScopeDef = { name: "invoke", description: "Invoke agent through AgentCore" };

const LOOM_DOMAIN_SCOPES: CognitoScopeDef[] = [
  { name: "catalog:read", description: "Read catalog resources" },
  { name: "catalog:write", description: "Write catalog resources" },
  { name: "agent:read", description: "Read agents" },
  { name: "agent:write", description: "Write agents" },
  { name: "memory:read", description: "Read memory resources" },
  { name: "memory:write", description: "Write memory resources" },
  { name: "security:read", description: "Read security configurations" },
  { name: "security:write", description: "Write security configurations" },
  { name: "settings:read", description: "Read settings" },
  { name: "settings:write", description: "Write settings" },
  { name: "tagging:read", description: "View tag policies and profiles" },
  { name: "tagging:write", description: "Manage tag policies and profiles" },
  { name: "costs:read", description: "View cost data" },
  { name: "costs:write", description: "Manage cost settings" },
  { name: "mcp:read", description: "Read MCP servers" },
  { name: "mcp:write", description: "Write MCP servers" },
  { name: "a2a:read", description: "Read A2A agents" },
  { name: "a2a:write", description: "Write A2A agents" },
  { name: "registry:read", description: "View registry records" },
  { name: "registry:write", description: "Manage registry records" },
  { name: "admin:read", description: "View admin dashboard and audit data" },
  { name: "admin:write", description: "Manage admin dashboard settings" },
];

/** Loom's own full 23-scope resource server surface (`invoke` + 11 domains x read/write). */
export const LOOM_COGNITO_SCOPES: CognitoScopeDef[] = [LOOM_INVOKE_SCOPE, ...LOOM_DOMAIN_SCOPES];

/** Light tier's trimmed scope catalog — matches Loom's own `pScopes` parameter default ("invoke"). */
const LOOM_LIGHT_SCOPES: CognitoScopeDef[] = [LOOM_INVOKE_SCOPE];

/** Loom's own UI-tier pair — product structure, not org policy (see file header). */
export const LOOM_UI_TIER_GROUPS: CognitoGroupDef[] = [
  { name: "t-admin", description: "Admin UI view" },
  { name: "t-user", description: "User UI view (restricted to Catalog, Agents, Memory, Costs)" },
];

const EMPTY_GROUP_DEFS: CognitoGroupDef[] = [];
const EMPTY_STRING_LIST: string[] = [];
const DEFAULT_CALLBACK_URLS: string[] = ["https://localhost"];
const LOOM_ENABLED_MFAS: string[] = ["SOFTWARE_TOKEN_MFA"];
const LOOM_CLIENT_CREDENTIALS_FLOW: string[] = ["client_credentials"];
const LOOM_AUTHORIZATION_CODE_FLOW: string[] = ["code"];
const LOOM_COGNITO_IDENTITY_PROVIDERS: string[] = ["COGNITO"];
const LOOM_OIDC_SCOPES: string[] = ["openid", "email", "profile"];
const LOOM_USER_CLIENT_AUTH_FLOWS: string[] = [
  "ALLOW_USER_PASSWORD_AUTH",
  "ALLOW_REFRESH_TOKEN_AUTH",
  "ALLOW_ADMIN_USER_PASSWORD_AUTH",
];

// ─────────────────────────────────────────────────────────────────────────
// Per-phase resource builders. Each is a plain module-level function (not
// nested in the Composite() factory below) so it can be invoked with a
// ternary — never an `if` wrapping a resource constructor.
// ─────────────────────────────────────────────────────────────────────────

interface CoreResult {
  members: {
    userPool: InstanceType<typeof UserPool>;
    userPoolDomain: InstanceType<typeof UserPoolDomain>;
    resourceServer: InstanceType<typeof UserPoolResourceServer>;
    m2mClient: InstanceType<typeof UserPoolClient>;
  };
  userPool: InstanceType<typeof UserPool>;
  userPoolIdRef: string;
  resourceServer: InstanceType<typeof UserPoolResourceServer>;
  resourceServerIdentifier: string;
  scopeDefs: CognitoScopeDef[];
  callbackUrls: string[];
  uiTierGroupDefs: CognitoGroupDef[];
  resourceGroupDefs: CognitoGroupDef[];
  demoSeedUsers: CognitoDemoUser[] | undefined;
  managedLoginBrandingEnabled: boolean;
}

/**
 * The always-built-together core of a provisioned loom-cognito: the
 * UserPool itself, its hosted-UI domain, the resource server (scope catalog
 * tier-trimmed), and the M2M client. Present whenever `identity.mode` is
 * `"provision"` (default), regardless of tier.
 */
function buildCore(naming: LoomNaming, namingParams: LoomNamingParams, tier: Tier, provision: CognitoProvisionData): CoreResult {
  const poolName = naming.name("pool");

  const abacApplication = provision.abacTags?.application ?? namingParams.project;
  const abacGroup = provision.abacTags?.group ?? namingParams.instance;
  const abacOwner = provision.abacTags?.owner ?? namingParams.owner;
  const userPoolTags = naming.tags({
    "loom:application": abacApplication,
    "loom:group": abacGroup,
    "loom:owner": abacOwner,
  });

  const advancedSecurityMode = tier === "light" ? "AUDIT" : "ENFORCED";
  const mfaConfiguration = tier === "light" ? "OFF" : "ON";
  const enabledMfas = tier === "light" ? undefined : LOOM_ENABLED_MFAS;
  const deletionProtection = tier === "production-ha" ? "ACTIVE" : "INACTIVE";

  const passwordPolicy = new UserPool_PasswordPolicy({
    MinimumLength: 12,
    RequireUppercase: true,
    RequireLowercase: true,
    RequireNumbers: true,
    RequireSymbols: false,
  });
  const policies = new UserPool_Policies({ PasswordPolicy: passwordPolicy });
  const adminCreateUserConfig = new UserPool_AdminCreateUserConfig({ AllowAdminCreateUserOnly: true });
  const userPoolAddOns = new UserPool_UserPoolAddOns({ AdvancedSecurityMode: advancedSecurityMode });

  const userPool = new UserPool({
    UserPoolName: poolName,
    AdminCreateUserConfig: adminCreateUserConfig,
    Policies: policies,
    UserPoolAddOns: userPoolAddOns,
    MfaConfiguration: mfaConfiguration,
    EnabledMfas: enabledMfas,
    DeletionProtection: deletionProtection,
    UserPoolTags: userPoolTags,
  });
  const userPoolIdRef = Ref(userPool) as unknown as string;

  // Cognito reserves "aws", "amazon", and "cognito" in a hosted-UI domain
  // prefix — real Cognito rejects any prefix containing them with
  // "Invalid request provided" (Floci does not enforce this; found on a real
  // us-east-2 deploy). The component name "loom-cognito" injects "cognito", so
  // strip the reserved words and collapse the resulting hyphens. The
  // uniqueness suffix from the naming helper is preserved.
  const rawDomainPrefix = naming.name("auth", { service: "cognitoDomain" });
  const domainPrefix = rawDomainPrefix.replace(/cognito|amazon|aws/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const userPoolDomain = new UserPoolDomain({ Domain: domainPrefix, UserPoolId: userPoolIdRef });

  const resourceServerIdentifier = provision.resourceServerIdentifier ?? naming.name("resource-server");
  const resourceServerName = naming.name("resource-server");
  const scopeDefs = provision.scopes ?? (tier === "light" ? LOOM_LIGHT_SCOPES : LOOM_COGNITO_SCOPES);
  const scopeDeclarables = scopeDefs.map(
    (s) => new UserPoolResourceServer_ResourceServerScopeType({ ScopeName: s.name, ScopeDescription: s.description }),
  );
  const resourceServer = new UserPoolResourceServer({
    Identifier: resourceServerIdentifier,
    Name: resourceServerName,
    UserPoolId: userPoolIdRef,
    Scopes: scopeDeclarables,
  });

  const callbackUrls = provision.callbackUrls ?? DEFAULT_CALLBACK_URLS;
  const m2mClientName = naming.name("m2m-client");
  const m2mScope = `${resourceServerIdentifier}/invoke`;
  const m2mClient = new UserPoolClient(
    {
      UserPoolId: userPoolIdRef,
      ClientName: m2mClientName,
      GenerateSecret: true,
      AllowedOAuthFlows: LOOM_CLIENT_CREDENTIALS_FLOW,
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: [m2mScope],
      CallbackURLs: callbackUrls,
      SupportedIdentityProviders: LOOM_COGNITO_IDENTITY_PROVIDERS,
    },
    { DependsOn: [resourceServer] },
  );

  const uiTierGroupDefs = provision.groups?.uiTiers ?? LOOM_UI_TIER_GROUPS;
  const resourceGroupDefs = provision.groups?.resourceGroups ?? EMPTY_GROUP_DEFS;
  const managedLoginBrandingEnabled = provision.managedLoginBranding !== false;

  return {
    members: { userPool, userPoolDomain, resourceServer, m2mClient },
    userPool,
    userPoolIdRef,
    resourceServer,
    resourceServerIdentifier,
    scopeDefs,
    callbackUrls,
    uiTierGroupDefs,
    resourceGroupDefs,
    demoSeedUsers: provision.demoSeed?.users,
    managedLoginBrandingEnabled,
  };
}

interface UserClientResult {
  members: { userClient: InstanceType<typeof UserPoolClient> };
  userClient: InstanceType<typeof UserPoolClient>;
}

/** User-facing client (authorization code flow, full scope catalog) — production/production-ha only (chant#890). */
function buildUserClient(
  naming: LoomNaming,
  userPoolIdRef: string,
  resourceServerIdentifier: string,
  scopeDefs: CognitoScopeDef[],
  callbackUrls: string[],
  resourceServer: InstanceType<typeof UserPoolResourceServer>,
): UserClientResult {
  const userClientName = naming.name("user-client");
  const domainScopeStrings = scopeDefs.map((s) => `${resourceServerIdentifier}/${s.name}`);
  const allScopes = LOOM_OIDC_SCOPES.concat(domainScopeStrings);

  const userClient = new UserPoolClient(
    {
      UserPoolId: userPoolIdRef,
      ClientName: userClientName,
      GenerateSecret: false,
      ExplicitAuthFlows: LOOM_USER_CLIENT_AUTH_FLOWS,
      AllowedOAuthFlows: LOOM_AUTHORIZATION_CODE_FLOW,
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: allScopes,
      CallbackURLs: callbackUrls,
      SupportedIdentityProviders: LOOM_COGNITO_IDENTITY_PROVIDERS,
    },
    { DependsOn: [resourceServer] },
  );

  return { members: { userClient }, userClient };
}

interface BrandingResult {
  members: { managedLoginBranding: InstanceType<typeof ManagedLoginBranding> };
}

/** Managed Login branding on the user-facing client — production/production-ha only, and only when `managedLoginBranding !== false` (chant#890). */
function buildManagedLoginBranding(userPoolIdRef: string, userClient: InstanceType<typeof UserPoolClient>): BrandingResult {
  // `Ref(...)`, matching Loom's own `ClientId: !Ref UserClient` — `Ref` on
  // `AWS::Cognito::UserPoolClient` resolves to the client id, same value
  // `userClient.ClientId` (Fn::GetAtt) would produce, just closer to the
  // source template's own intrinsic choice.
  const clientIdRef = Ref(userClient) as unknown as string;
  const managedLoginBranding = new ManagedLoginBranding({
    UserPoolId: userPoolIdRef,
    ClientId: clientIdRef,
    UseCognitoProvidedValues: true,
  });
  return { members: { managedLoginBranding } };
}

interface GroupsResult {
  members: Record<string, InstanceType<typeof UserPoolGroup>>;
  groupMap: Map<string, InstanceType<typeof UserPoolGroup>>;
}

/** Cognito groups (RBAC, chant#888) — UI-tier + resource-owning, production/production-ha only (chant#890). */
function buildGroups(userPoolIdRef: string, uiTierGroupDefs: CognitoGroupDef[], resourceGroupDefs: CognitoGroupDef[]): GroupsResult {
  const membersMap = new Map<string, InstanceType<typeof UserPoolGroup>>();
  const groupMap = new Map<string, InstanceType<typeof UserPoolGroup>>();

  uiTierGroupDefs.forEach((g, index) => {
    const group = new UserPoolGroup({
      UserPoolId: userPoolIdRef,
      GroupName: g.name,
      Description: g.description,
      Precedence: g.precedence,
    });
    membersMap.set(`uiTierGroup${index}`, group);
    groupMap.set(g.name, group);
  });

  resourceGroupDefs.forEach((g, index) => {
    const group = new UserPoolGroup({
      UserPoolId: userPoolIdRef,
      GroupName: g.name,
      Description: g.description,
      Precedence: g.precedence,
    });
    membersMap.set(`resourceGroup${index}`, group);
    groupMap.set(g.name, group);
  });

  const members = Object.fromEntries(membersMap) as Record<string, InstanceType<typeof UserPoolGroup>>;
  return { members, groupMap };
}

interface DemoSeedResult {
  members: Record<string, InstanceType<typeof UserPoolUser> | InstanceType<typeof UserPoolUserToGroupAttachment>>;
}

/** Demo/seed users + group attachments (chant#888: opt-in only, see file header) — only called when there is at least 1 user to seed. */
function buildDemoSeed(
  userPoolIdRef: string,
  groupMap: Map<string, InstanceType<typeof UserPoolGroup>>,
  users: CognitoDemoUser[],
): DemoSeedResult {
  const membersMap = new Map<string, InstanceType<typeof UserPoolUser> | InstanceType<typeof UserPoolUserToGroupAttachment>>();

  users.forEach((u, userIndex) => {
    // chant-disable-next-line LOOM001 -- "email" is Cognito's own standard user-attribute schema name, not a physical resource name we control.
    const emailAttribute = new UserPoolUser_AttributeType({ Name: "email", Value: u.email });
    const user = new UserPoolUser({ UserPoolId: userPoolIdRef, Username: u.username, UserAttributes: [emailAttribute] });
    membersMap.set(`demoUser${userIndex}`, user);
    const usernameRef = Ref(user) as unknown as string;

    const uiTierGroup = groupMap.get(u.uiTier);
    const missingUiTierGroupError = new Error(
      `LoomCognito: demoSeed user "${u.username}" references unknown uiTier group "${u.uiTier}" — add it to groups.uiTiers first`,
    );
    if (!uiTierGroup) throw missingUiTierGroupError;
    const uiTierGroupNameRef = Ref(uiTierGroup) as unknown as string;
    const uiTierAttachment = new UserPoolUserToGroupAttachment({
      UserPoolId: userPoolIdRef,
      Username: usernameRef,
      GroupName: uiTierGroupNameRef,
    });
    membersMap.set(`demoUserTierAttachment${userIndex}`, uiTierAttachment);

    const resourceGroupNames = u.resourceGroups ?? EMPTY_STRING_LIST;
    resourceGroupNames.forEach((groupName, groupIndex) => {
      const resourceGroup = groupMap.get(groupName);
      const missingResourceGroupError = new Error(
        `LoomCognito: demoSeed user "${u.username}" references unknown resource group "${groupName}" — add it to groups.resourceGroups first`,
      );
      if (!resourceGroup) throw missingResourceGroupError;
      const resourceGroupNameRef = Ref(resourceGroup) as unknown as string;
      const resourceAttachment = new UserPoolUserToGroupAttachment({
        UserPoolId: userPoolIdRef,
        Username: usernameRef,
        GroupName: resourceGroupNameRef,
      });
      membersMap.set(`demoUserResourceAttachment${userIndex}_${groupIndex}`, resourceAttachment);
    });
  });

  const members = Object.fromEntries(membersMap) as Record<
    string,
    InstanceType<typeof UserPoolUser> | InstanceType<typeof UserPoolUserToGroupAttachment>
  >;
  return { members };
}

/**
 * Every member `LoomCognito` can return. The 6 named ones cover the
 * always-present-in-provision-mode core plus the full-tier-only client/
 * branding; groups/demo-users/attachments are dynamic-count (a team's own
 * org structure) and come back under generated keys (`uiTierGroup0`,
 * `resourceGroup0`, `demoUser0`, `demoUserTierAttachment0`,
 * `demoUserResourceAttachment0_0`, ...) — hence the index signature.
 * `identity.mode: "reference-existing"`/`"omit"` return no members at all.
 */
export type LoomCognitoResult = {
  userPool?: InstanceType<typeof UserPool>;
  userPoolDomain?: InstanceType<typeof UserPoolDomain>;
  resourceServer?: InstanceType<typeof UserPoolResourceServer>;
  m2mClient?: InstanceType<typeof UserPoolClient>;
  userClient?: InstanceType<typeof UserPoolClient>;
  managedLoginBranding?: InstanceType<typeof ManagedLoginBranding>;
};

export const LoomCognito = Composite<LoomCognitoProps, LoomCognitoResult>((props) => {
  const naming = loomNaming(props.naming, "loom-cognito");
  const tier = props.naming.tier;
  const identity = props.identity;

  const core = identity.mode !== "reference-existing" && identity.mode !== "omit"
    ? buildCore(naming, props.naming, tier, identity)
    : undefined;

  const userClientResult = core && tier !== "light"
    ? buildUserClient(naming, core.userPoolIdRef, core.resourceServerIdentifier, core.scopeDefs, core.callbackUrls, core.resourceServer)
    : undefined;

  const brandingResult = core && userClientResult && core.managedLoginBrandingEnabled
    ? buildManagedLoginBranding(core.userPoolIdRef, userClientResult.userClient)
    : undefined;

  const groupsResult = core && tier !== "light"
    ? buildGroups(core.userPoolIdRef, core.uiTierGroupDefs, core.resourceGroupDefs)
    : undefined;

  const demoSeedResult = core && groupsResult && core.demoSeedUsers && core.demoSeedUsers.length > 0
    ? buildDemoSeed(core.userPoolIdRef, groupsResult.groupMap, core.demoSeedUsers)
    : undefined;

  return {
    ...(core?.members ?? {}),
    ...(userClientResult?.members ?? {}),
    ...(brandingResult?.members ?? {}),
    ...(groupsResult?.members ?? {}),
    ...(demoSeedResult?.members ?? {}),
  };
}, "LoomCognito");
