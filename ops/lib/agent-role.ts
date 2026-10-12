/**
 * Scripts for `chant run loom-agent-role` (loomster#2): deploy one Loom
 * agent's execution role stack (`../../src/loom-agent-role/`, the chant
 * version of Loom's `shared/iac/role.yaml`), then register it in Loom
 * (Security > Roles) tagged into the agent's group. Loom v1.9.0 never creates
 * IAM itself, so this is how a per-agent role comes to exist.
 *
 * The agent and group are read when the step runs (LOOM_AGENT_ROLE_AGENT,
 * LOOM_AGENT_ROLE_GROUP), not baked in at build time, so one built Op serves
 * any agent. The same vars drive the stack's build params
 * (`../../chant.config.ts`).
 */

export interface AgentRoleRefs {
  /** `{project}-{env}-{instance}`: the stack is `<prefix>-agent-role-<agent with _ as ->`. */
  stackPrefix: string;
}

/** Shared preamble: required inputs, the stack name, and the role ARN once deployed. */
function preamble(refs: AgentRoleRefs): string[] {
  return [
    "set -euo pipefail",
    `AGENT="\${LOOM_AGENT_ROLE_AGENT:?set LOOM_AGENT_ROLE_AGENT to the Loom agent name the role is for}"`,
    `GROUP="\${LOOM_AGENT_ROLE_GROUP:?set LOOM_AGENT_ROLE_GROUP to the Loom group (loom:group) that may deploy with it}"`,
    `SUFFIX="\${AGENT//_/-}"`,
    `STACK="${refs.stackPrefix}-agent-role-$SUFFIX"`,
  ];
}

/** Phase 1: synthesize and deploy the role stack (idempotent: an unchanged stack is a no-op). */
export function deployAgentRoleScript(refs: AgentRoleRefs): string {
  return [
    ...preamble(refs),
    `TEMPLATE="dist/agent-role-$SUFFIX.template.json"`,
    `mkdir -p dist`,
    `npx chant build src/loom-agent-role --lexicon aws -o "$TEMPLATE"`,
    `echo "loom-agent-role: deploying $STACK for agent $AGENT (group $GROUP)"`,
    `aws cloudformation deploy --stack-name "$STACK" --template-file "$TEMPLATE" --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset`,
    `ROLE_ARN=$(aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='oAgentRoleArn'].OutputValue | [0]" --output text)`,
    `echo "loom-agent-role: role $ROLE_ARN"`,
  ].join("\n");
}

/** Phase 2: register the role in Loom, tagged into the group (idempotent: an already-registered ARN is left alone). */
export function importAgentRoleScript(refs: AgentRoleRefs): string {
  return [
    ...preamble(refs),
    `BASE="\${LOOM_API_BASE_URL:-http://localhost:8080}"`,
    // Bearer token through a curl -K config file, kept out of argv (same as loom-seed).
    `AUTHCFG="$(mktemp)"; trap 'rm -f "$AUTHCFG"' EXIT`,
    `if [ -n "\${LOOM_API_TOKEN:-}" ]; then printf 'header = "Authorization: Bearer %s"\\n' "$LOOM_API_TOKEN" > "$AUTHCFG"; fi`,
    `ROLE_ARN=$(aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='oAgentRoleArn'].OutputValue | [0]" --output text)`,
    `if [ -z "$ROLE_ARN" ] || [ "$ROLE_ARN" = None ]; then echo "loom-agent-role: $STACK has no oAgentRoleArn output" >&2; exit 1; fi`,
    `if curl -fsS -K "$AUTHCFG" "$BASE/api/security/roles" | jq -e --arg a "$ROLE_ARN" 'any(.[]; .role_arn == $a)' >/dev/null; then`,
    `  echo "loom-agent-role: $ROLE_ARN is already registered in Loom"; exit 0`,
    `fi`,
    `BODY=$(jq -cn --arg a "$ROLE_ARN" --arg g "$GROUP" --arg n "$AGENT" '{role_arn: $a, role_type: "agent", description: ("Execution role for agent " + $n + " (loom-agent-role)"), tags: {"loom:application": "loomster", "loom:group": $g, "loom:owner": "loomster"}}')`,
    `curl -fsS -K "$AUTHCFG" -X POST "$BASE/api/security/roles" -H 'Content-Type: application/json' -d "$BODY" >/dev/null`,
    `echo "loom-agent-role: registered $ROLE_ARN in Loom (group $GROUP); deploy agent $AGENT with it"`,
  ].join("\n");
}
