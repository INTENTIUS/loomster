/**
 * Script for `chant run loom-tunnel-host` (loomster#37): deploy the optional
 * SSM tunnel host (`../../src/loom-tunnel-host/`, the chant version of Loom's
 * `backend/iac/ec2.yaml`) into this deployment's network.
 *
 * Its inputs come from the deployed stacks when the step runs, each one
 * overridable by setting the LOOM_TUNNEL_* variable first (the same vars are
 * the stack's build params, `../../chant.config.ts`):
 * - LOOM_TUNNEL_VPC_ID      <- shared-foundation `oVpcId`
 * - LOOM_TUNNEL_SUBNET_IDS  <- shared-foundation `oPrivateSubnetIds` (`:`-joined
 *   there, `SUBNET_LIST_DELIMITER`; comma-separated here)
 * - LOOM_TUNNEL_DB_SG_ID    <- loom-db `oRdsSecurityGroupId` (provisioned DB
 *   only; with a referenced DB, open its security group to the host yourself)
 * - LOOM_TUNNEL_DB_PORT     <- loom-db `oRdsPort`
 */

/** CloudFormation stack suffix: `{project}-{env}-{instance}-tunnel-host`. */
export const TUNNEL_HOST_STACK = "tunnel-host";

export interface TunnelHostRefs {
  /** `{project}-{env}-{instance}`, the prefix every stack of this deployment shares. */
  stackPrefix: string;
}

/** `out <stack> <key>`: one stack output, empty when the stack or the key is missing. */
const OUT_FN =
  `out() { aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text 2>/dev/null | grep -v '^None$' || true; }`;

/** Synthesize and deploy the tunnel host stack (idempotent: an unchanged stack is a no-op). */
export function deployTunnelHostScript(refs: TunnelHostRefs): string {
  const stack = `${refs.stackPrefix}-${TUNNEL_HOST_STACK}`;
  const foundation = `${refs.stackPrefix}-shared-foundation`;
  const db = `${refs.stackPrefix}-loom-db`;
  return [
    "set -euo pipefail",
    OUT_FN,
    `export LOOM_TUNNEL_VPC_ID="\${LOOM_TUNNEL_VPC_ID:-$(out ${foundation} oVpcId)}"`,
    `export LOOM_TUNNEL_SUBNET_IDS="\${LOOM_TUNNEL_SUBNET_IDS:-$(out ${foundation} oPrivateSubnetIds | tr ':' ',')}"`,
    `export LOOM_TUNNEL_DB_SG_ID="\${LOOM_TUNNEL_DB_SG_ID:-$(out ${db} oRdsSecurityGroupId)}"`,
    `export LOOM_TUNNEL_DB_PORT="\${LOOM_TUNNEL_DB_PORT:-$(out ${db} oRdsPort)}"`,
    `[ -n "$LOOM_TUNNEL_DB_PORT" ] || unset LOOM_TUNNEL_DB_PORT`,
    `[ -n "$LOOM_TUNNEL_DB_SG_ID" ] || { unset LOOM_TUNNEL_DB_SG_ID; echo "loom-tunnel-host: ${db} has no oRdsSecurityGroupId (a referenced DB?); open the database's security group to the host yourself" >&2; }`,
    `[ -n "$LOOM_TUNNEL_VPC_ID" ] || { echo "loom-tunnel-host: no VPC: deploy shared-foundation (${foundation}) first, or set LOOM_TUNNEL_VPC_ID" >&2; exit 1; }`,
    `[ -n "$LOOM_TUNNEL_SUBNET_IDS" ] || { echo "loom-tunnel-host: no private subnets: set LOOM_TUNNEL_SUBNET_IDS" >&2; exit 1; }`,
    `TEMPLATE="dist/${TUNNEL_HOST_STACK}.template.json"`,
    `mkdir -p dist`,
    `npx chant build src/loom-tunnel-host --lexicon aws -o "$TEMPLATE"`,
    `echo "loom-tunnel-host: deploying ${stack} into $LOOM_TUNNEL_VPC_ID (subnets $LOOM_TUNNEL_SUBNET_IDS, SSM endpoints \${LOOM_TUNNEL_SSM_ENDPOINTS:-false})"`,
    `aws cloudformation deploy --stack-name "${stack}" --template-file "$TEMPLATE" --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset`,
    `echo "loom-tunnel-host: instance $(out ${stack} oInstanceId); open the tunnel with: just tunnel"`,
  ].join("\n");
}
