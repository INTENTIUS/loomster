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
  /** Deterministic Cognito user-pool name (`./stack-refs.ts`'s `cognitoUserPoolName`); used as the fallback pool lookup. */
  cognitoUserPoolName: string;
  /** Namespaced loom-cognito stack name (`{project}-{env}-{instance}-loom-cognito`); the pool id is read from its `oCognitoUserPoolId` output, which is exact and pagination-proof. */
  cognitoStackName: string;
  /** Profile to use when `LOOM_SEED_PROFILE` is unset — the tier default (`demo` on light, `foundation` otherwise). */
  defaultProfile: SeedProfile;
}

export function seedDefaultsScript(refs: SeedRefs): string {
  const { agentRoleName, cognitoUserPoolName, cognitoStackName, defaultProfile } = refs;
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
    // Every deployment enforces auth, local-up included (Cognito on Floci,
    // loomster#58). When LOOM_API_TOKEN is set (e.g. the throwaway admin the
    // live-e2e harness or scripts/local/local-token.sh mints), pass it as a bearer
    // via a curl -K config file — kept out of argv/`ps`, quoting-safe, and simply
    // absent (empty file) when no token is set. Every curl below reads it (`-K "$AUTHCFG"`).
    `AUTHCFG="$(mktemp)"; trap 'rm -f "$AUTHCFG"' EXIT`,
    `if [ -n "\${LOOM_API_TOKEN:-}" ]; then printf 'header = "Authorization: Bearer %s"\\n' "$LOOM_API_TOKEN" > "$AUTHCFG"; echo "loom-seed: authenticating with LOOM_API_TOKEN"; fi`,
    `if [ "$PROFILE" = "none" ]; then echo "loom-seed: profile=none, nothing to seed"; exit 0; fi`,
    // Every step prints one verdict line: ok (created), present (already there),
    // skipped (optional, with the reason) or failed. Any failed step makes the
    // script exit non-zero at the end, after every step has had its turn, so a
    // demo seed that could not deploy its agent cannot pass for a good one.
    `FAILED=""`,
    `verdict() { local step="$1" v="$2"; shift 2; echo "loom-seed: step=$step verdict=$v\${*:+ $*}"; if [ "$v" = failed ]; then FAILED="$FAILED $step"; fi; }`,
    `finish() { if [ -n "$FAILED" ]; then echo "loom-seed: FAILED steps:$FAILED" >&2; exit 1; fi; echo "loom-seed: $1"; exit 0; }`,
    // Account id: prefer the env, fall back to STS (Floci returns the zero account).
    `ACCOUNT="\${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo 000000000000)}"`,
    `BRAND_TAGS="{\\"loom:application\\":\\"loomster\\",\\"loom:group\\":\\"$GROUP\\",\\"loom:owner\\":\\"loomster\\"}"`,
    // ── foundation: a "loomster" tag profile (idempotent), so the Tagging screen
    //    carries the brand and there's a preset to apply to new resources.
    //    Optional: a failure skips it with the reason. ──
    `if curl -fsS "$BASE/api/settings/tag-profiles" | jq -e 'any(.[]; .name == "loomster")' >/dev/null; then`,
    `  verdict tag-profile present`,
    `elif curl -fsS -X POST "$BASE/api/settings/tag-profiles" -H 'Content-Type: application/json' \\`,
    `    -d "{\\"name\\":\\"loomster\\",\\"tags\\":$BRAND_TAGS}" >/dev/null; then`,
    `  verdict tag-profile ok "created loomster tag profile"`,
    `else`,
    `  verdict tag-profile skipped "POST /api/settings/tag-profiles failed (optional)"`,
    `fi`,
    // ── foundation: import the agent execution role (idempotent) ──
    `ROLE_ARN="arn:aws:iam::\${ACCOUNT}:role/${agentRoleName}"`,
    `if curl -fsS "$BASE/api/security/roles" | jq -e --arg a "$ROLE_ARN" 'any(.[]; .role_arn == $a)' >/dev/null; then`,
    `  verdict agent-role present "$ROLE_ARN"`,
    `elif curl -fsS -X POST "$BASE/api/security/roles" -H 'Content-Type: application/json' \\`,
    `    -d "{\\"mode\\":\\"import\\",\\"role_arn\\":\\"$ROLE_ARN\\",\\"role_type\\":\\"agent\\",\\"description\\":\\"Loomster: agent execution role (seeded by loom-seed)\\",\\"tags\\":$BRAND_TAGS}" >/dev/null; then`,
    `  verdict agent-role ok "imported $ROLE_ARN"`,
    `else`,
    `  verdict agent-role failed "POST /api/security/roles could not import $ROLE_ARN"`,
    `fi`,
    // ── foundation: Cognito authorizer (idempotent) ──
    // Resolve the pool id from the loom-cognito stack output (exact, pagination-proof);
    // fall back to a name scan for a locally-provisioned pool with no stack output.
    `POOL_ID=$(aws cloudformation describe-stacks --stack-name "${cognitoStackName}" --query "Stacks[0].Outputs[?OutputKey=='oCognitoUserPoolId'].OutputValue | [0]" --output text 2>/dev/null || echo None)`,
    `if [ -z "$POOL_ID" ] || [ "$POOL_ID" = "None" ]; then POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 --query "UserPools[?Name=='${cognitoUserPoolName}'].Id | [0]" --output text 2>/dev/null || echo None); fi`,
    `AUTH_NAME="Loomster Cognito Pool"`,
    `if [ -z "$POOL_ID" ] || [ "$POOL_ID" = "None" ]; then`,
    `  verdict authorizer skipped "no cognito pool (stack ${cognitoStackName} / name ${cognitoUserPoolName})"`,
    `elif curl -fsS "$BASE/api/security/authorizers" | jq -e --arg n "$AUTH_NAME" 'any(.[]; .name == $n)' >/dev/null; then`,
    `  verdict authorizer present "$AUTH_NAME"`,
    `elif curl -fsS -X POST "$BASE/api/security/authorizers" -H 'Content-Type: application/json' \\`,
    `    -d "{\\"name\\":\\"$AUTH_NAME\\",\\"authorizer_type\\":\\"cognito\\",\\"pool_id\\":\\"$POOL_ID\\",\\"allowed_scopes\\":[\\"loom/invoke\\"]}" >/dev/null; then`,
    `  verdict authorizer ok "created cognito authorizer -> $POOL_ID"`,
    `else`,
    `  verdict authorizer failed "POST /api/security/authorizers failed for pool $POOL_ID"`,
    `fi`,
    `if [ "$PROFILE" != "demo" ]; then finish "foundation seed complete"; fi`,
    // ── demo: populate every Catalog section (agents, memories, MCP, A2A) via
    //    Loom's own API, so the demo Catalog is non-empty across the board. A
    //    demo step that fails is failed, never skipped. ──
    // MCP server (create doesn't validate the endpoint, so a placeholder is fine).
    `MCP_NAME="Loomster Echo MCP"`,
    `if curl -fsS "$BASE/api/mcp/servers" | jq -e --arg n "$MCP_NAME" 'any(.[]; .name == $n)' >/dev/null; then`,
    `  verdict demo-mcp-server present`,
    `elif curl -fsS -X POST "$BASE/api/mcp/servers" -H 'Content-Type: application/json' \\`,
    `    -d "{\\"name\\":\\"$MCP_NAME\\",\\"description\\":\\"Loomster sample MCP server (seeded demo content)\\",\\"endpoint_url\\":\\"https://example.invalid/mcp\\",\\"transport_type\\":\\"streamable_http\\",\\"auth_type\\":\\"none\\",\\"tags\\":$BRAND_TAGS}" >/dev/null; then`,
    `  verdict demo-mcp-server ok`,
    `else`,
    `  verdict demo-mcp-server failed "POST /api/mcp/servers failed"`,
    `fi`,
    // Memory resource (create provisions an AgentCore memory — free on the emulator).
    // A summary strategy, so the memory actually processes events rather than
    // being an inert resource — the most representative single strategy.
    `MEM_NAME="loomster_demo_memory"`,
    `if curl -fsS "$BASE/api/memories" | jq -e --arg n "$MEM_NAME" 'any(.[]; .name == $n)' >/dev/null; then`,
    `  verdict demo-memory present`,
    `elif curl -fsS -X POST "$BASE/api/memories" -H 'Content-Type: application/json' \\`,
    `    -d "{\\"name\\":\\"$MEM_NAME\\",\\"description\\":\\"Loomster demo memory (seeded demo content)\\",\\"event_expiry_duration\\":30,\\"memory_strategies\\":[{\\"strategy_type\\":\\"summary\\",\\"name\\":\\"summary\\",\\"namespaces\\":[\\"/strategy/{strategyId}/actor/{actorId}/session/{sessionId}/\\"]}],\\"tags\\":$BRAND_TAGS}" >/dev/null; then`,
    `  verdict demo-memory ok "with a summary strategy"`,
    `else`,
    `  verdict demo-memory failed "POST /api/memories failed"`,
    `fi`,
    // Agent (deploy) — the imported role runs it; model id is discovered from the
    // catalog. Loom requires an identifier-style name (no hyphens).
    `AGENT_NAME="loomster_demo_agent"`,
    `if curl -fsS "$BASE/api/agents" | jq -e --arg n "$AGENT_NAME" 'any(.[]; .name == $n)' >/dev/null; then`,
    `  verdict demo-agent present`,
    `else`,
    `  MODEL=$(curl -fsS "$BASE/api/agents/models" 2>/dev/null | jq -r '[.. | .model_id? // empty] | .[0] // empty' || true)`,
    `  if [ -z "$MODEL" ]; then verdict demo-agent failed "GET /api/agents/models listed no model"`,
    `  elif curl -fsS -X POST "$BASE/api/agents" -H 'Content-Type: application/json' \\`,
    `      -d "{\\"source\\":\\"deploy\\",\\"name\\":\\"$AGENT_NAME\\",\\"description\\":\\"Loomster demo assistant (seeded demo content)\\",\\"model_id\\":\\"$MODEL\\",\\"role_arn\\":\\"$ROLE_ARN\\",\\"protocol\\":\\"HTTP\\",\\"network_mode\\":\\"PUBLIC\\",\\"tags\\":$BRAND_TAGS}" >/dev/null; then`,
    `    verdict demo-agent ok "deploy requested (async; demo-agent-ready waits for it)"`,
    `  else`,
    `    verdict demo-agent failed "POST /api/agents failed"`,
    `  fi`,
    `fi`,
    // A2A agent — registration fetches the agent card from the base URL, so it
    // needs a reachable A2A endpoint (LOOM_DEMO_A2A_URL). local-up serves one via
    // its proxy; without it, the A2A section is left for you to register.
    `if [ -n "\${LOOM_DEMO_A2A_URL:-}" ]; then`,
    `  A2A_NAME="Loomster Demo A2A"`,
    `  if curl -fsS "$BASE/api/a2a/agents" | jq -e --arg n "$A2A_NAME" 'any(.[]; .name == $n)' >/dev/null; then`,
    `    verdict demo-a2a-agent present`,
    `  elif curl -fsS -X POST "$BASE/api/a2a/agents" -H 'Content-Type: application/json' \\`,
    `      -d "{\\"name\\":\\"$A2A_NAME\\",\\"base_url\\":\\"$LOOM_DEMO_A2A_URL\\",\\"tags\\":$BRAND_TAGS}" >/dev/null; then`,
    `    verdict demo-a2a-agent ok`,
    `  else`,
    `    verdict demo-a2a-agent failed "card fetch failed at $LOOM_DEMO_A2A_URL"`,
    `  fi`,
    `else`,
    `  verdict demo-a2a-agent skipped "LOOM_DEMO_A2A_URL unset (needs a reachable A2A endpoint)"`,
    `fi`,
    // Security screen extras. NOT seeded here: an Identity Provider — creating
    // one switches Loom's login to that provider, which locks
    // a local/demo deploy (there's no real IdP to authenticate against). That tab
    // is left for you to fill with a real provider on a real deploy.
    // Approval policy (Security > Approval Policies) — idempotent by name.
    `POLICY_NAME="Loomster Default Approval Policy"`,
    `if curl -fsS "$BASE/api/settings/approval-policies" | jq -e --arg n "$POLICY_NAME" 'any(.[]; .name == $n)' >/dev/null; then`,
    `  verdict demo-approval-policy present`,
    `elif curl -fsS -X POST "$BASE/api/settings/approval-policies" -H 'Content-Type: application/json' \\`,
    `    -d "{\\"name\\":\\"$POLICY_NAME\\",\\"policy_type\\":\\"tool_context\\",\\"tool_match_rules\\":[\\"*\\"],\\"approval_mode\\":\\"notify_only\\",\\"timeout_seconds\\":300,\\"agent_scope\\":{\\"type\\":\\"all\\"},\\"enabled\\":true}" >/dev/null; then`,
    `  verdict demo-approval-policy ok`,
    `else`,
    `  verdict demo-approval-policy failed "POST /api/settings/approval-policies failed"`,
    `fi`,
    // The demo agent deploys async above; wait for it to settle. FAILED (or
    // never READY) is a failed demo, whatever Loom's API accepted.
    `AID=$(curl -fsS "$BASE/api/agents" 2>/dev/null | jq -r '.[] | select(.name=="loomster_demo_agent") | .id // empty' | head -n1 || true)`,
    `ASTATUS=""`,
    `if [ -n "$AID" ]; then`,
    `  for i in $(seq 1 40); do`,
    `    ASTATUS=$(curl -fsS "$BASE/api/agents" 2>/dev/null | jq -r '.[] | select(.name=="loomster_demo_agent") | .status // empty' | head -n1 || true)`,
    `    if [ "$ASTATUS" = "READY" ] || [ "$ASTATUS" = "FAILED" ]; then break; fi`,
    `    sleep 3`,
    `  done`,
    `fi`,
    `if [ "$ASTATUS" = "READY" ]; then verdict demo-agent-ready ok`,
    `else verdict demo-agent-ready failed "demo agent is \${ASTATUS:-missing}, not READY"; fi`,
    // Runtime dashboards (Costs, Admin audit, Invocations, Chat) fill from real
    // invocation records, not seeding — so light them up honestly by invoking the
    // demo agent a few times. Idempotent: skip once any invocation exists. demo-only
    // — invoking a real agent on a live account costs money, which is why this
    // never runs on foundation.
    `INVOCATIONS=$(curl -fsS "$BASE/api/dashboard/costs" 2>/dev/null | jq -r '.total_invocations // empty' || true)`,
    `if [ -z "$INVOCATIONS" ]; then`,
    `  verdict demo-invocations failed "GET /api/dashboard/costs gave no total_invocations"`,
    `elif [ "$INVOCATIONS" != 0 ]; then`,
    `  verdict demo-invocations present "$INVOCATIONS recorded"`,
    `elif [ "$ASTATUS" != "READY" ]; then`,
    `  verdict demo-invocations failed "the demo agent is not READY to invoke"`,
    `else`,
    `  OK=0`,
    `  for PROMPT in "What can you help me with?" "Summarize what you do" "List your capabilities"; do`,
    `    if curl -fsS -N --max-time 25 -X POST "$BASE/api/agents/$AID/invoke" -H 'Content-Type: application/json' \\`,
    `      -d "{\\"prompt\\":\\"$PROMPT\\",\\"payload\\":{\\"prompt\\":\\"$PROMPT\\"}}" >/dev/null 2>&1; then OK=$((OK + 1)); fi`,
    `  done`,
    `  if [ "$OK" -gt 0 ]; then verdict demo-invocations ok "$OK of 3 invocations answered (runtime dashboards populated)"`,
    `  else verdict demo-invocations failed "none of 3 invocations answered"; fi`,
    `fi`,
    `finish "demo seed complete"`,
  ]
    .join("\n")
    // Every request authenticates when a token is present (see AUTHCFG above).
    .replace(/curl -fsS/g, `curl -fsS -K "$AUTHCFG"`);
}
