/**
 * Script for `chant run loom-bootstrap` (loomster#38): the run-once-per-account
 * steps of Loom's `shared/makefile` (`agentcore.init`, `ecs.init`). Each one
 * creates a service-linked role a fresh account may not have yet:
 *
 *   - `ecs.amazonaws.com` (AWSServiceRoleForECS), which the ECS cluster and
 *     services need;
 *   - `runtime-identity.bedrock-agentcore.amazonaws.com`
 *     (AWSServiceRoleForBedrockAgentCoreRuntimeIdentity), which AgentCore
 *     Runtime's workload identity needs before the first agent deploys.
 *
 * Not a CloudFormation resource: `AWS::IAM::ServiceLinkedRole` fails when the
 * role already exists, and a service-linked role is per account, not per
 * deployment, so a second instance (or an account where AWS already created
 * it) would fail its first stack. The script looks the role up by its
 * service path and creates only what is missing, so it is safe to run on
 * every deploy. Loom's makefile does the same with `|| true`, which also hides
 * a real failure (no iam:CreateServiceLinkedRole); this reports one.
 */

/** A service-linked role Loom needs: the service principal and the role AWS names for it. */
export interface ServiceLinkedRole {
  service: string;
  roleName: string;
  /** Loom's makefile target that creates it. */
  loomTarget: string;
}

export const LOOM_SERVICE_LINKED_ROLES: ServiceLinkedRole[] = [
  { service: "ecs.amazonaws.com", roleName: "AWSServiceRoleForECS", loomTarget: "ecs.init" },
  {
    service: "runtime-identity.bedrock-agentcore.amazonaws.com",
    roleName: "AWSServiceRoleForBedrockAgentCoreRuntimeIdentity",
    loomTarget: "agentcore.init",
  },
];

/** The bootstrap step: for each role, keep it if present, create it if not. Idempotent. */
export function bootstrapScript(roles: ServiceLinkedRole[] = LOOM_SERVICE_LINKED_ROLES): string {
  return [
    "set -euo pipefail",
    `ensure_slr() { # service role-name loom-target`,
    // Looked up by its service path: the role name is AWS's to choose, the path is fixed.
    `  local found`,
    `  found="$(aws iam list-roles --path-prefix "/aws-service-role/$1/" --query "Roles[0].RoleName" --output text)"`,
    `  if [ -n "$found" ] && [ "$found" != None ]; then`,
    `    echo "loom-bootstrap: $found ($1) already exists"`,
    `    return 0`,
    `  fi`,
    `  echo "loom-bootstrap: creating the $1 service-linked role ($2, Loom's make $3)"`,
    `  aws iam create-service-linked-role --aws-service-name "$1" >/dev/null`,
    `}`,
    ...roles.map((r) => `ensure_slr ${r.service} ${r.roleName} ${r.loomTarget}`),
    `echo "loom-bootstrap: the account has every service-linked role Loom needs"`,
  ].join("\n");
}
