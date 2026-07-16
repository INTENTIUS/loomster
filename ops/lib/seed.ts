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
    // ── demo: populate every Catalog section (agents, memories, MCP, A2A) via
    //    Loom's own API, so the demo Catalog is non-empty across the board ──
    // MCP server (create doesn't validate the endpoint, so a placeholder is fine).
    `MCP_NAME="Loomster Echo MCP"`,
    `if curl -fsS "$BASE/api/mcp/servers" | jq -e --arg n "$MCP_NAME" 'any(.[]; .name == $n)' >/dev/null; then`,
    `  echo "loom-seed: demo MCP server already present"`,
    `else`,
    `  curl -fsS -X POST "$BASE/api/mcp/servers" -H 'Content-Type: application/json' \\`,
    `    -d "{\\"name\\":\\"$MCP_NAME\\",\\"description\\":\\"Loomster sample MCP server (seeded demo content)\\",\\"endpoint_url\\":\\"https://example.invalid/mcp\\",\\"transport_type\\":\\"streamable_http\\",\\"auth_type\\":\\"none\\",\\"tags\\":$BRAND_TAGS}" >/dev/null \\`,
    `    && echo "loom-seed: seeded demo MCP server" || echo "loom-seed: demo MCP server skipped" >&2`,
    `fi`,
    // Memory resource (create provisions an AgentCore memory — free on the emulator).
    `MEM_NAME="loomster_demo_memory"`,
    `if curl -fsS "$BASE/api/memories" | jq -e --arg n "$MEM_NAME" 'any(.[]; .name == $n)' >/dev/null; then`,
    `  echo "loom-seed: demo memory already present"`,
    `else`,
    `  curl -fsS -X POST "$BASE/api/memories" -H 'Content-Type: application/json' \\`,
    `    -d "{\\"name\\":\\"$MEM_NAME\\",\\"description\\":\\"Loomster demo memory (seeded demo content)\\",\\"event_expiry_duration\\":30,\\"tags\\":$BRAND_TAGS}" >/dev/null \\`,
    `    && echo "loom-seed: seeded demo memory" || echo "loom-seed: demo memory skipped" >&2`,
    `fi`,
    // Agent (deploy) — the imported role runs it; model id is discovered from the
    // catalog. Loom requires an identifier-style name (no hyphens).
    `AGENT_NAME="loomster_demo_agent"`,
    `if curl -fsS "$BASE/api/agents" | jq -e --arg n "$AGENT_NAME" 'any(.[]; .name == $n)' >/dev/null; then`,
    `  echo "loom-seed: demo agent already present"`,
    `else`,
    `  MODEL=$(curl -fsS "$BASE/api/agents/models" 2>/dev/null | jq -r '[.. | .model_id? // empty] | .[0] // empty')`,
    `  if [ -z "$MODEL" ]; then echo "loom-seed: no model available, skipping demo agent" >&2; else`,
    `    curl -fsS -X POST "$BASE/api/agents" -H 'Content-Type: application/json' \\`,
    `      -d "{\\"source\\":\\"deploy\\",\\"name\\":\\"$AGENT_NAME\\",\\"description\\":\\"Loomster demo assistant (seeded demo content)\\",\\"model_id\\":\\"$MODEL\\",\\"role_arn\\":\\"$ROLE_ARN\\",\\"protocol\\":\\"HTTP\\",\\"network_mode\\":\\"PUBLIC\\",\\"tags\\":$BRAND_TAGS}" >/dev/null \\`,
    `      && echo "loom-seed: deploying demo agent (async)" || echo "loom-seed: demo agent skipped" >&2`,
    `  fi`,
    `fi`,
    // A2A agent — registration fetches the agent card from the base URL, so it
    // needs a reachable A2A endpoint (LOOM_DEMO_A2A_URL). local-up serves one via
    // its proxy; without it, the A2A section is left for you to register.
    `if [ -n "\${LOOM_DEMO_A2A_URL:-}" ]; then`,
    `  A2A_NAME="Loomster Demo A2A"`,
    `  if curl -fsS "$BASE/api/a2a/agents" | jq -e --arg n "$A2A_NAME" 'any(.[]; .name == $n)' >/dev/null; then`,
    `    echo "loom-seed: demo A2A agent already present"`,
    `  else`,
    `    curl -fsS -X POST "$BASE/api/a2a/agents" -H 'Content-Type: application/json' \\`,
    `      -d "{\\"name\\":\\"$A2A_NAME\\",\\"base_url\\":\\"$LOOM_DEMO_A2A_URL\\",\\"tags\\":$BRAND_TAGS}" >/dev/null \\`,
    `      && echo "loom-seed: seeded demo A2A agent" || echo "loom-seed: demo A2A agent skipped (card fetch failed at $LOOM_DEMO_A2A_URL)" >&2`,
    `  fi`,
    `else`,
    `  echo "loom-seed: LOOM_DEMO_A2A_URL unset — skipping A2A demo agent (needs a reachable A2A endpoint)" >&2`,
    `fi`,
    // Security screen extras. NOT seeded here: an Identity Provider — creating
    // one flips Loom out of its dev-auth bypass into real-OIDC mode, which locks
    // a local/demo deploy (there's no real IdP to authenticate against). That tab
    // is left for you to fill with a real provider on a real deploy.
    // Approval policy (Security > Approval Policies) — idempotent by name.
    `POLICY_NAME="Loomster Default Approval Policy"`,
    `if curl -fsS "$BASE/api/settings/approval-policies" | jq -e --arg n "$POLICY_NAME" 'any(.[]; .name == $n)' >/dev/null; then`,
    `  echo "loom-seed: approval policy already present"`,
    `else`,
    `  curl -fsS -X POST "$BASE/api/settings/approval-policies" -H 'Content-Type: application/json' \\`,
    `    -d "{\\"name\\":\\"$POLICY_NAME\\",\\"policy_type\\":\\"tool_context\\",\\"tool_match_rules\\":[\\"*\\"],\\"approval_mode\\":\\"notify_only\\",\\"timeout_seconds\\":300,\\"agent_scope\\":{\\"type\\":\\"all\\"},\\"enabled\\":true}" >/dev/null \\`,
    `    && echo "loom-seed: seeded approval policy" || echo "loom-seed: approval policy skipped" >&2`,
    `fi`,
    // Permission request (Security > Permission Requests) — a single demo pending
    // request against the seeded role. Requests have no unique name, so only seed
    // one when the list is empty (keeps re-runs from piling them up).
    `RID=$(curl -fsS "$BASE/api/security/roles" 2>/dev/null | jq -r '.[0].id // empty')`,
    `if [ -z "$RID" ]; then echo "loom-seed: no managed role, skipping permission request" >&2`,
    `elif curl -fsS "$BASE/api/security/permission-requests" | jq -e 'length > 0' >/dev/null; then`,
    `  echo "loom-seed: permission request already present"`,
    `else`,
    `  curl -fsS -X POST "$BASE/api/security/permission-requests" -H 'Content-Type: application/json' \\`,
    `    -d "{\\"managed_role_id\\":$RID,\\"requested_actions\\":[\\"bedrock:InvokeModel\\"],\\"requested_resources\\":[\\"*\\"],\\"justification\\":\\"Loomster demo permission request (seeded demo content)\\"}" >/dev/null \\`,
    `    && echo "loom-seed: seeded permission request" || echo "loom-seed: permission request skipped" >&2`,
    `fi`,
    `echo "loom-seed: demo seed complete"`,
  ].join("\n");
}
