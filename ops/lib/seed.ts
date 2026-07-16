/**
 * Seed script for Loom's application database (loomster#103).
 *
 * A fresh Loom deploy comes up mostly empty: Loom's own `init_db()` seeds only
 * platform tags + demo tag-profiles, so the Security screen's IAM-role and
 * authorizer pickers are blank and an agent cannot be deployed until an admin
 * hand-imports a role and an authorizer (`ONBOARDING.md` Steps 1-2). loomster
 * provisions those resources (the shared-foundation agent role, the Cognito
 * pool) but never registers them into Loom's app DB — so this Op does, by
 * driving Loom's OWN supported import/create endpoints. It never touches Loom's
 * source (loomster vendors Loom, never forks it).
 *
 * Same pattern as `./cognito-backup.ts` / `./rds-safety.ts`: a pure,
 * unit-testable script builder. Deterministic names are baked in at build time
 * (`./stack-refs.ts` + the naming helper); the AWS-generated Cognito pool id is
 * resolved by its deterministic name at run time.
 *
 * Profiles (tier-defaulted, overridable with `LOOM_SEED_PROFILE`):
 *   - `foundation` — import the agent execution role + a Cognito authorizer.
 *     Enough to deploy an agent. The default on `production`/`production-ha`,
 *     where cost-incurring demo content is unwanted.
 *   - `demo` — foundation, plus demo content (a sample MCP server) so the
 *     Catalog and MCP screens are non-empty. The default on `light`.
 *   - `none` — seed nothing beyond Loom's own `init_db()`.
 *
 * The Loom API base URL comes from `LOOM_API_BASE_URL` (default the local-up
 * proxy `http://localhost:8080`); every write is idempotent (the import
 * endpoints dedupe, and each POST is guarded by a prior existence check), so
 * re-running is safe. Additive and ungated — runs on the local executor.
 */

export type SeedProfile = "demo" | "foundation" | "none";

export interface SeedRefs {
  /** Deterministic shared-foundation agent execution role name (`naming.name("agent-role")`). */
  agentRoleName: string;
  /** Deterministic Cognito user-pool name (`./stack-refs.ts`'s `cognitoUserPoolName`); the pool id is resolved from it at run time. */
  cognitoUserPoolName: string;
  /** Profile to use when `LOOM_SEED_PROFILE` is unset — the tier default (`demo` on light, `foundation` otherwise). */
  defaultProfile: SeedProfile;
}

export function seedDefaultsScript(refs: SeedRefs): string {
  const { agentRoleName, cognitoUserPoolName, defaultProfile } = refs;
  return [
    "set -euo pipefail",
    `BASE="\${LOOM_API_BASE_URL:-http://localhost:8080}"`,
    `PROFILE="\${LOOM_SEED_PROFILE:-${defaultProfile}}"`,
    // Everything loom-seed creates is branded "loomster" — a distinct
    // application + owner tag, a "loomster" tag profile, and "Loomster"-prefixed
    // resource names — so its records are identifiable apart from Loom's own
    // demo data and hand-entered records (provenance, cleanup, idempotency).
    // `loom:group` governs visibility, so it stays overridable via
    // LOOM_SEED_GROUP (default "loomster").
    `GROUP="\${LOOM_SEED_GROUP:-loomster}"`,
    `echo "loom-seed: profile=$PROFILE base=$BASE group=$GROUP"`,
    `if [ "$PROFILE" = "none" ]; then echo "loom-seed: profile=none, nothing to seed"; exit 0; fi`,
    // Account id: prefer the env, fall back to STS (Floci returns the zero account).
    `ACCOUNT="\${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo 000000000000)}"`,
    `BRAND_TAGS="{\\"loom:application\\":\\"loomster\\",\\"loom:group\\":\\"$GROUP\\",\\"loom:owner\\":\\"loomster\\"}"`,
    // ── foundation: a "loomster" tag profile (idempotent), so the Tagging screen
    //    carries the brand and there's a preset to apply to new resources ──
    `if curl -fsS "$BASE/api/settings/tag-profiles" | jq -e 'any(.[]; .name == "loomster")' >/dev/null; then`,
    `  echo "loom-seed: loomster tag profile already present"`,
    `else`,
    `  curl -fsS -X POST "$BASE/api/settings/tag-profiles" -H 'Content-Type: application/json' \\`,
    `    -d "{\\"name\\":\\"loomster\\",\\"tags\\":$BRAND_TAGS}" >/dev/null \\`,
    `    && echo "loom-seed: created loomster tag profile" || echo "loom-seed: loomster tag profile skipped" >&2`,
    `fi`,
    // ── foundation: import the agent execution role (idempotent) ──
    `ROLE_ARN="arn:aws:iam::\${ACCOUNT}:role/${agentRoleName}"`,
    `if curl -fsS "$BASE/api/security/roles" | jq -e --arg a "$ROLE_ARN" 'any(.[]; .role_arn == $a)' >/dev/null; then`,
    `  echo "loom-seed: agent role already imported ($ROLE_ARN)"`,
    `else`,
    `  curl -fsS -X POST "$BASE/api/security/roles" -H 'Content-Type: application/json' \\`,
    `    -d "{\\"mode\\":\\"import\\",\\"role_arn\\":\\"$ROLE_ARN\\",\\"role_type\\":\\"agent\\",\\"description\\":\\"Loomster: agent execution role (seeded by loom-seed)\\",\\"tags\\":$BRAND_TAGS}" >/dev/null`,
    `  echo "loom-seed: imported agent role $ROLE_ARN"`,
    `fi`,
    // ── foundation: Cognito authorizer (idempotent), pool id resolved by name ──
    `POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 --query "UserPools[?Name=='${cognitoUserPoolName}'].Id | [0]" --output text 2>/dev/null || echo None)`,
    `AUTH_NAME="Loomster Cognito Pool"`,
    `if [ -z "$POOL_ID" ] || [ "$POOL_ID" = "None" ]; then`,
    `  echo "loom-seed: no cognito pool named ${cognitoUserPoolName}, skipping authorizer" >&2`,
    `elif curl -fsS "$BASE/api/security/authorizers" | jq -e --arg n "$AUTH_NAME" 'any(.[]; .name == $n)' >/dev/null; then`,
    `  echo "loom-seed: authorizer already present ($AUTH_NAME)"`,
    `else`,
    `  curl -fsS -X POST "$BASE/api/security/authorizers" -H 'Content-Type: application/json' \\`,
    `    -d "{\\"name\\":\\"$AUTH_NAME\\",\\"authorizer_type\\":\\"cognito\\",\\"pool_id\\":\\"$POOL_ID\\",\\"allowed_scopes\\":[\\"loom/invoke\\"]}" >/dev/null`,
    `  echo "loom-seed: created cognito authorizer -> $POOL_ID"`,
    `fi`,
    `if [ "$PROFILE" != "demo" ]; then echo "loom-seed: foundation seed complete"; exit 0; fi`,
    // ── demo: a sample MCP server so the MCP + Catalog screens are non-empty ──
    `MCP_NAME="Loomster Echo MCP"`,
    `if curl -fsS "$BASE/api/mcp/servers" | jq -e --arg n "$MCP_NAME" 'any(.[]; .name == $n)' >/dev/null; then`,
    `  echo "loom-seed: demo MCP server already present"`,
    `else`,
    `  curl -fsS -X POST "$BASE/api/mcp/servers" -H 'Content-Type: application/json' \\`,
    `    -d "{\\"name\\":\\"$MCP_NAME\\",\\"description\\":\\"Loomster sample MCP server (seeded demo content)\\",\\"endpoint_url\\":\\"https://example.invalid/mcp\\",\\"transport_type\\":\\"streamable_http\\",\\"auth_type\\":\\"none\\",\\"tags\\":$BRAND_TAGS}" >/dev/null \\`,
    `    && echo "loom-seed: seeded demo MCP server" || echo "loom-seed: demo MCP server skipped" >&2`,
    `fi`,
    `echo "loom-seed: demo seed complete"`,
  ].join("\n");
}
